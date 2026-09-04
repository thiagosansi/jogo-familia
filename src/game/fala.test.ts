/**
 * Testes do watchdog de TTS travado (`motorDoBrowser().tocarTexto`) e da
 * assinatura de saúde da voz. Rodam em node puro, sem DOM nenhum:
 *
 *   node --test --experimental-strip-types src/game/fala.test.ts
 *
 * O Chrome/macOS trava o motor de TTS inteiro (`speechSynthesis.speak()`
 * aceita, `speaking` vira `true`, mas `onstart` nunca dispara — ver a
 * knowledge "Sem audio no desktop"). `AmbienteFala` é a seam que deixa isso
 * reproduzível sem `window`: simulamos `SpeechSynthesis`/
 * `SpeechSynthesisUtterance` com objetos simples e controlamos exatamente
 * quando (e se) `onstart`/`onend`/`onerror` disparam.
 *
 * Cobre:
 *  1. `start` nunca dispara -> retry único -> 2ª tentativa também trava ->
 *     saúde vira indisponível, Promise resolve sem lançar (DoD 1 e 3);
 *  2. `start` dispara normalmente -> sem retry, saúde continua disponível
 *     (DoD 1 e 4);
 *  3. 1ª tentativa trava mas a 2ª (retry) recupera -> nunca marca indisponível;
 *  4. `not-allowed` é falta de gesto, não travamento -> não marca indisponível;
 *  5. fala que já iniciou não é confundida com travamento mesmo com `onend`
 *     atrasado;
 *  6. `timerLimite` (rede de segurança do `onend` perdido) cancela a síntese
 *     real antes de resolver, sem marcar a voz indisponível (achado 1);
 *  7. voz remota lenta (onstart depois da janela curta, mas dentro da janela
 *     alargada) não é confundida com motor travado (achado 2);
 *  8. `assinarSaudeDaVoz` notifica no ato da inscrição e a cada mudança real
 *     (DoD 2), e para de notificar depois de cancelada;
 *  9. idioma: `vozParaIdioma` (interno) escolhe a voz na ordem exata+local ->
 *     exata -> prefixo -> `null`, e `fala.lang` sempre sai com o idioma
 *     pedido (padrão pt-BR quando omitido) — fundação do modo de inglês;
 *  10. dedupe entre idiomas: o mesmo texto em dois idiomas não é tratado como
 *      a mesma fala (a chave padrão da fila passa a incluir o idioma), mas o
 *      dedupe normal (mesmo texto, mesmo idioma) continua funcionando.
 *
 * `vozIndisponivel` (em fala.ts) é estado de módulo — compartilhado por
 * todos os testes deste arquivo, que rodam no mesmo processo `node --test`.
 * Por isso um `beforeEach` redefine esse estado antes de CADA teste (via
 * `redefinirSaudeDaVozParaTestes`, o gancho de teste exportado por fala.ts):
 * isso é mais legível que espalhar a chamada manualmente em cada teste (fácil
 * de esquecer num teste novo) e garante que a suíte passe em qualquer ordem
 * — nenhum teste depende mais de outro ter disparado `onstart` antes dele.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  assinarSaudeDaVoz,
  FilaDeFala,
  motorDoBrowser,
  redefinirSaudeDaVozParaTestes,
  type AmbienteFala,
  type Idioma,
  type MotorFala,
  type SinteseFala,
  type UtteranceFala,
} from "./fala.ts";

/** Bem menor que os 1500ms de produção — os testes não esperam de verdade. */
const MS_ESPERA_INICIO_TESTE = 10;

beforeEach(() => {
  redefinirSaudeDaVozParaTestes();
});

/** Utterance falsa mutável — só os campos que `tocarTexto` toca. */
function criarUtteranceFalsa(): UtteranceFala {
  return {
    lang: "",
    rate: 1,
    pitch: 1,
    voice: null,
    onstart: null,
    onend: null,
    onerror: null,
  };
}

