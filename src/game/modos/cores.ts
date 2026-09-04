/**
 * MODO "CORES E FORMAS" — conteúdo e montagem de rodada. PURO (sem React,
 * sem DOM, sem IO). Roda em node: `node --test --experimental-strip-types`.
 *
 * REGRA DE ACESSIBILIDADE Nº 1: **cor nunca é a única pista**.
 * Cada cor do catálogo tem uma FORMA própria e exclusiva (bijeção cor <-> forma).
 * Uma criança daltônica — ou que ainda não sabe o nome das cores — resolve a
 * rodada pela silhueta, porque a pergunta fala as duas coisas:
 * "Pega a concha azul!" (forma + cor). O catálogo é validado no import
 * (`validarCatalogo`) e de novo a cada rodada montada, então é impossível
 * chegar na tela uma rodada com duas peças da mesma forma.
 *
 * O engine (`@/game/engine`) só conhece IDs de alternativa; aqui os IDs são os
 * `CorId`. Este módulo é o mapa `id -> conteúdo` do mini-jogo.
 *
 *   const dif = dificuldadeInicial();
 *   const rodada = montarRodadaCores({ qtd: dif.alternativas, sortear });
 *   useRodada({ pergunta: rodada.pergunta, alternativas: rodada.alternativas, correta: rodada.correta });
 *
 * NÃO depende de personagem cadastrado, foto ou voz gravada: o conteúdo é todo
 * desenhado (ver `@/components/objetos/ObjetoMar`), então o modo funciona no
 * primeiro uso, antes de o adulto configurar qualquer coisa.
 */

import { embaralhar, montarAlternativas, type Sorteio } from "../dificuldade.ts";

// ---------------------------------------------------------------- formas

/** Silhuetas desenhadas em `@/components/objetos/ObjetoMar`. */
export type FormaObjeto = "concha" | "estrela" | "aguaViva" | "bolha" | "peixe";

export type Genero = "m" | "f";

export interface Forma {
  readonly id: FormaObjeto;
  /** Gênero gramatical do substantivo — o adjetivo de cor concorda com ele. */
  readonly genero: Genero;
  readonly singular: string;
  readonly plural: string;
}

export const FORMAS: Record<FormaObjeto, Forma> = {
  concha: { id: "concha", genero: "f", singular: "concha", plural: "conchas" },
  estrela: {
    id: "estrela",
    genero: "f",
    singular: "estrela do mar",
    plural: "estrelas do mar",
  },
  aguaViva: { id: "aguaViva", genero: "f", singular: "água-viva", plural: "águas-vivas" },
  bolha: { id: "bolha", genero: "f", singular: "bolha", plural: "bolhas" },
  peixe: { id: "peixe", genero: "m", singular: "peixinho", plural: "peixinhos" },
};

export const IDS_FORMA = Object.keys(FORMAS) as readonly FormaObjeto[];

// ----------------------------------------------------------------- cores

export type CorId = "vermelho" | "azul" | "amarelo" | "verde" | "roxo";

export interface PecaCor {
  readonly id: CorId;
  /** Cor de preenchimento do SVG. Alto contraste sobre o fundo do mar escuro. */
  readonly hex: string;
  /** Nome falado, nas duas concordâncias ("vermelho"/"vermelha"). */
  readonly nome: Readonly<Record<Genero, string>>;
  /** A forma exclusiva desta cor — a redundância que salva o daltônico. */
  readonly forma: FormaObjeto;
}

/**
 * Catálogo. Exatamente uma forma por cor e uma cor por forma — mexer aqui sem
 * manter a bijeção quebra `validarCatalogo()` no import e o teste
 * `cada cor tem uma forma exclusiva` em `cores.test.ts`.
 */
export const CORES: readonly PecaCor[] = [
  { id: "vermelho", hex: "#e63946", nome: { m: "vermelho", f: "vermelha" }, forma: "estrela" },
  { id: "azul", hex: "#3a86ff", nome: { m: "azul", f: "azul" }, forma: "concha" },
  { id: "amarelo", hex: "#ffd166", nome: { m: "amarelo", f: "amarela" }, forma: "peixe" },
  { id: "verde", hex: "#2fbf71", nome: { m: "verde", f: "verde" }, forma: "aguaViva" },
  { id: "roxo", hex: "#b16cff", nome: { m: "roxo", f: "roxa" }, forma: "bolha" },
];

export const IDS_COR = CORES.map((c) => c.id) as readonly CorId[];

const POR_ID = new Map<string, PecaCor>(CORES.map((c) => [c.id, c]));

export function peca(id: string): PecaCor {
  const achada = POR_ID.get(id);
  if (!achada) throw new Error(`Cor desconhecida no modo cores: ${id}`);
  return achada;
}

export function formaDe(id: string): Forma {
  return FORMAS[peca(id).forma];
}

// ------------------------------------------------------------ invariante

