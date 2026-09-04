/**
 * Testes do modo "cores e formas". Node puro, nenhum DOM:
 *
 *   node --test --experimental-strip-types src/game/modos/cores.test.ts
 *
 * Foco: a cor NUNCA é a única pista (bijeção cor <-> forma) e a rodada montada
 * é sempre válida para o engine sem-derrota.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { continuar, criarRodada, tocar } from "../engine.ts";
import { dificuldadeInicial, registrarAcerto } from "../dificuldade.ts";
import {
  CORES,
  FORMAS,
  IDS_COR,
  criarSorteio,
  formaDe,
  formasDistintas,
  fraseDaRodada,
  montarRodadaCores,
  nomeDaPeca,
  peca,
  proximaCor,
  validarCatalogo,
  type PecaCor,
} from "./cores.ts";

/** Especificadores importados por um módulo (para provar que nada vem do IndexedDB). */
function importsDe(fonte: string): string[] {
  return [...fonte.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
}

// -------------------------------------------- cor não pode ser a única pista

test("cada cor do catálogo tem uma forma exclusiva (bijeção cor <-> forma)", () => {
  assert.equal(validarCatalogo(), true);

  const formas = CORES.map((c) => c.forma);
  assert.equal(new Set(formas).size, formas.length, "duas cores com a mesma forma");
  assert.equal(new Set(CORES.map((c) => c.id)).size, CORES.length, "cor repetida");
  // Toda forma do catálogo de silhuetas está em uso, e vice-versa.
  assert.deepEqual([...formas].sort(), Object.keys(FORMAS).sort());
  assert.ok(CORES.length >= 2, "o modo precisa de pelo menos 2 peças para uma rodada");
});

test("catálogo com duas cores na mesma forma é rejeitado", () => {
  const quebrado: PecaCor[] = [
    { id: "azul", hex: "#000", nome: { m: "azul", f: "azul" }, forma: "concha" },
    { id: "verde", hex: "#000", nome: { m: "verde", f: "verde" }, forma: "concha" },
  ];
  assert.throws(() => validarCatalogo(quebrado), /mesma forma/i);
});

test("nenhuma rodada sorteada repete forma (300 rodadas, 2 a 4 alternativas)", () => {
  const sortear = criarSorteio(20260902);
  for (let i = 0; i < 300; i++) {
    const qtd = 2 + (i % 3);
    const rodada = montarRodadaCores({ qtd, sortear });
    assert.equal(rodada.alternativas.length, qtd, "quantidade de alternativas");
    assert.ok(formasDistintas(rodada.alternativas), "duas peças com a mesma forma na tela");
    assert.equal(
      new Set(rodada.alternativas).size,
      rodada.alternativas.length,
      "cor repetida na mesma rodada",
    );
    assert.ok(rodada.alternativas.includes(rodada.correta), "a correta tem que estar na tela");
    assert.equal(rodada.pecas.length, rodada.alternativas.length);
    assert.deepEqual(
      rodada.pecas.map((p) => p.id),
      [...rodada.alternativas],
      "as peças acompanham a ordem das alternativas",
    );
  }
});

test("a pergunta falada sempre diz a FORMA e a COR (redundância para daltonismo)", () => {
  for (const cor of CORES) {
    const frase = fraseDaRodada(cor.id);
    const forma = FORMAS[cor.forma];
    assert.ok(frase.includes(forma.singular), `${frase} não diz a forma ${forma.singular}`);
    assert.ok(
      frase.includes(cor.nome[forma.genero]),
      `${frase} não diz a cor ${cor.nome[forma.genero]}`,
    );
  }
  // Concordância de gênero em pt-BR.
  assert.equal(fraseDaRodada("azul"), "Pega a concha azul!");
  assert.equal(fraseDaRodada("amarelo"), "Pega o peixinho amarelo!");
  assert.equal(fraseDaRodada("vermelho"), "Pega a estrela do mar vermelha!");
  assert.equal(fraseDaRodada("roxo"), "Pega a bolha roxa!");
  assert.equal(nomeDaPeca("verde"), "água-viva verde");
});

test("formaDe/peca respondem por id e rejeitam id desconhecido", () => {
  assert.equal(formaDe("azul").id, "concha");
  assert.equal(peca("roxo").hex, "#b16cff");
  assert.throws(() => peca("rosa-choque"), /desconhecida/i);
});

// ------------------------------------------------- integração com o engine

test("a rodada montada é jogável no engine sem-derrota", () => {
  const sortear = criarSorteio(7);
  let dif = dificuldadeInicial();
  let anterior: (typeof IDS_COR)[number] | null = null;

  for (let i = 0; i < 20; i++) {
    const r = montarRodadaCores({ qtd: dif.alternativas, anterior, sortear });
    const estado = criarRodada({
      pergunta: r.pergunta,
      alternativas: r.alternativas,
      correta: r.correta,
      festa: r.festa,
      em: 0,
    });

    // Errar (quando há errada na tela) mantém a rodada viva; acertar encerra.
    const errada = r.alternativas.find((id) => id !== r.correta)!;
    const erro = tocar(estado, errada, 1000);
    assert.equal(erro.estado.fase, "quaseLa");

    // A careta acaba e a MESMA rodada volta — nunca há derrota.
    const volta = continuar(erro.estado, 3000);
    assert.equal(volta.estado.fase, "perguntando");

    const acerto = tocar(volta.estado, r.correta, 4000);
    assert.equal(acerto.estado.fase, "acertou");
    assert.equal(acerto.falas[0].texto, r.festa);

    anterior = r.correta;
    dif = registrarAcerto(dif);
  }
  assert.equal(dif.alternativas, 4, "a dificuldade sobe até 4 peças na tela");
});

test("proximaCor não repete o alvo da rodada anterior", () => {
  const sortear = criarSorteio(99);
  let anterior = IDS_COR[0];
  for (let i = 0; i < 100; i++) {
    const proxima = proximaCor(anterior, sortear);
    assert.notEqual(proxima, anterior, "alvo repetido duas rodadas seguidas");
    assert.ok(IDS_COR.includes(proxima));
    anterior = proxima;
  }
});

// --------------------------------------- funciona sem nada cadastrado

test("o conteúdo é autossuficiente: não depende de personagens, fotos ou IndexedDB", () => {
  const imports = importsDe(readFileSync(new URL("./cores.ts", import.meta.url), "utf8"));
  assert.deepEqual(imports, ["../dificuldade.ts"], "o catálogo não importa db/fotos/vozes");
  // Uma rodada completa sai só do catálogo desenhado.
  const r = montarRodadaCores({ qtd: 3, sortear: criarSorteio(1) });
  assert.equal(r.pecas.every((p) => typeof p.hex === "string" && p.hex.startsWith("#")), true);
});

test("qtd fora do intervalo é limitada ao tamanho do catálogo (nunca quebra a rodada)", () => {
  const sortear = criarSorteio(3);
  assert.equal(montarRodadaCores({ qtd: 0, sortear }).alternativas.length, 2);
  assert.equal(montarRodadaCores({ qtd: 99, sortear }).alternativas.length, CORES.length);
});
