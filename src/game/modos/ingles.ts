/**
 * MODO "INGLÊS" — conteúdo e montagem de rodada dos quatro baralhos, PURO
 * (sem React, sem DOM, sem IO). Roda em node: `node --test --experimental-strip-types`.
 *
 * REGRA "O INGLÊS NUNCA CHEGA SOZINHO": toda palavra nova em inglês vem
 * ANCORADA em algo que a criança já reconhece — um desenho já validado
 * (`animais.ts`/`cores.ts`), a própria foto da família, ou (nas saudações,
 * que ainda não têm arte) pelo menos um `id` estável para o desenho chegar
 * depois. A palavra nunca é a única pista: se a criança ainda não entende o
 * som em inglês, a imagem resolve sozinha — é assim que vocabulário novo
 * entra em quem tem 3 anos (input compreensível, não teste de audição).
 *
 * DECISÃO DE VOZ (produto, já tomada — este módulo só respeita):
 * a palavra em inglês é falada por síntese en-US; a comemoração usa a voz JÁ
 * GRAVADA da família (o mesmo áudio de sempre, não uma gravação nova por
 * palavra). Por isso NENHUM item de catálogo aqui tem campo de áudio: quem
 * decide qual `Blob` tocar é a página, olhando para `personagem.vozFesta`
 * (ou caindo para TTS) — este módulo só devolve texto.
 *
 * CINCO BARALHOS
 * ----------------
 *  1. `numeros`    — contar de 1 a 10; a rodada sorteia um SUBCONJUNTO do
 *                     pool (10 é mais do que a criança aguenta de uma vez).
 *  2. `cotidiano`   — substantivos do dia a dia, reaproveitando o desenho de
 *                     `animais.ts` e de `cores.ts` (formas). Zero arte nova.
 *  3. `familia`     — mommy/daddy/brother/sister sobre os personagens
 *                     cadastrados. Único baralho que depende de cadastro:
 *                     degrada (nunca lança) quando o elenco não dá.
 *  4. `saudacoes`   — hello/bye bye/thank you/please. Abstratas, então
 *                     dependem de ilustração própria (em desenho por outro
 *                     agente); o catálogo já referencia o `id` que a tela vai
 *                     usar para achar o desenho certo, mas não IMPORTA nada
 *                     de ilustração — os testes rodam sem ela existir.
 *  5. `cores`       — red/blue/yellow/green/purple. EXCEÇÃO INTENCIONAL à
 *                     regra "o inglês nunca chega sozinho" logo acima — ver
 *                     bloco dedicado antes de `montarRodadaCoresIngles`.
 *
 * LIMITAÇÃO CONHECIDA (família): `Personagem.papel` não guarda gênero — só
 * existe o papel `"irmao"` para irmãos/irmãs, sem distinguir menino de
 * menina (ver `src/lib/tipos.ts`). "brother" e "sister" mapeiam para o MESMO
 * papel; com um irmão cadastrado, os dois rótulos ficam disponíveis para a
 * MESMA foto. Preferimos essa simplificação documentada a inventar um campo
 * de gênero que não existe no cadastro (fora do escopo desta task).
 *
 * Uso típico (a página monta o `ConfigRodada` do `useRodada`):
 *
 *   const r = montarRodadaCotidiano({ qtd: dif.alternativas, sortear });
 *   useRodada({ pergunta: r.pergunta, alternativas: r.alternativas, correta: r.correta });
 *
 *   const rf = montarRodadaFamiliaIngles({ fichas, qtd: dif.alternativas, sortear });
 *   if (!rf) return <ConvitePulaBaralho />;  // "pular o baralho", nunca quebrar
 */

import { embaralhar, montarAlternativas, type Sorteio } from "../dificuldade.ts";
import { IDS_ANIMAIS, type IdAnimal } from "./animais.ts";
import { criarContagem, type EstadoContagem, type FalasContagem } from "./contar.ts";
import { CORES, IDS_COR, IDS_FORMA, peca, type CorId, type FormaObjeto } from "./cores.ts";
import type { Papel, Personagem } from "../../lib/tipos.ts";

// ------------------------------------------------------------ falas comuns

/**
 * SÓ A PALAVRA — pedido explícito do dono do produto: "no inglês é melhor
 * mostrar e falar apenas o que se quer [ensinar]". Uma frase carregadora
 * ("Show me X!") é ruído para quem ainda está adquirindo o vocabulário: a
 * criança não entende "show me", só a palavra-alvo é o item lexical que ela
 * precisa associar ao desenho na tela. Por isso a pergunta falada/exibida
 * nos quatro baralhos é só `"${Palavra}!"` — nunca uma frase em volta.
 */
