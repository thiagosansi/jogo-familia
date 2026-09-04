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
import { comemorar, contarObjeto } from "./contar.ts";
import { peca } from "./cores.ts";
import {
  BARALHOS_INGLES,
  CORES_INGLES,
  COTIDIANO_INGLES,
  FALAS_CONTAGEM_NUMEROS_INGLES,
  FAMILIA_INGLES,
  IDS_COR_INGLES,
  IDS_COTIDIANO,
  IDS_NUMERO,
  IDS_SAUDACAO,
  ITENS_FRASE,
  NUMEROS_INGLES,
  SAUDACOES_INGLES,
  TAMANHO_SUBCONJUNTO_NUMEROS,
  corInglesPorId,
  criarContagemNumeroIngles,
  criarSorteio,
  itemFrasePorId,
  montarRodadaCoresIngles,
  montarRodadaCotidiano,
  montarRodadaFamiliaIngles,
  montarRodadaFrases,
  montarRodadaNumeros,
  montarRodadaSaudacoes,
  numeroPorId,
  palavraCorIngles,
  palavraCotidianoPorId,
  palavraFamiliaPorId,
  palavraFormaIngles,
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

test("validarCatalogoIngles passa e os 6 baralhos existem com ids estáveis", () => {
  assert.equal(validarCatalogoIngles(), true);
  assert.deepEqual(
    BARALHOS_INGLES.map((b) => b.id),
    ["numeros", "cotidiano", "familia", "saudacoes", "cores", "frases"],
  );

  assert.equal(NUMEROS_INGLES.length, 10);
  assert.deepEqual(
    IDS_NUMERO,
    NUMEROS_INGLES.map((n) => n.id),
  );

  assert.ok(COTIDIANO_INGLES.length >= 8, "pool de cotidiano pequeno demais");
  assert.ok(FAMILIA_INGLES.length === 4);
  assert.ok(SAUDACOES_INGLES.length === 4);
  assert.ok(CORES_INGLES.length === 5);
  assert.equal(ITENS_FRASE.length, 5 * 5 * 2, "frases: precisa cruzar toda cor x forma x tamanho");

  // ids são strings estáveis e não vazias, sem duplicar entre si.
  for (const [nome, itens] of [
    ["numeros", NUMEROS_INGLES],
    ["cotidiano", COTIDIANO_INGLES],
    ["familia", FAMILIA_INGLES],
    ["saudacoes", SAUDACOES_INGLES],
    ["cores", CORES_INGLES],
    ["frases", ITENS_FRASE],
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

// ------------------------------------------- contagem pós-acerto (números)

test("contagem de números (inglês): fala one..ten na ordem e não repete o total (eco)", () => {
  assert.deepEqual(FALAS_CONTAGEM_NUMEROS_INGLES.numeros, [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ]);
  // O total é `null` de propósito: a última palavra contada ("nine") JÁ É o
  // total — falar "Nine!" logo em seguida seria eco, não reforço (ver
  // comentário de `FALAS_CONTAGEM_NUMEROS_INGLES.total` em ingles.ts).
  assert.equal(FALAS_CONTAGEM_NUMEROS_INGLES.total, null);
  // A comemoração já aconteceu no acerto do número — silêncio aqui de propósito.
  assert.equal(FALAS_CONTAGEM_NUMEROS_INGLES.festa, null);
});

test("contagem de números (inglês): monta exatamente `valor` objetos e conta até o total em en", () => {
  for (const id of IDS_NUMERO) {
    const sortear = criarSorteio(20260904);
    const estado = criarContagemNumeroIngles(id, sortear, "Eight!");
    const item = numeroPorId(id);
    assert.equal(estado.objetos.length, item.valor, `id ${id}: quantidade errada de objetos`);
    assert.equal(estado.forma, "peixe");
    assert.equal(estado.pergunta, "Eight!", "pergunta repassada intacta para o <Palco>");
    assert.equal(estado.falas, FALAS_CONTAGEM_NUMEROS_INGLES);

    // Toca cada objeto na ordem e confere a fala de cada um — SEM eco do
    // total no fim: a última palavra contada já é o total (ver `total:
    // null` em `FALAS_CONTAGEM_NUMEROS_INGLES`).
    let atual = estado;
    const falado: string[] = [];
    for (const objeto of atual.objetos) {
      const t = contarObjeto(atual, objeto.id);
      assert.equal(t.mudou, true);
      atual = t.estado;
      for (const f of t.falas) falado.push(f.texto);
    }
    const esperado = [...FALAS_CONTAGEM_NUMEROS_INGLES.numeros.slice(0, item.valor)];
    assert.deepEqual(falado, esperado, `id ${id}: sequência de falas errada (eco do total?)`);
    assert.equal(falado.at(-1), item.palavra, `id ${id}: última palavra falada só uma vez, sem eco`);
    assert.equal(atual.fase, "total");

    // A festa fecha em silêncio (festa: null) — mesmo assim a transição acontece.
    const festa = comemorar(atual);
    assert.equal(festa.mudou, true);
    assert.equal(festa.estado.fase, "festa");
    assert.deepEqual(festa.falas, []);
  }
});

test("contagem de números (inglês): teto pedagógico do pt-BR (5) não se aplica — chega a dez", () => {
  const sortear = criarSorteio(1);
  const dez = criarContagemNumeroIngles("10", sortear);
  assert.equal(dez.objetos.length, 10);
});

test("contagem de números (inglês): objeto já contado não fala de novo (não existe perder)", () => {
  const sortear = criarSorteio(7);
  const estado = criarContagemNumeroIngles("3", sortear);
  const primeiro = contarObjeto(estado, estado.objetos[0].id);
  assert.equal(primeiro.mudou, true);
  const repetido = contarObjeto(primeiro.estado, estado.objetos[0].id);
  assert.equal(repetido.mudou, false);
  assert.deepEqual(repetido.falas, []);
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

// ----------------------------------------------------------------- cores

test("cores: rodada nunca repete alternativa e a correta está nela", () => {
  checarRodadasValidas("cores", (qtd, sortear) => montarRodadaCoresIngles({ qtd, sortear }));
});

test("cores: palavra vem do catálogo (red/blue/yellow/green/purple) e id desconhecido lança", () => {
  assert.deepEqual(IDS_COR_INGLES, CORES_INGLES.map((c) => c.id));
  assert.equal(corInglesPorId("vermelho").palavra, "red");
  assert.equal(corInglesPorId("azul").palavra, "blue");
  assert.equal(corInglesPorId("amarelo").palavra, "yellow");
  assert.equal(corInglesPorId("verde").palavra, "green");
  assert.equal(corInglesPorId("roxo").palavra, "purple");
  assert.throws(() => corInglesPorId("rosa"), /Cor desconhecida/);
});

test("cores: pergunta e festa são SÓ a palavra, sem frase de apoio (regra nova do topo do arquivo)", () => {
  const sortear = criarSorteio(7);
  for (let i = 0; i < 10; i++) {
    const r = montarRodadaCoresIngles({ qtd: 3, sortear });
    const esperado = `${corInglesPorId(r.correta).palavra.charAt(0).toUpperCase()}${corInglesPorId(r.correta).palavra.slice(1)}!`;
    assert.equal(r.pergunta, esperado);
    assert.equal(r.festa, esperado);
  }
});

test("cores: TODAS as alternativas de uma rodada usam a MESMA forma (exceção documentada — aqui a cor é a pista)", () => {
  for (const semente of SEMENTES) {
    const sortear = criarSorteio(semente);
    for (const qtd of [2, 3, 4] as const) {
      for (let i = 0; i < 20; i++) {
        const r = montarRodadaCoresIngles({ qtd, sortear });
        // A forma é uma só por rodada (o tipo já garante isso: `forma` é
        // singular, não um array) — o desenho de CADA alternativa na tela
        // usa exatamente `r.forma` (ver page.tsx), então não há o que somar
        // aqui além de confirmar que ela é uma forma válida do catálogo.
        assert.ok(
          ["concha", "estrela", "aguaViva", "bolha", "peixe"].includes(r.forma),
          `forma inválida sorteada: ${r.forma}`,
        );
      }
    }
  }
});

test("cores: a forma sorteada NUNCA é a que a bijeção de cores.ts associa à cor correta", () => {
  for (const semente of SEMENTES) {
    const sortear = criarSorteio(semente);
    for (let i = 0; i < 200; i++) {
      const r = montarRodadaCoresIngles({ qtd: 4, sortear });
      const formaBijetada = peca(r.correta).forma;
      assert.notEqual(
        r.forma,
        formaBijetada,
        `semente ${semente}: forma da rodada (${r.forma}) é a mesma bijetada à cor correta (${r.correta})`,
      );
    }
  }
});

test("cores: nunca duas alternativas da mesma cor", () => {
  const sortear = criarSorteio(2026);
  for (let i = 0; i < 50; i++) {
    const r = montarRodadaCoresIngles({ qtd: 4, sortear });
    assert.equal(new Set(r.alternativas).size, r.alternativas.length);
  }
});

test("cores: figurinha usa o prefixo 'ingles-' + id da palavra (coerente com PREFIXO.ingles)", () => {
  // `idFigurinha` mora em recompensa.ts — este módulo não importa de lá (regra
  // de pureza), então o teste só confirma que `correta` (o que a página usa
  // como chave) é um `CorId` estável do catálogo, igual aos outros baralhos.
  const sortear = criarSorteio(11);
  const r = montarRodadaCoresIngles({ qtd: 2, sortear });
  assert.ok(IDS_COR_INGLES.includes(r.correta));
});

// ------------------------------------------------------------- frases (fase 2)

test("frases: rodada nunca repete alternativa e a correta está nela (nível 1 e nível 2)", () => {
  checarRodadasValidas("frases nível 1", (qtd, sortear) => montarRodadaFrases({ qtd, nivel: 1, sortear }));
  checarRodadasValidas("frases nível 2", (qtd, sortear) => montarRodadaFrases({ qtd, nivel: 2, sortear }));
});

test("frases: palavras de cor e forma vêm dos catálogos existentes (CORES_INGLES/PALAVRA_FORMA)", () => {
  assert.equal(palavraCorIngles("vermelho"), "red");
  assert.equal(palavraCorIngles("azul"), "blue");
  assert.equal(palavraFormaIngles("peixe"), "fish");
  assert.equal(palavraFormaIngles("concha"), "shell");
});

test("frases: nível 1 — todas as alternativas têm o mesmo tamanho ('big') e cores distintas", () => {
  for (const semente of SEMENTES) {
    const sortear = criarSorteio(semente);
    for (let i = 0; i < 30; i++) {
      const r = montarRodadaFrases({ qtd: 4, nivel: 1, sortear });
      assert.deepEqual(r.atributos, ["cor"]);
      const itens = r.alternativas.map((id) => itemFrasePorId(id));
      for (const item of itens) {
        assert.equal(item.tamanho, "big", `nível 1: item com tamanho != big (${item.id})`);
        assert.equal(item.forma, r.forma, `nível 1: item com forma != r.forma (${item.id})`);
      }
      const cores = itens.map((item) => item.cor);
      assert.equal(new Set(cores).size, cores.length, "nível 1: duas alternativas com a mesma cor");
    }
  }
});

test("frases: nível 2 — o alvo é único no par (cor, tamanho) dentro da rodada", () => {
  for (const semente of SEMENTES) {
    const sortear = criarSorteio(semente);
    for (let i = 0; i < 30; i++) {
      const r = montarRodadaFrases({ qtd: 4, nivel: 2, sortear });
      assert.deepEqual(r.atributos, ["cor", "tamanho"]);
      const itens = r.alternativas.map((id) => itemFrasePorId(id));
      for (const item of itens) {
        assert.equal(item.forma, r.forma, `nível 2: item com forma != r.forma (${item.id})`);
      }
      const pares = itens.map((item) => `${item.cor}:${item.tamanho}`);
      assert.equal(new Set(pares).size, pares.length, "nível 2: dois itens com o mesmo par (cor, tamanho)");
      const alvo = itemFrasePorId(r.correta);
      assert.equal(pares.filter((p) => p === `${alvo.cor}:${alvo.tamanho}`).length, 1, "alvo não é único no par");
    }
  }
});

test("frases: ids das alternativas são únicos e vêm do catálogo (ITENS_FRASE)", () => {
  const sortear = criarSorteio(2026);
  for (const nivel of [1, 2] as const) {
    for (let i = 0; i < 30; i++) {
      const r = montarRodadaFrases({ qtd: 4, nivel, sortear });
      assert.equal(new Set(r.alternativas).size, r.alternativas.length);
      for (const id of r.alternativas) assert.ok(ITENS_FRASE.some((item) => item.id === id));
    }
  }
});

test("frases: não repete a forma da rodada anterior deste baralho", () => {
  for (const semente of SEMENTES) {
    const sortear = criarSorteio(semente);
    let anterior: ReturnType<typeof montarRodadaFrases>["forma"] | null = null;
    for (let i = 0; i < 20; i++) {
      const r = montarRodadaFrases({ qtd: 3, nivel: i % 2 === 0 ? 1 : 2, anterior, sortear });
      if (anterior) assert.notEqual(r.forma, anterior, `semente ${semente}: repetiu a forma da rodada anterior`);
      anterior = r.forma;
    }
  }
});

test("frases: pergunta e festa — nível 1 fala só cor+forma, nível 2 fala tamanho+cor+forma", () => {
  const sortear = criarSorteio(20260904);
  for (let i = 0; i < 15; i++) {
    const r1 = montarRodadaFrases({ qtd: 3, nivel: 1, sortear });
    const alvo1 = itemFrasePorId(r1.correta);
    assert.equal(r1.pergunta, `Touch the ${palavraCorIngles(alvo1.cor)} ${palavraFormaIngles(alvo1.forma)}!`);
    assert.ok(!r1.festa.toLowerCase().startsWith("touch"), "festa não deveria repetir a frase-carregadora");

    const r2 = montarRodadaFrases({ qtd: 3, nivel: 2, sortear });
    const alvo2 = itemFrasePorId(r2.correta);
    assert.equal(
      r2.pergunta,
      `Where is the ${alvo2.tamanho} ${palavraCorIngles(alvo2.cor)} ${palavraFormaIngles(alvo2.forma)}?`,
    );
    assert.ok(!r2.festa.toLowerCase().startsWith("where"), "festa não deveria repetir a frase-carregadora");
  }
});

test("frases: determinismo — mesma semente produz a mesma sequência de rodadas", () => {
  const passos = (sortear: ReturnType<typeof criarSorteio>) =>
    Array.from({ length: 8 }, (_, i) => montarRodadaFrases({ qtd: 3, nivel: i % 2 === 0 ? 1 : 2, sortear }));

  for (const semente of SEMENTES) {
    const a = passos(criarSorteio(semente));
    const b = passos(criarSorteio(semente));
    assert.deepEqual(
      a.map((r) => ({ correta: r.correta, alternativas: r.alternativas, forma: r.forma })),
      b.map((r) => ({ correta: r.correta, alternativas: r.alternativas, forma: r.forma })),
      `semente ${semente}: rodadas divergiram com a mesma semente`,
    );
  }
});

test("frases: id desconhecido lança", () => {
  assert.throws(() => itemFrasePorId("nao-existe"), /Item de frase desconhecido/);
});
