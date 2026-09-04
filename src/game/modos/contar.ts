/**
 * MODO "CONTAR DE 1 A 5" — máquina de contagem PURA (sem React, sem DOM,
 * sem timers). Roda em node: `node --test --experimental-strip-types`.
 *
 * MECÂNICA: a tela mostra de 1 a 5 bichinhos iguais. Cada toque MARCA um
 * bichinho e FALA o número em voz alta ("um... dois... três"); quando o último
 * é marcado, o jogo fala o total ("São três peixinhos!"). Não há número
 * escrito para ler, não há conta, não há placar e não há como errar — tocar em
 * algo já contado simplesmente não faz nada (nem conta, nem fala).
 *
 * INVARIANTES (cobertos por contar.test.ts)
 *  1. A contagem NUNCA passa de 5 (`MAX_CONTAGEM`) — nem por config nem por
 *     sorteio da próxima rodada.
 *  2. O mesmo objeto não incrementa duas vezes: `contarObjeto` devolve
 *     `mudou: false` e `falas: []` para um objeto já contado (duplo toque,
 *     multi-touch, criança martelando).
 *  3. Toda contagem aceita fala o número, e a última fala também o total.
 *  4. Tudo é puro: nada de `Date.now()`, nada de áudio aqui — a página
 *     converte `TransicaoContagem.falas` em itens da `FilaDeFala`.
 *
 * FLUXO
 *   contando ──(último objeto marcado)──▶ total ──comemorar()──▶ festa
 *
 * Não depende de personagem cadastrado: as cores e formas vêm de `cores.ts`
 * (mesma tabela cor <-> forma dos dois modos), então o jogo roda no primeiro
 * uso, sem nenhuma foto ou voz gravada.
 */

import { embaralhar, type Sorteio } from "../dificuldade.ts";
import { CORES, FORMAS, type FormaObjeto, type Genero } from "./cores.ts";

// -------------------------------------------------------------- constantes

export const MIN_CONTAGEM = 1;
/** Teto pedagógico: criança de 3 anos conta até 5. Nunca mais que isso. */
export const MAX_CONTAGEM = 5;

/**
 * Números falados na contagem. Forma canônica (é assim que se ensina a
 * contar em voz alta: "um, dois, três"), independente do gênero do bichinho —
 * a concordância aparece só na frase do total ("São duas conchas!").
 */
export const NUMEROS: readonly string[] = ["um", "dois", "três", "quatro", "cinco"];

/** "um/uma" e "dois/duas" concordam; de três em diante é invariável. */
const NUMEROS_COM_GENERO: Readonly<Record<Genero, readonly string[]>> = {
  m: ["um", "dois", "três", "quatro", "cinco"],
  f: ["uma", "duas", "três", "quatro", "cinco"],
};

// ------------------------------------------------------------------ tipos

export type FaseContagem = "contando" | "total" | "festa";

export interface ObjetoContagem {
  readonly id: string;
  readonly forma: FormaObjeto;
  readonly cor: string;
  /** Inclinação em graus, só para os bichinhos não ficarem enfileirados iguais. */
  readonly giro: number;
}

/** Pedido de fala. A página converte em `ItemFala` da `FilaDeFala`. */
export interface FalaContagem {
  readonly chave: string;
  readonly texto: string;
  readonly prioridade: "alta" | "normal";
}

export interface EstadoContagem {
  readonly objetos: readonly ObjetoContagem[];
  /** IDs já contados, na ordem em que a criança tocou. */
  readonly contados: readonly string[];
  readonly forma: FormaObjeto;
  readonly cor: string;
  /** Texto falado da pergunta ("Vamos contar os peixinhos!"). */
  readonly pergunta: string;
  readonly fase: FaseContagem;
  /** Incrementa a cada transição aceita — serve de `key`/guarda de timer. */
  readonly versao: number;
}

export interface TransicaoContagem {
  readonly estado: EstadoContagem;
  readonly mudou: boolean;
  readonly falas: readonly FalaContagem[];
}

// ----------------------------------------------------------------- criação

export interface OpcoesContagem {
  /** Quantos bichinhos. Fora de 1..5 é limitado ao intervalo (nunca passa de 5). */
  quantidade: number;
  forma?: FormaObjeto;
  /** Sobrescreve a cor da forma (padrão: a cor que essa forma tem em `cores.ts`). */
  cor?: string;
  sortear?: Sorteio;
}

/** Cor canônica da forma — a MESMA tabela cor<->forma do modo cores. */
export function corDaForma(forma: FormaObjeto): string {
  const encontrada = CORES.find((c) => c.forma === forma);
  if (!encontrada) throw new Error(`Forma sem cor no catálogo: ${forma}`);
  return encontrada.hex;
}

/** Limita a quantidade ao intervalo pedagógico 1..5. */
export function limitarQuantidade(valor: number): number {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n)) return MIN_CONTAGEM;
  return Math.min(MAX_CONTAGEM, Math.max(MIN_CONTAGEM, n));
}

