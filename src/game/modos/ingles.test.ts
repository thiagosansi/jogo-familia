/**
 * Testes do modo "inglês". Node puro, nenhum DOM, nenhum IndexedDB:
 *
 *   node --test --experimental-strip-types src/game/modos/ingles.test.ts
 *
 * Foco do DoD:
 *  1. catálogo validado no import (os 4 baralhos, ids estáveis, sem `any`);
 *  2. toda rodada montada (nos 4 baralhos) nunca repete alternativa e a
 *     correta sempre está entre as alternativas;
 *  3. o baralho família degrada SEM LANÇAR quando o elenco não dá.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { criarRodada, tocar } from "../engine.ts";
import {
  BARALHOS_INGLES,
  COTIDIANO_INGLES,
  FAMILIA_INGLES,
  IDS_COTIDIANO,
  IDS_NUMERO,
  IDS_SAUDACAO,
  NUMEROS_INGLES,
  SAUDACOES_INGLES,
  TAMANHO_SUBCONJUNTO_NUMEROS,
  criarSorteio,
  montarRodadaCotidiano,
  montarRodadaFamiliaIngles,
  montarRodadaNumeros,
  montarRodadaSaudacoes,
  numeroPorId,
  palavraCotidianoPorId,
  palavraFamiliaPorId,
  palavrasFamiliaJogaveis,
  podeJogarFamiliaIngles,
  saudacaoPorId,
  validarCatalogoIngles,
  type FichaFamiliarIngles,
  type RodadaFamiliaIngles,
} from "./ingles.ts";

const SEMENTES = [1, 7, 42, 99, 1234, 20260904, 2 ** 30 - 1];

function ficha(id: string, nome: string, papel: FichaFamiliarIngles["papel"]): FichaFamiliarIngles {
  return { id, nome, papel };
}

// -------------------------------------------------------------- catálogo

test("validarCatalogoIngles passa e os 4 baralhos existem com ids estáveis", () => {
  assert.equal(validarCatalogoIngles(), true);
  assert.deepEqual(
    BARALHOS_INGLES.map((b) => b.id),
    ["numeros", "cotidiano", "familia", "saudacoes"],
  );

  assert.equal(NUMEROS_INGLES.length, 10);
  assert.deepEqual(
    IDS_NUMERO,
    NUMEROS_INGLES.map((n) => n.id),
  );

  assert.ok(COTIDIANO_INGLES.length >= 8, "pool de cotidiano pequeno demais");
  assert.ok(FAMILIA_INGLES.length === 4);
  assert.ok(SAUDACOES_INGLES.length === 4);

  // ids são strings estáveis e não vazias, sem duplicar entre si.
  for (const [nome, itens] of [
    ["numeros", NUMEROS_INGLES],
    ["cotidiano", COTIDIANO_INGLES],
    ["familia", FAMILIA_INGLES],
    ["saudacoes", SAUDACOES_INGLES],
  ] as const) {
    const ids = itens.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, `${nome}: ids duplicados`);
    for (const id of ids) assert.ok(id.length > 0, `${nome}: id vazio`);
  }
});

test("módulo é puro — não importa React, DOM, @/lib/db, fala.ts nem usa alias @/", () => {
  const fonte = readFileSync(new URL("./ingles.ts", import.meta.url), "utf8");
  const imports = [...fonte.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(!spec.startsWith("@/"), `import usando alias @/: ${spec}`);
    assert.doesNotMatch(spec, /\/lib\/db(\.ts)?$/, `import de @/lib/db: ${spec}`);
    assert.doesNotMatch(spec, /\/fala(\.ts)?$/, `import de fala.ts: ${spec}`);
    assert.notEqual(spec, "react", "import de react");
  }
});

// ------------------------------------------------- rodada sempre válida

/** Roda `montar` várias vezes com sementes variadas e checa as invariantes do engine. */
function checarRodadasValidas<A extends string>(
  nome: string,
  montar: (qtd: 2 | 3 | 4, sortear: () => number) => { alternativas: readonly A[]; correta: A },
) {
  for (const semente of SEMENTES) {
    const sortear = criarSorteio(semente);
    for (const qtd of [2, 3, 4] as const) {
      for (let i = 0; i < 20; i++) {
        const r = montar(qtd, sortear);
        assert.ok(r.alternativas.length >= 2, `${nome}: menos de 2 alternativas`);
        assert.equal(
          new Set(r.alternativas).size,
          r.alternativas.length,
          `${nome}: alternativa repetida (semente ${semente}, qtd ${qtd})`,
        );
        assert.ok(r.alternativas.includes(r.correta), `${nome}: correta fora das alternativas`);

        // O engine tem que aceitar a rodada e reconhecer a alternativa certa.
        const estado = criarRodada({
          pergunta: "x",
          alternativas: r.alternativas,
          correta: r.correta,
        });
        const t = tocar(estado, r.correta);
        assert.equal(t.estado.fase, "acertou", `${nome}: engine não aceitou a rodada`);
      }
    }
  }
}

