/**
 * FILA DE FALA — um áudio por vez, sempre.
 *
 * Problema que isto resolve: criança de 3 anos martela a tela. Sem fila, cada
 * toque dispara um `AudioBufferSourceNode` e as vozes tocam por cima umas das
 * outras (e no iOS, sem gesto, nenhuma toca). Aqui:
 *
 *  - execução SERIALIZADA: o próximo item só começa quando o anterior termina;
 *  - DEDUPE: pedir de novo algo que já está tocando/na fila não empilha;
 *  - PRIORIDADE `alta`: corta o que estiver tocando (feedback do toque tem que
 *    sair em < 100 ms) e limpa a fila;
 *  - voz gravada da família quando existe — `Blob` (gravado no aparelho) ou
 *    URL (`string`, servida pela web); senão `SpeechSynthesis`, mais lento
 *    que o padrão, no `Idioma` pedido (pt-BR por padrão; en-US para o modo
 *    de inglês) — ver `Idioma` e `ItemFala.idioma`;
 *  - `AudioContext` do `@/lib/media` (singleton destravado no 1º gesto no iOS).
 *
 * Uso (tasks 4/5/6 normalmente só usam via `useRodada`):
 *
 *   import { filaDeFala } from "@/game/fala";
 *   filaDeFala.falar({ chave: "pergunta", texto: "Cadê a mamãe?", audio: p.vozNome });
 *   filaDeFala.falar({ chave: "en:cat", texto: "Cat", idioma: "en-US" });
 *   filaDeFala.cancelar();                       // troca de tela / unmount
 *   const parar = filaDeFala.assinar(({ falando }) => setFalando(falando));
 *
 * O motor de áudio é injetável (`new FilaDeFala(motorFake)`), o que deixa a
 * fila testável em node — é assim que `engine.test.ts` conta os áudios.
 */

/** Idioma da fala — controla o `lang` do TTS e a escolha de voz. */
export type Idioma = "pt-BR" | "en-US";

/** Idioma padrão de todo o app até hoje — mantém o comportamento atual. */
export const IDIOMA_PADRAO: Idioma = "pt-BR";

export interface ItemFala {
  /**
   * Identidade lógica da fala. Dois pedidos com a mesma chave não empilham.
   * Padrão: `${idioma}:${texto}` — o idioma entra na chave padrão de
   * propósito. Sem isto, o MESMO texto pedido em dois idiomas (coincidência,
   * ou um modo bilíngue reaproveitando frases) seria deduplicado como se
   * fosse uma fala só, e uma das duas nunca tocaria.
   */
  chave?: string;
  /** Texto para o TTS (e rótulo acessível). */
  texto: string;
  /**
   * Voz gravada da família. Tem prioridade sobre o TTS quando existe.
   * Aceita `Blob` (gravado no aparelho, IndexedDB) ou `string` (URL servida
   * pela web) — o jogo funciona igual nos dois modos.
   */
  audio?: FonteAudio | null;
  /** `alta` cancela o que estiver tocando e limpa a fila. */
  prioridade?: "alta" | "normal";
  /** Velocidade do TTS. 0.8 = bem devagar, para criança de 3 anos. */
  taxa?: number;
  /** Idioma do TTS (`fala.lang` + escolha de voz). Padrão: `"pt-BR"`. */
  idioma?: Idioma;
}

/** De onde sai a voz: arquivo local (IndexedDB) ou endereço na web. */
export type FonteAudio = Blob | string;

interface ItemNormalizado {
  chave: string;
  texto: string;
  audio: FonteAudio | null;
  taxa: number;
  idioma: Idioma;
}

/**
 * Motor de áudio — trocável nos testes. `idioma` fica por último e é
 * opcional para não quebrar os motores falsos que os testes já implementam
 * sem esse parâmetro — retrocompatibilidade deliberada.
 */
export interface MotorFala {
  tocarAudio(fonte: FonteAudio, sinal: AbortSignal): Promise<void>;
  tocarTexto(texto: string, taxa: number, sinal: AbortSignal, idioma?: Idioma): Promise<void>;
}

export interface EventoFala {
  falando: boolean;
  chave: string | null;
}

/**
 * Voz bem mais lenta que o padrão (1.0): criança de 3 anos precisa de tempo
 * — em QUALQUER idioma. Vale igual para pt-BR e en-US: nada em `ItemFala`
 * ajusta a taxa por `idioma`, de propósito.
 */
