/**
 * Sincronização opcional com a nuvem (Supabase).
 *
 * O jogo continua sendo LOCAL: o IndexedDB é a verdade para jogar, e nada aqui
 * é necessário para a criança brincar offline. A nuvem existe por um motivo só:
 * a mãe cadastra no celular dela e a criança joga no tablet. O caminho é
 *
 *   painel dos pais (adulto logado) --sincronizar--> Supabase
 *   Supabase --link com o uuid da família--> /entrar no tablet --> IndexedDB
 *
 * Na volta, só o progresso: o tablet manda o álbum para a nuvem sem login
 * (`enviarProgresso`), sempre em segundo plano. Quem decide QUANDO mandar (e
 * o que fazer quando não há rede) é `sincronia.ts` — aqui só existe o cano.
 *
 * Contrato do backend: `supabase/README.md` e `supabase/migrations/*.sql`.
 * Resumo do que importa aqui:
 *  - as tabelas têm RLS ligado e ZERO policies; tudo passa pelas RPCs `jogo_*`;
 *  - `jogo_familia_carregar` é ANÔNIMA (é a criança jogando: não há login no
 *    tablet). As de cadastro exigem adulto logado E dono da família;
 *  - o uuid da família É a credencial: quem tem o link, joga.
 *
 * REGRA DE OURO — arte de terceiros não sobe. Personagens de papel `mascote`
 * vêm da pasta de imagens do adulto (desenho animado favorito da criança) e o
 * bucket é público por URL. Então `sincronizar` PULA todo `mascote`: eles
 * continuam locais, importados em cada aparelho pelo importador de pasta.
 *
 * Sem `NEXT_PUBLIC_SUPABASE_URL`/`..._PUBLISHABLE_KEY` o módulo carrega igual e
 * `nuvemConfigurada()` devolve false — a UI simplesmente esconde a seção.
 *
 * O `@supabase/supabase-js` entra por `import()` dinâmico: fica fora do caminho
 * anônimo (que usa `fetch` cru, como o README mostra) e fora do `node --test`.
 */
import { listarPersonagens, salvarPersonagem } from "./db.ts";
import { redimensionarImagem } from "./media.ts";
import type { Papel, Personagem } from "./tipos.ts";

const URL_NUVEM = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const CHAVE_NUVEM = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** Bucket das fotos e vozes (ver migration `..._jogo_familia_storage.sql`). */
export const BUCKET = "jogo-familia";

/** Limite por arquivo no bucket. Acima disso o Storage recusa o upload. */
export const LIMITE_ARQUIVO = 5 * 1024 * 1024;

/**
 * Papéis que a sincronização envia. `mascote` está FORA de propósito: é arte de
 * terceiros e o bucket é público por URL.
 */
export const PAPEIS_NA_NUVEM: readonly Papel[] = ["mae", "pai", "irmao", "parente"];

/** Erro previsto da nuvem, já com mensagem pronta para mostrar ao adulto. */
export class NuvemErro extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "NuvemErro";
  }
}

/** true quando as variáveis de ambiente existem. Sem elas, a nuvem some da UI. */
export function nuvemConfigurada(): boolean {
  return Boolean(URL_NUVEM && CHAVE_NUVEM);
}

/** Este familiar pode subir? Mascote nunca sobe. */
export function podeSubir(papel: Papel): boolean {
  return PAPEIS_NA_NUVEM.includes(papel);
}

// ------------------------------------------------------------------ caminhos

/** Segmento de caminho seguro no Storage. O id local costuma ser uuid, mas o
 *  fallback de `novoId()` (iOS antigo) não é — melhor não confiar. */
function segmento(valor: string): string {
  const limpo = valor.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
  return limpo || "sem-id";
}

/**
 * Pasta da mídia de um familiar: `<familia_id>/<personagem_id>/`.
 *
 * O `<personagem_id>` aqui é o id LOCAL do personagem, não o da linha no banco.
 * É de propósito: permite subir a mídia ANTES de existir linha nenhuma (ver
 * `sincronizar`) e faz o reenvio sobrescrever sempre o mesmo arquivo, em vez de
 * ir deixando órfãos no bucket. A policy do Storage só olha o primeiro
 * segmento (a família), então o segundo é livre.
 */
