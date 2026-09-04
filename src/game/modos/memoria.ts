/**
 * MODO "JOGO DA MEMÓRIA" — máquina de cartas PURA (sem React, sem DOM, sem
 * timers). Roda em node: `node --test --experimental-strip-types`.
 * =============================================================================
 *
 * MECÂNICA: um tabuleiro pequeno de cartas viradas para baixo, em pares. A
 * criança toca numa carta — ela vira e o jogo FALA o nome do que apareceu
 * ("peixinho", "polvo", "Mamãe"). Ao virar a segunda, o jogo compara: par
 * certo fica virado para sempre e ouve "Achou o par!"; par errado volta para
 * baixo com uma frase de INCENTIVO ("Quase! Vamos de novo."). Quando todos os
 * pares estão achados o tabuleiro está "completo" e vem a festa.
 *
 * POR QUE ESTE MODO EXISTE: a mesma criança que jogava aos 3 anos tem 5. Achar
 * pares é memória de trabalho + nomeação, e é o único modo em que a criança
 * pode "errar" no sentido comum da palavra — daí o cuidado abaixo.
 *
 * REGRAS DE PRODUTO (as mesmas do resto do app — ver `engine.ts` e `fala.ts`)
 * --------------------------------------------------------------------------
 * 1. **NÃO EXISTE PERDER.** Não há vidas, não há tempo, não há limite de
 *    tentativas. Um par errado devolve as cartas para baixo e a criança tenta
 *    de novo, quantas vezes quiser. A fala do par errado é sempre de REFORÇO
 *    POSITIVO, nunca corretiva ("Errou!", "Não é esse" — proibidos).
 * 2. **NENHUM NÚMERO NA TELA.** `tentativas` existe só para `proximoNivel`
 *    decidir se o tabuleiro seguinte cresce. Ele NUNCA é falado nem desenhado:
 *    seria placar, e placar é justamente o que este app não tem.
 * 3. **O NÍVEL NUNCA DESCE.** `proximoNivel` sobe ou fica onde está. Rebaixar
 *    o tabuleiro depois de uma rodada difícil é a leitura mais direta possível
 *    de "você foi mal" para uma criança que não lê — é punição disfarçada de
 *    ajuste de dificuldade.
 * 4. **Só toque, e só fala pela `filaDeFala`.** Este módulo não fala nada: ele
 *    DEVOLVE pedidos de fala (`FalaMemoria`), e a página os enfileira. Mesmo
 *    contrato de `contar.ts`.
 *
 * INVARIANTES (todos cobertos por `memoria.test.ts`)
 * -------------------------------------------------
 *  1. Enquanto a fase é `comparando` (duas cartas na mesa), TODO toque é
 *     ignorado — o terceiro dedo da criança não pode virar uma terceira carta
 *     nem "roubar" o par que está sendo comparado.
 *  2. Tocar de novo numa carta JÁ VIRADA ou JÁ ENCONTRADA não faz nada: nem
 *     muda estado, nem fala, nem conta tentativa (duplo toque, multi-touch,
 *     criança martelando a mesma carta).
 *  3. O tabuleiro só chega a `completo` por PARES ACERTADOS: `encontradas`
 *     cresce exclusivamente dentro de `resolver` quando as duas cartas viradas
 *     têm o mesmo `par`. Não há atalho, timeout nem "desistir".
 *  4. `proximoNivel` devolve sempre 1, 2 ou 3, e nunca menos que o nível
 *     recebido (monotônico — ver regra de produto 3).
 *  5. Tudo é puro e determinístico: com o mesmo `sortear` injetado
 *     (`criarSorteio` de `cores.ts`), `criarMemoria` devolve exatamente o mesmo
 *     tabuleiro. Nada de `Date.now()`, nada de áudio, nada de `Math.random()`
 *     escondido.
 *
 * FLUXO
 *   escolhendo ──(1ª carta)──▶ escolhendo ──(2ª carta)──▶ comparando
 *        ▲                                                     │
 *        └──────────── resolver() (par errado) ────────────────┘
 *                                                              │
 *                              resolver() (último par) ──▶ completo
 *
 * NÃO DEPENDE DE CADASTRO: o baralho de desenhos é injetado pela página
 * (`desenhos`), que monta formas do fundo do mar e mascotes sempre, e fotos da
 * família só quando existem. Sem nenhuma foto cadastrada o jogo roda igual.
 */

import { embaralhar, type Sorteio } from "../dificuldade.ts";
import type { FormaObjeto } from "./cores.ts";
import type { Mascote } from "@/components/Personagem";

