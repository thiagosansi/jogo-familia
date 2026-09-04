/**
 * Testes do watchdog de TTS travado (`motorDoBrowser().tocarTexto`) e da
 * assinatura de saúde da voz. Rodam em node puro, sem DOM nenhum:
 *
 *   node --test --experimental-strip-types src/game/fala.test.ts
 *
 * O Chrome/macOS pode travar o motor de TTS inteiro: `speechSynthesis.speak()`
 * aceita, mas nem `onstart` nem `onend` disparam NUNCA — ver a medição real
 * no comentário de `desistir()` em `fala.ts` (`speaking: true` parado para
 * sempre, sem `cancel()`/`pause()`/`resume()` recuperar). `AmbienteFala` é a
 * seam que deixa isso reproduzível sem `window`: simulamos `SpeechSynthesis`/
 * `SpeechSynthesisUtterance` com objetos simples e controlamos exatamente
 * quando (e se) `onstart`/`onend`/`onerror` disparam.
 *
 * NÃO HÁ RETRY. Já existiu uma versão com retry único (cancelar + `speak()`
 * de novo quando `onstart` não chegava a tempo) — foi removida porque o
 * motor travado do Chrome/macOS não se recupera com `cancel()` + novo
 * `speak()`, então o retry só produzia fala dupla (a causa raiz da última
 * palavra da contagem em inglês saindo repetida). A detecção agora depende
 * só do `timerLimite` (rede de segurança dimensionada pelo tamanho do
 * texto, até 12s): se ele estourar sem `onstart` nem `onend` terem
 * disparado, o motor travou de verdade.
 *
 * Cobre:
 *  1. nem `onstart` nem `onend` disparam -> `timerLimite` estoura -> saúde
 *     vira indisponível, uma tentativa só, Promise resolve sem lançar
 *     (DoD 1 e 2);
 *  2. `onstart` dispara normalmente -> saúde continua disponível (DoD 1 e 4);
 *  3. motor saudável que NUNCA dispara `onstart` mas dispara `onend`: saúde
 *     continua disponível e a fala sai UMA vez só (DoD 3) — prova que
 *     `speaking`/ausência de `onstart` não é usada como sinal de travamento;
 *  4. `not-allowed` é falta de gesto, não travamento -> não marca
 *     indisponível (DoD 4);
 *  5. fala que já iniciou não é confundida com travamento mesmo com `onend`
 *     atrasado;
 *  6. `timerLimite` (rede de segurança do `onend` perdido, motor com
 *     `onstart` mas sem `onend`) cancela a síntese real antes de resolver,
 *     sem marcar a voz indisponível — a fala tinha começado, não é
 *     travamento;
 *  7. `assinarSaudeDaVoz` notifica no ato da inscrição e a cada mudança real,
 *     e para de notificar depois de cancelada;
 *  8. idioma: `vozParaIdioma` (interno) escolhe a voz na ordem exata+local ->
 *     exata -> prefixo -> `null`, e `fala.lang` sempre sai com o idioma
 *     pedido (padrão pt-BR quando omitido) — fundação do modo de inglês;
 *  9. dedupe entre idiomas: o mesmo texto em dois idiomas não é tratado como
 *     a mesma fala (a chave padrão da fila passa a incluir o idioma), mas o
 *     dedupe normal (mesmo texto, mesmo idioma) continua funcionando.
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

/** Unidade de tempo pequena para os testes não esperarem de verdade — usada para escalonar `msLimiteFala` e delays de `setTimeout` nos fakes abaixo. */
const MS_UNIDADE_TESTE = 10;

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
 * Monta um `AmbienteFala` de teste. `speak()` empurra a utterance em
 * `chamadas` e delega para `aoFalar` decidir o que acontece depois (disparar
 * `onstart`/`onend`/`onerror`, ou não disparar nada — simulando o travamento
 * do Chrome). Sem retry, `speak()` é chamado no máximo uma vez por
 * `tocarTexto` — `chamadas.length` prova isso nos testes. `cancelChamadas.total`
 * conta quantas vezes `sintese.cancel()` foi chamado — usado pelo teste do
 * `timerLimite`, que prova que ele cancela a síntese de verdade.
 */
