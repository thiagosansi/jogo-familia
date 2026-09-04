/**
 * Persistência local do jogo (IndexedDB via `idb`).
 *
 * Decisão de projeto: o IndexedDB é a VERDADE. Toda tela lê e escreve aqui, e
 * o jogo funciona inteiro sem rede — a nuvem (`nuvem.ts`, `sincronia.ts`) é
 * opcional e sempre chega depois. Este arquivo não conhece Supabase: ele só
 * AVISA quem quiser (`aoMudarProgresso`) que o progresso mudou.
 *
 * Object stores:
 *  - `personagens` (keyPath `id`, índice `papel`) — familiares com foto/vozes
 *  - `progresso`   (keyPath `id`) — registro único `PROGRESSO_ID`
 *  - `config`      (keyPath `id`) — registro único `CONFIG_ID`
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AcertosEixo,
  Config,
  Eixo,
  Figurinha,
  Papel,
  Personagem,
  Progresso,
} from "./tipos";

/** Papéis aceitos no cadastro de familiares. */
export const PAPEIS: readonly Papel[] = ["mae", "pai", "irmao", "parente", "mascote"];

/** Eixos de aprendizado — cada modo de jogo alimenta um deles. */
export const EIXOS: readonly Eixo[] = [
  "familia",
  "cores",
  "contar",
  "animais",
  "ingles",
  "letras",
  "memoria",
];

export const DB_NOME = "jogo-familia";
export const DB_VERSAO = 1;

export const PROGRESSO_ID = "unico";
export const CONFIG_ID = "unico";

/**
 * Config padrão: todos os modos ligados.
 *
 * `limiteSessaoMin: 0` — limite de tempo TEMPORARIAMENTE DESLIGADO (0 = sem
 * limite, ver `limiteEmMs` em `src/game/sessao.ts`). Motivo: o dono do
 * projeto estava esbarrando na despedida ao testar no computador. Voltar
 * para `7` restaura o comportamento anterior (7 min por sessão).
 */
export const CONFIG_PADRAO: Config = {
  id: CONFIG_ID,
  limiteSessaoMin: 0,
  modosAtivos: [
    "familia",
    "cores",
    "contar",
    "animais",
    "aquario",
    "ingles",
    "letras",
    "numeros",
    "memoria",
  ],
};

/**
 * Fotografia CONGELADA dos ids de `CONFIG_PADRAO.modosAtivos` no momento em
 * que a reconciliação abaixo foi escrita — NÃO é "os modos de hoje", é um
 * retrato de um instante passado que precisa parar no tempo de propósito.
 * Ela é o "corte" que permite distinguir, num array salvo, id que sumiu por
 * ser NOVO no padrão (deve ser tratado como ativo) de id que sumiu porque
 * foi deixado de fora na hora de salvar (deve continuar de fora). Sem esse
 * corte as duas situações são indistinguíveis, e qualquer array salvo —
 * mesmo um subconjunto de propósito — acabaria sempre voltando pro padrão
 * inteiro.
 *
 * "ingles" NÃO ENTRA aqui — de propósito. Esse é o próprio bug que motivou
 * este comentário: `ingles` foi criado e alguém "atualizou" esta lista pra
 * incluí-lo, junto com o padrão. Resultado: para quem já tinha config salva
 * (sem `ingles`), a conta em `reconciliarModosAtivos` dava
 * `idsSalvos.has("ingles") === false` E `!idsBase.has("ingles") === false`
 * (porque "ingles" TINHA sido colocado na base) — ou seja, `ingles` era
 * filtrado fora. O mecanismo criado para NUNCA esconder um modo novo
 * escondia exatamente o modo novo.
 *
 * REGRA PARA A PRÓXIMA PESSOA: quando um modo novo entrar em
 * `CONFIG_PADRAO.modosAtivos`, ele NÃO entra aqui. Esta lista só existe
 * para representar o padrão de ANTES do modo novo mais recente existir.
 * Atualizá-la junto com `CONFIG_PADRAO` reintroduz este exato bug.
 */
const MODOS_PADRAO_BASE: readonly string[] = [
  "familia",
  "cores",
  "contar",
  "animais",
  "aquario",
];