// ------------------------------------------------------------------- tipos

export type FaseMemoria = "escolhendo" | "comparando" | "completo";

/**
 * O que a carta mostra quando vira. Três variantes, todas já desenháveis com
 * componentes que existem — nada de arte nova:
 * - `forma`: peça do fundo do mar (`<ObjetoMar>`), com a cor da bijeção de
 *   `cores.ts`;
 * - `mascote`: um dos quatro bichinhos SVG de `<Personagem>` (sem foto);
 * - `pessoa`: a foto recortada de um familiar cadastrado (`<Personagem foto>`).
 */
export type DesenhoCarta =
  | { readonly tipo: "forma"; readonly forma: FormaObjeto; readonly cor: string }
  | { readonly tipo: "mascote"; readonly mascote: Mascote }
  | { readonly tipo: "pessoa"; readonly personagemId: string; readonly nome: string };

/** Uma carta na mesa. Duas cartas do mesmo `par` casam. */
export interface CartaMemoria {
  /** Id único DESTA carta (as duas do par têm ids diferentes). */
  readonly id: string;
  /**
   * Chave do par — igual nas duas cartas irmãs. É também a chave da figurinha
   * (`idFigurinha("memoria", par)`), então precisa ser estável entre sessões:
   * id da forma, id do mascote ou id do personagem.
   */
  readonly par: string;
  readonly desenho: DesenhoCarta;
  /** Nome falado quando a carta vira ("peixinho", "polvo", "Mamãe"). */
  readonly nome: string;
}

/** Pedido de fala — mesmo formato de `FalaContagem` em `contar.ts`. */
export interface FalaMemoria {
  readonly chave: string;
  readonly texto: string;
  readonly prioridade: "alta" | "normal";
}

export interface EstadoMemoria {
  readonly cartas: readonly CartaMemoria[];
  /** Ids das cartas viradas para cima AGORA (0, 1 ou 2 — nunca mais). */
  readonly viradas: readonly string[];
  /** Chaves de par já achadas — essas cartas ficam para cima para sempre. */
  readonly encontradas: readonly string[];
  readonly fase: FaseMemoria;
  /**
   * Quantas duplas a criança já comparou neste tabuleiro. USO ÚNICO:
   * `proximoNivel`. Nunca falado, nunca desenhado (regra de produto 2).
   */
  readonly tentativas: number;
  /** Colunas da grade (a página joga em `--colunas` no CSS). */
  readonly colunas: number;
  /** Texto falado ao abrir o tabuleiro. */
  readonly pergunta: string;
  /** Incrementa a cada transição aceita — serve de `key`/guarda de timer. */
  readonly versao: number;
}

export interface TransicaoMemoria {
  readonly estado: EstadoMemoria;
  readonly mudou: boolean;
  readonly falas: readonly FalaMemoria[];
}

// -------------------------------------------------------------- constantes

export type NivelMemoria = 1 | 2 | 3;

/**
 * Os três tabuleiros. Pequenos de propósito: 6 pares (4x3) já é o teto do que
 * uma criança de 5 anos segura sem desistir no meio, e cabe em retrato sem
 * carta menor que `--toque-min`.
 */
export const NIVEIS = {
  1: { pares: 2, colunas: 2 },
  2: { pares: 3, colunas: 3 },
  3: { pares: 6, colunas: 4 },
} as const satisfies Record<NivelMemoria, { pares: number; colunas: number }>;

export const NIVEIS_MEMORIA: readonly NivelMemoria[] = [1, 2, 3];

/** Pergunta do tabuleiro. Uma frase só, sem número e sem instrução de leitura. */
export const PERGUNTA_MEMORIA = "Vira as cartas e acha os pares!";

/** Fala do par certo. */
export const FALA_PAR = "Achou o par!";

/**
 * Falas do par errado. Todas de INCENTIVO (regra de produto 1) — nenhuma
 * delas diz que a criança errou. Escolhida por `versao`, não sorteada, para o
 * módulo continuar determinístico sem precisar de `sortear` aqui.
 */
export const FALAS_QUASE: readonly string[] = [
  "Quase! Vamos de novo.",
  "Tenta outra!",
  "Isso, continua procurando!",
];

/** Festa do tabuleiro completo. */
export const FALA_COMPLETO = "Você achou todos os pares!";

// ----------------------------------------------------------------- criação

/** Um desenho disponível para virar par. A página monta o baralho. */
export interface DesenhoDisponivel {
  /** Chave estável do par (id da forma / do mascote / do personagem). */
  readonly par: string;
  readonly desenho: DesenhoCarta;
  readonly nome: string;
}