export const TAXA_PADRAO = 0.8;
/** Teto da fila: martelar a tela não vira uma fila de 30 falas. */
export const TAMANHO_MAX_FILA = 3;

export class FilaDeFala {
  #motor: MotorFala | null;
  #fila: ItemNormalizado[] = [];
  #atual: ItemNormalizado | null = null;
  #abort: AbortController | null = null;
  #rodando = false;
  #ouvintes = new Set<(evento: EventoFala) => void>();

  /** Sem argumento usa o motor do browser (Web Audio + SpeechSynthesis). */
  constructor(motor?: MotorFala) {
    this.#motor = motor ?? null;
  }

  get falando(): boolean {
    return this.#atual !== null;
  }

  /** Chave do que está tocando agora (null se em silêncio). */
  get chaveAtual(): string | null {
    return this.#atual?.chave ?? null;
  }

  get tamanhoFila(): number {
    return this.#fila.length;
  }

  /** Notifica mudanças de estado (para o pulso de fala do <Personagem>). */
  assinar(ouvinte: (evento: EventoFala) => void): () => void {
    this.#ouvintes.add(ouvinte);
    ouvinte({ falando: this.falando, chave: this.chaveAtual });
    return () => {
      this.#ouvintes.delete(ouvinte);
    };
  }

  /**
   * Enfileira uma fala. Devolve `true` se entrou na fila e `false` se foi
   * descartada por dedupe/lotação — dois toques rápidos na mesma coisa geram
   * UM áudio só.
   */
  falar(item: ItemFala): boolean {
    const idioma = item.idioma ?? IDIOMA_PADRAO;
    const normalizado: ItemNormalizado = {
      chave: item.chave ?? `${idioma}:${item.texto}`,
      texto: item.texto,
      audio: item.audio ?? null,
      taxa: item.taxa ?? TAXA_PADRAO,
      idioma,
    };

    if (item.prioridade === "alta") {
      this.#cancelarInterno();
      this.#fila = [normalizado];
      void this.#bombear();
      return true;
    }

    // Dedupe: já está tocando ou já está na fila.
    if (this.#atual?.chave === normalizado.chave) return false;
    if (this.#fila.some((f) => f.chave === normalizado.chave)) return false;
    if (this.#fila.length >= TAMANHO_MAX_FILA) return false;

    this.#fila.push(normalizado);
    void this.#bombear();
    return true;
  }

  /** Corta tudo: o que toca agora e o que está na fila. */
  cancelar(): void {
    this.#cancelarInterno();
    this.#notificar();
  }

  #cancelarInterno(): void {
    this.#fila = [];
    this.#abort?.abort();
    this.#abort = null;
  }

  async #bombear(): Promise<void> {
    if (this.#rodando) return;
    this.#rodando = true;
    try {
      while (this.#fila.length > 0) {
        const item = this.#fila.shift()!;
        this.#atual = item;
        this.#abort = new AbortController();
        this.#notificar();
        const sinal = this.#abort.signal;
        const motor = this.#garantirMotor();
        try {
          if (item.audio) {
            try {
              await motor.tocarAudio(item.audio, sinal);
            } catch {
              // Áudio corrompido, codec não suportado ou rede fora do ar:
              // cai no TTS, sem travar o jogo.
              if (!sinal.aborted) await motor.tocarTexto(item.texto, item.taxa, sinal, item.idioma);
            }
          } else {
            await motor.tocarTexto(item.texto, item.taxa, sinal, item.idioma);
          }
        } catch {
          // Áudio nunca pode derrubar a rodada — segue para o próximo item.
        } finally {
          this.#atual = null;
          this.#abort = null;
        }
      }
    } finally {
      this.#rodando = false;
      this.#atual = null;
      this.#notificar();
    }
  }

  #garantirMotor(): MotorFala {
    this.#motor ??= motorDoBrowser();
    return this.#motor;
  }

  #notificar(): void {
    const evento: EventoFala = { falando: this.falando, chave: this.chaveAtual };
    for (const ouvinte of this.#ouvintes) ouvinte(evento);
  }
}

// ------------------------------------------------------- motor do navegador

const cacheBlob = new WeakMap<Blob, AudioBuffer>();
/** URLs remotas: baixadas e decodificadas uma vez só por sessão. */
const cacheUrl = new Map<string, AudioBuffer>();

/** Forma mínima do evento de erro do TTS — só lemos `.error`. */
export interface ErroSintese {
  error: string;
}

/**
 * Utterance mínima que `tocarTexto` sabe controlar — real
 * (`SpeechSynthesisUtterance`) ou falsa (testes em node, sem DOM).
 */
export interface UtteranceFala {
  lang: string;
  rate: number;
  pitch: number;
  voice: SpeechSynthesisVoice | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: ErroSintese) => void) | null;
}