/**
 * Monta um `AmbienteFala` de teste. Cada `speak()` empurra a utterance em
 * `chamadas` e delega para `aoFalar` decidir o que acontece depois (disparar
 * `onstart`/`onend`/`onerror`, ou não disparar nada — simulando o travamento
 * do Chrome). `numero` é 1 na 1ª tentativa, 2 no retry. `cancelChamadas.total`
 * conta quantas vezes `sintese.cancel()` foi chamado — usado pelo teste do
 * achado 1, que prova que o `timerLimite` cancela a síntese de verdade.
 */
function criarAmbienteFalso(
  aoFalar: (fala: UtteranceFala, numero: number) => void,
  opcoes: {
    msEsperaInicio?: number;
    /** Vozes que `getVoices()` devolve — vazio por padrão (nenhuma voz escolhida). */
    vozes?: SpeechSynthesisVoice[];
    /** Override do teto do `timerLimite` — ver `AmbienteFala.msLimiteFala`. */
    msLimiteFala?: number;
  } = {},
): { ambiente: AmbienteFala; chamadas: UtteranceFala[]; cancelChamadas: { total: number } } {
  const { msEsperaInicio = MS_ESPERA_INICIO_TESTE, vozes = [], msLimiteFala } = opcoes;
  const chamadas: UtteranceFala[] = [];
  const cancelChamadas = { total: 0 };
  const sintese: SinteseFala = {
    cancel() {
      cancelChamadas.total += 1;
      // Cancelar dispara 'onerror: canceled' na utterance mais recente —
      // exatamente o que o Chrome faz de verdade quando o retry cancela a
      // tentativa presa.
      chamadas.at(-1)?.onerror?.({ error: "canceled" });
    },
    speak(fala) {
      chamadas.push(fala);
      aoFalar(fala, chamadas.length);
    },
    getVoices() {
      return vozes;
    },
  };
  const ambiente: AmbienteFala = {
    sintese,
    criarFala: () => criarUtteranceFalsa(),
    esperarGesto: async () => {},
    msEsperaInicio,
    msLimiteFala,
  };
  return { ambiente, chamadas, cancelChamadas };
}

/** Voz falsa mínima — só os campos que `vozParaIdioma` (interno de fala.ts) lê. */
function voz(lang: string, localService: boolean, name = lang): SpeechSynthesisVoice {
  return { default: false, lang, localService, name, voiceURI: name };
}

/** Lê o estado atual de `assinarSaudeDaVoz` sem manter a assinatura viva. */
function saudeAtual(): boolean {
  let atual = false;
  const parar = assinarSaudeDaVoz((v) => {
    atual = v;
  });
  parar();
  return atual;
}

// --------------------------------------------------- watchdog / retry

test("start nunca dispara: retry único e depois marca a voz indisponível", async () => {
  const { ambiente, chamadas } = criarAmbienteFalso(() => {
    // Nunca dispara onstart/onend/onerror — reproduz o travamento do Chrome.
  });
  const motor = motorDoBrowser(ambiente);

  await assert.doesNotReject(
    () => motor.tocarTexto("Cadê a mamãe?", 0.8, new AbortController().signal),
    "tocarTexto nunca pode lançar, mesmo com o motor travado",
  );

  assert.equal(chamadas.length, 2, "esperava a tentativa original + 1 retry, nada mais");
  assert.equal(saudeAtual(), true, "2ª tentativa também travou: voz deveria virar indisponível");
});

test("start dispara normalmente: sem retry, voz continua disponível", async () => {
  const { ambiente, chamadas } = criarAmbienteFalso((fala) => {
    fala.onstart?.();
    fala.onend?.();
  });
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Cadê o papai?", 0.8, new AbortController().signal);

  assert.equal(chamadas.length, 1, "start disparou na 1ª tentativa — não deveria haver retry");
  assert.equal(saudeAtual(), false, "voz não deveria ser marcada indisponível");
});

