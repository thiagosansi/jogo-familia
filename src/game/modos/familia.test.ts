/**
 * Testes do modo "Quem é quem" (família). Node puro, nenhum DOM, nenhum
 * IndexedDB:
 *
 *   node --test --experimental-strip-types src/game/modos/familia.test.ts
 *
 * Foco nos três compromissos do modo:
 *  1. o alvo NÃO repete em rodadas seguidas (com mais de um alvo possível);
 *  2. elenco insuficiente NÃO vira rodada quebrada — `podeJogar()` avisa antes
 *     e a página troca pelo convite ao adulto;
 *  3. a voz gravada manda quando existe, e a ausência dela NÃO trava nada
 *     (slot `null` ⇒ a `FilaDeFala` fala com `SpeechSynthesis`).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { continuar, criarRodada, rodadaEncerrada, tocar } from "../engine.ts";
import { dificuldadeInicial, registrarRodada } from "../dificuldade.ts";
import { FilaDeFala, type MotorFala } from "../fala.ts";
import {
  PAPEIS_ALVO,
  REFORCOS_FAMILIA,
  alvosPossiveis,
  apresentador,
  criarSorteio,
  ehAlvoPossivel,
  festaDe,
  montarRodadaFamilia,
  perguntaDe,
  podeJogar,
  proximoAlvo,
  rotuloDe,
  vozesDaRodada,
  type FichaFamiliar,
  type RodadaFamilia,
} from "./familia.ts";

// ------------------------------------------------------------------ fixtures

function ficha(id: string, nome: string, papel: FichaFamiliar["papel"]): FichaFamiliar {
  return { id, nome, papel };
}

/** Elenco típico do DoD 1: três personagens cadastrados. */
const TRIO: FichaFamiliar[] = [
  ficha("p1", "Mamãe", "mae"),
  ficha("p2", "Papai", "pai"),
  ficha("p3", "Léo", "irmao"),
];

/** Sementes variadas — nenhum teste depende de uma sorte específica. */
const SEMENTES = [1, 7, 42, 99, 1234, 20260902, 2 ** 30 - 1];

// ------------------------------------------------- mascote nunca é alvo

test("mascote fica fora do sorteio de alvo (mas conta como cara na tela)", () => {
  const elenco = [...TRIO, ficha("m1", "Nemo", "mascote")];
  assert.deepEqual(alvosPossiveis(elenco).map((f) => f.id), ["p1", "p2", "p3"]);
  assert.equal(ehAlvoPossivel(ficha("m1", "Nemo", "mascote")), false);
  assert.deepEqual([...PAPEIS_ALVO], ["mae", "pai", "irmao", "parente"]);

  for (const semente of SEMENTES) {
    const sortear = criarSorteio(semente);
    for (let i = 0; i < 30; i++) {
      assert.notEqual(proximoAlvo(elenco, null, sortear).papel, "mascote");
    }
  }

  // ...e ele é o apresentador.
  assert.equal(apresentador(elenco)?.id, "m1");
  assert.equal(apresentador(TRIO), null);
});

test("mascote como alvo forçado é recusado alto e cedo", () => {
  const elenco = [...TRIO, ficha("m1", "Nemo", "mascote")];
  assert.throws(
    () => montarRodadaFamilia({ fichas: elenco, qtd: 3, correta: "m1" }),
    /Mascote não pode ser alvo/,
  );
});

// ------------------------------------------ DoD 1: sem alvo repetido seguido

test("DoD 1 — 5 rodadas seguidas com 3 personagens nunca repetem o alvo consecutivo", () => {
  for (const semente of SEMENTES) {
    let dificuldade = dificuldadeInicial();
    let anterior: string | null = null;
    const alvos: string[] = [];

    for (let n = 0; n < 5; n++) {
      // Anotação explícita: sem ela o TS entra em circularidade ao inferir
      // `rodada` a partir de `anterior`, que por sua vez recebe `rodada.correta`.
      const rodada: RodadaFamilia<FichaFamiliar> = montarRodadaFamilia({
        fichas: TRIO,
        qtd: dificuldade.alternativas,
        anterior,
        sortear: criarSorteio(semente + n * 7919),
      });
      assert.notEqual(
        rodada.correta,
        anterior,
        `semente ${semente}, rodada ${n}: alvo repetiu em rodadas seguidas`,
      );
      alvos.push(rodada.correta);
      anterior = rodada.correta;
      dificuldade = registrarRodada(dificuldade, { quaseLas: 0 });
    }

    assert.equal(alvos.length, 5);
    // Sanidade: o modo não fica preso numa pessoa só.
    assert.ok(new Set(alvos).size >= 2, `semente ${semente}: só um alvo em 5 rodadas`);
  }
});

