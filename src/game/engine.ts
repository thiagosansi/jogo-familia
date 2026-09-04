/**
 * ENGINE DE RODADA — máquina de estados PURA (sem React, sem DOM, sem timers).
 * =============================================================================
 *
 * REGRA DE OURO DO PRODUTO: **não existe perder**.
 * Não há (e não pode passar a haver) fase de derrota, placar numérico,
 * cronômetro ou game over. Um toque errado vira `quaseLa`: careta engraçada +
 * reforço positivo + a pergunta repetida — e a rodada volta a `perguntando`.
 * O tipo `FaseRodada` é a garantia estrutural disso (ver `FASES`).
 *
 * COMO AS TASKS 4/5/6 CONSOMEM (família, cores/formas, contar 1-5, animais)
 * -----------------------------------------------------------------------
 * O engine é agnóstico de conteúdo: ele só conhece **ids** de alternativa
 * (strings). Cada mini-jogo mantém o seu próprio mapa `id -> conteúdo`
 * (foto do familiar, cor, quantidade, animal) e desenha as alternativas.
 *
 *   import { criarRodada, tocar, continuar, recompensar, repetirPergunta } from "@/game/engine";
 *
 *   let estado = criarRodada({
 *     pergunta: "Cadê a mamãe?",
 *     alternativas: ["p1", "p2"],   // ids do mini-jogo
 *     correta: "p1",
 *   });
 *
 *   // no handler do toque (ver <BotaoAlternativa> em Palco.tsx):
 *   const t = tocar(estado, "p2");
 *   if (t.mudou) estado = t.estado;      // t.mudou === false ⇒ toque ignorado
 *   for (const fala of t.falas) void filaDeFala.falar({ ... });  // ver fala.ts
 *
 * Na prática o React não chama isto na mão: use o hook `useRodada`
 * (`@/game/useRodada`), que já cuida da fila de fala, dos timers de
 * `quaseLa -> perguntando` / `acertou -> recompensa` e do cleanup no unmount.
 *
 * FLUXO DE FASES
 * --------------
 *            tocar(errada)                continuar()
 *   perguntando ──────────▶ quaseLa ──────────────▶ perguntando   (∞ vezes)
 *        │
 *        │ tocar(correta)          recompensar()
 *        └───────────────▶ acertou ─────────────▶ recompensa   (fim da rodada)
 *
 * INVARIANTES (cobertos por engine.test.ts)
 * -----------------------------------------
 * 1. Nenhuma sequência de toques errados encerra a rodada nem produz derrota.
 * 2. Toques só são aceitos na fase `perguntando`. Em qualquer outra fase o
 *    resultado é `mudou: false` e `falas: []` (nada empilha em cima da fala).
 * 3. Toques dentro de `janelaToqueMs` do último toque aceito são ignorados —
 *    é isto que faz multi-touch simultâneo contar como UM toque só e dois
 *    toques em < 200 ms produzirem UMA transição e UM áudio.
 * 4. Todas as funções são puras: recebem `em` (timestamp) e devolvem um estado
 *    NOVO. Nada de `Date.now()` escondido quando o chamador informa `em`.
 */

// ---------------------------------------------------------------------- fases

/**
 * As únicas fases que existem. Repare: não há `perdeu`, `derrota`, `errou`
 * nem `fimDeJogo`. Adicionar uma quebraria o teste `sem estado de derrota`.
 */
export type FaseRodada = "perguntando" | "quaseLa" | "acertou" | "recompensa";

/**
 * Espelho em runtime da união `FaseRodada`. O `Record<FaseRodada, true>` força
 * o compilador a acusar se a união e esta lista divergirem — então um teste
 * sobre `FASES` é, na prática, um teste sobre o tipo.
 */
const TODAS_AS_FASES: Record<FaseRodada, true> = {
  perguntando: true,
  quaseLa: true,
  acertou: true,
  recompensa: true,
};

export const FASES = Object.keys(TODAS_AS_FASES) as readonly FaseRodada[];

// ---------------------------------------------------------------------- falas

/** Por que o jogo está falando — o mini-jogo decide a voz/áudio de cada motivo. */
export type MotivoFala = "pergunta" | "reforco" | "festa";