test("1ª tentativa trava, retry recupera: nunca marca a voz indisponível", async () => {
  const { ambiente, chamadas } = criarAmbienteFalso((fala, numero) => {
    if (numero === 2) {
      fala.onstart?.();
      fala.onend?.();
    }
    // numero === 1: nunca dispara nada, força o watchdog a agir.
  });
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Cadê a vovó?", 0.8, new AbortController().signal);

  assert.equal(chamadas.length, 2, "esperava exatamente 1 retry");
  assert.equal(saudeAtual(), false, "a 2ª tentativa recuperou antes do watchdog desistir");
});

test("'not-allowed' é falta de gesto, não travamento: não marca indisponível", async () => {
  // Ponto de partida conhecido (voz disponível): o `beforeEach` do topo do
  // arquivo já garante isto — não precisa mais forçar aqui manualmente.
  const { ambiente, chamadas } = criarAmbienteFalso((fala) => {
    fala.onerror?.({ error: "not-allowed" });
  });
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Cadê o vovô?", 0.8, new AbortController().signal);

  assert.equal(chamadas.length, 1, "not-allowed não deveria disparar retry");
  assert.equal(saudeAtual(), false, "not-allowed não pode ser confundido com travamento");
});

test("fala que já iniciou não é marcada como travada mesmo com onend atrasado", async () => {
  const { ambiente, chamadas } = criarAmbienteFalso((fala) => {
    fala.onstart?.();
    // onend só chega bem depois do msEsperaInicio: já tinha começado, então
    // não pode ser tratado como watchdog estourado.
    setTimeout(() => fala.onend?.(), MS_ESPERA_INICIO_TESTE * 3);
  });
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Espera aí, ainda estou falando", 0.8, new AbortController().signal);

  assert.equal(chamadas.length, 1, "start já tinha disparado — não pode haver retry");
  assert.equal(saudeAtual(), false, "fala longa em andamento não é travamento");
});

// ------------------------------------------------ timerLimite (achado 1)

test("timerLimite cancela a síntese antes de resolver, sem marcar a voz indisponível", async () => {
  // `onstart` dispara (a fala começou de verdade) mas `onend` nunca chega —
  // exatamente o bug do Safari que o `timerLimite` existe pra cobrir.
  // `msLimiteFala` pequeno deixa o teste rápido: em produção o teto vem da
  // fórmula baseada no texto (até 12s), aqui não precisamos esperar isso.
  const { ambiente, chamadas, cancelChamadas } = criarAmbienteFalso(
    (fala) => {
      fala.onstart?.();
      // onend nunca chega.
    },
    { msLimiteFala: MS_ESPERA_INICIO_TESTE * 2 },
  );
  const motor = motorDoBrowser(ambiente);

  await assert.doesNotReject(() =>
    motor.tocarTexto("Cadê o titio?", 0.8, new AbortController().signal),
  );

  assert.equal(chamadas.length, 1, "start já tinha disparado — não pode haver retry");
  // 2 cancelamentos: o 1º é o `sintese.cancel()` defensivo no topo de
  // `tocarTexto` (limpa resíduo de fala anterior, sempre dispara — não é o
  // que este teste prova). O 2º é o do `timerLimite` (achado 1) — sem ele
  // este total ficaria em 1 e a fala abandonada continuaria tocando no
  // motor real depois da Promise já ter resolvido.
  assert.equal(
    cancelChamadas.total,
    2,
    "timerLimite deveria cancelar o motor real antes de resolver (achado 1)",
  );
  assert.equal(
    saudeAtual(),
    false,
    "onend perdido pelo Safari não é motor travado (a fala tinha começado) — não pode marcar indisponível",
  );
});

// -------------------------------------------- janela por tipo de voz (achado 2)

