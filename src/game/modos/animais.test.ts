/**
 * Testes do modo Animais. Rodam em node puro (nenhum DOM, nenhum React):
 *
 *   node --test --experimental-strip-types src/game/modos/animais.test.ts
 *
 * Cobre os pontos do DoD que dá para provar sem navegador:
 *  1. licença declarada de TODO som (código x public/sons/CREDITOS.md);
 *  2. tocar 3 bichos em sequência rápida => 3 sons EM FILA, sem sobreposição;
 *  + a integração com o engine (nunca existe derrota) e a normalização de volume.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { criarRodada, tocar, continuar, rodadaEncerrada } from "../engine.ts";
import { FilaDeFala, type MotorFala } from "../fala.ts";
import {
  ANIMAIS,
  GANHO_MAXIMO,
  IDS_ANIMAIS,
  LICENCA_TTS,
  PICO_ALVO,
  animalPorId,
  codificarWav,
  configRodadaAnimais,
  falaDoAnimal,
  festaDe,
  ganhoNormalizador,
  normalizarCanais,
  perguntaDe,
  picoDe,
  proximoAnimal,
} from "./animais.ts";

const CREDITOS = readFileSync(
  new URL("../../../public/sons/CREDITOS.md", import.meta.url),
  "utf8",
);

// ------------------------------------------------------------- licenças

test("todo animal declara a origem e a licença do seu som", () => {
  assert.ok(ANIMAIS.length >= 4, "pool pequeno demais para 4 alternativas");
  for (const animal of ANIMAIS) {
    assert.ok(animal.som.licenca.trim().length > 0, `${animal.id}: licença vazia`);
    assert.ok(animal.som.origem.trim().length > 0, `${animal.id}: origem vazia`);
    assert.doesNotMatch(
      `${animal.som.licenca} ${animal.som.origem}`,
      /desconhecid|a definir|todo|tbd|\?\?\?/i,
      `${animal.id}: licença/origem não declarada de verdade`,
    );
    if (animal.som.tipo === "arquivo") {
      // Arquivo embarcado só entra com licença livre COMPROVADA.
      assert.ok(animal.som.arquivo, `${animal.id}: tipo arquivo sem caminho`);
      assert.match(
        animal.som.licenca,
        /CC0|domínio público|public domain/i,
        `${animal.id}: arquivo embarcado precisa ser CC0/domínio público`,
      );
    } else {
      assert.equal(animal.som.tipo, "tts");
      assert.equal(animal.som.licenca, LICENCA_TTS);
      assert.equal(animal.som.arquivo, undefined, `${animal.id}: TTS não embarca arquivo`);
    }
  }
});

test("public/sons/CREDITOS.md declara cada som exatamente como o código", () => {
  for (const animal of ANIMAIS) {
    assert.ok(CREDITOS.includes(animal.id), `CREDITOS.md não cita o animal ${animal.id}`);
    assert.ok(
      CREDITOS.includes(animal.som.licenca),
      `CREDITOS.md não repete a licença declarada de ${animal.id}`,
    );
    assert.ok(
      CREDITOS.includes(animal.som.origem),
      `CREDITOS.md não repete a origem declarada de ${animal.id}`,
    );
    if (animal.som.tipo === "arquivo") {
      assert.ok(
        CREDITOS.includes(animal.som.arquivo!),
        `CREDITOS.md não cita o arquivo ${animal.som.arquivo}`,
      );
    }
  }
});

// ---------------------------------------------- fila de sons (sem sobrepor)

/**
 * Motor de áudio espião: conta quantas falas estão tocando AO MESMO TEMPO.
 * Se a serialização da fila quebrar, `sobreposicoes` fica > 0.
 */
function motorEspiao(duracaoMs = 8) {
  const ordem: string[] = [];
  let ativas = 0;
  let sobreposicoes = 0;
  let maxSimultaneas = 0;

  async function tocar(texto: string): Promise<void> {
    ativas += 1;
    maxSimultaneas = Math.max(maxSimultaneas, ativas);
    if (ativas > 1) sobreposicoes += 1;
    ordem.push(texto);
    await new Promise((r) => setTimeout(r, duracaoMs));
    ativas -= 1;
  }

  const motor: MotorFala = {
    async tocarAudio() {
      await tocar("[audio]");
    },
    async tocarTexto(texto) {
      await tocar(texto);
    },
  };
  return {
    motor,
    ordem,
    get sobreposicoes() {
      return sobreposicoes;
    },
    get maxSimultaneas() {
      return maxSimultaneas;
    },
  };
}