test("números: rodada nunca repete alternativa e a correta está nela", () => {
  checarRodadasValidas("numeros", (qtd, sortear) => montarRodadaNumeros({ qtd, sortear }));
});

test("cotidiano: rodada nunca repete alternativa e a correta está nela", () => {
  checarRodadasValidas("cotidiano", (qtd, sortear) => montarRodadaCotidiano({ qtd, sortear }));
});

test("saudações: rodada nunca repete alternativa e a correta está nela", () => {
  checarRodadasValidas("saudacoes", (qtd, sortear) => montarRodadaSaudacoes({ qtd, sortear }));
});

test("família: rodada nunca repete alternativa e a correta está nela (elenco farto)", () => {
  const elenco: FichaFamiliarIngles[] = [
    ficha("p1", "Mamãe", "mae"),
    ficha("p2", "Papai", "pai"),
    ficha("p3", "Léo", "irmao"),
    ficha("p4", "Tio João", "parente"),
  ];
  checarRodadasValidas("familia", (qtd, sortear) => {
    const r = montarRodadaFamiliaIngles({ fichas: elenco, qtd, sortear });
    assert.ok(r, "esperava rodada com elenco farto");
    return r!;
  });
});

// -------------------------------------------------------------- números

test("números: cada rodada sorteia um subconjunto (não expõe o pool de 10 inteiro)", () => {
  const sortear = criarSorteio(2026);
  const r = montarRodadaNumeros({ qtd: 4, sortear });
  assert.ok(r.itens.length <= TAMANHO_SUBCONJUNTO_NUMEROS);
  assert.equal(numeroPorId(r.correta).id, r.correta);
});

test("números: palavra vem do catálogo (one..ten) e id desconhecido lança", () => {
  assert.equal(numeroPorId("3").palavra, "three");
  assert.throws(() => numeroPorId("11"), /Número desconhecido/);
});

// ------------------------------------------------------------- cotidiano

test("cotidiano: cada palavra referencia um desenho já existente (animal ou forma+cor)", () => {
  for (const item of COTIDIANO_INGLES) {
    if (item.desenho.tipo === "animal") {
      assert.ok(item.desenho.animal.length > 0);
    } else {
      assert.ok(item.desenho.forma.length > 0);
      assert.ok(item.desenho.cor.length > 0);
    }
  }
  assert.equal(IDS_COTIDIANO.length, COTIDIANO_INGLES.length);
  assert.throws(() => palavraCotidianoPorId("nao-existe"), /Palavra desconhecida/);
});

// --------------------------------------------------------------- família

test("família: sem ninguém cadastrado, degrada sem lançar (pula o baralho)", () => {
  assert.deepEqual(palavrasFamiliaJogaveis([]), []);
  assert.equal(podeJogarFamiliaIngles([]), false);
  const r = montarRodadaFamiliaIngles({ fichas: [], qtd: 3 });
  assert.equal(r, null);
});

