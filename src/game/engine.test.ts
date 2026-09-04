/**
 * Testes do engine de rodada + fila de fala. Rodam em node puro (nenhum DOM):
 *
 *   node --test --experimental-strip-types src/game/engine.test.ts
 *
 * Cobre a regra de ouro (não existe perder) e o anti-empilhamento de toque/áudio.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  FASES,
  aceitaToque,
  continuar,
  criarRodada,
  recompensar,
  repetirPergunta,
  rodadaEncerrada,
  tocar,
  type FaseRodada,
} from "./engine.ts";
import { FilaDeFala, type MotorFala } from "./fala.ts";

const T0 = 1_000_000;

function rodada(alternativas = ["mae", "pai"], correta = "mae") {
  return criarRodada({
    pergunta: "Cadê a mamãe?",
    alternativas,
    correta,
    em: T0,
  });
}

// --------------------------------------------------------- sem derrota

test("nenhuma fase representa derrota — o tipo FaseRodada só tem 4 fases", () => {
  assert.deepEqual([...FASES].sort(), ["acertou", "perguntando", "quaseLa", "recompensa"]);
  for (const fase of FASES) {
    assert.doesNotMatch(
      fase,
      /derrot|perde|perdeu|game.?over|fim.?de.?jogo|falhou|errou/i,
      `fase suspeita de derrota: ${fase}`,
    );
  }
  // Espelho em runtime da união: se alguém acrescentar "perdeu" ao tipo sem
  // acrescentar aqui, o TS quebra; se acrescentar nos dois, este teste quebra.
  const exaustivo: Record<FaseRodada, true> = {
    perguntando: true,
    quaseLa: true,
    acertou: true,
    recompensa: true,
  };
  assert.equal(Object.keys(exaustivo).length, FASES.length);
});

test("10 toques errados mantêm a rodada viva e reemitem a pergunta", () => {
  let estado = rodada();
  let em = T0;

  for (let i = 1; i <= 10; i++) {
    em += 1000;
    const erro = tocar(estado, "pai", em);
    assert.equal(erro.mudou, true, `toque errado ${i} deveria ser aceito`);
    assert.equal(erro.estado.fase, "quaseLa");
    assert.equal(erro.estado.quaseLas, i, "quaseLa acumula, mas não é derrota");
    assert.equal(rodadaEncerrada(erro.estado), false, "rodada nunca encerra por erro");

    // A pergunta é sempre reemitida junto do reforço positivo.
    const motivos = erro.falas.map((f) => f.motivo);
    assert.deepEqual(motivos, ["reforco", "pergunta"]);
    assert.equal(erro.falas[1].texto, "Cadê a mamãe?");
    assert.equal(erro.falas[0].prioridade, "alta", "o reforço corta o áudio anterior");

    em += 2000;
    const volta = continuar(erro.estado, em);
    assert.equal(volta.mudou, true);
    assert.equal(volta.estado.fase, "perguntando", "sempre volta a perguntar");
    assert.deepEqual(volta.estado.alternativas, estado.alternativas, "mesmas alternativas");
    estado = volta.estado;
  }

  // Depois de 10 erros a criança ainda pode acertar normalmente.
  em += 1000;
  const acerto = tocar(estado, "mae", em);
  assert.equal(acerto.estado.fase, "acertou");
  assert.equal(acerto.estado.escolhida, "mae");
  assert.deepEqual(
    acerto.falas.map((f) => f.motivo),
    ["festa"],
  );
  const premio = recompensar(acerto.estado, em + 1000);
  assert.equal(premio.estado.fase, "recompensa");
  assert.equal(rodadaEncerrada(premio.estado), true);
});

test("reforços do quaseLa rodam em rodízio (não repete a mesma frase)", () => {
  let estado = rodada();
  let em = T0;
  const frases: string[] = [];
  for (let i = 0; i < 3; i++) {
    em += 1000;
    const erro = tocar(estado, "pai", em);
    frases.push(erro.falas[0].texto);
    em += 1000;
    estado = continuar(erro.estado, em).estado;
  }
  assert.equal(new Set(frases).size, 3, "frases de reforço variam");
});

// ------------------------------------------------- multi-touch / duplo toque

test("dois toques em menos de 200 ms = UMA transição e UM áudio", async () => {
  const { motor, tocados } = motorFake();
  const fila = new FilaDeFala(motor);
  const estado = rodada();

  const primeiro = tocar(estado, "mae", T0 + 10);
  assert.equal(primeiro.mudou, true);
  for (const f of primeiro.falas) {
    fila.falar({ chave: f.motivo, texto: f.texto, prioridade: f.prioridade });
  }

  // Segundo dedo 50 ms depois (mesma alternativa) e um terceiro a 150 ms.
  const segundo = tocar(primeiro.estado, "mae", T0 + 60);
  const terceiro = tocar(primeiro.estado, "mae", T0 + 160);
  for (const t of [segundo, terceiro]) {
    assert.equal(t.mudou, false, "toque dentro da janela é ignorado");
    assert.equal(t.falas.length, 0, "toque ignorado não pede áudio");
    assert.equal(t.estado.versao, primeiro.estado.versao, "sem transição extra");
    for (const f of t.falas) fila.falar({ chave: f.motivo, texto: f.texto });
  }

  await tick();
  assert.deepEqual(tocados, ["Isso! Muito bem!"], "um áudio só");
});

test("multi-touch em alternativas diferentes: só o primeiro dedo conta", () => {
  const estado = rodada(["mae", "pai", "irmao"]);
  const primeiro = tocar(estado, "pai", T0 + 10); // errada
  assert.equal(primeiro.estado.fase, "quaseLa");

  // Outro dedo, no mesmo instante, na alternativa certa: não deve "salvar".
  const segundo = tocar(primeiro.estado, "mae", T0 + 10);
  assert.equal(segundo.mudou, false);
  assert.equal(segundo.estado.fase, "quaseLa");
  assert.equal(segundo.estado.escolhida, null);
});

test("toque fora da fase perguntando é ignorado (nada empilha na fala)", () => {
  const estado = rodada();
  const acerto = tocar(estado, "mae", T0 + 10);
  assert.equal(acerto.estado.fase, "acertou");

  const depois = tocar(acerto.estado, "pai", T0 + 5000);
  assert.equal(depois.mudou, false);
  assert.equal(depois.falas.length, 0);
  assert.equal(aceitaToque(acerto.estado, T0 + 5000), false);

  // E na recompensa também não.
  const premio = recompensar(acerto.estado, T0 + 6000).estado;
  assert.equal(tocar(premio, "mae", T0 + 9000).mudou, false);
});

test("repetir a pergunta fala de novo sem mudar de fase", () => {
  const estado = rodada();
  const r = repetirPergunta(estado);
  assert.equal(r.mudou, false, "repetir não é transição de estado");
  assert.equal(r.estado.versao, estado.versao);
  assert.deepEqual(
    r.falas.map((f) => [f.motivo, f.prioridade]),
    [["pergunta", "alta"]],
    "prioridade alta: corta o áudio em andamento em vez de empilhar",
  );
  // Depois do acerto o botão fica mudo (a rodada acabou).
  const acerto = tocar(estado, "mae", T0 + 10).estado;
  assert.equal(repetirPergunta(acerto).falas.length, 0);
});

// ------------------------------------------------------------- fila de fala

test("fila de fala não empilha o mesmo áudio e roda serializada", async () => {
  const { motor, tocados, liberar, emAndamento } = motorFake({ manual: true });
  const fila = new FilaDeFala(motor);

  fila.falar({ chave: "pergunta", texto: "Cadê a mamãe?" });
  fila.falar({ chave: "pergunta", texto: "Cadê a mamãe?" }); // duplicado
  fila.falar({ chave: "outra", texto: "Cadê o papai?" });
  await tick();

  assert.deepEqual(tocados, ["Cadê a mamãe?"], "só o primeiro começou");
  assert.equal(emAndamento(), 1, "um áudio por vez");
  assert.equal(fila.falando, true);

  liberar();
  await tick();
  assert.deepEqual(tocados, ["Cadê a mamãe?", "Cadê o papai?"], "o próximo só começa depois");

  liberar();
  await tick();
  assert.equal(fila.falando, false);
});

test("prioridade alta corta o áudio atual e limpa a fila", async () => {
  const { motor, tocados, abortados } = motorFake({ manual: true });
  const fila = new FilaDeFala(motor);

  fila.falar({ chave: "pergunta", texto: "Cadê a mamãe?" });
  await tick();
  fila.falar({ chave: "fila", texto: "vai ser descartada" });
  fila.falar({ chave: "festa", texto: "Isso! Muito bem!", prioridade: "alta" });
  await tick();

  assert.deepEqual(abortados, ["Cadê a mamãe?"], "o que tocava foi cortado");
  assert.deepEqual(tocados, ["Cadê a mamãe?", "Isso! Muito bem!"], "a fila antiga foi descartada");
});

test("cancelar() para tudo (troca de rodada / unmount)", async () => {
  const { motor, abortados } = motorFake({ manual: true });
  const fila = new FilaDeFala(motor);
  fila.falar({ chave: "pergunta", texto: "Cadê a mamãe?" });
  await tick();
  fila.cancelar();
  await tick();
  assert.deepEqual(abortados, ["Cadê a mamãe?"]);
  assert.equal(fila.falando, false);
  assert.equal(fila.tamanhoFila, 0);
});

// ------------------------------------------------------------------ helpers

/** Deixa as microtasks/timers pendentes rodarem. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Motor de áudio de mentira. `manual: true` faz cada fala ficar "tocando" até
 * `liberar()` — é assim que testamos a serialização.
 */
function motorFake(opcoes: { manual?: boolean } = {}) {
  const tocados: string[] = [];
  const abortados: string[] = [];
  const pendentes: (() => void)[] = [];

  const motor: MotorFala = {
    async tocarAudio(fonte, sinal) {
      return motor.tocarTexto(typeof fonte === "string" ? fonte : "(blob)", 1, sinal);
    },
    async tocarTexto(texto, _taxa, sinal) {
      tocados.push(texto);
      if (!opcoes.manual) return;
      await new Promise<void>((resolve) => {
        const terminar = () => {
          const i = pendentes.indexOf(terminar);
          if (i >= 0) pendentes.splice(i, 1);
          resolve();
        };
        pendentes.push(terminar);
        sinal.addEventListener(
          "abort",
          () => {
            abortados.push(texto);
            terminar();
          },
          { once: true },
        );
      });
    },
  };

  return {
    motor,
    tocados,
    abortados,
    emAndamento: () => pendentes.length,
    liberar: () => pendentes[0]?.(),
  };
}