function perguntaDaPalavra(palavra: string): string {
  return `${maiuscula(palavra)}!`;
}

/**
 * Comemoração-texto (fallback do TTS quando não há voz gravada tocando):
 * mesma regra da pergunta, só a palavra — repetir o vocabulário-alvo no
 * acerto reforça a associação som↔desenho; uma frase decorativa ("Yes!")
 * não ensina nada novo. O resultado é IGUAL ao de `perguntaDaPalavra` de
 * propósito: `useRodada` separa a chave de dedupe da fila de fala por
 * `motivo` (pergunta vs. festa), então o mesmo texto toca duas vezes sem
 * ser engolido pela deduplicação.
 */
function festaDaPalavra(palavra: string): string {
  return perguntaDaPalavra(palavra);
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** `montarAlternativas` só aceita 2|3|4 — a dificuldade pode pedir fora disso. */
function clampQtd(n: number): 2 | 3 | 4 {
  return Math.min(4, Math.max(2, Math.round(n))) as 2 | 3 | 4;
}

export type BaralhoIngles = "numeros" | "cotidiano" | "familia" | "saudacoes" | "cores";

export const BARALHOS_INGLES: readonly { readonly id: BaralhoIngles; readonly titulo: string }[] = [
  { id: "numeros", titulo: "Numbers" },
  { id: "cotidiano", titulo: "Everyday words" },
  { id: "familia", titulo: "Family" },
  { id: "saudacoes", titulo: "Hello & bye" },
  { id: "cores", titulo: "Colors" },
];

// ============================================================= 1. números

export type IdNumero = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";

export interface PalavraNumero {
  readonly id: IdNumero;
  /** Quantidade a desenhar na tela (bolinhas, bichinhos etc). */
  readonly valor: number;
  readonly palavra: string;
}

export const NUMEROS_INGLES: readonly PalavraNumero[] = [
  { id: "1", valor: 1, palavra: "one" },
  { id: "2", valor: 2, palavra: "two" },
  { id: "3", valor: 3, palavra: "three" },
  { id: "4", valor: 4, palavra: "four" },
  { id: "5", valor: 5, palavra: "five" },
  { id: "6", valor: 6, palavra: "six" },
  { id: "7", valor: 7, palavra: "seven" },
  { id: "8", valor: 8, palavra: "eight" },
  { id: "9", valor: 9, palavra: "nine" },
  { id: "10", valor: 10, palavra: "ten" },
];

export const IDS_NUMERO: readonly IdNumero[] = NUMEROS_INGLES.map((n) => n.id);

const NUMERO_POR_ID = new Map<string, PalavraNumero>(NUMEROS_INGLES.map((n) => [n.id, n]));

export function numeroPorId(id: string): PalavraNumero {
  const achado = NUMERO_POR_ID.get(id);
  if (!achado) throw new Error(`Número desconhecido no modo inglês: ${id}`);
  return achado;
}

/**
 * De 1 a 10, cada rodada só trabalha com esta fatia — o pool inteiro é
 * grande demais para os 3 anos escolherem de uma vez só. O alvo sempre
 * entra na fatia; o resto é sorteado do que sobrou.
 */
export const TAMANHO_SUBCONJUNTO_NUMEROS = 6;

function subconjuntoNumeros(alvo: IdNumero, sortear: Sorteio): PalavraNumero[] {
  const resto = NUMEROS_INGLES.filter((n) => n.id !== alvo);
  const tamanho = Math.min(TAMANHO_SUBCONJUNTO_NUMEROS - 1, resto.length);
  const fatia = embaralhar(resto, sortear).slice(0, tamanho);
  return embaralhar([numeroPorId(alvo), ...fatia], sortear);
}

/** Sorteia o próximo alvo evitando repetir o anterior. */
export function proximoNumero(anterior: IdNumero | null | undefined, sortear: Sorteio = Math.random): IdNumero {
  const candidatos = IDS_NUMERO.filter((id) => id !== anterior);
  const pool = candidatos.length > 0 ? candidatos : IDS_NUMERO;
  return embaralhar(pool, sortear)[0];
}

export interface RodadaNumeros {
  readonly pergunta: string;
  readonly festa: string;
  readonly alternativas: readonly IdNumero[];
  readonly correta: IdNumero;
  /** Conteúdo de cada alternativa, na mesma ordem. */
  readonly itens: readonly PalavraNumero[];
}

export interface OpcoesRodadaNumeros {
  /** Quantas alternativas (2, 3 ou 4 — vem de `dificuldade.ts`). */
  qtd: number;
  correta?: IdNumero;
  anterior?: IdNumero | null;
  sortear?: Sorteio;
}

export function montarRodadaNumeros({
  qtd,
  correta,
  anterior = null,
  sortear = Math.random,
}: OpcoesRodadaNumeros): RodadaNumeros {
  const alvo = correta ?? proximoNumero(anterior, sortear);
  const poolIds = subconjuntoNumeros(alvo, sortear).map((n) => n.id);
  const alternativas = montarAlternativas(poolIds, alvo, clampQtd(qtd), sortear) as IdNumero[];

  return {
    pergunta: perguntaDaPalavra(numeroPorId(alvo).palavra),
    festa: festaDaPalavra(numeroPorId(alvo).palavra),
    alternativas,
    correta: alvo,
    itens: alternativas.map((id) => numeroPorId(id)),
  };
}

// ------------------------------------------- 1b. contagem pós-acerto (números)

/**
 * PEDIDO DO DONO DO PRODUTO: depois de acertar um número, a criança toca e
 * conta os objetos EM INGLÊS antes da próxima rodada ("one... two... three…").
 * Em vez de duplicar as regras de "não conta duas vezes"/"ordem
 * livre"/"não existe perder" (as partes difíceis de acertar), reaproveitamos
 * a MESMA máquina de estados do modo Contar (`@/game/modos/contar`, ver o
 * cabeçalho de lá) passando este pacote de falas.
 *
 * `festa: null` — a comemoração do acerto já aconteceu ANTES desta etapa
 * (voz gravada da família, ou TTS da palavra-alvo — ver `aoAcertar` em
 * `/jogo/ingles/page.tsx`): repetir aqui seria ruído, não reforço.
 */
export const FALAS_CONTAGEM_NUMEROS_INGLES: FalasContagem = {
  numeros: NUMEROS_INGLES.map((n) => n.palavra),
  // `null`, e não `perguntaDaPalavra(...)`: em pt-BR o total é uma frase
  // NOVA ("São nove peixinhos!"), então falar depois do último número
  // reforça a contagem. Em inglês a regra "SÓ A PALAVRA" (topo do arquivo)
  // faz o total ser A MESMA palavra do último número, só capitalizada
  // ("nine" -> "Nine!") — repetir isso vira eco ("nine, Nine!") para quem
  // tem 3 anos, não reforço. O último número já dito É o total.
  total: null,
  festa: null,
};

/**
 * Monta a etapa de contagem do número `idAlvo` (ex.: "8" -> 8 peixinhos para
 * tocar, contando em inglês).
 *
 * `forma` fixa em "peixe": é a MESMA silhueta que já ilustra a quantidade
 * dentro da própria alternativa de números (ver `ConteudoAlternativa` em
 * `/jogo/ingles/page.tsx`) — o peixinho que a criança viu na alternativa é o
 * mesmo que ela toca na contagem, sem uma forma nova para reconhecer no meio
 * do reforço. `maximo: 10` é o teto do baralho de números, escrito aqui de
 * propósito: hoje é o MESMO valor de `MAX_CONTAGEM` (o modo Contar também vai
 * até 10 desde que a criança fez 5 anos), mas os dois tetos são decisões
 * independentes — este baralho ensina "one…ten" e não deve seguir uma futura
 * mudança do teto pedagógico do pt-BR.
 * `pergunta`, quando informada, é só o texto mostrado no `<Palco>` durante a
 * contagem — a página decide se fala esse texto ou não.
 */
export function criarContagemNumeroIngles(
  idAlvo: IdNumero,
  sortear: Sorteio = Math.random,
  pergunta?: string,
): EstadoContagem {
  return criarContagem({
    quantidade: numeroPorId(idAlvo).valor,
    forma: "peixe",
    maximo: 10,
    falas: FALAS_CONTAGEM_NUMEROS_INGLES,
    sortear,
    pergunta,
  });
}

// =========================================================== 2. cotidiano

/**
 * Como desenhar esta palavra — sempre um desenho JÁ existente (nenhuma arte
 * nova): ou um bicho de `animais.ts`, ou uma forma colorida de `cores.ts`.
 */
export type DesenhoCotidiano =
  | { readonly tipo: "animal"; readonly animal: IdAnimal }
  | { readonly tipo: "forma"; readonly forma: FormaObjeto; readonly cor: CorId };

export interface PalavraCotidiano {
  readonly id: string;
  readonly palavra: string;
  readonly desenho: DesenhoCotidiano;
}

const PALAVRA_ANIMAL: Readonly<Record<IdAnimal, string>> = {
  vaca: "cow",
  cachorro: "dog",
  gato: "cat",
  pato: "duck",
  galo: "rooster",
  ovelha: "sheep",
};

const PALAVRA_FORMA: Readonly<Record<FormaObjeto, string>> = {
  concha: "shell",
  estrela: "star",
  aguaViva: "jellyfish",
  bolha: "bubble",
  peixe: "fish",
};

/** A cor exclusiva de cada forma, herdada da bijeção de `cores.ts`. */
const COR_POR_FORMA = new Map<FormaObjeto, CorId>(CORES.map((c) => [c.forma, c.id]));

export const COTIDIANO_INGLES: readonly PalavraCotidiano[] = [
  ...IDS_ANIMAIS.map(
    (id): PalavraCotidiano => ({
      id: `animal-${id}`,
      palavra: PALAVRA_ANIMAL[id],
      desenho: { tipo: "animal", animal: id },
    }),
  ),
  ...IDS_FORMA.map((id): PalavraCotidiano => {
    const cor = COR_POR_FORMA.get(id);
    if (!cor) throw new Error(`Forma sem cor correspondente no catálogo de cores: ${id}`);
    return { id: `forma-${id}`, palavra: PALAVRA_FORMA[id], desenho: { tipo: "forma", forma: id, cor } };
  }),
];

export const IDS_COTIDIANO: readonly string[] = COTIDIANO_INGLES.map((p) => p.id);

const COTIDIANO_POR_ID = new Map<string, PalavraCotidiano>(COTIDIANO_INGLES.map((p) => [p.id, p]));

export function palavraCotidianoPorId(id: string): PalavraCotidiano {
  const achada = COTIDIANO_POR_ID.get(id);
  if (!achada) throw new Error(`Palavra desconhecida no baralho cotidiano: ${id}`);
  return achada;
}

export function proximoCotidiano(anterior: string | null | undefined, sortear: Sorteio = Math.random): string {
  const candidatos = IDS_COTIDIANO.filter((id) => id !== anterior);
  const pool = candidatos.length > 0 ? candidatos : IDS_COTIDIANO;
  return embaralhar(pool, sortear)[0];
}

export interface RodadaCotidiano {
  readonly pergunta: string;
  readonly festa: string;
  readonly alternativas: readonly string[];
  readonly correta: string;
  readonly itens: readonly PalavraCotidiano[];
}

export interface OpcoesRodadaCotidiano {
  qtd: number;
  correta?: string;
  anterior?: string | null;
  sortear?: Sorteio;
}

export function montarRodadaCotidiano({
  qtd,
  correta,
  anterior = null,
  sortear = Math.random,
}: OpcoesRodadaCotidiano): RodadaCotidiano {
  const alvo = correta ?? proximoCotidiano(anterior, sortear);
  const alternativas = montarAlternativas(IDS_COTIDIANO, alvo, clampQtd(qtd), sortear);

  // Rede de segurança (mesmo espírito de `cores.ts`): o pool já garante ids
  // únicos, mas se alguém duplicar uma palavra no catálogo a rodada morre
  // aqui, não na frente da criança.
  const palavras = alternativas.map((id) => palavraCotidianoPorId(id).palavra);
  if (new Set(palavras).size !== palavras.length) {
    throw new Error("Rodada de cotidiano com duas alternativas que soam igual.");
  }

  return {
    pergunta: perguntaDaPalavra(palavraCotidianoPorId(alvo).palavra),
    festa: festaDaPalavra(palavraCotidianoPorId(alvo).palavra),
    alternativas,
    correta: alvo,
    itens: alternativas.map((id) => palavraCotidianoPorId(id)),
  };
}

// ============================================================= 3. família

export type IdPalavraFamilia = "mommy" | "daddy" | "brother" | "sister";

export interface PalavraFamilia {
  readonly id: IdPalavraFamilia;
  readonly palavra: string;
  /** Papel do cadastro que responde por esta palavra (ver limitação no topo). */
  readonly papel: Papel;
}

export const FAMILIA_INGLES: readonly PalavraFamilia[] = [
  { id: "mommy", palavra: "mommy", papel: "mae" },
  { id: "daddy", palavra: "daddy", papel: "pai" },
  { id: "brother", palavra: "brother", papel: "irmao" },
  { id: "sister", palavra: "sister", papel: "irmao" },
];

const FAMILIA_POR_ID = new Map<string, PalavraFamilia>(FAMILIA_INGLES.map((p) => [p.id, p]));

export function palavraFamiliaPorId(id: string): PalavraFamilia {
  const achada = FAMILIA_POR_ID.get(id);
  if (!achada) throw new Error(`Palavra desconhecida no baralho família: ${id}`);
  return achada;
}

/** O mínimo que este módulo precisa saber de um familiar cadastrado. */
export type FichaFamiliarIngles = Pick<Personagem, "id" | "nome" | "papel">;

/**
 * Quais palavras dá para perguntar com ESTE elenco.
 *
 * Precisa de pelo menos DUAS fichas no total (o engine recusa rodada com uma
 * alternativa só) e de pelo menos UM papel correspondente por palavra. Com
 * ninguém cadastrado (ou só uma pessoa), a lista sai vazia — sinal para a
 * página pular o baralho, nunca lançar.
 */
export function palavrasFamiliaJogaveis<T extends FichaFamiliarIngles>(
  fichas: readonly T[],
): readonly PalavraFamilia[] {
  if (fichas.length < 2) return [];
  return FAMILIA_INGLES.filter((p) => fichas.some((f) => f.papel === p.papel));
}

export function podeJogarFamiliaIngles<T extends FichaFamiliarIngles>(fichas: readonly T[]): boolean {
  return palavrasFamiliaJogaveis(fichas).length > 0;
}

function proximaPalavraFamilia(
  jogaveis: readonly PalavraFamilia[],
  anterior: IdPalavraFamilia | null | undefined,
  sortear: Sorteio,
): PalavraFamilia {
  const candidatas = jogaveis.filter((p) => p.id !== anterior);
  const pool = candidatas.length > 0 ? candidatas : jogaveis;
  return embaralhar(pool, sortear)[0];
}

export interface RodadaFamiliaIngles<T extends FichaFamiliarIngles = FichaFamiliarIngles> {
  readonly pergunta: string;
  readonly festa: string;
  /** Ids de PERSONAGEM (fotos) para o engine — não confundir com `PalavraFamilia.id`. */
  readonly alternativas: readonly string[];
  readonly correta: string;
  /** A palavra em inglês desta rodada. */
  readonly palavra: PalavraFamilia;
  /** As fichas de cada alternativa, na mesma ordem. */
  readonly pessoas: readonly T[];
}

export interface OpcoesRodadaFamiliaIngles<T extends FichaFamiliarIngles> {
  fichas: readonly T[];
  qtd: number;
  correta?: IdPalavraFamilia;
  anterior?: IdPalavraFamilia | null;
  sortear?: Sorteio;
}

/**
 * Monta a rodada do baralho família — ou devolve `null` para "pula este
 * baralho" quando o elenco não dá (edge case obrigatório do brief: NUNCA
 * lança, a página decide o que fazer com `null`, ex.: cair para `cotidiano`).
 */
export function montarRodadaFamiliaIngles<T extends FichaFamiliarIngles>({
  fichas,
  qtd,
  correta,
  anterior = null,
  sortear = Math.random,
}: OpcoesRodadaFamiliaIngles<T>): RodadaFamiliaIngles<T> | null {
  const jogaveis = palavrasFamiliaJogaveis(fichas);
  if (jogaveis.length === 0) return null;

  const forcada = correta ? jogaveis.find((p) => p.id === correta) : undefined;
  const palavra = forcada ?? proximaPalavraFamilia(jogaveis, anterior, sortear);

  const candidatosAlvo = fichas.filter((f) => f.papel === palavra.papel);
  const alvo = embaralhar(candidatosAlvo, sortear)[0];
  // `alvo` sempre existe: `palavra` só está em `jogaveis` se algum papel bateu.

  const total = clampQtd(Math.min(Math.max(2, Math.round(qtd)), fichas.length));
  const outros = embaralhar(
    fichas.filter((f) => f.id !== alvo.id),
    sortear,
  ).slice(0, total - 1);
  const ids = embaralhar([alvo.id, ...outros.map((f) => f.id)], sortear);

  const porId = new Map(fichas.map((f) => [f.id, f]));
  const pessoas = ids.map((id) => porId.get(id)!);

  return {
    pergunta: perguntaDaPalavra(palavra.palavra),
    festa: festaDaPalavra(palavra.palavra),
    alternativas: ids,
    correta: alvo.id,
    palavra,
    pessoas,
  };
}

// =========================================================== 4. saudações

export type IdSaudacao = "hello" | "byeBye" | "thankYou" | "please";

export interface PalavraSaudacao {
  readonly id: IdSaudacao;
  readonly palavra: string;
}

/**
 * `id` dobra como referência do desenho: quando a ilustração de cada
 * saudação existir, a tela troca por `<IlustracaoSaudacao id={item.id} />`
 * (ou equivalente) sem precisar mexer neste catálogo. Nada é importado daqui
 * — por isso os testes rodam sem nenhum componente de desenho existir.
 */
export const SAUDACOES_INGLES: readonly PalavraSaudacao[] = [
  { id: "hello", palavra: "hello" },
  { id: "byeBye", palavra: "bye bye" },
  { id: "thankYou", palavra: "thank you" },
  { id: "please", palavra: "please" },
];

export const IDS_SAUDACAO: readonly IdSaudacao[] = SAUDACOES_INGLES.map((s) => s.id);

const SAUDACAO_POR_ID = new Map<string, PalavraSaudacao>(SAUDACOES_INGLES.map((s) => [s.id, s]));

export function saudacaoPorId(id: string): PalavraSaudacao {
  const achada = SAUDACAO_POR_ID.get(id);
  if (!achada) throw new Error(`Saudação desconhecida no modo inglês: ${id}`);
  return achada;
}

export function proximaSaudacao(anterior: IdSaudacao | null | undefined, sortear: Sorteio = Math.random): IdSaudacao {
  const candidatas = IDS_SAUDACAO.filter((id) => id !== anterior);
  const pool = candidatas.length > 0 ? candidatas : IDS_SAUDACAO;
  return embaralhar(pool, sortear)[0];
}

export interface RodadaSaudacoes {
  readonly pergunta: string;
  readonly festa: string;
  readonly alternativas: readonly IdSaudacao[];
  readonly correta: IdSaudacao;
  readonly itens: readonly PalavraSaudacao[];
}

export interface OpcoesRodadaSaudacoes {
  qtd: number;
  correta?: IdSaudacao;
  anterior?: IdSaudacao | null;
  sortear?: Sorteio;
}

export function montarRodadaSaudacoes({
  qtd,
  correta,
  anterior = null,
  sortear = Math.random,
}: OpcoesRodadaSaudacoes): RodadaSaudacoes {
  const alvo = correta ?? proximaSaudacao(anterior, sortear);
  // Só 4 saudações no total — o teto real é o tamanho do próprio pool.
  const total = clampQtd(Math.min(qtd, IDS_SAUDACAO.length));
  const alternativas = montarAlternativas(IDS_SAUDACAO, alvo, total, sortear) as IdSaudacao[];

  return {
    pergunta: perguntaDaPalavra(saudacaoPorId(alvo).palavra),
    festa: festaDaPalavra(saudacaoPorId(alvo).palavra),
    alternativas,
    correta: alvo,
    itens: alternativas.map((id) => saudacaoPorId(id)),
  };
}

// =============================================================== 5. cores

/**
 * EXCEÇÃO INTENCIONAL E RESTRITA A ESTE BARALHO — não "consertar" depois.
 *
 * `cores.ts` tem uma regra forte, correta para o RESTO do jogo: cor nunca é a
 * única pista (bijeção cor↔forma, ver o cabeçalho de lá) — uma criança
 * daltônica resolve pela silhueta. Esse mesmo `cotidiano` acima reaproveita
 * essa bijeção (uma forma, uma cor fixa por palavra).
 *
 * Só que este baralho ENSINA justamente o NOME da cor ("Blue!", sem frase de
 * apoio — ver `perguntaDaPalavra`). Se cada cor sempre aparecesse com a
 * "sua" forma exclusiva, a proteção do daltônico vira um atalho pedagógico
 * pelas costas: a criança aprenderia a apontar para a concha ao ouvir
 * "Blue!" sem nunca precisar reconhecer a COR — a forma sozinha já resolveria
 * a rodada, e a palavra nova nunca seria testada de verdade.
 *
 * Por isso, e SÓ aqui, a rodada sorteia uma forma por rodada e desenha TODAS
 * as alternativas com essa MESMA forma — a cor passa a ser a única variável
 * possível, porque a cor É o conteúdo que está sendo ensinado. Para a forma
 * sorteada não reabrir a mesma porta pela lateral (a criança reconhecendo a
 * forma bijetada à cor certa e descartando as outras por eliminação de
 * forma), `montarRodadaCoresIngles` exclui explicitamente a forma que
 * `cores.ts` associa à cor-alvo — ver `formaDaRodada`, provado pelo teste
 * "a forma da rodada nunca é a bijetada à cor correta" em `ingles.test.ts`.
 */

const PALAVRA_COR: Readonly<Record<CorId, string>> = {
  vermelho: "red",
  azul: "blue",
  amarelo: "yellow",
  verde: "green",
  roxo: "purple",
};

export interface PalavraCor {
  readonly id: CorId;
  readonly palavra: string;
}

export const CORES_INGLES: readonly PalavraCor[] = IDS_COR.map(
  (id): PalavraCor => ({ id, palavra: PALAVRA_COR[id] }),
);

export const IDS_COR_INGLES: readonly CorId[] = CORES_INGLES.map((c) => c.id);

const COR_INGLES_POR_ID = new Map<string, PalavraCor>(CORES_INGLES.map((c) => [c.id, c]));

export function corInglesPorId(id: string): PalavraCor {
  const achada = COR_INGLES_POR_ID.get(id);
  if (!achada) throw new Error(`Cor desconhecida no baralho de cores (inglês): ${id}`);
  return achada;
}

export function proximaCorIngles(anterior: CorId | null | undefined, sortear: Sorteio = Math.random): CorId {
  const candidatos = IDS_COR_INGLES.filter((id) => id !== anterior);
  const pool = candidatos.length > 0 ? candidatos : IDS_COR_INGLES;
  return embaralhar(pool, sortear)[0];
}

/**
 * A forma desta rodada: qualquer uma do catálogo de `cores.ts`, MENOS a que
 * a bijeção associa à cor-alvo (ver bloco acima — é essa exclusão que
 * impede a forma de virar um segundo atalho para a resposta).
 */
function formaDaRodada(alvo: CorId, sortear: Sorteio): FormaObjeto {
  const formaDaCorAlvo = peca(alvo).forma;
  const formasPossiveis = IDS_FORMA.filter((f) => f !== formaDaCorAlvo);
  return embaralhar(formasPossiveis, sortear)[0];
}

export interface RodadaCoresIngles {
  readonly pergunta: string;
  readonly festa: string;
  readonly alternativas: readonly CorId[];
  readonly correta: CorId;
  /** A MESMA forma para todas as alternativas desta rodada — ver exceção
   * documentada acima: aqui a cor é a única pista, de propósito. */
  readonly forma: FormaObjeto;
  readonly itens: readonly PalavraCor[];
}

export interface OpcoesRodadaCoresIngles {
  qtd: number;
  correta?: CorId;
  anterior?: CorId | null;
  sortear?: Sorteio;
}

export function montarRodadaCoresIngles({
  qtd,
  correta,
  anterior = null,
  sortear = Math.random,
}: OpcoesRodadaCoresIngles): RodadaCoresIngles {
  const alvo = correta ?? proximaCorIngles(anterior, sortear);
  const alternativas = montarAlternativas(IDS_COR_INGLES, alvo, clampQtd(qtd), sortear) as CorId[];

  // Rede de segurança (mesmo espírito de cores.ts/cotidiano): o pool já
  // garante ids únicos, mas se alguém duplicar uma cor no catálogo a rodada
  // morre aqui, não na frente da criança — nunca duas alternativas da mesma cor.
  if (new Set(alternativas).size !== alternativas.length) {
    throw new Error("Rodada de cores (inglês) com duas alternativas da mesma cor.");
  }

  return {
    pergunta: perguntaDaPalavra(corInglesPorId(alvo).palavra),
    festa: festaDaPalavra(corInglesPorId(alvo).palavra),
    alternativas,
    correta: alvo,
    forma: formaDaRodada(alvo, sortear),
    itens: alternativas.map((id) => corInglesPorId(id)),
  };
}

// ------------------------------------------------------------ invariantes

/**
 * Validação do catálogo inteiro — chamada no import (falha alto e cedo, no
 * build/dev) e reusada pelos testes. Cobre: ids únicos por baralho, palavras
 * únicas dentro de cada baralho (nenhuma soa igual à outra), e que todo
 * desenho referenciado em `cotidiano` existe de verdade nos catálogos de
 * origem.
 */
export function validarCatalogoIngles(): true {
  validarIdsUnicos("numeros", NUMEROS_INGLES);
  if (NUMEROS_INGLES.length !== 10) throw new Error("Baralho de números precisa ter exatamente 10 itens (1 a 10).");
  for (const n of NUMEROS_INGLES) {
    if (n.valor < 1 || n.valor > 10) throw new Error(`Número fora do intervalo 1-10: ${n.id}`);
  }

  validarIdsUnicos("cotidiano", COTIDIANO_INGLES);
  validarPalavrasUnicas("cotidiano", COTIDIANO_INGLES);
  const idsAnimalValidos = new Set<string>(IDS_ANIMAIS);
  const idsFormaValidos = new Set<string>(IDS_FORMA);
  const assinaturas = new Set<string>();
  for (const p of COTIDIANO_INGLES) {
    const assinatura =
      p.desenho.tipo === "animal" ? `animal:${p.desenho.animal}` : `forma:${p.desenho.forma}:${p.desenho.cor}`;
    if (assinaturas.has(assinatura)) {
      throw new Error(`Duas palavras de cotidiano com o mesmo desenho: ${assinatura}`);
    }
    assinaturas.add(assinatura);
    if (p.desenho.tipo === "animal" && !idsAnimalValidos.has(p.desenho.animal)) {
      throw new Error(`Cotidiano referencia animal inexistente: ${p.desenho.animal}`);
    }
    if (p.desenho.tipo === "forma" && !idsFormaValidos.has(p.desenho.forma)) {
      throw new Error(`Cotidiano referencia forma inexistente: ${p.desenho.forma}`);
    }
  }

  validarIdsUnicos("familia", FAMILIA_INGLES);
  validarPalavrasUnicas("familia", FAMILIA_INGLES);

  validarIdsUnicos("saudacoes", SAUDACOES_INGLES);
  validarPalavrasUnicas("saudacoes", SAUDACOES_INGLES);
  if (SAUDACOES_INGLES.length < 2) {
    throw new Error("Baralho de saudações precisa de pelo menos 2 itens para formar uma rodada.");
  }

  validarIdsUnicos("cores", CORES_INGLES);
  validarPalavrasUnicas("cores", CORES_INGLES);
  if (CORES_INGLES.length !== CORES.length) {
    throw new Error("Baralho de cores (inglês) precisa ter exatamente uma palavra por cor de cores.ts.");
  }
  const idsCorValidos = new Set<string>(IDS_COR);
  for (const c of CORES_INGLES) {
    if (!idsCorValidos.has(c.id)) throw new Error(`Cores (inglês) referencia cor inexistente em cores.ts: ${c.id}`);
  }
  // Precisa sobrar pelo menos uma forma depois de excluir a bijetada à cor
  // alvo (ver `formaDaRodada`) — senão a rodada nunca conseguiria sortear.
  if (IDS_FORMA.length < 2) {
    throw new Error("Catálogo de formas pequeno demais para excluir a forma bijetada à cor-alvo em cores.");
  }

  return true;
}

function validarIdsUnicos(baralho: string, itens: readonly { readonly id: string }[]): void {
  const ids = new Set<string>();
  for (const item of itens) {
    if (ids.has(item.id)) throw new Error(`Id repetido no baralho ${baralho}: ${item.id}`);
    ids.add(item.id);
  }
}

function validarPalavrasUnicas(baralho: string, itens: readonly { readonly palavra: string }[]): void {
  const palavras = new Set<string>();
  for (const item of itens) {
    if (palavras.has(item.palavra)) {
      throw new Error(`Palavra repetida no baralho ${baralho} — duas alternativas soariam igual: ${item.palavra}`);
    }
    palavras.add(item.palavra);
  }
}

validarCatalogoIngles();

// ------------------------------------------------------------------- rng

/**
 * PRNG determinístico (mulberry32) — mesmo contrato de `Sorteio` usado pelos
 * outros modos (`cores.ts`, `familia.ts`). Nos testes, a semente fixa deixa a
 * rodada reproduzível.
 */
export function criarSorteio(semente: number): Sorteio {
  let a = (semente >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