/**
 * A garantia central do modo, verificável de fora: nenhuma cor repete forma e
 * nenhuma forma repete cor. Chamada no import (falha alto e cedo, no build/dev)
 * e usada pelos testes.
 */
export function validarCatalogo(cores: readonly PecaCor[] = CORES): true {
  const ids = new Set<string>();
  const formas = new Set<FormaObjeto>();
  for (const c of cores) {
    if (ids.has(c.id)) throw new Error(`Cor repetida no catálogo: ${c.id}`);
    if (formas.has(c.forma)) {
      throw new Error(`Duas cores com a mesma forma (${c.forma}) — cor não pode ser a única pista.`);
    }
    if (!FORMAS[c.forma]) throw new Error(`Forma desconhecida: ${c.forma}`);
    ids.add(c.id);
    formas.add(c.forma);
  }
  return true;
}

/** As peças desta rodada têm todas formas diferentes? (usado no teste e antes de exibir) */
export function formasDistintas(ids: readonly string[]): boolean {
  const formas = ids.map((id) => peca(id).forma);
  return new Set(formas).size === formas.length;
}

validarCatalogo();

// ------------------------------------------------------------------ falas

/** "concha azul", "peixinho amarelo", "estrela do mar vermelha". */
export function nomeDaPeca(id: string): string {
  const p = peca(id);
  const f = FORMAS[p.forma];
  return `${f.singular} ${p.nome[f.genero]}`;
}

/** Artigo definido concordando com a forma. */
function artigo(genero: Genero): string {
  return genero === "f" ? "a" : "o";
}

/**
 * Pergunta falada da rodada. Diz FORMA e COR — se a criança não pega a cor,
 * ainda dá para resolver pela silhueta (e vice-versa).
 */
export function fraseDaRodada(id: string): string {
  const p = peca(id);
  const f = FORMAS[p.forma];
  return `Pega ${artigo(f.genero)} ${f.singular} ${p.nome[f.genero]}!`;
}

/** Comemoração — repete o nome da peça, que é onde está o aprendizado. */
export function festaDaRodada(id: string): string {
  return `Isso! ${maiuscula(nomeDaPeca(id))}!`;
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ---------------------------------------------------------------- rodada

export interface RodadaCores {
  /** Texto falado e rótulo do `<Palco>`. */
  readonly pergunta: string;
  readonly festa: string;
  /** IDs para o engine, já embaralhados. */
  readonly alternativas: readonly CorId[];
  readonly correta: CorId;
  /** Conteúdo de cada alternativa, na mesma ordem — o mapa `id -> peça`. */
  readonly pecas: readonly PecaCor[];
}

export interface OpcoesRodadaCores {
  /** Quantas alternativas na tela (vem de `dificuldade.ts`: 2, 3 ou 4). */
  qtd: number;
  /** Força a cor pedida (senão sorteia). */
  correta?: CorId;
  /** Cor da rodada anterior — não repete o alvo duas vezes seguidas. */
  anterior?: CorId | null;
  sortear?: Sorteio;
}

export function montarRodadaCores({
  qtd,
  correta,
  anterior = null,
  sortear = Math.random,
}: OpcoesRodadaCores): RodadaCores {
  const alvo = correta ?? proximaCor(anterior, sortear);
  const total = Math.min(Math.max(2, Math.round(qtd)), CORES.length);

  const alternativas = montarAlternativas(IDS_COR, alvo, total as 2 | 3 | 4, sortear) as CorId[];

  // Rede de segurança: `montarAlternativas` sorteia do pool, e o pool é o
  // catálogo — mas se alguém trocar o pool por um com formas repetidas, a
  // rodada morre aqui e não na frente da criança.
  if (!formasDistintas(alternativas)) {
    throw new Error("Rodada com duas peças da mesma forma — cor viraria a única pista.");
  }

  return {
    pergunta: fraseDaRodada(alvo),
    festa: festaDaRodada(alvo),
    alternativas,
    correta: alvo,
    pecas: alternativas.map((id) => peca(id)),
  };
}

/** Sorteia o alvo da próxima rodada, evitando repetir o anterior. */
export function proximaCor(anterior: CorId | null | undefined, sortear: Sorteio = Math.random): CorId {
  const candidatos = IDS_COR.filter((id) => id !== anterior);
  const pool = candidatos.length > 0 ? candidatos : IDS_COR;
  return embaralhar(pool, sortear)[0];
}

// ------------------------------------------------------------------- rng

/**
 * PRNG determinístico (mulberry32) — o mesmo `Sorteio` de `dificuldade.ts`.
 *
 * Por que existe: a página é client component mas passa por SSR. Sortear com
 * `Math.random()` durante o render dá hidratação divergente; a página sorteia
 * UMA semente depois de montar e deriva todas as rodadas dela. Nos testes, a
 * semente fixa deixa a rodada reproduzível.
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
