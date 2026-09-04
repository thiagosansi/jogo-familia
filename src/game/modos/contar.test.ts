/**
 * Testes do modo "contar de 1 a 10". Node puro, nenhum DOM:
 *
 *   node --test --experimental-strip-types src/game/modos/contar.test.ts
 *
 * Foco: nunca passar de 10 (o teto subiu de 5 quando a criança fez 5 anos —
 * ver o cabeçalho de `contar.ts`), começar a progressão em 1 mesmo assim,
 * falar o número a cada toque e o total no fim, e NUNCA contar duas vezes o
 * mesmo bichinho.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { criarSorteio } from "./cores.ts";
import {
  MAX_CONTAGEM,
  MIN_CONTAGEM,
  NUMEROS,
  comemorar,
  contagemCompleta,
  contarObjeto,
  corDaForma,
  criarContagem,
  falaDoTotal,
  jaContado,
  limitarQuantidade,
  numeroPorExtenso,
  proximaRodadaContar,
  quantidadeContada,
  repetirPergunta,
  type EstadoContagem,
} from "./contar.ts";

const SORTEAR = criarSorteio(20260902);

function contarTudo(estado: EstadoContagem) {
  const falado: string[] = [];
  let atual = estado;
  for (const objeto of estado.objetos) {
    const t = contarObjeto(atual, objeto.id);
    assert.equal(t.mudou, true, `toque em ${objeto.id} deveria contar`);
    for (const f of t.falas) falado.push(f.texto);
    atual = t.estado;
  }
  return { estado: atual, falado };
}

// --------------------------------------------------- nunca passa de 10

test("a contagem nunca passa de 10, venha de onde vier a quantidade", () => {
  assert.equal(MAX_CONTAGEM, 10, "o teto do modo Contar é 10 (era 5 aos 3 anos)");
  for (const pedido of [0, -3, 1, 5, 10, 11, 42, Number.NaN, 3.4]) {
    const estado = criarContagem({ quantidade: pedido, sortear: SORTEAR });
    assert.ok(
      estado.objetos.length >= MIN_CONTAGEM && estado.objetos.length <= MAX_CONTAGEM,
      `quantidade ${pedido} virou ${estado.objetos.length} objetos`,
    );
  }
  assert.equal(limitarQuantidade(99), 10);
  assert.equal(limitarQuantidade(0), 1);
  // Quem pede um teto MENOR continua sendo respeitado (o motor é injetável).
  assert.equal(limitarQuantidade(99, 5), 5);
});

test("a progressão de rodadas começa em 1, sobe até 10 e nunca ultrapassa", () => {
  let rodada = proximaRodadaContar(null, SORTEAR);
  assert.equal(rodada.quantidade, 1, "a primeira rodada começa com 1 bichinho");
  const vistos: number[] = [rodada.quantidade];

  for (let i = 0; i < 400; i++) {
    const anterior = rodada;
    rodada = proximaRodadaContar(anterior, SORTEAR);
    assert.ok(
      rodada.quantidade >= MIN_CONTAGEM && rodada.quantidade <= MAX_CONTAGEM,
      `rodada com ${rodada.quantidade} bichinhos`,
    );
    assert.notEqual(rodada.forma, anterior.forma, "a silhueta muda a cada rodada");
    vistos.push(rodada.quantidade);
  }
  assert.deepEqual(
    vistos.slice(0, 10),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    "progressão crescente de 1 em 1 até o teto",
  );
  assert.equal(Math.max(...vistos), 10);
  // Depois do teto o pool é 2..10 — nunca volta para 1 (seria sem graça).
  assert.equal(
    vistos.slice(10).includes(1),
    false,
    "chegando no teto, o sorteio nunca devolve 1",
  );
  // E, ao longo de 400 rodadas, o sorteio cobre a faixa inteira acima de 5:
  // é o que garante que o teto novo não ficou só no `limitarQuantidade`.
  for (const n of [6, 7, 8, 9, 10]) {
    assert.ok(vistos.includes(n), `a quantidade ${n} tem que aparecer em alguma rodada`);
  }
});

// ------------------------------------------ fala o número e depois o total

test("cada toque fala o número em pt-BR, na ordem, e o último fala o total", () => {
  const estado = criarContagem({ quantidade: MAX_CONTAGEM, forma: "peixe", sortear: SORTEAR });
  const { estado: fim, falado } = contarTudo(estado);

  assert.deepEqual(falado, [
    "um",
    "dois",
    "três",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
    "dez",
    "São dez peixinhos!",
  ]);
  assert.equal(fim.fase, "total");
  assert.equal(contagemCompleta(fim), true);
  assert.equal(quantidadeContada(fim), 10);
});

test("o número sai com prioridade alta e o total entra na fila depois dele", () => {
  const estado = criarContagem({ quantidade: 2, forma: "concha", sortear: SORTEAR });
  const primeiro = contarObjeto(estado, "obj-1");
  assert.deepEqual(
    primeiro.falas.map((f) => [f.texto, f.prioridade]),
    [["um", "alta"]],
  );

  const segundo = contarObjeto(primeiro.estado, "obj-2");
  assert.deepEqual(
    segundo.falas.map((f) => [f.texto, f.prioridade]),
    [
      ["dois", "alta"],
      ["São duas conchas!", "normal"],
    ],
    "o total não pode cortar o último número",
  );
});

test("o total concorda em gênero e número (pt-BR)", () => {
  assert.equal(falaDoTotal(1, "peixe"), "É um peixinho!");
  assert.equal(falaDoTotal(1, "concha"), "É uma concha!");
  assert.equal(falaDoTotal(2, "concha"), "São duas conchas!");
  assert.equal(falaDoTotal(3, "estrela"), "São três estrelas do mar!");
  assert.equal(falaDoTotal(4, "aguaViva"), "São quatro águas-vivas!");
  assert.equal(falaDoTotal(5, "bolha"), "São cinco bolhas!");
  assert.equal(falaDoTotal(7, "peixe"), "São sete peixinhos!");
  assert.equal(falaDoTotal(10, "concha"), "São dez conchas!");
  // Mesmo pedindo além do teto, a frase fica em 10.
  assert.equal(falaDoTotal(42, "bolha"), "São dez bolhas!");
  assert.deepEqual(
    [...NUMEROS],
    ["um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"],
  );
  assert.equal(NUMEROS.length, MAX_CONTAGEM, "uma palavra por número até o teto");
});

test("numeroPorExtenso concorda em gênero e nunca devolve `undefined`", () => {
  // A forma canônica (masculina) é o padrão: é assim que se conta em voz alta.
  assert.equal(numeroPorExtenso(1), "um");
  assert.equal(numeroPorExtenso(2), "dois");
  assert.equal(numeroPorExtenso(1, "f"), "uma");
  assert.equal(numeroPorExtenso(2, "f"), "duas");
  // De três em diante o número é invariável nos dois gêneros.
  for (let n = 3; n <= MAX_CONTAGEM; n++) {
    assert.equal(numeroPorExtenso(n, "m"), numeroPorExtenso(n, "f"), `${n} é invariável`);
  }
  assert.equal(numeroPorExtenso(10), "dez");
  // Fora da faixa cai no algarismo em vez de `undefined` — não existe rodada
  // assim, mas nada aqui pode chegar quebrado na frente da criança.
  assert.equal(numeroPorExtenso(0), "0");
  assert.equal(numeroPorExtenso(11), "11");
});

test("rodada de 1 objeto fala o número e o total no mesmo toque", () => {
  const estado = criarContagem({ quantidade: 1, forma: "peixe", sortear: SORTEAR });
  const t = contarObjeto(estado, "obj-1");
  assert.deepEqual(
    t.falas.map((f) => f.texto),
    ["um", "É um peixinho!"],
  );
  assert.equal(t.estado.fase, "total");
});

// ------------------------------------- duplo toque não conta duas vezes

test("tocar duas vezes no MESMO objeto não incrementa a contagem nem fala de novo", () => {
  const estado = criarContagem({ quantidade: 3, forma: "peixe", sortear: SORTEAR });

  const primeiro = contarObjeto(estado, "obj-1");
  assert.equal(primeiro.mudou, true);
  assert.equal(quantidadeContada(primeiro.estado), 1);
  assert.equal(jaContado(primeiro.estado, "obj-1"), true);

  // Martelando o mesmo bichinho 10 vezes: nada muda, nada fala.
  let atual = primeiro.estado;
  for (let i = 0; i < 10; i++) {
    const repetido = contarObjeto(atual, "obj-1");
    assert.equal(repetido.mudou, false, `toque repetido ${i} não pode contar`);
    assert.deepEqual(repetido.falas, [], "toque repetido não fala");
    assert.equal(repetido.estado, atual, "estado intacto (mesma referência)");
    assert.equal(quantidadeContada(repetido.estado), 1);
    assert.equal(repetido.estado.versao, primeiro.estado.versao, "sem transição extra");
    atual = repetido.estado;
  }

  // E a contagem continua normalmente nos outros bichinhos.
  const segundo = contarObjeto(atual, "obj-2");
  assert.equal(segundo.falas[0].texto, "dois");
  assert.equal(quantidadeContada(segundo.estado), 2);
});

test("objeto inexistente e toque depois do total são ignorados", () => {
  const estado = criarContagem({ quantidade: 2, forma: "bolha", sortear: SORTEAR });
  assert.equal(contarObjeto(estado, "obj-99").mudou, false);

  const { estado: fim } = contarTudo(estado);
  const depois = contarObjeto(fim, "obj-1");
  assert.equal(depois.mudou, false, "não conta nada depois do total");
  assert.deepEqual(depois.falas, []);
});

test("a ordem dos toques é livre — a criança conta do fim para o começo", () => {
  const estado = criarContagem({ quantidade: 4, forma: "estrela", sortear: SORTEAR });
  const ordem = ["obj-4", "obj-2", "obj-3", "obj-1"];
  let atual = estado;
  const falado: string[] = [];
  for (const id of ordem) {
    const t = contarObjeto(atual, id);
    assert.equal(t.mudou, true);
    for (const f of t.falas) falado.push(f.texto);
    atual = t.estado;
  }
  assert.deepEqual(falado, ["um", "dois", "três", "quatro", "São quatro estrelas do mar!"]);
  assert.deepEqual([...atual.contados], ordem, "a ordem tocada é preservada");
});

// ------------------------------------------------------ fim da rodada

test("comemorar só sai de `total` e não existe fase de derrota", () => {
  const estado = criarContagem({ quantidade: 2, forma: "peixe", sortear: SORTEAR });
  assert.equal(comemorar(estado).mudou, false, "não comemora no meio da contagem");

  const { estado: fim } = contarTudo(estado);
  const festa = comemorar(fim);
  assert.equal(festa.mudou, true);
  assert.equal(festa.estado.fase, "festa");
  assert.equal(festa.falas[0].texto, "Muito bem!");
  assert.equal(comemorar(festa.estado).mudou, false, "não comemora duas vezes");

  for (const fase of [estado.fase, fim.fase, festa.estado.fase]) {
    assert.doesNotMatch(fase, /derrot|perde|errou|game.?over/i);
  }
});

test("repetir a pergunta fala de novo sem mexer na contagem", () => {
  const estado = criarContagem({ quantidade: 3, forma: "concha", sortear: SORTEAR });
  const r = repetirPergunta(estado);
  assert.equal(r.mudou, false);
  assert.equal(r.falas[0].texto, "Vamos contar as conchas!");
  assert.equal(r.falas[0].prioridade, "alta");
  assert.equal(quantidadeContada(r.estado), 0);

  const masculino = criarContagem({ quantidade: 3, forma: "peixe", sortear: SORTEAR });
  assert.equal(masculino.pergunta, "Vamos contar os peixinhos!");
});

// --------------------------------------- funciona sem nada cadastrado

test("a cor de cada bichinho vem da MESMA tabela cor<->forma do modo cores", () => {
  const estado = criarContagem({ quantidade: 3, forma: "peixe", sortear: SORTEAR });
  assert.equal(estado.cor, corDaForma("peixe"));
  assert.equal(new Set(estado.objetos.map((o) => o.cor)).size, 1, "bichinhos iguais");
  assert.equal(new Set(estado.objetos.map((o) => o.id)).size, 3, "ids únicos");
});

test("o conteúdo é autossuficiente: não depende de personagens, fotos ou IndexedDB", () => {
  const fonte = readFileSync(new URL("./contar.ts", import.meta.url), "utf8");
  const imports = [...fonte.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(
    imports.sort(),
    ["../dificuldade.ts", "./cores.ts"],
    "a contagem não importa db/fotos/vozes",
  );
  const estado = criarContagem({ quantidade: 4, sortear: SORTEAR });
  assert.equal(estado.objetos.length, 4);
});