test("família: com uma pessoa só (não dá pra montar 2 alternativas), degrada sem lançar", () => {
  const elenco: FichaFamiliarIngles[] = [ficha("p1", "Mamãe", "mae")];
  assert.deepEqual(palavrasFamiliaJogaveis(elenco), []);
  const r = montarRodadaFamiliaIngles({ fichas: elenco, qtd: 3 });
  assert.equal(r, null);
});

test("família: cadastro sem papel jogável (só mascote) degrada sem lançar", () => {
  const elenco: FichaFamiliarIngles[] = [
    ficha("m1", "Nemo", "mascote"),
    ficha("m2", "Dory", "mascote"),
  ];
  assert.deepEqual(palavrasFamiliaJogaveis(elenco), []);
  assert.equal(montarRodadaFamiliaIngles({ fichas: elenco, qtd: 4 }), null);
});

test("família: elenco mínimo jogável (mãe + 1 outra pessoa) reduz alternativas sem lançar", () => {
  const elenco: FichaFamiliarIngles[] = [ficha("p1", "Mamãe", "mae"), ficha("p2", "Papai", "pai")];
  assert.equal(podeJogarFamiliaIngles(elenco), true);
  const r = montarRodadaFamiliaIngles({ fichas: elenco, qtd: 4, correta: "mommy" });
  assert.ok(r);
  assert.equal(r!.alternativas.length, 2, "esperava reduzir para 2 (só há 2 pessoas)");
  assert.equal(r!.correta, "p1");
  assert.equal(r!.palavra.id, "mommy");
});

test("família: brother e sister mapeiam para o mesmo papel 'irmao' (limitação documentada)", () => {
  assert.equal(palavraFamiliaPorId("brother").papel, "irmao");
  assert.equal(palavraFamiliaPorId("sister").papel, "irmao");
  const elenco: FichaFamiliarIngles[] = [ficha("p1", "Mamãe", "mae"), ficha("p2", "Léo", "irmao")];
  const jogaveis = palavrasFamiliaJogaveis(elenco).map((p) => p.id);
  assert.ok(jogaveis.includes("brother"));
  assert.ok(jogaveis.includes("sister"));

  const rBrother = montarRodadaFamiliaIngles({ fichas: elenco, qtd: 2, correta: "brother" });
  const rSister = montarRodadaFamiliaIngles({ fichas: elenco, qtd: 2, correta: "sister" });
  assert.equal(rBrother!.correta, "p2");
  assert.equal(rSister!.correta, "p2");
});

test("família: não repete o alvo em rodadas seguidas quando há mais de uma palavra jogável", () => {
  const elenco: FichaFamiliarIngles[] = [
    ficha("p1", "Mamãe", "mae"),
    ficha("p2", "Papai", "pai"),
    ficha("p3", "Léo", "irmao"),
  ];
  for (const semente of SEMENTES) {
    const sortear = criarSorteio(semente);
    let anterior: "mommy" | "daddy" | "brother" | "sister" | null = null;
    for (let i = 0; i < 15; i++) {
      const r: RodadaFamiliaIngles<FichaFamiliarIngles> | null = montarRodadaFamiliaIngles({
        fichas: elenco,
        qtd: 3,
        anterior,
        sortear,
      });
      assert.ok(r);
      if (anterior) assert.notEqual(r!.palavra.id, anterior);
      anterior = r!.palavra.id;
    }
  }
});

// ------------------------------------------------------------- saudações

test("saudações: id dobra como referência do desenho, sem depender de ilustração pra testar", () => {
  assert.deepEqual(IDS_SAUDACAO, SAUDACOES_INGLES.map((s) => s.id));
  assert.equal(saudacaoPorId("hello").palavra, "hello");
  assert.equal(saudacaoPorId("byeBye").palavra, "bye bye");
  assert.throws(() => saudacaoPorId("oi"), /Saudação desconhecida/);
});