test("com 200 rodadas seguidas o alvo nunca repete e todo mundo é sorteado", () => {
  const vistos = new Set<string>();
  let anterior: string | null = null;
  const sortear = criarSorteio(2026);
  for (let n = 0; n < 200; n++) {
    const alvo: FichaFamiliar = proximoAlvo(TRIO, anterior, sortear);
    assert.notEqual(alvo.id, anterior);
    vistos.add(alvo.id);
    anterior = alvo.id;
  }
  assert.deepEqual([...vistos].sort(), ["p1", "p2", "p3"]);
});

test("com um único familiar repetir é a única saída — e continua jogável", () => {
  const elenco = [ficha("p1", "Mamãe", "mae"), ficha("m1", "Nemo", "mascote")];
  const sortear = criarSorteio(5);
  assert.equal(proximoAlvo(elenco, "p1", sortear).id, "p1");
  const rodada = montarRodadaFamilia({ fichas: elenco, qtd: 4, anterior: "p1", sortear });
  assert.equal(rodada.correta, "p1");
  assert.equal(rodada.alternativas.length, 2); // qtd é teto, não promessa
});

// ------------------------------- DoD 2: elenco insuficiente vira convite

test("DoD 2 — podeJogar() reprova 0 e 1 personagem (a página mostra o convite)", () => {
  assert.equal(podeJogar([]), false);
  assert.equal(podeJogar([ficha("p1", "Mamãe", "mae")]), false);
  // Duas caras, mas nenhuma família: nada a perguntar.
  assert.equal(podeJogar([ficha("m1", "Nemo", "mascote"), ficha("m2", "Dory", "mascote")]), false);
  // A partir daqui dá jogo.
  assert.equal(podeJogar([ficha("p1", "Mamãe", "mae"), ficha("m1", "Nemo", "mascote")]), true);
  assert.equal(podeJogar(TRIO), true);
});

test("DoD 2 — montar rodada com elenco insuficiente falha com mensagem que aponta o convite", () => {
  for (const elenco of [[], [ficha("p1", "Mamãe", "mae")]]) {
    assert.throws(
      () => montarRodadaFamilia({ fichas: elenco, qtd: 2 }),
      /podeJogar\(\)/,
      "a mensagem tem que mandar a página checar podeJogar() antes",
    );
  }
});

// --------------------------------------------------- rodada válida p/ engine

test("a rodada montada é sempre válida para o engine", () => {
  const elenco = [...TRIO, ficha("p4", "Tia Bia", "parente"), ficha("m1", "Nemo", "mascote")];
  for (const semente of SEMENTES) {
    for (const qtd of [2, 3, 4] as const) {
      const r = montarRodadaFamilia({ fichas: elenco, qtd, sortear: criarSorteio(semente) });

      assert.equal(r.alternativas.length, Math.min(qtd, elenco.length));
      assert.equal(new Set(r.alternativas).size, r.alternativas.length, "alternativa repetida");
      assert.ok(r.alternativas.includes(r.correta), "a correta tem que estar na tela");
      assert.equal(r.alvo.id, r.correta);
      // `pessoas` é o mapa id -> pessoa, na mesma ordem das alternativas.
      assert.deepEqual(r.pessoas.map((p) => p.id), [...r.alternativas]);
      for (const id of r.alternativas) {
        assert.ok(elenco.some((f) => f.id === id), `id fora do elenco: ${id}`);
      }
      // O engine aceita (ele valida de novo por conta própria).
      assert.doesNotThrow(() =>
        criarRodada({ pergunta: r.pergunta, alternativas: r.alternativas, correta: r.correta }),
      );
    }
  }
});

test("distratores saem primeiro dos familiares; mascote só completa a tela", () => {
  const elenco = [
    ficha("p1", "Mamãe", "mae"),
    ficha("p2", "Papai", "pai"),
    ficha("m1", "Nemo", "mascote"),
    ficha("m2", "Dory", "mascote"),
  ];
  for (const semente of SEMENTES) {
    const dupla = montarRodadaFamilia({ fichas: elenco, qtd: 2, sortear: criarSorteio(semente) });
    assert.deepEqual([...dupla.alternativas].sort(), ["p1", "p2"], "dois familiares bastam");

    const trinca = montarRodadaFamilia({ fichas: elenco, qtd: 3, sortear: criarSorteio(semente) });
    assert.ok(trinca.alternativas.includes("p1") && trinca.alternativas.includes("p2"));
    assert.equal(trinca.alternativas.filter((id) => id.startsWith("m")).length, 1);
  }
});