/**
 * Pedido de fala emitido por uma transição. Converta para `ItemFala` de
 * `fala.ts` acrescentando a voz gravada quando houver — `Blob` (IndexedDB) ou
 * URL (`string`, servida pela web): `personagem.vozNome` para `pergunta`,
 * `personagem.vozFesta` para `festa`.
 */
export interface FalaDaRodada {
  motivo: MotivoFala;
  texto: string;
  /**
   * `alta` cancela o que estiver tocando (o feedback do toque tem que sair em
   * menos de 100 ms); `normal` entra na fila atrás.
   */
  prioridade: "alta" | "normal";
}

// --------------------------------------------------------------------- estado

export interface ConfigRodada {
  /** Texto falado da pergunta ("Cadê a mamãe?"). Também é o rótulo do <Palco>. */
  pergunta: string;
  /** Ids das alternativas exibidas (2 a 4 — ver `dificuldade.ts`). */
  alternativas: readonly string[];
  /** Id da alternativa correta. Precisa estar em `alternativas`. */
  correta: string;
  /** Frases de reforço do `quaseLa`, usadas em rodízio. */
  reforcos?: readonly string[];
  /** Frase de comemoração do acerto. */
  festa?: string;
  /** Janela de bloqueio após um toque aceito (multi-touch/duplo toque). */
  janelaToqueMs?: number;
  /** Timestamp inicial (injete nos testes). */
  em?: number;
}

export interface EstadoRodada {
  readonly fase: FaseRodada;
  readonly pergunta: string;
  readonly alternativas: readonly string[];
  readonly correta: string;
  /** Alternativa correta escolhida (só preenche em `acertou`/`recompensa`). */
  readonly escolhida: string | null;
  /** Última alternativa errada tocada — o mini-jogo usa para a careta. */
  readonly ultimaQuase: string | null;
  /** Quantos `quaseLa` esta rodada teve. Não é placar: alimenta `dificuldade`. */
  readonly quaseLas: number;
  /** Incrementa a cada transição aceita. Use como `key`/guarda de timer. */
  readonly versao: number;
  /** Toques com `em` menor que isto são ignorados. */
  readonly bloqueadoAte: number;
  readonly reforcos: readonly string[];
  readonly festa: string;
  readonly janelaToqueMs: number;
}

/** Resultado de qualquer transição. `mudou: false` ⇒ o toque foi ignorado. */
export interface Transicao {
  estado: EstadoRodada;
  mudou: boolean;
  falas: readonly FalaDaRodada[];
}

/** Reforços padrão — sempre positivos, nunca corretivos. */
export const REFORCOS_PADRAO: readonly string[] = [
  "Quase!",
  "Ih, essa não! Tenta de novo!",
  "Opa! Cadê?",
  "Quase lá! Olha de novo!",
];

export const FESTA_PADRAO = "Isso! Muito bem!";

/** Bloqueio após um toque aceito. 300 ms cobre o multi-touch de dois dedos. */
export const JANELA_TOQUE_MS = 300;

// ------------------------------------------------------------------- criação

/**
 * Cria a rodada na fase `perguntando`. Valida a configuração alto e cedo:
 * um mini-jogo que sorteia mal as alternativas quebra aqui, não na cara da
 * criança.
 */
export function criarRodada(config: ConfigRodada): EstadoRodada {
  const alternativas = [...config.alternativas];
  if (alternativas.length < 2) {
    throw new Error("Rodada precisa de pelo menos 2 alternativas.");
  }
  if (new Set(alternativas).size !== alternativas.length) {
    throw new Error("Alternativas repetidas na mesma rodada.");
  }
  if (!alternativas.includes(config.correta)) {
    throw new Error("A alternativa correta precisa estar entre as alternativas.");
  }
  const reforcos =
    config.reforcos && config.reforcos.length > 0 ? [...config.reforcos] : [...REFORCOS_PADRAO];

  return {
    fase: "perguntando",
    pergunta: config.pergunta,
    alternativas,
    correta: config.correta,
    escolhida: null,
    ultimaQuase: null,
    quaseLas: 0,
    versao: 0,
    bloqueadoAte: config.em ?? 0,
    reforcos,
    festa: config.festa ?? FESTA_PADRAO,
    janelaToqueMs: config.janelaToqueMs ?? JANELA_TOQUE_MS,
  };
}