/**
 * Reconcilia o `modosAtivos` salvo no IndexedDB com o padrão atual.
 *
 * Por que existe: `getConfig` faz `{ ...CONFIG_PADRAO, ...salvo }`, e como
 * `modosAtivos` é um array, `salvo.modosAtivos` SUBSTITUI o array do padrão
 * inteiro — não faz merge item a item. Um aparelho que salvou a config antes
 * de um modo novo existir (caso real e concreto: `ingles`, criado depois dos
 * cinco modos originais) teria um array sem esse id, e passaria a esconder o
 * modo novo sem que o adulto tivesse escolhido escondê-lo.
 *
 * Regra adotada ENQUANTO NÃO existir UI para o adulto editar `modosAtivos`:
 * um id que já existia em `MODOS_PADRAO_BASE` e está ausente do salvo é uma
 * exclusão respeitada (é o que o teste manual de "escrever um subconjunto"
 * espera). Já um id do padrão atual que NÃO está em `MODOS_PADRAO_BASE` — ou
 * seja, chegou depois — é sempre tratado como ativo quando ausente do salvo,
 * porque nenhuma tela jamais deu ao adulto a chance de desligá-lo de
 * propósito.
 *
 * NO DIA em que existir uma tela real de edição, `setConfig` passa a gravar
 * escolhas de verdade e este corte fica errado: qualquer ausência (mesmo de
 * um id antigo) passará a ser uma escolha legítima do adulto, não um
 * artefato de versão antiga. Nesse momento, remova `MODOS_PADRAO_BASE` e a
 * chamada a esta função — o merge raso do `getConfig` já é a regra certa.
 *
 * Ids desconhecidos no salvo (modo que não existe mais) são ignorados aqui
 * porque o resultado nunca contém nada fora de `padraoAtual`.
 */
export function reconciliarModosAtivos(
  padraoAtual: readonly string[],
  salvo: readonly string[] | undefined,
  baseConhecida: readonly string[] = MODOS_PADRAO_BASE,
): string[] {
  if (!salvo) return [...padraoAtual];
  const idsSalvos = new Set(salvo);
  const idsBase = new Set(baseConhecida);
  return padraoAtual.filter((id) => idsSalvos.has(id) || !idsBase.has(id));
}

/**
 * Filtra itens (ex.: os modos da home) pelos ids ativos, com FALHA ABERTA:
 * o resultado nunca fica vazio.
 *
 * `idsAtivos` nulo (config não pôde ser lida — aba anônima, quota, storage
 * bloqueado) ou vazio, ou um filtro que não sobra nenhum item (ex.: só
 * ids desconhecidos), devolve TODOS os itens. Home vazia para uma criança de
 * 3 anos é pior do que qualquer filtro errado.
 */
export function filtrarPorIdsAtivos<T>(
  itens: readonly T[],
  idsAtivos: readonly string[] | null,
  obterId: (item: T) => string,
): T[] {
  if (!idsAtivos || idsAtivos.length === 0) return [...itens];
  const ativos = new Set(idsAtivos);
  const filtrados = itens.filter((item) => ativos.has(obterId(item)));
  return filtrados.length > 0 ? filtrados : [...itens];
}

function progressoVazio(): Progresso {
  const porEixo = {} as Record<Eixo, AcertosEixo>;
  for (const eixo of EIXOS) porEixo[eixo] = { acertos: 0, erros: 0 };
  return { id: PROGRESSO_ID, figurinhas: [], porEixo, atualizadoEm: Date.now() };
}

interface JogoDB extends DBSchema {
  personagens: {
    key: string;
    value: Personagem;
    indexes: { papel: Papel };
  };
  progresso: { key: string; value: Progresso };
  config: { key: string; value: Config };
}

let dbPromise: Promise<IDBPDatabase<JogoDB>> | null = null;

/** Abre (e cria/migra) o banco. Reaproveita a mesma promise em toda a app. */
export function getDB(): Promise<IDBPDatabase<JogoDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB indisponível neste ambiente."));
  }
  dbPromise ??= openDB<JogoDB>(DB_NOME, DB_VERSAO, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("personagens")) {
        const store = db.createObjectStore("personagens", { keyPath: "id" });
        store.createIndex("papel", "papel");
      }
      if (!db.objectStoreNames.contains("progresso")) {
        db.createObjectStore("progresso", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config", { keyPath: "id" });
      }
    },
  });
  return dbPromise;
}