export interface OpcoesMemoria {
  readonly nivel: NivelMemoria;
  /**
   * Baralho de onde sair os pares. Precisa ter pelo menos `NIVEIS[nivel].pares`
   * entradas; com menos, o tabuleiro nasce com quantos couberem (nunca lança —
   * um baralho curto por falta de cadastro não pode quebrar a tela da criança).
   * Entradas com `par` repetido são descartadas: dois pares iguais no mesmo
   * tabuleiro dariam quatro cartas idênticas e a comparação perderia o sentido.
   */
  readonly desenhos: readonly DesenhoDisponivel[];
  readonly sortear?: Sorteio;
}

/** Limita ao conjunto fechado de níveis, sem lançar. */
export function limitarNivel(bruto: number): NivelMemoria {
  const n = Math.round(Number(bruto));
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(1, n)) as NivelMemoria;
}

/**
 * Monta o tabuleiro: pega `pares` desenhos do baralho, duplica cada um em duas
 * cartas e embaralha tudo. Determinístico com `sortear` injetado.
 */
export function criarMemoria({ nivel, desenhos, sortear = Math.random }: OpcoesMemoria): EstadoMemoria {
  const config = NIVEIS[limitarNivel(nivel)];

  // Sem `par` repetido: quatro cartas iguais na mesa não formariam um par
  // definido (qual casa com qual?), e a criança acertaria "sem querer".
  const vistos = new Set<string>();
  const unicos = desenhos.filter((d) => {
    if (vistos.has(d.par)) return false;
    vistos.add(d.par);
    return true;
  });

  const escolhidos = embaralhar(unicos, sortear).slice(0, config.pares);

  const cartas: CartaMemoria[] = [];
  for (const d of escolhidos) {
    cartas.push({ id: `${d.par}#a`, par: d.par, desenho: d.desenho, nome: d.nome });
    cartas.push({ id: `${d.par}#b`, par: d.par, desenho: d.desenho, nome: d.nome });
  }

  return {
    cartas: embaralhar(cartas, sortear),
    viradas: [],
    encontradas: [],
    // Baralho vazio (nenhum desenho): o tabuleiro já nasce completo em vez de
    // travar. Na prática não acontece — a página sempre tem formas e mascotes.
    fase: cartas.length === 0 ? "completo" : "escolhendo",
    tentativas: 0,
    colunas: config.colunas,
    pergunta: PERGUNTA_MEMORIA,
    versao: 0,
  };
}

// -------------------------------------------------------------- consultas

function ignorada(estado: EstadoMemoria): TransicaoMemoria {
  return { estado, mudou: false, falas: [] };
}

export function cartaDe(estado: EstadoMemoria, id: string): CartaMemoria | undefined {
  return estado.cartas.find((c) => c.id === id);
}

/** Esta carta já foi casada (fica para cima para sempre)? */
export function jaEncontrada(estado: EstadoMemoria, id: string): boolean {
  const carta = cartaDe(estado, id);
  return carta ? estado.encontradas.includes(carta.par) : false;
}

/** Esta carta está para cima agora (virada nesta jogada ou já casada)? */
export function estaVirada(estado: EstadoMemoria, id: string): boolean {
  return estado.viradas.includes(id) || jaEncontrada(estado, id);
}

export function paresRestantes(estado: EstadoMemoria): number {
  const total = new Set(estado.cartas.map((c) => c.par)).size;
  return total - estado.encontradas.length;
}

export function memoriaCompleta(estado: EstadoMemoria): boolean {
  return paresRestantes(estado) <= 0;
}

// -------------------------------------------------------------- transições

/**
 * Toque numa carta.
 *
 * Ignorado (`mudou: false`, `falas: []`) quando:
 * - a fase não é `escolhendo` (duas cartas na mesa esperando `resolver`, ou
 *   tabuleiro completo) — é esta linha que barra o TERCEIRO toque;
 * - o id não existe no tabuleiro;
 * - a carta já está virada nesta jogada (duplo toque na mesma carta);
 * - a carta pertence a um par já encontrado.
 *
 * Aceito ⇒ vira a carta e fala o NOME dela (prioridade alta: corta a fala
 * anterior em vez de empilhar, igual à contagem). Se foi a SEGUNDA carta, a
 * fase vira `comparando` e `tentativas` sobe — a página agenda `resolver`.
 */