// ---------------------------------------------------------------- transições

function ignorada(estado: EstadoRodada): Transicao {
  return { estado, mudou: false, falas: [] };
}

/** A rodada aceita toque agora? (fase certa + fora da janela de bloqueio) */
export function aceitaToque(estado: EstadoRodada, em: number = Date.now()): boolean {
  return estado.fase === "perguntando" && em >= estado.bloqueadoAte;
}

/**
 * Toque da criança numa alternativa.
 *
 * - Fora da fase `perguntando`, ou dentro da janela de bloqueio, ou id
 *   desconhecido ⇒ `mudou: false`, `falas: []` (nada acontece, nada empilha).
 * - Alternativa correta ⇒ `acertou` + fala de festa (prioridade alta).
 * - Alternativa errada ⇒ `quaseLa` + reforço positivo + a pergunta de novo.
 *   NUNCA derrota: `quaseLas` só cresce e `continuar()` devolve a rodada.
 */
export function tocar(
  estado: EstadoRodada,
  alternativa: string,
  em: number = Date.now(),
): Transicao {
  if (!aceitaToque(estado, em)) return ignorada(estado);
  if (!estado.alternativas.includes(alternativa)) return ignorada(estado);

  const bloqueadoAte = em + estado.janelaToqueMs;

  if (alternativa === estado.correta) {
    return {
      estado: {
        ...estado,
        fase: "acertou",
        escolhida: alternativa,
        versao: estado.versao + 1,
        bloqueadoAte,
      },
      mudou: true,
      falas: [{ motivo: "festa", texto: estado.festa, prioridade: "alta" }],
    };
  }

  const reforco = estado.reforcos[estado.quaseLas % estado.reforcos.length];
  return {
    estado: {
      ...estado,
      fase: "quaseLa",
      ultimaQuase: alternativa,
      quaseLas: estado.quaseLas + 1,
      versao: estado.versao + 1,
      bloqueadoAte,
    },
    mudou: true,
    falas: [
      { motivo: "reforco", texto: reforco, prioridade: "alta" },
      { motivo: "pergunta", texto: estado.pergunta, prioridade: "normal" },
    ],
  };
}

/**
 * Fim da careta: `quaseLa -> perguntando`. A mesma rodada continua viva, com
 * as mesmas alternativas — a criança tenta quantas vezes quiser.
 */
export function continuar(estado: EstadoRodada, em: number = Date.now()): Transicao {
  if (estado.fase !== "quaseLa") return ignorada(estado);
  return {
    estado: {
      ...estado,
      fase: "perguntando",
      versao: estado.versao + 1,
      // Libera o toque na hora: a criança já esperou a careta inteira.
      bloqueadoAte: em,
    },
    mudou: true,
    falas: [],
  };
}

/** `acertou -> recompensa` (figurinha/aquário). Fim da rodada. */
export function recompensar(estado: EstadoRodada, em: number = Date.now()): Transicao {
  if (estado.fase !== "acertou") return ignorada(estado);
  return {
    estado: { ...estado, fase: "recompensa", versao: estado.versao + 1, bloqueadoAte: em },
    mudou: true,
    falas: [],
  };
}

/**
 * Botão "repetir a pergunta" do <Palco>. Não muda de fase (por isso
 * `mudou: false`) — só reemite a fala, com prioridade alta para cortar o que
 * estiver tocando e não empilhar.
 */
export function repetirPergunta(estado: EstadoRodada): Transicao {
  if (estado.fase === "acertou" || estado.fase === "recompensa") return ignorada(estado);
  return {
    estado,
    mudou: false,
    falas: [{ motivo: "pergunta", texto: estado.pergunta, prioridade: "alta" }],
  };
}

/** A rodada acabou? (só `recompensa` encerra — nunca por erro.) */
export function rodadaEncerrada(estado: EstadoRodada): boolean {
  return estado.fase === "recompensa";
}