/** Motor de síntese mínimo — real (`window.speechSynthesis`) ou falso. */
export interface SinteseFala {
  cancel(): void;
  speak(fala: UtteranceFala): void;
  getVoices(): SpeechSynthesisVoice[];
  /**
   * `true` enquanto o motor "acha" que está narrando alguma coisa AGORA
   * (existe em `window.speechSynthesis` de verdade). Mantido na interface
   * por completude, mas `tocarTexto` NÃO usa este campo para decidir se o
   * motor travou: medição real mostrou `speaking: true` tanto no caso
   * saudável quanto no motor genuinamente travado (ver o comentário de
   * `desistir()` em `tocarTexto`) — não é prova de saúde de nada.
   */
  readonly speaking?: boolean;
}

/**
 * Tudo que `tocarTexto` precisa do mundo exterior. Injetável para testar o
 * watchdog de travamento em node puro, sem `window` nenhum — ver
 * `fala.test.ts`. Sem argumento, `motorDoBrowser` usa os globais do browser
 * exatamente como antes.
 */
export interface AmbienteFala {
  sintese: SinteseFala | undefined;
  criarFala(texto: string): UtteranceFala;
  esperarGesto(sinal?: AbortSignal): Promise<void>;
  /**
   * Override do teto da rede de segurança (`timerLimite`) — só para testes.
   * Em produção o teto sempre vem da fórmula baseada no texto (ver
   * `tocarTexto`); sem este seam, testar o caminho do `timerLimite` exigiria
   * esperar de verdade os ~1.2s mínimos da fórmula real.
   */
  msLimiteFala?: number;
}

function ambientePadrao(): AmbienteFala {
  return {
    // Bridge deliberado: `SpeechSynthesis`/`SpeechSynthesisUtterance` do DOM
    // têm mais membros que `SinteseFala`/`UtteranceFala` (que só existem
    // para deixar o watchdog testável em node, sem `window`). Em runtime são
    // sempre os objetos reais do browser — os dois casts abaixo só calam o
    // TypeScript quanto à superfície que não usamos.
    sintese: typeof window !== "undefined" ? (window.speechSynthesis as unknown as SinteseFala) : undefined,
    criarFala(texto) {
      return new SpeechSynthesisUtterance(texto) as unknown as UtteranceFala;
    },
    async esperarGesto(sinal) {
      const { esperarGesto } = await import("@/lib/media");
      await esperarGesto(sinal);
    },
  };
}

// ---------------------------------------------------- saúde da voz (TTS)

/**
 * `true` quando o `timerLimite` de `tocarTexto` estourou sem que `onstart`
 * NEM `onend` tivessem disparado — o motor de TTS travou de verdade
 * (Chrome/macOS trava assim; ver a medição real no comentário de `desistir`,
 * dentro de `tocarTexto`). A UI assina isto para avisar o adulto, em vez do
 * jogo ficar mudo sem explicação.
 */
let vozIndisponivel = false;
const ouvintesSaudeDaVoz = new Set<(indisponivel: boolean) => void>();

/**
 * Assina mudanças de saúde da voz. Notifica na hora da inscrição (estado
 * atual) e a cada mudança — mesmo padrão de `FilaDeFala.assinar`.
 */
export function assinarSaudeDaVoz(ouvinte: (indisponivel: boolean) => void): () => void {
  ouvintesSaudeDaVoz.add(ouvinte);
  ouvinte(vozIndisponivel);
  return () => {
    ouvintesSaudeDaVoz.delete(ouvinte);
  };
}

function marcarSaudeDaVoz(indisponivel: boolean): void {
  if (vozIndisponivel === indisponivel) return;
  vozIndisponivel = indisponivel;
  for (const ouvinte of ouvintesSaudeDaVoz) ouvinte(vozIndisponivel);
}