function criarAmbienteFalso(
  aoFalar: (fala: UtteranceFala) => void,
  opcoes: {
    /** Vozes que `getVoices()` devolve — vazio por padrão (nenhuma voz escolhida). */
    vozes?: SpeechSynthesisVoice[];
    /** Override do teto do `timerLimite` — ver `AmbienteFala.msLimiteFala`. */
    msLimiteFala?: number;
    /**
     * Valor fixo de `sintese.speaking` durante o teste. Existe só para provar
     * que `tocarTexto` IGNORA este campo na decisão de travamento (medição
     * real mostrou `speaking: true` tanto no caso saudável quanto no motor
     * travado — ver comentário de `desistir()` em `fala.ts`). Omitido por
     * padrão (`speaking` fica `undefined`, motor falso "antigo" sem o campo).
     */
    speaking?: boolean;
  } = {},
): { ambiente: AmbienteFala; chamadas: UtteranceFala[]; cancelChamadas: { total: number } } {
  const { vozes = [], msLimiteFala, speaking } = opcoes;
  const chamadas: UtteranceFala[] = [];
  const cancelChamadas = { total: 0 };
  const sintese: SinteseFala = {
    cancel() {
      cancelChamadas.total += 1;
      // Cancelar dispara 'onerror: canceled' na utterance mais recente —
      // exatamente o que o Chrome faz de verdade ao cancelar uma fala.
      chamadas.at(-1)?.onerror?.({ error: "canceled" });
    },
    speak(fala) {
      chamadas.push(fala);
      aoFalar(fala);
    },
    getVoices() {
      return vozes;
    },
    get speaking() {
      return speaking ?? false;
    },
  };
  const ambiente: AmbienteFala = {
    sintese,
    criarFala: () => criarUtteranceFalsa(),
    esperarGesto: async () => {},
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

// --------------------------------------------------- watchdog (sem retry)

test("nem onstart nem onend disparam: timerLimite estoura e marca a voz indisponível, sem retry", async () => {
  const { ambiente, chamadas } = criarAmbienteFalso(
    () => {
      // Nunca dispara onstart/onend/onerror — reproduz o travamento real do
      // Chrome/macOS (ver medição no cabeçalho do arquivo e em `desistir()`
      // de fala.ts). `speaking: true` fixo prova que este campo não muda o
      // resultado — a decisão é só "onstart nunca chegou".
      // (não precisa setar nada aqui; a opção `speaking` cobre isso)
    },
    { msLimiteFala: MS_UNIDADE_TESTE * 2, speaking: true },
  );
  const motor = motorDoBrowser(ambiente);

  await assert.doesNotReject(
    () => motor.tocarTexto("Cadê a mamãe?", 0.8, new AbortController().signal),
    "tocarTexto nunca pode lançar, mesmo com o motor travado",
  );

  assert.equal(
    chamadas.length,
    1,
    "sem retry: uma única chamada a speak(), mesmo com o motor travado",
  );
  assert.equal(saudeAtual(), true, "timerLimite estourou sem onstart nem onend: voz deveria virar indisponível");
});

/**
 * CAUSA RAIZ da última palavra da contagem (e da pergunta/festa) saírem
 * repetidas: o bug real do Chrome/macOS documentado no cabeçalho deste
 * arquivo — o motor às vezes narra de verdade sem NUNCA disparar `onstart`.
 * A versão antiga do watchdog lia "onstart não chegou" como "motor travado"
 * e disparava um retry (`cancel()` + novo `speak()`) — só que `cancel()` não
 * interrompe a tempo o áudio que o motor já começou a narrar, então as DUAS
 * chamadas eram ouvidas: a palavra saía duplicada. A correção elimina o
 * retry inteiro: este teste prova que, mesmo sem `onstart`, o `onend`
 * chegando resolve a fala normalmente — UMA chamada a `speak()` só — e que
 * `speaking: true` (fixo aqui, provando que o campo é ignorado) não muda
 * nada nessa decisão.
 */
test("motor saudável sem onstart mas com onend: uma fala só, voz continua disponível", async () => {
  const { ambiente, chamadas } = criarAmbienteFalso(
    (fala) => {
      // onstart nunca dispara — só onend, como no bug real documentado
      // acima. `speaking: true` (opção abaixo) prova que este campo não é
      // usado como sinal de travamento.
      setTimeout(() => fala.onend?.(), MS_UNIDADE_TESTE);
    },
    { msLimiteFala: MS_UNIDADE_TESTE * 10, speaking: true },
  );
  const motor = motorDoBrowser(ambiente);

  await assert.doesNotReject(() => motor.tocarTexto("Nine", 0.8, new AbortController().signal));

  assert.equal(
    chamadas.length,
    1,
    "onend chegou antes do timerLimite — nunca deveria haver uma 2ª chamada a speak()",
  );
  assert.equal(saudeAtual(), false, "onend chegou normalmente — motor não estava travado");
});

test("onstart dispara normalmente: voz continua disponível", async () => {
  const { ambiente, chamadas } = criarAmbienteFalso((fala) => {
    fala.onstart?.();
    fala.onend?.();
  });
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Cadê o papai?", 0.8, new AbortController().signal);

  assert.equal(chamadas.length, 1, "uma única chamada a speak()");
  assert.equal(saudeAtual(), false, "voz não deveria ser marcada indisponível");
});

test("'not-allowed' é falta de gesto, não travamento: não marca indisponível", async () => {
  // Ponto de partida conhecido (voz disponível): o `beforeEach` do topo do
  // arquivo já garante isto — não precisa mais forçar aqui manualmente.
  const { ambiente, chamadas } = criarAmbienteFalso((fala) => {
    fala.onerror?.({ error: "not-allowed" });
  });
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Cadê o vovô?", 0.8, new AbortController().signal);

  assert.equal(chamadas.length, 1, "not-allowed não deveria disparar uma nova chamada a speak()");
  assert.equal(saudeAtual(), false, "not-allowed não pode ser confundido com travamento");
});

test("fala que já iniciou não é marcada como travada mesmo com onend atrasado", async () => {
  const { ambiente, chamadas } = criarAmbienteFalso((fala) => {
    fala.onstart?.();
    // onend só chega bem depois — já tinha começado, então não pode ser
    // tratado como timerLimite estourado por travamento.
    setTimeout(() => fala.onend?.(), MS_UNIDADE_TESTE * 3);
  });
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Espera aí, ainda estou falando", 0.8, new AbortController().signal);

  assert.equal(chamadas.length, 1, "onstart já tinha disparado — só uma chamada a speak()");
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
    { msLimiteFala: MS_UNIDADE_TESTE * 2 },
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

// ------------------------------------------------- voz remota (rede) lenta

/**
 * Antes existia uma janela curta por voz (watchdog dimensionado por
 * `msEsperaInicio`, alargado 3x para voz remota) separada do `timerLimite`.
 * Foi removida junto com o retry: como não há mais watchdog nenhum além do
 * `timerLimite` (até 12s, igual para qualquer voz), uma voz remota (ex.:
 * Google no Chrome) que demora para o 1º `onstart` só precisa terminar
 * dentro desse teto único — não existe mais janela separada para depender
 * de `localService`.
 */
test("voz remota lenta: onstart atrasado, mas dentro do timerLimite, não marca indisponível", async () => {
  const vozRemota: SpeechSynthesisVoice = {
    default: false,
    lang: "pt-BR",
    localService: false, // voz de rede (ex.: Google) — pode demorar mais pro 1º onstart
    name: "Google português do Brasil",
    voiceURI: "Google pt-BR",
  };

  const { ambiente, chamadas } = criarAmbienteFalso(
    (fala) => {
      // Atraso relevante, mas bem dentro do `timerLimite` do teste abaixo.
      setTimeout(() => {
        fala.onstart?.();
        fala.onend?.();
      }, MS_UNIDADE_TESTE * 2);
    },
    { vozes: [vozRemota], msLimiteFala: MS_UNIDADE_TESTE * 10 },
  );
  const motor = motorDoBrowser(ambiente);

  await motor.tocarTexto("Cadê a titia?", 0.8, new AbortController().signal);

  assert.equal(chamadas.length, 1, "onstart chegou dentro do timerLimite — só uma chamada a speak()");
  assert.equal(saudeAtual(), false, "voz remota carregando não pode ser confundida com motor travado");
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