async function esvaziar(fila: FilaDeFala): Promise<void> {
  const limite = Date.now() + 2000;
  while ((fila.falando || fila.tamanhoFila > 0) && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("tocar 3 bichos em sequência rápida enfileira 3 sons, sem sobreposição", async () => {
  const espiao = motorEspiao();
  const fila = new FilaDeFala(espiao.motor);

  // Três toques no MESMO tick — é o que a criança faz martelando a tela.
  for (const id of ["vaca", "gato", "pato"]) fila.falar(falaDoAnimal(id));
  await esvaziar(fila);

  assert.deepEqual(espiao.ordem, ["Muuu", "Miau", "Quá quá"], "ordem dos toques preservada");
  assert.equal(espiao.maxSimultaneas, 1, "nunca mais de um som ao mesmo tempo");
  assert.equal(espiao.sobreposicoes, 0, "houve sobreposição de áudio");
});

test("martelar o MESMO bicho não empilha áudio (dedupe por chave)", async () => {
  const espiao = motorEspiao();
  const fila = new FilaDeFala(espiao.motor);

  for (let i = 0; i < 6; i++) fila.falar(falaDoAnimal("vaca"));
  await esvaziar(fila);

  assert.deepEqual(espiao.ordem, ["Muuu"], "6 toques no mesmo bicho = 1 som");
});

test("o som do bicho nunca corta o que já está tocando (prioridade normal)", () => {
  for (const id of IDS_ANIMAIS) {
    assert.equal(falaDoAnimal(id).prioridade, "normal", `${id} cortaria o áudio anterior`);
    assert.equal(falaDoAnimal(id).chave, `bicho:${id}`);
  }
});

test("falaDoAnimal usa o Blob pré-carregado quando existe", () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });
  const sons = new Map<string, Blob>([["vaca", blob]]);
  assert.equal(falaDoAnimal("vaca", sons).audio, blob);
  assert.equal(falaDoAnimal("gato", sons).audio, null, "sem arquivo => TTS");
});

// -------------------------------------------------------- perguntas/rodada

test("a pergunta é sobre o SOM e a festa amarra som e bicho", () => {
  assert.equal(perguntaDe("vaca"), "Quem faz muuu?");
  assert.equal(festaDe("vaca"), "Isso! A vaca faz muuu!");
  assert.equal(perguntaDe("galo"), "Quem faz cocoricó?");
  assert.equal(festaDe("galo"), "Isso! O galo faz cocoricó!");
  assert.throws(() => perguntaDe("dinossauro"), /Animal desconhecido/);
});

test("configRodadaAnimais monta uma rodada válida e sem derrota", () => {
  const config = configRodadaAnimais("vaca", ["gato", "vaca", "pato"]);
  assert.equal(config.pergunta, "Quem faz muuu?");
  assert.equal(config.correta, "vaca");
  assert.ok(config.alternativas.includes("vaca"));

  let estado = criarRodada({ ...config, em: 0 });
  // Erra duas vezes: continua viva, e a pergunta é reemitida.
  for (const [i, errada] of ["gato", "pato"].entries()) {
    const t = tocar(estado, errada, 1000 * (i + 1));
    assert.equal(t.estado.fase, "quaseLa");
    assert.equal(rodadaEncerrada(t.estado), false);
    assert.deepEqual(
      t.falas.map((f) => f.motivo),
      ["reforco", "pergunta"],
    );
    assert.equal(t.falas[1].texto, "Quem faz muuu?");
    estado = continuar(t.estado, 1000 * (i + 1) + 500).estado;
  }
  const acerto = tocar(estado, "vaca", 9000);
  assert.equal(acerto.estado.fase, "acertou");
  assert.equal(acerto.falas[0].texto, "Isso! A vaca faz muuu!");
});