export function criarContagem({
  quantidade,
  forma = "peixe",
  cor,
  sortear = Math.random,
}: OpcoesContagem): EstadoContagem {
  const total = limitarQuantidade(quantidade);
  const info = FORMAS[forma];
  if (!info) throw new Error(`Forma desconhecida no modo contar: ${forma}`);

  const objetos: ObjetoContagem[] = Array.from({ length: total }, (_, i) => ({
    id: `obj-${i + 1}`,
    forma,
    cor: cor ?? corDaForma(forma),
    giro: Math.round((sortear() * 24 - 12) * 10) / 10,
  }));

  return {
    objetos,
    contados: [],
    forma,
    cor: cor ?? corDaForma(forma),
    pergunta: `Vamos contar ${info.genero === "f" ? "as" : "os"} ${info.plural}!`,
    fase: "contando",
    versao: 0,
  };
}

// -------------------------------------------------------------- transições

function ignorada(estado: EstadoContagem): TransicaoContagem {
  return { estado, mudou: false, falas: [] };
}

/** Este objeto já foi contado? */
export function jaContado(estado: EstadoContagem, id: string): boolean {
  return estado.contados.includes(id);
}

export function quantidadeContada(estado: EstadoContagem): number {
  return estado.contados.length;
}

export function totalDeObjetos(estado: EstadoContagem): number {
  return estado.objetos.length;
}

/**
 * Toque num bichinho.
 *
 * - Objeto desconhecido, fase != `contando` ou **objeto já contado** ⇒
 *   `mudou: false` e `falas: []`. É esta linha que garante que martelar o
 *   mesmo peixinho não vira "um, dois, três" com um peixe só.
 * - Objeto novo ⇒ marca, fala o número (prioridade alta: corta o número
 *   anterior em vez de empilhar) e, se foi o último, fala também o total
 *   (prioridade normal: entra na fila DEPOIS do número).
 */
export function contarObjeto(estado: EstadoContagem, id: string): TransicaoContagem {
  if (estado.fase !== "contando") return ignorada(estado);
  if (!estado.objetos.some((o) => o.id === id)) return ignorada(estado);
  if (jaContado(estado, id)) return ignorada(estado);

  const contados = [...estado.contados, id];
  const n = contados.length;
  const total = estado.objetos.length;
  const completou = n >= total;

  const falas: FalaContagem[] = [
    {
      // A versão entra na chave para o mesmo número poder ser falado de novo
      // numa rodada seguinte sem cair no dedupe da fila.
      chave: `numero:${n}:${estado.versao}`,
      texto: NUMEROS[n - 1] ?? String(n),
      prioridade: "alta",
    },
  ];
  if (completou) {
    falas.push({
      chave: `total:${total}:${estado.versao}`,
      texto: falaDoTotal(total, estado.forma),
      prioridade: "normal",
    });
  }

  return {
    estado: {
      ...estado,
      contados,
      fase: completou ? "total" : "contando",
      versao: estado.versao + 1,
    },
    mudou: true,
    falas,
  };
}

/** `total -> festa`: comemoração antes da próxima rodada. */
export function comemorar(estado: EstadoContagem): TransicaoContagem {
  if (estado.fase !== "total") return ignorada(estado);
  return {
    estado: { ...estado, fase: "festa", versao: estado.versao + 1 },
    mudou: true,
    falas: [
      { chave: `festa:${estado.versao}`, texto: "Muito bem!", prioridade: "normal" },
    ],
  };
}

/** Repetir a pergunta (botão do `<Palco>`): fala de novo, sem mudar de fase. */
export function repetirPergunta(estado: EstadoContagem): TransicaoContagem {
  if (estado.fase === "festa") return ignorada(estado);
  return {
    estado,
    mudou: false,
    falas: [{ chave: `pergunta:${estado.versao}`, texto: estado.pergunta, prioridade: "alta" }],
  };
}

export function contagemCompleta(estado: EstadoContagem): boolean {
  return estado.contados.length >= estado.objetos.length;
}

// --------------------------------------------------------------- falas pt-BR

/** "É uma concha!", "São três peixinhos!" — concorda em gênero e número. */
export function falaDoTotal(n: number, forma: FormaObjeto): string {
  const info = FORMAS[forma];
  const total = limitarQuantidade(n);
  const numero = NUMEROS_COM_GENERO[info.genero][total - 1] ?? String(total);
  return total === 1
    ? `É ${numero} ${info.singular}!`
    : `São ${numero} ${info.plural}!`;
}

// ------------------------------------------------------- próxima rodada

export interface RodadaContar {
  readonly quantidade: number;
  readonly forma: FormaObjeto;
}

/**
 * Progressão: começa em 1 e sobe de um em um até 5; chegando no teto, sorteia
 * de novo entre 2 e 5 (nunca acima de `MAX_CONTAGEM`). A forma muda a cada
 * rodada para a criança não decorar a silhueta em vez de contar.
 */
export function proximaRodadaContar(
  anterior: RodadaContar | null = null,
  sortear: Sorteio = Math.random,
): RodadaContar {
  const formas = Object.keys(FORMAS) as FormaObjeto[];
  const candidatas = formas.filter((f) => f !== anterior?.forma);
  const forma = embaralhar(candidatas.length > 0 ? candidatas : formas, sortear)[0];

  if (!anterior) return { quantidade: MIN_CONTAGEM, forma };

  const atual = limitarQuantidade(anterior.quantidade);
  if (atual < MAX_CONTAGEM) return { quantidade: atual + 1, forma };

  // No teto: sorteia entre 2 e 5 (voltar para 1 depois de contar 5 é sem graça).
  const opcoes = [2, 3, 4, 5].filter((n) => n <= MAX_CONTAGEM);
  return { quantidade: embaralhar(opcoes, sortear)[0], forma };
}
