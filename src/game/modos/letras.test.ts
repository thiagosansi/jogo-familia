/**
 * Testes do modo "letras" (som inicial + cadê a letra). Node puro, nenhum DOM:
 *
 *   node --test --experimental-strip-types src/game/modos/letras.test.ts
 *
 * Foco: NENHUMA rodada tem duas alternativas com a mesma letra inicial (a
 * regra de ouro do módulo — ver o cabeçalho de `letras.ts`), a prioridade de
 * âncora (criança > família > figura) e a normalização de acento/caixa.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { continuar, criarRodada, tocar } from "../engine.ts";
import { dificuldadeInicial, registrarAcerto } from "../dificuldade.ts";
import {
  ALFABETO,
  FIGURAS,
  LETRAS_FIGURAS,
  ancorasDe,
  criarSorteio,
  figuraPorId,
  letrasDistintas,
  montarRodadaCadeLetra,
  montarRodadaSomInicial,
  normalizarLetra,
  validarCatalogoLetras,
  type AncoraLetra,
} from "./letras.ts";

/** Especificadores importados por um módulo (para provar que nada vem do IndexedDB). */
function importsDe(fonte: string): string[] {
  return [...fonte.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
}

// ------------------------------------------------------------------ catálogo

test("o catálogo de letras é válido: ids únicos, letras bem formadas, desenhos existentes", () => {
  assert.equal(validarCatalogoLetras(), true);
  assert.equal(new Set(FIGURAS.map((f) => f.id)).size, FIGURAS.length, "id repetido");
  for (const f of FIGURAS) {
    assert.match(f.letra, /^[A-Z]$/, `letra malformada em ${f.id}`);
  }
  // Oito letras distintas — pool de sobra para o teto de 6 alternativas.
  assert.ok(LETRAS_FIGURAS.length >= 6, "catálogo pequeno demais para o teto de dificuldade");
  assert.deepEqual([...LETRAS_FIGURAS].sort(), ["A", "B", "C", "E", "G", "O", "P", "V"]);
});

test("figuraPorId acha pelo id e rejeita id desconhecido", () => {
  assert.equal(figuraPorId("forma-peixe").nome, "peixinho");
  assert.throws(() => figuraPorId("forma-tubarao"), /desconhecida/i);
});

test("ALFABETO tem as 26 letras, sem repetição", () => {
  assert.equal(ALFABETO.length, 26);
  assert.equal(new Set(ALFABETO).size, 26);
  assert.equal(ALFABETO[0], "A");
  assert.equal(ALFABETO[25], "Z");
});

// -------------------------------------------------------- normalização

test("normalizarLetra: maiúscula, sem acento, primeira letra só", () => {
  assert.equal(normalizarLetra("mamãe"), "M");
  assert.equal(normalizarLetra("Ângela"), "A");
  assert.equal(normalizarLetra("Zoë"), "Z");
  assert.equal(normalizarLetra("Çafa"), "C");
  assert.equal(normalizarLetra("ana clara"), "A");
  assert.equal(normalizarLetra("Ana-Clara"), "A");
  assert.equal(normalizarLetra("  bia"), "B");
});

test("normalizarLetra: sem letra válida devolve null (vazio, espaço, símbolo/número)", () => {
  assert.equal(normalizarLetra(""), null);
  assert.equal(normalizarLetra("   "), null);
  assert.equal(normalizarLetra("7"), null);
  assert.equal(normalizarLetra("!"), null);
});

// -------------------------------------------------- som inicial: sem ambiguidade

test("som inicial: nenhuma rodada tem duas alternativas com a mesma letra (400 rodadas, 2 a 6 alternativas)", () => {
  const sortear = criarSorteio(20260904);
  let anterior: string | null = null;
  for (let i = 0; i < 400; i++) {
    const qtd = 2 + (i % 5); // 2..6
    const r = montarRodadaSomInicial({ qtd, anterior, sortear });
    assert.equal(r.alternativas.length, qtd);
    assert.equal(r.figuras.length, qtd);
    assert.ok(letrasDistintas(r.figuras), "duas figuras com a mesma letra na tela");
    assert.equal(new Set(r.alternativas).size, r.alternativas.length, "id repetido na rodada");
    assert.ok(r.alternativas.includes(r.correta), "a correta tem que estar na tela");
    assert.equal(figuraPorId(r.correta).letra, r.letra, "a letra da rodada bate com a da figura correta");
    assert.ok(r.pergunta.includes(r.letra), `pergunta "${r.pergunta}" não menciona a letra ${r.letra}`);
    assert.ok(r.festa.startsWith("Isso! "));
    anterior = r.letra;
  }
});

test("som inicial: a pergunta e a festa nunca falam sílaba isolada — só a letra inteira ou a palavra inteira", () => {
  const sortear = criarSorteio(3);
  for (let i = 0; i < 30; i++) {
    const r = montarRodadaSomInicial({ qtd: 3, sortear });
    assert.equal(r.pergunta, `Qual começa com a letra ${r.letra}?`);
    const figura = figuraPorId(r.correta);
    assert.equal(r.festa, `Isso! ${figura.nome.charAt(0).toUpperCase()}${figura.nome.slice(1)} começa com ${r.letra}!`);
  }
});

test("som inicial: proximaLetra nunca repete a letra da rodada anterior", () => {
  const sortear = criarSorteio(11);
  let anterior: string | null = null;
  for (let i = 0; i < 100; i++) {
    const r = montarRodadaSomInicial({ qtd: 2, anterior, sortear });
    if (anterior) assert.notEqual(r.letra, anterior, "letra-alvo repetida duas rodadas seguidas");
    anterior = r.letra;
  }
});

test("som inicial: qtd fora do intervalo é limitada (nunca menos de 2, nunca mais que o catálogo)", () => {
  const sortear = criarSorteio(5);
  assert.equal(montarRodadaSomInicial({ qtd: 0, sortear }).alternativas.length, 2);
  assert.equal(montarRodadaSomInicial({ qtd: 99, sortear }).alternativas.length, LETRAS_FIGURAS.length);
});

// --------------------------------------------------------------- âncoras

test("ancorasDe: prioridade criança > família > figura, uma âncora por letra", () => {
  const ancoras = ancorasDe(["Mamãe", "Papai"], "Mateus");
  const porLetra = new Map(ancoras.map((a) => [a.letra, a]));
  // "Mateus" (criança) e "Mamãe" (família) começam com M — a criança vence.
  assert.equal(porLetra.get("M")?.fonte, "crianca");
  assert.equal(porLetra.get("M")?.palavra, "Mateus");
  // "Papai" (família) não tem concorrente da criança — família vence a figura.
  assert.equal(porLetra.get("P")?.fonte, "familia");
  assert.equal(porLetra.get("P")?.palavra, "Papai");
});

test("ancorasDe: sem nomeCrianca e sem família, cai inteiro para as figuras do catálogo", () => {
  const ancoras = ancorasDe([]);
  assert.ok(ancoras.length >= 6, "precisa sobrar âncora suficiente para o teto de dificuldade");
  for (const a of ancoras) {
    assert.equal(a.fonte, "figura");
    assert.ok(a.palavra.length > 0, "toda âncora tem palavra");
  }
});

test("ancorasDe: toda âncora tem palavra e letra bem formada, mesmo com nomes acentuados/compostos", () => {
  const ancoras = ancorasDe(["Ângela", "José", "Ana Clara"], "Zoë");
  for (const a of ancoras) {
    assert.match(a.letra, /^[A-Z]$/, `letra malformada: ${JSON.stringify(a)}`);
    assert.ok(a.palavra.trim().length > 0, "âncora sem palavra");
  }
  const porLetra = new Map(ancoras.map((a) => [a.letra, a]));
  // "Ângela" vem antes de "Ana Clara" na lista — dentro da MESMA fonte
  // (família), a primeira a cobrir a letra vence (ver `ancorasDe`).
  assert.equal(porLetra.get("A")?.palavra, "Ângela");
  assert.equal(porLetra.get("J")?.palavra, "José");
  assert.equal(porLetra.get("Z")?.palavra, "Zoë");
});

test("ancorasDe: nome sem letra válida (vazio, símbolo) é descartado sem quebrar", () => {
  const ancoras = ancorasDe(["", "   ", "7up"], "");
  // "7up" começa com dígito -> sem âncora; nomeCrianca "" -> ignorado.
  assert.ok(ancoras.every((a) => a.fonte === "figura"));
});

test("ancorasDe: nome da criança sem NENHUMA família cadastrada ainda ancora letras fora do catálogo de figuras (ex.: L de Lucas)", () => {
  // "Sem família cadastrada" (edge case do DoD): `nomes` vem vazio, só
  // `nomeCrianca` existe — e ele sozinho alcança uma letra que nenhuma
  // figura do catálogo cobre (ver `LETRAS_FIGURAS`: A, B, C, E, G, O, P, V).
  assert.ok(!LETRAS_FIGURAS.includes("L"), "teste pressupõe que L não vem do catálogo de figuras");
  const ancoras = ancorasDe([], "Lucas");
  const l = ancoras.find((a) => a.letra === "L");
  assert.deepEqual(l, { letra: "L", palavra: "Lucas", fonte: "crianca" });

  // E essa âncora é jogável de verdade em "Cadê a letra?": forçando o
  // sorteio a cair nela (única âncora do pool), a rodada usa exatamente essa
  // letra como `correta` — é o que a página grava como `idFigurinha("letras", "L")`
  // ("letra-L", ver `@/game/recompensa`).
  const rodadaSoL = montarRodadaCadeLetra({ ancoras: [l!], qtd: 4, sortear: criarSorteio(1) });
  assert.equal(rodadaSoL.correta, "L");
  assert.equal(rodadaSoL.festa, "Isso! L de Lucas!");
});

test("ancorasDe: cada letra aparece no máximo uma vez", () => {
  const ancoras = ancorasDe(["Ana", "Alice", "André"], "Arthur");
  const letras = ancoras.map((a) => a.letra);
  assert.equal(new Set(letras).size, letras.length);
});

// ------------------------------------------------------------- cadê a letra

test("cadê a letra: alternativas nunca compartilham letra (vêm do alfabeto, únicas por construção)", () => {
  const ancoras = ancorasDe([]);
  const sortear = criarSorteio(20260905);
  let anterior: string | null = null;
  for (let i = 0; i < 300; i++) {
    const qtd = 2 + (i % 5);
    const r = montarRodadaCadeLetra({ ancoras, qtd, anterior, sortear });
    assert.equal(r.alternativas.length, qtd);
    assert.equal(new Set(r.alternativas).size, r.alternativas.length, "letra repetida na rodada");
    assert.ok(r.alternativas.includes(r.correta));
    assert.equal(r.correta, r.ancora.letra);
    assert.equal(r.pergunta, `Cadê a letra ${r.correta}?`);
    assert.equal(r.festa, `Isso! ${r.correta} de ${r.ancora.palavra}!`);
    anterior = r.correta;
  }
});

test("cadê a letra: nunca repete a letra-alvo da rodada anterior (quando há mais de uma âncora)", () => {
  const ancoras = ancorasDe([]);
  const sortear = criarSorteio(21);
  let anterior: string | null = null;
  for (let i = 0; i < 100; i++) {
    const r = montarRodadaCadeLetra({ ancoras, qtd: 3, anterior, sortear });
    if (anterior) assert.notEqual(r.correta, anterior);
    anterior = r.correta;
  }
});

test("cadê a letra: com uma única âncora, a mesma letra pode voltar (não trava o jogo)", () => {
  const unica: readonly AncoraLetra[] = [{ letra: "M", palavra: "Mamãe", fonte: "familia" }];
  const sortear = criarSorteio(1);
  const r1 = montarRodadaCadeLetra({ ancoras: unica, qtd: 4, anterior: "M", sortear });
  assert.equal(r1.correta, "M");
});

test("cadê a letra: sem nenhuma âncora, lança em vez de montar uma rodada quebrada", () => {
  assert.throws(() => montarRodadaCadeLetra({ ancoras: [], qtd: 3 }), /nenhuma âncora/i);
});

test("cadê a letra: qtd fora do intervalo é limitada a 2..6", () => {
  const ancoras = ancorasDe([]);
  const sortear = criarSorteio(2);
  assert.equal(montarRodadaCadeLetra({ ancoras, qtd: 0, sortear }).alternativas.length, 2);
  assert.equal(montarRodadaCadeLetra({ ancoras, qtd: 99, sortear }).alternativas.length, 6);
});

// ------------------------------------------------------------ determinismo

test("mesma semente produz a mesma sequência de rodadas (som inicial e cadê a letra)", () => {
  const ancoras = ancorasDe(["Mamãe", "Papai"], "Bia");
  for (const semente of [1, 42, 999]) {
    const a = [];
    const b = [];
    let sortearA = criarSorteio(semente);
    let sortearB = criarSorteio(semente);
    for (let i = 0; i < 10; i++) {
      a.push(montarRodadaSomInicial({ qtd: 4, sortear: sortearA }));
      b.push(montarRodadaSomInicial({ qtd: 4, sortear: sortearB }));
    }
    assert.deepEqual(a, b, `som inicial diverge para a semente ${semente}`);

    sortearA = criarSorteio(semente);
    sortearB = criarSorteio(semente);
    const c = [];
    const d = [];
    for (let i = 0; i < 10; i++) {
      c.push(montarRodadaCadeLetra({ ancoras, qtd: 4, sortear: sortearA }));
      d.push(montarRodadaCadeLetra({ ancoras, qtd: 4, sortear: sortearB }));
    }
    assert.deepEqual(c, d, `cadê a letra diverge para a semente ${semente}`);
  }
});

// ------------------------------------------------- integração com o engine

test("as duas rodadas são jogáveis no engine sem-derrota", () => {
  const sortear = criarSorteio(70);
  const ancoras = ancorasDe([]);
  let dif = dificuldadeInicial(2, 6);
  let anteriorSom: string | null = null;
  let anteriorCade: string | null = null;

  for (let i = 0; i < 15; i++) {
    const rs = montarRodadaSomInicial({ qtd: dif.alternativas, anterior: anteriorSom, sortear });
    let estado = criarRodada({
      pergunta: rs.pergunta,
      alternativas: rs.alternativas,
      correta: rs.correta,
      festa: rs.festa,
      em: 0,
    });
    const erradaSom = rs.alternativas.find((id) => id !== rs.correta)!;
    const erro = tocar(estado, erradaSom, 1000);
    assert.equal(erro.estado.fase, "quaseLa");
    const volta = continuar(erro.estado, 2000);
    assert.equal(volta.estado.fase, "perguntando");
    const acerto = tocar(volta.estado, rs.correta, 3000);
    assert.equal(acerto.estado.fase, "acertou");
    anteriorSom = rs.letra;

    const rc = montarRodadaCadeLetra({ ancoras, qtd: dif.alternativas, anterior: anteriorCade, sortear });
    estado = criarRodada({
      pergunta: rc.pergunta,
      alternativas: rc.alternativas,
      correta: rc.correta,
      festa: rc.festa,
      em: 0,
    });
    const acertoDireto = tocar(estado, rc.correta, 4000);
    assert.equal(acertoDireto.estado.fase, "acertou");
    assert.equal(acertoDireto.falas[0].texto, rc.festa);
    anteriorCade = rc.correta;

    dif = registrarAcerto(dif);
  }
  assert.equal(dif.alternativas, 6, "a dificuldade sobe até o teto de 6");
});

// --------------------------------------- funciona sem nada cadastrado

test("o conteúdo é autossuficiente: não depende de personagens, fotos ou IndexedDB", () => {
  const imports = importsDe(readFileSync(new URL("./letras.ts", import.meta.url), "utf8"));
  assert.deepEqual(
    imports.filter((i) => !i.startsWith("@/")),
    ["../dificuldade.ts", "./animais.ts", "./cores.ts"],
    "o catálogo não importa db/fotos/vozes em runtime",
  );
  // "Cadê a letra?" funciona com âncoras só das figuras (sem família, sem nome da criança).
  const ancoras = ancorasDe([]);
  const r = montarRodadaCadeLetra({ ancoras, qtd: 3, sortear: criarSorteio(1) });
  assert.equal(typeof r.correta, "string");
});