test("voz remota lenta: onstart depois da janela curta, mas dentro da janela alargada, não marca indisponível", async () => {
  const vozRemota: SpeechSynthesisVoice = {
    default: false,
    lang: "pt-BR",
    localService: false, // voz de rede (ex.: Google) — pode demorar mais pro 1º onstart
    name: "Google português do Brasil",
    voiceURI: "Google pt-BR",
  };

  const { ambiente, chamadas } = criarAmbienteFalso(
    (fala) => {
      // Chega depois da janela curta (MS_ESPERA_INICIO_TESTE) mas antes da
      // janela alargada para voz remota (3x, ver MULTIPLICADOR_ESPERA_VOZ_REMOTA
      // em fala.ts) — exatamente o que acontece com a voz do Google carregando.
      setTimeout(() => {
        fala.onstart?.();
        fala.onend?.();
      }, MS_ESPERA_INICIO_TESTE * 2);
    },
    { vozes: [vozRemota] },
  );
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Cadê a titia?", 0.8, new AbortController().signal);

  assert.equal(
    chamadas.length,
    1,
    "onstart chegou dentro da janela alargada — não deveria ter disparado o retry",
  );
  assert.equal(
    saudeAtual(),
    false,
    "voz remota carregando não pode ser confundida com motor travado",
  );
});

// --------------------------------------------------------- assinatura

test("assinarSaudeDaVoz notifica no ato da inscrição e a cada mudança real", async () => {
  // Ponto de partida conhecido (voz disponível) garantido pelo `beforeEach`.
  const recebidos: boolean[] = [];
  const parar = assinarSaudeDaVoz((v) => recebidos.push(v));
  assert.deepEqual(recebidos, [false], "deveria notificar o estado atual na inscrição");

  const { ambiente } = criarAmbienteFalso(() => {
    // nunca inicia — força a voz a ficar indisponível.
  });
  const motor = motorDoBrowser(ambiente);
  await motor.tocarTexto("oi", 0.8, new AbortController().signal);

  assert.deepEqual(recebidos, [false, true], "deveria notificar a mudança para indisponível");

  parar();
  redefinirSaudeDaVozParaTestes(); // muda de novo, mas a assinatura já foi cancelada
  assert.deepEqual(recebidos, [false, true], "não pode notificar depois de cancelar a assinatura");
});

// ------------------------------------------------------- idioma (voz + lang)

/**
 * `tocarTexto` seta `fala.lang` com o idioma pedido e escolhe a voz em
 * `vozParaIdioma` (interno de fala.ts) nesta ordem: exata + local -> exata
 * -> mesmo prefixo -> `null`. Provamos a ordem via `getVoices()` fake —
 * a utterance capturada em `chamadas[0]` expõe `.lang` e `.voice` porque
 * `criarAmbienteFalso` a devolve tal como `tocarTexto` a preencheu.
 */
test("escolhe a voz en-US local quando existe, mesmo com outras vozes en-US na lista", async () => {
  const local = voz("en-US", true, "voz local");
  const remota = voz("en-US", false, "voz remota");
  const { ambiente, chamadas } = criarAmbienteFalso(
    (fala) => {
      fala.onstart?.();
      fala.onend?.();
    },
    { vozes: [remota, local] },
  );
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Cat", 0.8, new AbortController().signal, "en-US");

  assert.equal(chamadas[0]!.lang, "en-US", "fala.lang deve ser o idioma pedido");
  assert.equal(chamadas[0]!.voice, local, "voz exata + localService deve ganhar da voz exata remota");
});

test("sem voz local, cai na voz en-US exata (qualquer origem)", async () => {
  const remota = voz("en-US", false, "voz remota");
  const { ambiente, chamadas } = criarAmbienteFalso(
    (fala) => {
      fala.onstart?.();
      fala.onend?.();
    },
    { vozes: [voz("pt-BR", true, "pt local"), remota] },
  );
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Dog", 0.8, new AbortController().signal, "en-US");

  assert.equal(chamadas[0]!.voice, remota, "sem voz local en-US, a exata remota é a próxima opção");
});