export function virar(estado: EstadoMemoria, id: string): TransicaoMemoria {
  if (estado.fase !== "escolhendo") return ignorada(estado);
  const carta = cartaDe(estado, id);
  if (!carta) return ignorada(estado);
  if (estado.encontradas.includes(carta.par)) return ignorada(estado);
  if (estado.viradas.includes(id)) return ignorada(estado);

  const viradas = [...estado.viradas, id];
  const fechou = viradas.length >= 2;

  return {
    estado: {
      ...estado,
      viradas,
      fase: fechou ? "comparando" : "escolhendo",
      tentativas: fechou ? estado.tentativas + 1 : estado.tentativas,
      versao: estado.versao + 1,
    },
    mudou: true,
    falas: [
      {
        // A versão entra na chave para o mesmo nome poder ser falado de novo
        // mais tarde sem cair no dedupe da fila de fala.
        chave: `carta:${carta.par}:${estado.versao}`,
        texto: carta.nome,
        prioridade: "alta",
      },
    ],
  };
}

/**
 * Fecha a comparação das duas cartas viradas (a página chama depois de um
 * respiro de ~1,1 s, tempo de a criança OLHAR as duas).
 *
 * - Fora de `comparando` ⇒ ignorada.
 * - Par certo ⇒ `encontradas += par`, as cartas ficam para cima e o jogo fala
 *   "Achou o par!". Se era o último par, a fase vira `completo` e entra também
 *   a fala de festa.
 * - Par errado ⇒ as duas cartas voltam para baixo e o jogo fala uma frase de
 *   INCENTIVO (`FALAS_QUASE`) — nunca uma correção. Nada é descontado: a
 *   única consequência de um par errado é o tabuleiro seguinte não crescer.
 */
export function resolver(estado: EstadoMemoria): TransicaoMemoria {
  if (estado.fase !== "comparando") return ignorada(estado);
  if (estado.viradas.length < 2) return ignorada(estado);

  const [a, b] = estado.viradas.map((id) => cartaDe(estado, id));
  const casou = !!a && !!b && a.par === b.par;

  if (!casou) {
    return {
      estado: { ...estado, viradas: [], fase: "escolhendo", versao: estado.versao + 1 },
      mudou: true,
      falas: [
        {
          chave: `quase:${estado.versao}`,
          texto: FALAS_QUASE[estado.tentativas % FALAS_QUASE.length],
          prioridade: "normal",
        },
      ],
    };
  }

  const encontradas = [...estado.encontradas, a.par];
  const completou = encontradas.length >= new Set(estado.cartas.map((c) => c.par)).size;

  const falas: FalaMemoria[] = [
    { chave: `par:${a.par}:${estado.versao}`, texto: FALA_PAR, prioridade: "normal" },
  ];
  if (completou) {
    falas.push({ chave: `completo:${estado.versao}`, texto: FALA_COMPLETO, prioridade: "normal" });
  }

  return {
    estado: {
      ...estado,
      viradas: [],
      encontradas,
      fase: completou ? "completo" : "escolhendo",
      versao: estado.versao + 1,
    },
    mudou: true,
    falas,
  };
}

/** Repetir a pergunta (botão do `<Palco>`): fala de novo, sem mudar de fase. */
export function repetirPergunta(estado: EstadoMemoria): TransicaoMemoria {
  if (estado.fase === "completo") return ignorada(estado);
  return {
    estado,
    mudou: false,
    falas: [
      { chave: `pergunta:${estado.versao}`, texto: estado.pergunta, prioridade: "alta" },
    ],
  };
}

// ------------------------------------------------------------- progressão

/**
 * Nível do PRÓXIMO tabuleiro.
 *
 * Sobe um degrau quando a criança fechou o tabuleiro em `pares + 2` tentativas
 * ou menos — a folga de 2 é o que separa "achou por memória" de "achou virando
 * tudo na sorte", sem exigir a jogada perfeita (que quase nenhuma criança de 5
 * faz num 4x3).
 *
 * NUNCA DESCE (regra de produto 3): fora dessa condição, o nível FICA. Um
 * tabuleiro que encolhe depois de uma rodada difícil é punição — e aqui não
 * existe perder. E nunca passa de 3, o teto que cabe na tela.
 */
export function proximoNivel(nivel: number, estado: EstadoMemoria): NivelMemoria {
  const atual = limitarNivel(nivel);
  if (estado.fase !== "completo") return atual;

  const pares = new Set(estado.cartas.map((c) => c.par)).size;
  const merece = estado.tentativas <= pares + 2;
  if (!merece) return atual;

  return limitarNivel(atual + 1);
}