/**
 * GANCHO DE TESTE — não é API de produção, não use fora de `*.test.ts`.
 * `vozIndisponivel` é estado de módulo compartilhado entre todos os testes
 * do mesmo processo `node --test`; sem isto, cada teste só "funciona" por
 * acidente de ordem (o teste anterior ter disparado `onstart` e deixado a
 * voz disponível), e quebra se alguém reordenar ou inserir um teste novo.
 * Chame no início de todo teste que observa `assinarSaudeDaVoz`, para partir
 * de um estado conhecido em vez de herdar o que o teste anterior deixou.
 */
export function redefinirSaudeDaVozParaTestes(): void {
  marcarSaudeDaVoz(false);
}

/**
 * Motor real. Criado sob demanda para que `fala.ts` possa ser importado em
 * node (testes) sem tocar em Web Audio — o `import()` de `@/lib/media` só
 * roda dentro do browser.
 *
 * `ambiente` é a seam de teste: passe um fake para exercitar o watchdog do
 * TTS em node puro. Sem argumento, usa `ambientePadrao()` (globais do
 * browser).
 */
export function motorDoBrowser(ambiente?: AmbienteFala): MotorFala {
  const amb = ambiente ?? ambientePadrao();
  return {
    async tocarAudio(fonte, sinal) {
      const { esperarGesto, getAudioContext, unlockAudio } = await import("@/lib/media");
      // No Chrome desktop o AudioContext nasce suspenso sem gesto prévio e o
      // `BufferSource` toca num contexto suspenso: o `onended` nunca dispara
      // e esta Promise travaria para sempre. Esperar o gesto aqui evita isso
      // — a fala fica retida (não perdida) até o usuário interagir.
      await esperarGesto(sinal);
      if (sinal.aborted) return;
      // No iOS o contexto só existe depois do 1º gesto; `unlockAudio` é idempotente.
      const ctx = getAudioContext() ?? (await unlockAudio());
      if (!ctx) throw new Error("Sem AudioContext.");
      if (ctx.state === "suspended") await unlockAudio();
      if (sinal.aborted) return;

      let buffer = typeof fonte === "string" ? cacheUrl.get(fonte) : cacheBlob.get(fonte);
      if (!buffer) {
        const bytes =
          typeof fonte === "string"
            ? await (await fetch(fonte, { signal: sinal })).arrayBuffer()
            : await fonte.arrayBuffer();
        buffer = await ctx.decodeAudioData(bytes);
        if (typeof fonte === "string") cacheUrl.set(fonte, buffer);
        else cacheBlob.set(fonte, buffer);
      }
      if (sinal.aborted) return;

      await new Promise<void>((resolve) => {
        const fonte = ctx.createBufferSource();
        fonte.buffer = buffer!;
        fonte.connect(ctx.destination);
        const terminar = () => {
          sinal.removeEventListener("abort", abortar);
          fonte.onended = null;
          resolve();
        };
        const abortar = () => {
          try {
            fonte.stop();
          } catch {
            // já parou
          }
          terminar();
        };
        fonte.onended = terminar;
        sinal.addEventListener("abort", abortar, { once: true });
        fonte.start(0);
      });
    },

    async tocarTexto(texto, taxa, sinal, idioma = IDIOMA_PADRAO) {
      const sintese = amb.sintese;
      if (!sintese) return;
      // Sem gesto prévio, `speechSynthesis.speak()` no Chrome desktop retorna
      // `not-allowed` na hora e a pergunta é engolida em silêncio — esperar
      // aqui faz a fala sair assim que o 1º gesto acontecer, em vez de sumir.
      await amb.esperarGesto(sinal);
      if (sinal.aborted) return;
      sintese.cancel();
      if (sinal.aborted) return;

      await new Promise<void>((resolve) => {
        let concluida = false;
        // Único sinal confiável de que a fala realmente começou. NÃO existe
        // `sintese.speaking` aqui de propósito — ver o porquê na medição
        // real dentro de `desistir()` abaixo: `speaking` vale `true` tanto
        // no caso saudável quanto no motor travado, então não serve de
        // prova de nada.
        let onstartAconteceu = false;

        const fala = amb.criarFala(texto);
        fala.lang = idioma;
        fala.rate = taxa;
        fala.pitch = 1.1;
        const voz = vozParaIdioma(sintese!, idioma);
        if (voz) fala.voice = voz;

        // Única rede de segurança: tempo estimado para a fala INTEIRA (até
        // 12s). Cobre os dois jeitos de dar errado — "onend nunca chegou"
        // (fala tocou, só o evento sumiu) e "motor travado de verdade" (nem
        // onstart nem onend chegam) — `desistir()` abaixo distingue os dois
        // pelo único sinal que sobrou: `onstartAconteceu`.
        const limite = amb.msLimiteFala ?? Math.min(12000, 1200 + (texto.length / Math.max(taxa, 0.5)) * 110);
        const timerLimite = setTimeout(desistir, limite);

        function limpar() {
          clearTimeout(timerLimite);
          sinal.removeEventListener("abort", abortarExterno);
        }

        function terminar() {
          if (concluida) return;
          concluida = true;
          limpar();
          resolve();
        }

        // Abort externo (troca de tela / unmount) — não é sinal de motor
        // travado, só libera a fila. Cancela o motor real antes de resolver:
        // sem isto o motor de verdade continuaria narrando a utterance
        // abandonada mesmo com a UI já achando que acabou.
        function abortarExterno() {
          sintese!.cancel();
          terminar();
        }

        /**
         * `timerLimite` estourou: nem `onend` (fala terminou) nem, se for o
         * caso, `onstart` chegaram a tempo. Antes esta função tentava usar
         * `sintese.speaking` para diferenciar "motor travado" de "fala já
         * tocando" e disparava um `speak()` de novo (retry). ISSO ESTAVA
         * ERRADO e foi removido: numa sessão de diagnóstico com o Chrome/
         * macOS genuinamente travado, capturamos
         *
         *   { ms: 6337, result: "TIMEOUT", started: false, speaking: true, pending: false }
         *   { ms: 4998, result: "TIMEOUT", started: false, speaking: true }
         *
         * ou seja: no travamento REAL, `speaking` também vale `true` — o
         * motor "aceita" a fala e nunca mais sai desse estado (nem
         * `cancel()`, `pause()` ou `resume()` recuperam; só fechar e reabrir
         * o navegador). `speaking` não diferencia travado de saudável.
         *
         * O que diferencia é `onend`: caso saudável sem `onstart` (bug
         * comum do Chrome/macOS onde o evento simplesmente não dispara,
         * mesmo com a fala tocando) ainda assim dispara `onend` quando
         * termina — e nesse caso `terminar()` já rodou por `fala.onend`
         * MUITO antes deste timer estourar, então nunca chegamos aqui. Se
         * chegamos aqui é porque nem `onstart` nem `onend` vieram: só resta
         * o caso "motor travado de verdade" (quando `onstartAconteceu` é
         * `false`) ou "onstart chegou mas o `onend` sumiu" (Safari — a fala
         * tocou, não é travamento). Sem retry: uma tentativa só, nunca dois
         * `speak()` da mesma fala — é o que elimina a palavra repetida.
         */
        function desistir() {
          sintese!.cancel();
          if (!onstartAconteceu) {
            marcarSaudeDaVoz(true);
          }
          terminar();
        }

        fala.onstart = () => {
          onstartAconteceu = true;
          // Falou de verdade: qualquer travamento anterior já passou.
          marcarSaudeDaVoz(false);
        };
        fala.onend = () => {
          terminar();
        };
        fala.onerror = () => {
          // 'not-allowed' é falta de gesto do usuário, não travamento do
          // motor — nunca marca indisponível aqui. Só `desistir()` faz isso,
          // e só quando nem onstart nem onend chegaram no prazo.
          terminar();
        };

        sinal.addEventListener("abort", abortarExterno, { once: true });
        sintese!.speak(fala);
      });
    },
  };
}

/**
 * Escolhe a melhor voz instalada para `idioma`, em ordem de preferência:
 * exata + local (mais rápida, sem depender de rede) -> exata (qualquer
 * origem) -> mesmo prefixo de idioma (`pt`, `en` — ex.: "en-GB" quando não
 * há "en-US") -> `null` quando nada casa (o `lang` da utterance ainda é
 * setado corretamente; sem voz nenhuma instalada o motor usa a voz padrão
 * do sistema para aquele `lang`, que o watchdog já cobre se travar).
 */
function vozParaIdioma(sintese: SinteseFala, idioma: Idioma): SpeechSynthesisVoice | null {
  const vozes = sintese.getVoices();
  const prefixo = idioma.split("-")[0]!;
  return (
    vozes.find((v) => v.lang === idioma && v.localService) ??
    vozes.find((v) => v.lang === idioma) ??
    vozes.find((v) => v.lang.startsWith(prefixo)) ??
    null
  );
}

/** Fila única do app — use esta em vez de instanciar a sua. */
export const filaDeFala = new FilaDeFala();