test("sem voz exata, cai na voz de mesmo prefixo (en-GB para en-US)", async () => {
  const britanica = voz("en-GB", true, "voz britânica");
  const { ambiente, chamadas } = criarAmbienteFalso(
    (fala) => {
      fala.onstart?.();
      fala.onend?.();
    },
    { vozes: [voz("pt-BR", true, "pt local"), britanica] },
  );
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Bird", 0.8, new AbortController().signal, "en-US");

  assert.equal(chamadas[0]!.voice, britanica, "sem en-US instalada, o prefixo 'en' deve casar");
});

test("nenhuma voz do idioma nem do prefixo instalada: voice fica null, mas lang é setado do mesmo jeito", async () => {
  const { ambiente, chamadas } = criarAmbienteFalso(
    (fala) => {
      fala.onstart?.();
      fala.onend?.();
    },
    { vozes: [voz("pt-BR", true, "pt local")] },
  );
  const motor = motorDoBrowser(ambiente);

  await assert.doesNotReject(() =>
    motor.tocarTexto("Fish", 0.8, new AbortController().signal, "en-US"),
  );

  assert.equal(chamadas[0]!.voice, null, "nenhuma voz en-US/en instalada — não inventa uma voz errada");
  assert.equal(chamadas[0]!.lang, "en-US", "lang continua correto mesmo sem voz casando");
});

test("idioma omitido usa pt-BR (padrão) — retrocompatível com quem não passa idioma", async () => {
  const ptLocal = voz("pt-BR", true, "pt local");
  const { ambiente, chamadas } = criarAmbienteFalso(
    (fala) => {
      fala.onstart?.();
      fala.onend?.();
    },
    { vozes: [ptLocal] },
  );
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Cadê a mamãe?", 0.8, new AbortController().signal); // sem idioma

  assert.equal(chamadas[0]!.lang, "pt-BR");
  assert.equal(chamadas[0]!.voice, ptLocal);
});

// --------------------------------------------------- dedupe entre idiomas

/** Motor de mentira para os testes de `FilaDeFala` — grava o que foi falado. */
function motorFakeQueRegistraIdioma(): { motor: MotorFala; falados: { texto: string; idioma: Idioma | undefined }[] } {
  const falados: { texto: string; idioma: Idioma | undefined }[] = [];
  const motor: MotorFala = {
    async tocarAudio() {
      // não usado nestes testes
    },
    async tocarTexto(texto, _taxa, _sinal, idioma) {
      falados.push({ texto, idioma });
    },
  };
  return { motor, falados };
}

test("mesmo texto em idiomas diferentes: a fila NÃO deduplica (chave padrão inclui o idioma)", async () => {
  const { motor, falados } = motorFakeQueRegistraIdioma();
  const fila = new FilaDeFala(motor);

  // Mesmo `texto`, sem `chave` explícita — só o `idioma` muda.
  const entrouPt = fila.falar({ texto: "Cat", idioma: "pt-BR" });
  const entrouEn = fila.falar({ texto: "Cat", idioma: "en-US" });

  assert.equal(entrouPt, true, "1º pedido deveria entrar na fila normalmente");
  assert.equal(entrouEn, true, "2º pedido em outro idioma NÃO pode ser tratado como duplicado do 1º");

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    falados,
    [
      { texto: "Cat", idioma: "pt-BR" },
      { texto: "Cat", idioma: "en-US" },
    ],
    "as DUAS falas deveriam ter tocado — nenhuma foi engolida pelo dedupe",
  );
});

test("mesmo texto e MESMO idioma (sem chave explícita) continua deduplicando normalmente", async () => {
  const { motor, falados } = motorFakeQueRegistraIdioma();
  const fila = new FilaDeFala(motor);

  const primeiro = fila.falar({ texto: "Cadê a mamãe?", idioma: "pt-BR" });
  const segundo = fila.falar({ texto: "Cadê a mamãe?", idioma: "pt-BR" });

  assert.equal(primeiro, true);
  assert.equal(segundo, false, "mesmo texto + mesmo idioma continua sendo a mesma fala lógica");

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(falados.length, 1, "só devia ter tocado uma vez");
});