test("toque errado nunca encerra a rodada da família — só quaseLa e volta a perguntar", () => {
  const r = montarRodadaFamilia({ fichas: TRIO, qtd: 3, sortear: criarSorteio(11) });
  let estado = criarRodada({
    pergunta: r.pergunta,
    alternativas: r.alternativas,
    correta: r.correta,
    reforcos: r.reforcos,
    festa: r.festa,
    em: 0,
  });
  const errada = r.alternativas.find((id) => id !== r.correta)!;

  let em = 0;
  for (let i = 0; i < 6; i++) {
    em += 1000;
    const t = tocar(estado, errada, em);
    assert.equal(t.estado.fase, "quaseLa");
    assert.ok(REFORCOS_FAMILIA.includes(t.falas[0].texto), "reforço fora do catálogo do modo");
    assert.equal(t.falas[1].texto, r.pergunta, "a pergunta tem que ser repetida");
    estado = continuar(t.estado, em + 1).estado;
    assert.equal(estado.fase, "perguntando");
    assert.equal(rodadaEncerrada(estado), false);
  }

  em += 1000;
  const acerto = tocar(estado, r.correta, em);
  assert.equal(acerto.estado.fase, "acertou");
  assert.equal(acerto.falas[0].texto, r.festa);
});

// ------------------------------------------------ desambiguação pelo nome

test("papel único vira apelido carinhoso na pergunta", () => {
  assert.equal(perguntaDe(TRIO[0], TRIO), "Cadê a mamãe?");
  assert.equal(perguntaDe(TRIO[1], TRIO), "Cadê o papai?");
  assert.equal(festaDe(TRIO[0], TRIO), "Isso! A mamãe!");
});

test("dois parentes (dois tios) são desambiguados pelo NOME, não pelo papel", () => {
  const elenco = [
    ficha("p1", "Mamãe", "mae"),
    ficha("t1", "Tio João", "parente"),
    ficha("t2", "Tio Zé", "parente"),
  ];
  assert.equal(perguntaDe(elenco[1], elenco), "Cadê Tio João?");
  assert.equal(perguntaDe(elenco[2], elenco), "Cadê Tio Zé?");
  assert.notEqual(perguntaDe(elenco[1], elenco), perguntaDe(elenco[2], elenco));
  // Nenhum parente vira "essa pessoa" quando tem nome.
  assert.doesNotMatch(perguntaDe(elenco[1], elenco), /essa pessoa/);
});

test("um parente sozinho também é chamado pelo nome (parente não tem apelido)", () => {
  const elenco = [ficha("p1", "Mamãe", "mae"), ficha("t1", "Vovó Rita", "parente")];
  assert.equal(perguntaDe(elenco[1], elenco), "Cadê Vovó Rita?");
});

test("duas mães (mãe e madrasta) também caem no nome", () => {
  const elenco = [ficha("a", "Ana", "mae"), ficha("b", "Bruna", "mae"), ficha("c", "Papai", "pai")];
  assert.equal(rotuloDe(elenco[0], elenco), "Ana");
  assert.equal(rotuloDe(elenco[1], elenco), "Bruna");
  // O pai continua único, então segue com o apelido.
  assert.equal(rotuloDe(elenco[2], elenco), "o papai");
});

test("nome em branco não deixa a pergunta vazia", () => {
  const elenco = [ficha("a", "   ", "parente"), ficha("b", "Papai", "pai")];
  assert.equal(perguntaDe(elenco[0], elenco), "Cadê essa pessoa?");
});

test("a pergunta e a festa da rodada usam o rótulo desambiguado", () => {
  const elenco = [
    ficha("p1", "Mamãe", "mae"),
    ficha("t1", "Tio João", "parente"),
    ficha("t2", "Tio Zé", "parente"),
  ];
  const r = montarRodadaFamilia({ fichas: elenco, qtd: 3, correta: "t2" });
  assert.equal(r.pergunta, "Cadê Tio Zé?");
  assert.equal(r.festa, "Isso! Tio Zé!");
});

// -------------------------------------------------------- DoD 3: as vozes

