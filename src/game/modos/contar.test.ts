/**
 * Testes do modo "contar de 1 a 5". Node puro, nenhum DOM:
 *
 *   node --test --experimental-strip-types src/game/modos/contar.test.ts
 *
 * Foco: nunca passar de 5, falar o número a cada toque e o total no fim, e
 * NUNCA contar duas vezes o mesmo bichinho.
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

// ---------------------------------------------------- nunca passa de 5

test("a contagem nunca passa de 5, venha de onde vier a quantidade", () => {
  assert.equal(MAX_CONTAGEM, 5);
  for (const pedido of [0, -3, 1, 5, 6, 9, 42, Number.NaN, 3.4]) {
    const estado = criarContagem({ quantidade: pedido, sortear: SORTEAR });
    assert.ok(
      estado.objetos.length >= MIN_CONTAGEM && estado.objetos.length <= MAX_CONTAGEM,
      `quantidade ${pedido} virou ${estado.objetos.length} objetos`,
    );
  }
  assert.equal(limitarQuantidade(99), 5);
  assert.equal(limitarQuantidade(0), 1);
});

test("a progressão de rodadas sobe de 1 até 5 e nunca ultrapassa", () => {
  let rodada = proximaRodadaContar(null, SORTEAR);
  assert.equal(rodada.quantidade, 1, "a primeira rodada começa com 1 bichinho");
  const vistos: number[] = [rodada.quantidade];

  for (let i = 0; i < 200; i++) {
    const anterior = rodada;
    rodada = proximaRodadaContar(anterior, SORTEAR);
    assert.ok(
      rodada.quantidade >= MIN_CONTAGEM && rodada.quantidade <= MAX_CONTAGEM,
      `rodada com ${rodada.quantidade} bichinhos`,
    );
    assert.notEqual(rodada.forma, anterior.forma, "a silhueta muda a cada rodada");
    vistos.push(rodada.quantidade);
  }
  assert.deepEqual(vistos.slice(0, 5), [1, 2, 3, 4, 5], "progressão crescente até o teto");
  assert.equal(Math.max(...vistos), 5);
});

// ------------------------------------------ fala o número e depois o total

test("cada toque fala o número em pt-BR, na ordem, e o último fala o total", () => {
  const estado = criarContagem({ quantidade: 5, forma: "peixe", sortear: SORTEAR });
  const { estado: fim, falado } = contarTudo(estado);

  assert.deepEqual(falado, [
    "um",
    "dois",
    "três",
    "quatro",
    "cinco",
    "São cinco peixinhos!",
  ]);
  assert.equal(fim.fase, "total");
  assert.equal(contagemCompleta(fim), true);
  assert.equal(quantidadeContada(fim), 5);
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
  // Mesmo pedindo além do teto, a frase fica em 5.
  assert.equal(falaDoTotal(9, "bolha"), "São cinco bolhas!");
  assert.deepEqual([...NUMEROS], ["um", "dois", "três", "quatro", "cinco"]);
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