export function pastaDoPersonagem(familiaId: string, personagemLocalId: string): string {
  return `${segmento(familiaId)}/${segmento(personagemLocalId)}`;
}

/** URL pública de um arquivo do bucket (o bucket é público por URL). */
export function urlPublica(caminho: string): string {
  return `${URL_NUVEM}/storage/v1/object/public/${BUCKET}/${caminho
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** Link que o adulto manda para o tablet. O uuid da família é a credencial. */
export function linkDoJogo(familiaId: string, origem?: string): string {
  const base = origem ?? (typeof window === "undefined" ? "" : window.location.origin);
  return `${base}/entrar?familia=${encodeURIComponent(familiaId)}`;
}

/** `audio/webm;codecs=opus` -> `audio/webm` (o bucket valida o mime exato). */
function mimeBase(tipo: string): string {
  return (tipo.split(";")[0] ?? "").trim().toLowerCase();
}

/** Mimes aceitos pelo bucket -> extensão do arquivo. */
const EXTENSAO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

// -------------------------------------------------------------------- client

type Cliente = import("@supabase/supabase-js").SupabaseClient;

let clientePromise: Promise<Cliente> | null = null;

/**
 * Cliente Supabase do browser. Singleton por aba, como em
 * `~/lista-compras/src/lib/supabase/client.ts` — só sem `@supabase/ssr`: lá o
 * client existe para casar cookie com o servidor, e aqui não há servidor. O
 * painel é client-side puro, então a sessão do adulto mora no localStorage
 * deste aparelho e o SDK cuida sozinho do refresh do token.
 */
async function cliente(): Promise<Cliente> {
  if (!nuvemConfigurada()) {
    throw new NuvemErro("A nuvem não está configurada neste aparelho.");
  }
  clientePromise ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(URL_NUVEM, CHAVE_NUVEM, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Não usamos magic link nem OAuth; ler o hash da URL só traria surpresa.
        detectSessionInUrl: false,
      },
    }),
  );
  return clientePromise;
}

// ---------------------------------------------------------------------- auth

export interface Adulto {
  id: string;
  email: string;
}

/** Mensagens do GoTrue em português — o painel é para a mãe, não para mim. */
function traduzir(mensagem: string): string {
  const m = mensagem.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email ou senha incorretos.";
  if (m.includes("email not confirmed")) return "Confirme seu email antes de entrar.";
  if (m.includes("already registered")) return "Este email já tem conta. Tente entrar.";
  if (m.includes("password should be")) return "A senha precisa de pelo menos 6 caracteres.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Muitas tentativas seguidas. Espere um minuto.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Sem conexão.";
  // A RPC responde exatamente isto quando o adulto logado não é o dono; o
  // Storage, no mesmo caso, responde com a violação de RLS da policy do bucket.
  if (m.includes("não é sua") || m.includes("row-level security") || m.includes("unauthorized"))
    return "Essa família é de outra conta (ou você não está logado).";
  return mensagem;
}

/** Adulto logado neste aparelho, ou null. Nunca lança: sem nuvem, é null. */
export async function adultoAtual(): Promise<Adulto | null> {
  if (!nuvemConfigurada()) return null;
  try {
    const sb = await cliente();
    const { data } = await sb.auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
  } catch {
    return null;
  }
}

/** Entra com as mesmas contas do lista-compras (email + senha). */
export async function entrar(email: string, senha: string): Promise<Adulto> {
  const sb = await cliente();
  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim(),
    password: senha,
  });
  if (error) throw new NuvemErro(traduzir(error.message));
  const u = data.user;
  if (!u) throw new NuvemErro("Não consegui entrar.");
  return { id: u.id, email: u.email ?? "" };
}

/**
 * Cria uma conta nova. Devolve null quando o projeto exige confirmação por
 * email (aí ainda não há sessão e o adulto precisa clicar no link).
 */
export async function criarConta(email: string, senha: string): Promise<Adulto | null> {
  const sb = await cliente();
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password: senha });
  if (error) throw new NuvemErro(traduzir(error.message));
  // Email já cadastrado: o Supabase devolve um usuário "fantasma" sem identidades.
  if (data.user?.identities?.length === 0) {
    throw new NuvemErro("Este email já tem conta. Tente entrar.");
  }
  if (!data.session || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

export async function sair(): Promise<void> {
  if (!nuvemConfigurada()) return;
  const sb = await cliente();
  await sb.auth.signOut();
}

// ------------------------------------------------------------------ famílias

export interface FamiliaNuvem {
  id: string;
  nome: string;
  criadoEm: string;
  personagens: number;
}

export async function listarFamilias(): Promise<FamiliaNuvem[]> {
  const sb = await cliente();
  const { data, error } = await sb.rpc("jogo_familias_do_dono");
  if (error) throw new NuvemErro(traduzir(error.message));
  const linhas = (data ?? []) as {
    id: string;
    nome: string;
    criado_em: string;
    personagens: number;
  }[];
  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    criadoEm: l.criado_em,
    personagens: Number(l.personagens ?? 0),
  }));
}

export async function criarFamilia(nome: string): Promise<string> {
  const sb = await cliente();
  const { data, error } = await sb.rpc("jogo_familia_criar", { p_nome: nome.trim() });
  if (error) throw new NuvemErro(traduzir(error.message));
  return String(data);
}

// --------------------------------------------------------- leitura sem login

export interface PersonagemNuvem {
  id: string;
  nome: string;
  papel: Papel;
  fotoCaminho: string | null;
  vozNomeCaminho: string | null;
  vozFestaCaminho: string | null;
}

export interface FamiliaCarregada {
  familia: { id: string; nome: string };
  personagens: PersonagemNuvem[];
  /**
   * Espelho do álbum na nuvem (jsonb cru — quem normaliza é `sincronia.ts`).
   * Vem junto porque a RPC já devolve: uma viagem só para família e progresso.
   */
  progresso: { figurinhas?: unknown; porEixo?: unknown } | null;
}

/**
 * Carrega a família pelo uuid — SEM login, é a criança abrindo o link.
 *
 * Usa `fetch` cru de propósito: o caminho anônimo não precisa carregar o SDK
 * inteiro. Devolve null quando o uuid não existe.
 */
export async function carregarFamilia(familiaId: string): Promise<FamiliaCarregada | null> {
  if (!nuvemConfigurada()) throw new NuvemErro("A nuvem não está configurada.");
  const r = await fetch(`${URL_NUVEM}/rest/v1/rpc/jogo_familia_carregar`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CHAVE_NUVEM,
      Authorization: `Bearer ${CHAVE_NUVEM}`,
    },
    body: JSON.stringify({ p_familia: familiaId }),
  });
  if (!r.ok) throw new NuvemErro("Não consegui falar com a nuvem.");
  const dados = (await r.json()) as FamiliaCarregada | null;
  if (!dados?.familia) return null;
  return {
    familia: dados.familia,
    personagens: dados.personagens ?? [],
    progresso: dados.progresso ?? null,
  };
}

/**
 * Grava o progresso da criança na nuvem — SEM login, `fetch` cru, igual à
 * leitura: quem joga é o tablet, e ele não tem conta.
 *
 * A RPC substitui a linha inteira (`on conflict do update`), então esta função
 * é idempotente por construção: mandar o mesmo retrato N vezes é igual a
 * mandar uma. É essa propriedade que deixa o reenvio do que foi ganho offline
 * ser burro e seguro. Quem chama é `sincronia.ts`, sempre em segundo plano.
 */
export async function enviarProgresso(
  familiaId: string,
  figurinhas: unknown,
  porEixo: unknown,
): Promise<void> {
  if (!nuvemConfigurada()) throw new NuvemErro("A nuvem não está configurada.");
  const r = await fetch(`${URL_NUVEM}/rest/v1/rpc/jogo_progresso_salvar`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CHAVE_NUVEM,
      Authorization: `Bearer ${CHAVE_NUVEM}`,
    },
    body: JSON.stringify({
      p_familia: familiaId,
      p_figurinhas: figurinhas ?? [],
      p_por_eixo: porEixo ?? {},
    }),
  });
  if (!r.ok) throw new NuvemErro("Não consegui salvar o progresso na nuvem.");
}

// ----------------------------------------------- memória local da nuvem

/**
 * De/para entre o id local do personagem e o id da linha no banco, por família.
 *
 * Sem isso, reenviar viraria duplicata. Fica em `localStorage` (e não no
 * IndexedDB) porque é preferência de aparelho, não conteúdo do jogo: apagar não
 * perde nada — `sincronizar` ainda casa por nome+papel com o que já está lá.
 */
const CHAVE_LOCAL = "jogo-familia:nuvem";

interface EstadoLocal {
  familiaSelecionada?: string;
  /** familiaId -> (idLocal -> idNaNuvem) */
  mapas?: Record<string, Record<string, string>>;
}

function lerEstado(): EstadoLocal {
  if (typeof localStorage === "undefined") return {};
  try {
    return (JSON.parse(localStorage.getItem(CHAVE_LOCAL) ?? "{}") as EstadoLocal) ?? {};
  } catch {
    return {};
  }
}

function gravarEstado(estado: EstadoLocal): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CHAVE_LOCAL, JSON.stringify(estado));
  } catch {
    // Modo privado / quota: o de/para é otimização, não requisito.
  }
}

export function familiaSelecionada(): string | null {
  return lerEstado().familiaSelecionada ?? null;
}

export function setFamiliaSelecionada(familiaId: string | null): void {
  const estado = lerEstado();
  if (familiaId) estado.familiaSelecionada = familiaId;
  else delete estado.familiaSelecionada;
  gravarEstado(estado);
}

function lerMapa(familiaId: string): Record<string, string> {
  return lerEstado().mapas?.[familiaId] ?? {};
}

function gravarMapa(familiaId: string, mapa: Record<string, string>): void {
  const estado = lerEstado();
  estado.mapas = { ...(estado.mapas ?? {}), [familiaId]: mapa };
  gravarEstado(estado);
}

// --------------------------------------------------------------- upload

/**
 * Deixa a foto dentro do limite do bucket. A foto do cadastro já passou por
 * `redimensionarImagem`, mas um pacote antigo (ou um import futuro) pode trazer
 * algo maior — e o Storage recusa acima de 5 MB.
 */
async function prepararFoto(foto: Blob): Promise<Blob> {
  const tipo = mimeBase(foto.type);
  if (foto.size <= LIMITE_ARQUIVO && EXTENSAO[tipo]) return foto;
  let menor = await redimensionarImagem(foto, 1024);
  if (menor.size > LIMITE_ARQUIVO) menor = await redimensionarImagem(foto, 720);
  if (menor.size > LIMITE_ARQUIVO) {
    throw new NuvemErro("A foto continua maior que 5 MB depois de redimensionar.");
  }
  return menor;
}

/** Sobe (ou substitui) um arquivo. Devolve o caminho gravado. */
async function subir(sb: Cliente, caminho: string, arquivo: Blob): Promise<string> {
  const tipo = mimeBase(arquivo.type);
  const { error } = await sb.storage.from(BUCKET).upload(caminho, arquivo, {
    // Reenviar o mesmo personagem sobrescreve em vez de estourar "já existe".
    upsert: true,
    contentType: EXTENSAO[tipo] ? tipo : "application/octet-stream",
  });
  if (error) throw new NuvemErro(traduzir(error.message));
  return caminho;
}

// ---------------------------------------------------------------- sincronizar

export interface ResultadoSync {
  /** Familiares gravados na nuvem. */
  enviados: number;
  /** Mascotes deixados de fora (arte de terceiros não sobe). */
  mascotesPulados: number;
  /** Coisas que não subiram, mas não impediram o resto. */
  avisos: string[];
  falhas: { nome: string; motivo: string }[];
}

export interface OpcoesSync {
  aoProgredir?: (feitos: number, total: number) => void;
}

/**
 * Envia os familiares deste aparelho para a família na nuvem.
 *
 * Ordem por familiar: **mídia primeiro, linha depois**. Se a rede cair no meio
 * de um upload, o que ficou no bucket é só arquivo solto — nenhuma linha aponta
 * para ele e o próximo sincronizar sobrescreve. Nunca sobra personagem
 * meio-cadastrado.
 *
 * Idempotente: o de/para em `localStorage` (e, como rede de segurança, o
 * casamento por nome+papel com o que já está na nuvem) faz o reenvio ATUALIZAR
 * a linha em vez de criar outra.
 *
 * Mascotes são pulados — ver a regra no topo do arquivo.
 */
export async function sincronizar(
  familiaId: string,
  personagens: Personagem[],
  opcoes: OpcoesSync = {},
): Promise<ResultadoSync> {
  const sb = await cliente();
  const enviaveis = personagens.filter((p) => podeSubir(p.papel));
  const resultado: ResultadoSync = {
    enviados: 0,
    mascotesPulados: personagens.length - enviaveis.length,
    avisos: [],
    falhas: [],
  };
  opcoes.aoProgredir?.(0, enviaveis.length);
  if (enviaveis.length === 0) return resultado;

  // O que já está lá: usado para casar por nome+papel quando o de/para local
  // sumiu (aparelho novo, localStorage limpo) e evitar duplicar.
  let naNuvem: PersonagemNuvem[] = [];
  try {
    naNuvem = (await carregarFamilia(familiaId))?.personagens ?? [];
  } catch {
    // Sem a leitura prévia ainda dá para sincronizar; só o casamento por nome
    // fica indisponível nesta rodada.
  }
  const chave = (nome: string, papel: string) => `${nome.trim().toLowerCase()}|${papel}`;
  const porNome = new Map(naNuvem.map((p) => [chave(p.nome, p.papel), p.id]));
  const mapa = { ...lerMapa(familiaId) };

  for (const [indice, p] of enviaveis.entries()) {
    try {
      const pasta = pastaDoPersonagem(familiaId, p.id);

      // 1) mídia
      const foto = await prepararFoto(p.fotoRecorte);
      const extFoto = EXTENSAO[mimeBase(foto.type)] ?? "jpg";
      const fotoCaminho = await subir(sb, `${pasta}/foto.${extFoto}`, foto);

      const vozes: (string | null)[] = [];
      for (const [rotulo, voz] of [
        ["voz-nome", p.vozNome],
        ["voz-festa", p.vozFesta],
      ] as const) {
        // Voz nula é caso válido: o jogo cai no TTS. Como a RPC trata caminho
        // nulo como "mantém a mídia atual", APAGAR uma voz aqui não a apaga na
        // nuvem — para isso o adulto remove o familiar e sincroniza de novo.
        if (!voz) {
          vozes.push(null);
          continue;
        }
        const tipo = mimeBase(voz.type);
        const ext = EXTENSAO[tipo];
        if (!ext) {
          resultado.avisos.push(`${p.nome}: formato de áudio não aceito (${tipo || "?"}).`);
          vozes.push(null);
          continue;
        }
        if (voz.size > LIMITE_ARQUIVO) {
          // Áudio não dá para redimensionar; melhor subir o resto do familiar.
          resultado.avisos.push(`${p.nome}: ${rotulo} passa de 5 MB e ficou de fora.`);
          vozes.push(null);
          continue;
        }
        vozes.push(await subir(sb, `${pasta}/${rotulo}.${ext}`, voz));
      }

      // 2) linha (só depois que a mídia está no bucket)
      const idConhecido = mapa[p.id] ?? porNome.get(chave(p.nome, p.papel)) ?? null;
      const idNaNuvem = await salvarLinha(sb, {
        familiaId,
        id: idConhecido,
        nome: p.nome,
        papel: p.papel,
        fotoCaminho,
        vozNomeCaminho: vozes[0] ?? null,
        vozFestaCaminho: vozes[1] ?? null,
        ordem: indice,
      });
      mapa[p.id] = idNaNuvem;
      porNome.set(chave(p.nome, p.papel), idNaNuvem);
      resultado.enviados += 1;
    } catch (e) {
      const motivo = e instanceof Error ? traduzir(e.message) : "erro desconhecido";
      // Não é dono da família: insistir nos outros só repete o mesmo erro.
      if (/de outra conta|inexistente/i.test(motivo)) {
        gravarMapa(familiaId, mapa);
        throw new NuvemErro(motivo);
      }
      resultado.falhas.push({ nome: p.nome, motivo });
    } finally {
      opcoes.aoProgredir?.(indice + 1, enviaveis.length);
    }
  }

  gravarMapa(familiaId, mapa);
  return resultado;
}

interface LinhaPersonagem {
  familiaId: string;
  id: string | null;
  nome: string;
  papel: Papel;
  fotoCaminho: string | null;
  vozNomeCaminho: string | null;
  vozFestaCaminho: string | null;
  ordem: number;
}

/**
 * `jogo_personagem_salvar`: `p_id` nulo cria, preenchido atualiza. Se o id que
 * guardamos apontar para uma linha que não existe mais (o adulto apagou pelo
 * outro aparelho), a RPC responde 'Personagem não encontrado' — aí cria.
 */
async function salvarLinha(sb: Cliente, linha: LinhaPersonagem): Promise<string> {
  const argumentos = (id: string | null) => ({
    p_familia: linha.familiaId,
    p_nome: linha.nome,
    p_papel: linha.papel,
    p_id: id,
    p_foto_caminho: linha.fotoCaminho,
    p_voz_nome_caminho: linha.vozNomeCaminho,
    p_voz_festa_caminho: linha.vozFestaCaminho,
    p_ordem: linha.ordem,
  });

  const { data, error } = await sb.rpc("jogo_personagem_salvar", argumentos(linha.id));
  if (!error) return String(data);
  if (linha.id && /não encontrado|nao encontrado/i.test(error.message)) {
    const nova = await sb.rpc("jogo_personagem_salvar", argumentos(null));
    if (nova.error) throw new NuvemErro(traduzir(nova.error.message));
    return String(nova.data);
  }
  throw new NuvemErro(traduzir(error.message));
}

// ------------------------------------------------------ baixar no aparelho

export interface ResultadoDownload {
  importados: number;
  atualizados: number;
  falhas: { nome: string; motivo: string }[];
  /** Progresso que estava na nuvem — `sincronia.adotarFamilia` mescla com o daqui. */
  progresso: { figurinhas?: unknown; porEixo?: unknown } | null;
}

/**
 * Traz a família da nuvem para o IndexedDB deste aparelho — é o que o tablet
 * faz quando a criança abre o link. Sem login: só o uuid.
 *
 * Depois disso o jogo volta a ser 100% local e offline; a nuvem só é lida de
 * novo se o adulto reabrir o link.
 */
export async function baixarParaAparelho(
  familiaId: string,
  opcoes: OpcoesSync = {},
): Promise<ResultadoDownload> {
  const dados = await carregarFamilia(familiaId);
  if (!dados) throw new NuvemErro("Não achei essa família. Confira o link.");

  const resultado: ResultadoDownload = {
    importados: 0,
    atualizados: 0,
    falhas: [],
    progresso: dados.progresso,
  };
  const locais = await listarPersonagens();
  const porId = new Map(locais.map((p) => [p.id, p]));
  // Se este aparelho já sincronizou (é o do adulto), respeita o de/para: assim
  // ele não ganha uma segunda cópia de cada familiar.
  const mapa = lerMapa(familiaId);
  const idLocalDe = new Map(Object.entries(mapa).map(([local, nuvem]) => [nuvem, local]));
  const base = Date.now();

  opcoes.aoProgredir?.(0, dados.personagens.length);
  for (const [indice, p] of dados.personagens.entries()) {
    try {
      // Sem foto não dá para jogar — `Personagem.fotoRecorte` é obrigatório.
      if (!p.fotoCaminho) {
        resultado.falhas.push({ nome: p.nome, motivo: "sem foto na nuvem" });
        continue;
      }
      const idLocal = idLocalDe.get(p.id) ?? p.id;
      const jaTinha = porId.get(idLocal);
      const foto = await baixarBlob(p.fotoCaminho);
      const vozNome = p.vozNomeCaminho ? await baixarBlob(p.vozNomeCaminho) : null;
      const vozFesta = p.vozFestaCaminho ? await baixarBlob(p.vozFestaCaminho) : null;

      await salvarPersonagem({
        id: idLocal,
        criadoEm: jaTinha?.criadoEm ?? base + indice,
        nome: p.nome,
        papel: p.papel,
        fotoRecorte: foto,
        vozNome,
        vozFesta,
      });
      if (jaTinha) resultado.atualizados += 1;
      else resultado.importados += 1;
    } catch (e) {
      resultado.falhas.push({
        nome: p.nome,
        motivo: e instanceof Error ? traduzir(e.message) : "erro desconhecido",
      });
    } finally {
      opcoes.aoProgredir?.(indice + 1, dados.personagens.length);
    }
  }
  return resultado;
}

async function baixarBlob(caminho: string): Promise<Blob> {
  const r = await fetch(urlPublica(caminho));
  if (!r.ok) throw new NuvemErro("Não consegui baixar a mídia.");
  return r.blob();
}