/** Só para testes: descarta a conexão memoizada. */
export function _resetDB(): void {
  dbPromise = null;
}

// ---------------------------------------------------------------- personagens

/** Todos os familiares, do mais antigo para o mais novo. */
export async function listarPersonagens(): Promise<Personagem[]> {
  const db = await getDB();
  const todos = await db.getAll("personagens");
  return todos.sort((a, b) => a.criadoEm - b.criadoEm);
}

export async function getPersonagem(id: string): Promise<Personagem | undefined> {
  const db = await getDB();
  return db.get("personagens", id);
}

/** `true` só para o estouro de quota — nesse caso normalizar o Blob não ajuda. */
function ehErroDeQuota(erro: unknown): boolean {
  return erro instanceof DOMException && erro.name === "QuotaExceededError";
}

/**
 * Troca cada Blob do registro por uma cópia criada via `arrayBuffer()`.
 *
 * Contorna um bug conhecido do WebKit: às vezes ele recusa gravar no
 * IndexedDB um Blob/File "cru" que veio direto de `<input type=file>` ou de
 * `canvas.toBlob` (falha silenciosa ou `DataCloneError`). Recriar o Blob a
 * partir dos próprios bytes resolve.
 */
export async function normalizarBlobs(registro: Personagem): Promise<Personagem> {
  const normalizar = async (blob: Blob | null): Promise<Blob | null> =>
    blob ? new Blob([await blob.arrayBuffer()], { type: blob.type }) : null;
  return {
    ...registro,
    fotoRecorte: (await normalizar(registro.fotoRecorte)) as Blob,
    vozNome: await normalizar(registro.vozNome),
    vozFesta: await normalizar(registro.vozFesta),
  };
}

/**
 * Cria ou atualiza um familiar. `id` e `criadoEm` são preenchidos quando
 * ausentes, então a tela de cadastro só precisa passar nome/papel/foto/vozes.
 *
 * IMPORTANTE: a foto DEVE ter passado por `redimensionarImagem` — o IndexedDB
 * tem quota e uma foto crua de câmera (5-10 MB) estoura o orçamento rápido.
 *
 * Se `put` falhar (e não for quota estourada), tenta UMA vez com os Blobs
 * normalizados (ver `normalizarBlobs`) antes de propagar o erro.
 */
export async function salvarPersonagem(
  personagem: Omit<Personagem, "id" | "criadoEm"> & Partial<Pick<Personagem, "id" | "criadoEm">>,
): Promise<Personagem> {
  const registro: Personagem = {
    ...personagem,
    id: personagem.id ?? novoId(),
    criadoEm: personagem.criadoEm ?? Date.now(),
  };
  const db = await getDB();
  try {
    await db.put("personagens", registro);
    return registro;
  } catch (erro) {
    if (ehErroDeQuota(erro)) throw erro;
    const normalizado = await normalizarBlobs(registro);
    await db.put("personagens", normalizado);
    return normalizado;
  }
}

export async function removerPersonagem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("personagens", id);
}

// ------------------------------------------------------------------- config

export async function getConfig(): Promise<Config> {
  const db = await getDB();
  const salvo = await db.get("config", CONFIG_ID);
  if (!salvo) return { ...CONFIG_PADRAO };
  // `modosAtivos` não pode vir de um merge raso (ver `reconciliarModosAtivos`).
  const modosAtivos = reconciliarModosAtivos(CONFIG_PADRAO.modosAtivos, salvo.modosAtivos);
  return { ...CONFIG_PADRAO, ...salvo, id: CONFIG_ID, modosAtivos };
}

/** Atualização parcial: mescla sobre o que já está gravado. */
export async function setConfig(parcial: Partial<Omit<Config, "id">>): Promise<Config> {
  const atual = await getConfig();
  const proximo: Config = { ...atual, ...parcial, id: CONFIG_ID };
  const db = await getDB();
  await db.put("config", proximo);
  return proximo;
}

// ----------------------------------------------------------------- progresso

type OuvinteProgresso = (progresso: Progresso) => void;

