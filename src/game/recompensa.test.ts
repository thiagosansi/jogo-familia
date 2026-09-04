/**
 * Testes de `recompensa.ts` — o vocabulário das figurinhas.
 *
 * Rodar: `node --test --experimental-strip-types src/game/recompensa.test.ts`
 * (ou `pnpm test`, que varre `src/**\/*.test.ts`).
 *
 * O que aqui é invariante de PRODUTO, não detalhe de implementação:
 *  - id desconhecido nunca estoura (a criança não pode ver tela quebrada);
 *  - a figurinha nova não muda o lugar das antigas (senão o álbum "some");
 *  - a ordem é a de conquista, então o slot de cada uma é estável no reload.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SLOTS,
  desenhoDaFigurinha,
  eixoDaFigurinha,
  figurinhasDoEixo,
  idFigurinha,
  nomeDaFigurinha,
  ordenarFigurinhas,
  slotFigurinha,
} from "./recompensa.ts";
import type { Figurinha } from "../lib/tipos.ts";

const f = (id: string, conquistadaEm: number): Figurinha => ({
  id,
  eixo: (eixoDaFigurinha(id) ?? "cores") as Figurinha["eixo"],
  conquistadaEm,
});

test("traduz cada eixo no desenho certo", () => {
  assert.deepEqual(desenhoDaFigurinha("cor-azul"), {
    tipo: "objeto",
    forma: "concha",
    cor: "#3a86ff",
  });
  assert.deepEqual(desenhoDaFigurinha("animal-vaca"), { tipo: "bicho", qual: "vaca" });
  assert.equal(desenhoDaFigurinha("contar-3").tipo, "cardume");
  assert.deepEqual(desenhoDaFigurinha("familia-abc123"), {
    tipo: "pessoa",
    personagemId: "abc123",
  });
  // O glifo É o desenho da figurinha de letra (ver DesenhoFigurinha).
  assert.deepEqual(desenhoDaFigurinha("letra-P"), { tipo: "letra", letra: "P" });
  // A cor da carta sai da bijeção cor <-> forma de `cores.ts` — o id só
  // carrega a forma, então o catálogo continua sendo a única fonte da cor.
  assert.deepEqual(desenhoDaFigurinha("memoria-peixe"), {
    tipo: "carta",
    forma: "peixe",
    cor: "#ffd166",
  });
});

test("id desconhecido vira mascote em vez de estourar", () => {
  for (const id of [
    "",
    "sei-la",
    "cor-inexistente",
    // O cardume vai de 1 a `MAX_CONTAGEM` (10, desde que o modo Contar
    // passou a contar até 10): 11 está fora e cai no mascote.
    "contar-11",
    "animal-dinossauro",
    "familia-",
    // O eixo "ingles" existe (ver eixoDaFigurinha), mas o catálogo de
    // desenhos por palavra ainda não foi escrito — cai no mascote até lá.
    "ingles-hello",
    // Letra só vale com UM caractere maiúsculo de A a Z.
    "letra-",
    "letra-ab",
    "letra-p",
    "letra-Ç",
    "letra-1",
    // Par de memória que não é forma do catálogo (foto da família, mascote):
    // sem desenho próprio no álbum, cai no mascote.
    "memoria-",
    "memoria-dinossauro",
  ]) {
    const d = desenhoDaFigurinha(id);
    assert.equal(d.tipo, "mascote", `id ${JSON.stringify(id)} deveria cair no mascote`);
  }
  // Determinístico: o mesmo id sempre dá o mesmo mascote.
  assert.deepEqual(desenhoDaFigurinha("sei-la"), desenhoDaFigurinha("sei-la"));
});

test("idFigurinha e eixoDaFigurinha são o caminho de ida e volta", () => {
  assert.equal(idFigurinha("cores", "azul"), "cor-azul");
  assert.equal(idFigurinha("contar", 4), "contar-4");
  assert.equal(idFigurinha("ingles", "hello"), "ingles-hello");
  assert.equal(idFigurinha("letras", "P"), "letra-P");
  assert.equal(idFigurinha("memoria", "peixe"), "memoria-peixe");
  assert.equal(eixoDaFigurinha("cor-azul"), "cores");
  assert.equal(eixoDaFigurinha("animal-gato"), "animais");
  assert.equal(eixoDaFigurinha("familia-x"), "familia");
  assert.equal(eixoDaFigurinha("ingles-hello"), "ingles");
  assert.equal(eixoDaFigurinha("letra-P"), "letras");
  assert.equal(eixoDaFigurinha("memoria-peixe"), "memoria");
  // Id de letra inválido continua sendo do eixo "letras" (o prefixo é o que
  // manda), mesmo caindo no mascote na hora de desenhar.
  assert.equal(eixoDaFigurinha("letra-ab"), "letras");
  assert.equal(eixoDaFigurinha("lixo"), null);
});

test("nome sai em português e sem id cru na tela", () => {
  assert.equal(nomeDaFigurinha("cor-azul"), "concha azul");
  assert.equal(nomeDaFigurinha("animal-vaca"), "vaca");
  assert.equal(nomeDaFigurinha("contar-1"), "1 peixinho");
  assert.equal(nomeDaFigurinha("familia-p1"), "alguém da família");
  assert.equal(nomeDaFigurinha("familia-p1", new Map([["p1", "Mamãe"]])), "Mamãe");
  assert.equal(nomeDaFigurinha("letra-P"), "letra P");
  assert.equal(nomeDaFigurinha("memoria-peixe"), "peixinho amarelo");
  assert.equal(nomeDaFigurinha("memoria-concha"), "concha azul");
});

test("ordena pela conquista e desempata pelo id (nunca pela ordem do banco)", () => {
  const bagunca = [f("cor-azul", 20), f("animal-gato", 10), f("cor-verde", 10)];
  assert.deepEqual(
    ordenarFigurinhas(bagunca).map((x) => x.id),
    ["animal-gato", "cor-verde", "cor-azul"],
  );
  // Entrada embaralhada dá a MESMA saída: o álbum não muda a cada leitura.
  assert.deepEqual(
    ordenarFigurinhas([...bagunca].reverse()).map((x) => x.id),
    ordenarFigurinhas(bagunca).map((x) => x.id),
  );
});

test("figurinha nova não desloca as antigas", () => {
  const antes = [f("cor-azul", 10), f("animal-gato", 20)];
  const depois = [...antes, f("contar-3", 30)];

  const slotsAntes = ordenarFigurinhas(antes).map((_, i) => slotFigurinha(i));
  const slotsDepois = ordenarFigurinhas(depois).map((_, i) => slotFigurinha(i));

  assert.deepEqual(slotsDepois.slice(0, slotsAntes.length), slotsAntes);
  // E a nova não caiu em cima de ninguém.
  assert.equal(slotsDepois.length, 3);
});

test("os slots de uma volta são todos distintos", () => {
  const vistos = new Set(
    Array.from({ length: SLOTS }, (_, i) => {
      const s = slotFigurinha(i);
      return `${s.x.toFixed(2)},${s.y.toFixed(2)}`;
    }),
  );
  assert.equal(vistos.size, SLOTS);
});

test("slot é determinístico (mesmo álbum depois do reload)", () => {
  for (const i of [0, 5, 17, 28, 61]) {
    assert.deepEqual(slotFigurinha(i), slotFigurinha(i));
  }
});

test("figurinhasDoEixo filtra pelo id, não pelo campo gravado", () => {
  // Registro antigo com o eixo errado gravado: o id manda.
  const torto: Figurinha = { id: "animal-pato", eixo: "cores", conquistadaEm: 1 };
  assert.deepEqual(
    figurinhasDoEixo([torto, f("cor-azul", 2)], "animais").map((x) => x.id),
    ["animal-pato"],
  );
});
