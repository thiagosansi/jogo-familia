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
 * MOTOR REUSADO POR OUTRO MODO (inglês): as PALAVRAS da contagem e o TETO de
 * objetos são injetáveis (`OpcoesContagem.falas` / `OpcoesContagem.maximo`),
 * com o pacote pt-BR e o teto 5 como PADRÃO. O baralho de números do modo
 * inglês (`ingles.ts`) reaproveita esta mesma máquina de estados passando
 * "one, two, three…" e teto 10 — em vez de duplicar as regras de "não conta
 * duas vezes", "ordem livre" e "não existe perder", que são justamente as
 * partes difíceis de acertar. Quem NÃO passa nada continua com o modo Contar
 * de sempre, byte a byte.
 *
 * INVARIANTES (cobertos por contar.test.ts)
 *  1. A contagem NUNCA passa de 5 (`MAX_CONTAGEM`) no modo Contar — nem por
 *     config nem por sorteio da próxima rodada. O teto só sobe quando quem
 *     chama pede `maximo` explicitamente (o inglês conta até 10).
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

/**
 * TUDO o que esta máquina fala, num pacote injetável — é o que permite o modo
 * inglês reusar a máquina inteira sem duplicá-la (ver o cabeçalho). O motor
 * nunca monta texto sozinho: pergunta pro pacote.
 */
export interface FalasContagem {
  /** Palavra de cada número, na ordem (índice 0 = o primeiro objeto contado). */
  readonly numeros: readonly string[];
  /**
   * Fala do total, no fim da contagem. `null` = não fala nada além do
   * último número — é o caso do inglês: a última palavra contada ("nine")
   * JÁ É o total, então falar de novo ("Nine!") logo em seguida vira eco
   * para uma criança de 3 anos, não reforço (em pt-BR "nove" e "São nove
   * peixinhos!" são frases diferentes, então o total continua fazendo
   * sentido lá — ver `FALAS_CONTAGEM_PT_BR`).
   */
  readonly total: ((n: number, forma: FormaObjeto) => string) | null;
  /**
   * Fala da comemoração (`comemorar`). `null` = a etapa fecha em silêncio —
   * é o caso do inglês, onde a comemoração já aconteceu ANTES da contagem
   * (no acerto do número), e repetir seria ruído.
   */
  readonly festa: string | null;
}

/** O modo Contar de sempre. Padrão de `criarContagem` — não mexer. */
export const FALAS_CONTAGEM_PT_BR: FalasContagem = {
  numeros: NUMEROS,
  total: falaDoTotal,
  festa: "Muito bem!",
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
  /** Pacote de falas desta contagem (pt-BR por padrão — ver `FalasContagem`). */
  readonly falas: FalasContagem;
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
  /** Quantos bichinhos. Fora de 1..`maximo` é limitado ao intervalo. */
  quantidade: number;
  forma?: FormaObjeto;
  /** Sobrescreve a cor da forma (padrão: a cor que essa forma tem em `cores.ts`). */
  cor?: string;
  sortear?: Sorteio;
  /**
   * Teto de objetos. Padrão `MAX_CONTAGEM` (5) — o teto pedagógico do modo
   * Contar em pt-BR, que ninguém deve mexer. O baralho de números do inglês
   * ensina até "ten", então passa 10 aqui: são objetivos diferentes (lá a
   * criança escolhe entre quantidades desenhadas, aqui ela conta na mão).
   */
  maximo?: number;
  /** Palavras faladas. Padrão: `FALAS_CONTAGEM_PT_BR`. */
  falas?: FalasContagem;
  /** Sobrescreve o texto da pergunta (o inglês usa só a palavra: "Eight!"). */
  pergunta?: string;
}

/** Cor canônica da forma — a MESMA tabela cor<->forma do modo cores. */
export function corDaForma(forma: FormaObjeto): string {
  const encontrada = CORES.find((c) => c.forma === forma);
  if (!encontrada) throw new Error(`Forma sem cor no catálogo: ${forma}`);
  return encontrada.hex;
}

/**
 * Limita a quantidade ao intervalo 1..`maximo`. O padrão é o teto pedagógico
 * de 5 do modo Contar — quem não passa `maximo` continua limitado a 5.
 */
export function limitarQuantidade(valor: number, maximo: number = MAX_CONTAGEM): number {
  const teto = Math.max(MIN_CONTAGEM, Math.round(Number(maximo)) || MAX_CONTAGEM);
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n)) return MIN_CONTAGEM;
  return Math.min(teto, Math.max(MIN_CONTAGEM, n));
}

export function criarContagem({
  quantidade,
  forma = "peixe",
  cor,
  sortear = Math.random,
  maximo = MAX_CONTAGEM,
  falas = FALAS_CONTAGEM_PT_BR,
  pergunta,
}: OpcoesContagem): EstadoContagem {
  const total = limitarQuantidade(quantidade, maximo);
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
    pergunta: pergunta ?? `Vamos contar ${info.genero === "f" ? "as" : "os"} ${info.plural}!`,
    falas,
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
      texto: estado.falas.numeros[n - 1] ?? String(n),
      prioridade: "alta",
    },
  ];
  // `total: null` (pacote do inglês) = pular esta fala de propósito: o
  // último número já dito É o total, repeti-lo em seguida seria eco.
  if (completou && estado.falas.total) {
    falas.push({
      chave: `total:${total}:${estado.versao}`,
      texto: estado.falas.total(total, estado.forma),
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

/**
 * `total -> festa`: comemoração antes da próxima rodada. Com
 * `falas.festa === null` (o pacote do inglês) a transição acontece igual, só
 * que em silêncio — a comemoração de lá já foi no acerto do número.
 */
export function comemorar(estado: EstadoContagem): TransicaoContagem {
  if (estado.fase !== "total") return ignorada(estado);
  const texto = estado.falas.festa;
  return {
    estado: { ...estado, fase: "festa", versao: estado.versao + 1 },
    mudou: true,
    falas:
      texto === null
        ? []
        : [{ chave: `festa:${estado.versao}`, texto, prioridade: "normal" }],
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