const ouvintesProgresso = new Set<OuvinteProgresso>();

/**
 * Avisa quando o progresso muda. Existe por um motivo só: deixar o espelho na
 * nuvem (`sincronia.ts`) ouvir sem que nenhum mini-jogo precise saber que a
 * nuvem existe — a rodada grava local e segue, como sempre.
 *
 * Devolve a função de desassinar. Um ouvinte que lança não derruba os outros
 * nem a gravação que acabou de acontecer.
 */
export function aoMudarProgresso(ouvinte: OuvinteProgresso): () => void {
  ouvintesProgresso.add(ouvinte);
  return () => {
    ouvintesProgresso.delete(ouvinte);
  };
}

function avisarProgresso(progresso: Progresso): void {
  for (const ouvinte of ouvintesProgresso) {
    try {
      ouvinte(progresso);
    } catch {
      /* ouvinte quebrado não pode afetar o jogo */
    }
  }
}

export async function getProgresso(): Promise<Progresso> {
  const db = await getDB();
  const salvo = await db.get("progresso", PROGRESSO_ID);
  if (!salvo) return progressoVazio();
  // Garante que eixos novos (adicionados numa versão futura) apareçam zerados.
  const base = progressoVazio();
  return {
    ...base,
    ...salvo,
    porEixo: { ...base.porEixo, ...salvo.porEixo },
  };
}

/**
 * Registra uma figurinha conquistada e soma o acerto/erro no eixo.
 * Figurinha repetida (mesmo `id`) não duplica — a criança pode reconquistar.
 */
export async function addFigurinha(
  figurinhaId: string,
  eixo: Eixo,
  opcoes: { acertou?: boolean } = {},
): Promise<Progresso> {
  const atual = await getProgresso();
  const jaTem = atual.figurinhas.some((f) => f.id === figurinhaId);
  const nova: Figurinha = { id: figurinhaId, eixo, conquistadaEm: Date.now() };
  const placar = atual.porEixo[eixo] ?? { acertos: 0, erros: 0 };
  const acertou = opcoes.acertou ?? true;

  const proximo: Progresso = {
    ...atual,
    figurinhas: jaTem ? atual.figurinhas : [...atual.figurinhas, nova],
    porEixo: {
      ...atual.porEixo,
      [eixo]: {
        acertos: placar.acertos + (acertou ? 1 : 0),
        erros: placar.erros + (acertou ? 0 : 1),
      },
    },
    atualizadoEm: Date.now(),
  };
  await gravarProgresso(proximo);
  return proximo;
}

/**
 * Registra um `quaseLa` (toque na alternativa errada) no eixo. NÃO dá
 * figurinha e NÃO é derrota — o jogo não tem derrota.
 *
 * Por que existe: é o único sinal de dificuldade que o relatório dos pais
 * (`/pais/progresso`) tem para dizer "acertou de primeira quase sempre" ou
 * "ainda está pegando o jeito". `addFigurinha(..., { acertou: false })` não
 * serve para isso: ela ENTREGA a figurinha do id que recebe.
 */
export async function registrarQuaseLa(eixo: Eixo): Promise<Progresso> {
  const atual = await getProgresso();
  const placar = atual.porEixo[eixo] ?? { acertos: 0, erros: 0 };
  const proximo: Progresso = {
    ...atual,
    porEixo: { ...atual.porEixo, [eixo]: { ...placar, erros: placar.erros + 1 } },
    atualizadoEm: Date.now(),
  };
  await gravarProgresso(proximo);
  return proximo;
}

/**
 * Grava o progresso inteiro (e avisa os ouvintes). É por aqui que a mescla com
 * a nuvem entra no aparelho — e é o único ponto de escrita do store, para que
 * nenhuma gravação escape do aviso.
 */
export async function gravarProgresso(progresso: Progresso): Promise<Progresso> {
  const registro: Progresso = { ...progresso, id: PROGRESSO_ID };
  const db = await getDB();
  await db.put("progresso", registro);
  avisarProgresso(registro);
  return registro;
}

// ------------------------------------------------------------------- helpers

/** id estável sem dependência externa (randomUUID cai em fallback no iOS antigo). */
export function novoId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
