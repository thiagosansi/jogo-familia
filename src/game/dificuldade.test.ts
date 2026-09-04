/**
 * Testes da dificuldade adaptativa (pura):
 *
 *   node --test --experimental-strip-types src/game/dificuldade.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ACERTOS_PARA_SUBIR,
  QUASES_PARA_DESCER,
  dificuldadeInicial,
  embaralhar,
  hidratarDificuldade,
  montarAlternativas,
  registrarAcerto,
  registrarQuaseLa,
  registrarRodada,
  serializarDificuldade,
} from "./dificuldade.ts";

test("começa com 2 alternativas", () => {
  const d = dificuldadeInicial();
  assert.equal(d.alternativas, 2);
  assert.equal(d.acertosSeguidos, 0);
  assert.equal(d.quasesSeguidos, 0);
});

test("sobe de 2 para 3 após 3 acertos consecutivos, e para 4 após mais 3", () => {
  let d = dificuldadeInicial();

  d = registrarAcerto(d);
  assert.equal(d.alternativas, 2, "1 acerto ainda não sobe");
  d = registrarAcerto(d);
  assert.equal(d.alternativas, 2, "2 acertos ainda não sobem");
  d = registrarAcerto(d);
  assert.equal(d.alternativas, 3, `${ACERTOS_PARA_SUBIR} acertos sobem para 3`);
  assert.equal(d.acertosSeguidos, 0, "contador zera ao mudar de nível");

  d = registrarAcerto(d);
  d = registrarAcerto(d);
  assert.equal(d.alternativas, 3, "faltava 1 acerto");
  d = registrarAcerto(d);
  assert.equal(d.alternativas, 4, "mais 3 acertos sobem para 4");

  // Teto: não existe nível 5.
  for (let i = 0; i < 6; i++) d = registrarAcerto(d);
  assert.equal(d.alternativas, 4);
});

test("desce um nível após 2 quaseLa consecutivos (e nunca abaixo de 2)", () => {
  let d = dificuldadeInicial();
  for (let i = 0; i < 6; i++) d = registrarAcerto(d); // sobe até 4
  assert.equal(d.alternativas, 4);

  d = registrarQuaseLa(d);
  assert.equal(d.alternativas, 4, "1 quaseLa não desce");
  d = registrarQuaseLa(d);
  assert.equal(d.alternativas, 3, `${QUASES_PARA_DESCER} quaseLa descem um nível`);
  assert.equal(d.quasesSeguidos, 0);

  d = registrarQuaseLa(d);
  d = registrarQuaseLa(d);
  assert.equal(d.alternativas, 2, "desce um nível de cada vez");

  // Piso: 2 alternativas é o mínimo jogável (nunca 1, nunca 0).
  for (let i = 0; i < 8; i++) d = registrarQuaseLa(d);
  assert.equal(d.alternativas, 2);
});

test("só sequências contam: acerto zera quaseLa e vice-versa", () => {
  let d = dificuldadeInicial();
  d = registrarQuaseLa(d);
  d = registrarAcerto(d);
  assert.equal(d.quasesSeguidos, 0, "acerto zera a sequência de quaseLa");

  d = registrarQuaseLa(d);
  assert.equal(d.acertosSeguidos, 0, "quaseLa zera a sequência de acertos");
  assert.equal(d.alternativas, 2);

  // Acerto-quase-acerto-quase nunca sobe nem desce.
  let e = dificuldadeInicial();
  for (let i = 0; i < 5; i++) {
    e = registrarAcerto(e);
    e = registrarQuaseLa(e);
  }
  assert.equal(e.alternativas, 2);
});

test("registrarRodada aplica os quaseLa da rodada e depois o acerto", () => {
  // Rodada limpa 3x seguidas => sobe.
  let d = dificuldadeInicial();
  for (let i = 0; i < 3; i++) d = registrarRodada(d, { quaseLas: 0 });
  assert.equal(d.alternativas, 3);

  // Uma rodada com 2 quaseLa desce antes de contar o acerto.
  d = registrarRodada(d, { quaseLas: 2 });
  assert.equal(d.alternativas, 2);
  assert.equal(d.acertosSeguidos, 1, "o acerto final da rodada conta");
});

test("montarAlternativas devolve a correta + distratores, sem repetir", () => {
  const pool = ["mae", "pai", "irmao", "vo", "cachorro"];
  const sorteio = geradorFixo([0.1, 0.4, 0.7, 0.2, 0.9, 0.3, 0.5, 0.8, 0.05, 0.6]);
  const alts = montarAlternativas(pool, "mae", 3, sorteio);

  assert.equal(alts.length, 3);
  assert.equal(new Set(alts).size, 3, "sem alternativa repetida");
  assert.ok(alts.includes("mae"), "a correta sempre está na tela");
  for (const a of alts) assert.ok(pool.includes(a));
});

test("montarAlternativas aguenta pool pequeno sem quebrar a rodada", () => {
  const alts = montarAlternativas(["mae", "pai"], "mae", 4, geradorFixo([0.5, 0.5, 0.5, 0.5]));
  assert.equal(alts.length, 2, "faltou distrator: joga com o que dá");
  assert.ok(alts.includes("mae"));
});

test("embaralhar preserva os itens", () => {
  const itens = ["a", "b", "c", "d"];
  const saida = embaralhar(itens, geradorFixo([0.9, 0.1, 0.6, 0.3]));
  assert.deepEqual([...saida].sort(), [...itens].sort());
  assert.deepEqual(itens, ["a", "b", "c", "d"], "não muta a entrada");
});

test("serializar/hidratar sobrevive a lixo salvo em disco", () => {
  const d = registrarAcerto(registrarAcerto(dificuldadeInicial()));
  const salvo = serializarDificuldade(d);
  assert.deepEqual(hidratarDificuldade(JSON.parse(JSON.stringify(salvo))), d);

  assert.deepEqual(hidratarDificuldade(null), dificuldadeInicial());
  assert.deepEqual(hidratarDificuldade("lixo"), dificuldadeInicial());
  assert.equal(hidratarDificuldade({ alternativas: 99 }).alternativas, 4, "teto respeitado");
  assert.equal(hidratarDificuldade({ alternativas: -3 }).alternativas, 2, "piso respeitado");
  assert.equal(hidratarDificuldade({ acertosSeguidos: 999 }).acertosSeguidos, ACERTOS_PARA_SUBIR);
});

/** Gerador determinístico (cíclico) para os testes de sorteio. */
function geradorFixo(valores: number[]): () => number {
  let i = 0;
  return () => valores[i++ % valores.length];
}