test("proximoAnimal nunca repete o bicho da rodada anterior", () => {
  let anterior: string | null = null;
  // Percorre o sorteio inteiro em todas as posições possíveis.
  for (let passo = 0; passo < 40; passo++) {
    const sortear = () => (passo % IDS_ANIMAIS.length) / IDS_ANIMAIS.length;
    const proximo = proximoAnimal(anterior, sortear);
    assert.notEqual(proximo, anterior, "repetiu o mesmo bicho");
    assert.ok(IDS_ANIMAIS.includes(proximo));
    anterior = proximo;
  }
  // Pool de um único bicho: devolve ele mesmo em vez de estourar.
  assert.equal(proximoAnimal("vaca", () => 0, ["vaca"]), "vaca");
});

test("cada animal tem cor e nome próprios (a criança não lê: cor + desenho)", () => {
  const cores = new Set(ANIMAIS.map((a) => a.cor));
  const nomes = new Set(ANIMAIS.map((a) => a.nome));
  assert.equal(cores.size, ANIMAIS.length, "cores repetidas entre bichos");
  assert.equal(nomes.size, ANIMAIS.length);
  assert.equal(animalPorId("ovelha").artigo, "a");
});

// ------------------------------------------------- normalização de volume

test("normalizarCanais iguala o pico dos arquivos (volume normalizado)", () => {
  // Um "muuu" gravado baixo e um "au au" gravado alto: depois da normalização
  // os dois têm o MESMO pico (é isso que a criança escuta como mesmo volume).
  const baixo = new Float32Array([0.3, -0.2, 0.25]);
  const alto = new Float32Array([0.7, -0.6, 0.2]);

  const ganhoBaixo = normalizarCanais([baixo]);
  const ganhoAlto = normalizarCanais([alto]);

  assert.ok(ganhoBaixo > ganhoAlto, "o arquivo mais baixo recebe mais ganho");
  // Tolerância de float32 (o buffer do Web Audio é float de 32 bits).
  assert.ok(Math.abs(picoDe([baixo]) - PICO_ALVO) < 1e-6, "pico do baixo não bateu no alvo");
  assert.ok(Math.abs(picoDe([alto]) - PICO_ALVO) < 1e-6, "pico do alto não bateu no alvo");
  assert.ok(Math.abs(picoDe([baixo]) - picoDe([alto])) < 1e-6, "volumes ainda diferentes");
  assert.ok(PICO_ALVO < 1, "sem headroom o alto-falante do tablet distorce");
});

test("normalização não amplifica silêncio nem estoura o teto de ganho", () => {
  assert.equal(ganhoNormalizador(0), 1, "silêncio não vira chiado amplificado");
  assert.equal(ganhoNormalizador(Number.NaN), 1);
  assert.equal(ganhoNormalizador(0.000001), GANHO_MAXIMO, "ganho limitado");
  const mudo = new Float32Array([0, 0, 0]);
  assert.equal(normalizarCanais([mudo]), 1);
  assert.deepEqual([...mudo], [0, 0, 0]);
});

test("codificarWav gera um cabeçalho RIFF/WAVE válido", () => {
  const canal = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const wav = new Uint8Array(codificarWav([canal], 8000));
  const texto = (i: number, n: number) => String.fromCharCode(...wav.slice(i, i + n));
  const view = new DataView(wav.buffer);

  assert.equal(texto(0, 4), "RIFF");
  assert.equal(texto(8, 4), "WAVE");
  assert.equal(texto(12, 4), "fmt ");
  assert.equal(texto(36, 4), "data");
  assert.equal(view.getUint16(22, true), 1, "1 canal");
  assert.equal(view.getUint32(24, true), 8000, "taxa de amostragem");
  assert.equal(view.getUint16(34, true), 16, "16 bits por amostra");
  assert.equal(view.getUint32(40, true), canal.length * 2, "tamanho do bloco de dados");
  assert.equal(wav.length, 44 + canal.length * 2);
  // Extremos não estouram para o outro lado do inteiro de 16 bits.
  assert.equal(view.getInt16(44 + 3 * 2, true), 32767);
  assert.equal(view.getInt16(44 + 4 * 2, true), -32768);
});