test("DoD 3 — com voz gravada, pergunta e festa saem na voz do alvo", () => {
  const vozNome = new Blob(["nome"], { type: "audio/webm" });
  const vozFesta = new Blob(["festa"], { type: "audio/webm" });
  const vozes = vozesDaRodada({ vozNome, vozFesta });
  assert.equal(vozes.pergunta, vozNome);
  assert.equal(vozes.festa, vozFesta);
  // Reforço é TTS de propósito: a única gravação disponível seria "Isso!".
  assert.equal(vozes.reforco, null);
});

test("DoD 3 — só vozNome: a festa reaproveita a voz gravada em vez de cair no TTS", () => {
  const vozNome = new Blob(["nome"], { type: "audio/webm" });
  const vozes = vozesDaRodada({ vozNome, vozFesta: null });
  assert.equal(vozes.festa, vozNome);
});

test("DoD 3 — personagem sem voz gravada devolve null (a fila cai para o TTS)", () => {
  const vozes = vozesDaRodada({ vozNome: null, vozFesta: null });
  assert.deepEqual(vozes, { pergunta: null, festa: null, reforco: null });
  assert.deepEqual(vozesDaRodada(null), { pergunta: null, festa: null, reforco: null });
});

test("DoD 3 — sem vozNome a fila fala o texto e NÃO trava a fila seguinte", async () => {
  const tocados: string[] = [];
  const motor: MotorFala = {
    async tocarAudio(fonte) {
      tocados.push(typeof fonte === "string" ? `url:${fonte}` : "blob");
    },
    async tocarTexto(texto) {
      tocados.push(`tts:${texto}`);
    },
  };
  const fila = new FilaDeFala(motor);
  const r = montarRodadaFamilia({ fichas: TRIO, qtd: 2, correta: "p2" });
  const semVoz = vozesDaRodada({ vozNome: null, vozFesta: null });

  fila.falar({ chave: "pergunta", texto: r.pergunta, audio: semVoz.pergunta });
  fila.falar({ chave: "festa", texto: r.festa, audio: semVoz.festa });
  await esperarSilencio(fila);

  assert.deepEqual(tocados, [`tts:Cadê o papai?`, `tts:Isso! O papai!`]);
  assert.equal(fila.falando, false);
  assert.equal(fila.tamanhoFila, 0);
});

test("com voz gravada a fila toca o áudio (e não o TTS)", async () => {
  const tocados: string[] = [];
  const motor: MotorFala = {
    async tocarAudio() {
      tocados.push("audio");
    },
    async tocarTexto(texto) {
      tocados.push(`tts:${texto}`);
    },
  };
  const fila = new FilaDeFala(motor);
  const vozes = vozesDaRodada({
    vozNome: new Blob(["n"], { type: "audio/webm" }),
    vozFesta: new Blob(["f"], { type: "audio/webm" }),
  });
  fila.falar({ chave: "pergunta", texto: "Cadê a mamãe?", audio: vozes.pergunta });
  await esperarSilencio(fila);
  assert.deepEqual(tocados, ["audio"]);
});

test("áudio corrompido cai para o TTS sem derrubar a rodada", async () => {
  const tocados: string[] = [];
  const motor: MotorFala = {
    async tocarAudio() {
      throw new Error("codec não suportado");
    },
    async tocarTexto(texto) {
      tocados.push(`tts:${texto}`);
    },
  };
  const fila = new FilaDeFala(motor);
  fila.falar({
    chave: "pergunta",
    texto: "Cadê a mamãe?",
    audio: new Blob(["lixo"], { type: "audio/webm" }),
  });
  await esperarSilencio(fila);
  assert.deepEqual(tocados, ["tts:Cadê a mamãe?"]);
});

// --------------------------------------------------------------- pureza

test("o módulo do modo é puro: nada de IndexedDB, React ou DOM", () => {
  const fonte = readFileSync(new URL("./familia.ts", import.meta.url), "utf8");
  const imports = [...fonte.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["../dificuldade.ts", "../../lib/tipos.ts"]);
  for (const proibido of ["@/lib/db", "idb", "react", "next/"]) {
    assert.ok(!imports.some((i) => i.includes(proibido)), `import proibido: ${proibido}`);
  }
  // `tipos.ts` é só tipos — o import some na compilação.
  assert.match(fonte, /import type \{[^}]*\} from "\.\.\/\.\.\/lib\/tipos\.ts";/);
});

// -------------------------------------------------------------- utilidades

/** Espera a fila esvaziar (ela é assíncrona por natureza). */
async function esperarSilencio(fila: FilaDeFala): Promise<void> {
  for (let i = 0; i < 200 && (fila.falando || fila.tamanhoFila > 0); i++) {
    await new Promise((r) => setTimeout(r, 1));
  }
}
