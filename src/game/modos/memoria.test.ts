/**
 * Testes do jogo da memória. Node puro, nenhum DOM:
 *
 *   node --test --experimental-strip-types src/game/modos/memoria.test.ts
 *
 * Foco nos invariantes do cabeçalho de `memoria.ts`: o terceiro toque durante
 * a comparação não faz nada, carta já virada/encontrada é inerte, o tabuleiro
 * só completa por pares, `proximoNivel` é monotônico e limitado a 1..3, e o
 * mesmo `sortear` devolve sempre o mesmo tabuleiro.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { criarSorteio } from "./cores.ts";
import { corDaForma } from "./contar.ts";
import {
  FALAS_QUASE,
  FALA_COMPLETO,
  FALA_PAR,
  NIVEIS,
  NIVEIS_MEMORIA,
  cartaDe,
  criarMemoria,
  estaVirada,
  jaEncontrada,
  limitarNivel,
  memoriaCompleta,
  paresRestantes,
  proximoNivel,
  repetirPergunta,
  resolver,
  virar,
  type DesenhoDisponivel,
  type EstadoMemoria,
  type NivelMemoria,
} from "./memoria.ts";

const SEMENTE = 20260904;
const sortear = () => criarSorteio(SEMENTE);

/** Baralho de teste: 5 formas + 4 mascotes + 2 pessoas = 11 desenhos. */
const BARALHO: readonly DesenhoDisponivel[] = [
  ...(["concha", "estrela", "aguaViva", "bolha", "peixe"] as const).map((forma) => ({
    par: forma,
    desenho: { tipo: "forma" as const, forma, cor: corDaForma(forma) },
    nome: forma,
  })),
  ...(["estrela", "caranguejo", "peixe", "polvo"] as const).map((mascote) => ({
    par: `mascote-${mascote}`,
    desenho: { tipo: "mascote" as const, mascote },
    nome: mascote,
  })),
  {
    par: "p1",
    desenho: { tipo: "pessoa" as const, personagemId: "p1", nome: "Mamãe" },
    nome: "Mamãe",
  },
  {
    par: "p2",
    desenho: { tipo: "pessoa" as const, personagemId: "p2", nome: "Papai" },
    nome: "Papai",
  },
];

function novo(nivel: NivelMemoria = 2): EstadoMemoria {
  return criarMemoria({ nivel, desenhos: BARALHO, sortear: sortear() });
}

/** Ids das duas cartas de um par ainda não encontrado. */
function parAberto(estado: EstadoMemoria): [string, string] {
  const par = estado.cartas.find((c) => !estado.encontradas.includes(c.par))!.par;
  const [a, b] = estado.cartas.filter((c) => c.par === par);
  return [a.id, b.id];
}

/** Duas cartas de pares DIFERENTES, ambos ainda abertos. */
function cartasDiferentes(estado: EstadoMemoria): [string, string] {
  const abertas = estado.cartas.filter((c) => !estado.encontradas.includes(c.par));
  const a = abertas[0];
  const b = abertas.find((c) => c.par !== a.par)!;
  return [a.id, b.id];
}

/** Fecha o tabuleiro inteiro só com pares certos. Devolve as falas ouvidas. */
function acharTudo(inicial: EstadoMemoria) {
  const falado: string[] = [];
  let atual = inicial;
  let guarda = 0;
  while (!memoriaCompleta(atual) && guarda++ < 50) {
    const [a, b] = parAberto(atual);
    for (const id of [a, b]) {
      const t = virar(atual, id);
      assert.equal(t.mudou, true, `virar ${id} deveria valer`);
      for (const f of t.falas) falado.push(f.texto);
      atual = t.estado;
    }
    const r = resolver(atual);
    assert.equal(r.mudou, true);
    for (const f of r.falas) falado.push(f.texto);
    atual = r.estado;
  }
  return { estado: atual, falado };
}

// ------------------------------------------------------------ tabuleiros

test("cada nível monta o tabuleiro combinado (pares duplicados, colunas certas)", () => {
  for (const nivel of NIVEIS_MEMORIA) {
    const config = NIVEIS[nivel];
    const estado = criarMemoria({ nivel, desenhos: BARALHO, sortear: sortear() });

    assert.equal(estado.cartas.length, config.pares * 2, `nível ${nivel}: total de cartas`);
    assert.equal(estado.colunas, config.colunas, `nível ${nivel}: colunas`);
    assert.equal(new Set(estado.cartas.map((c) => c.par)).size, config.pares);
    assert.equal(new Set(estado.cartas.map((c) => c.id)).size, estado.cartas.length, "ids únicos");
    for (const par of new Set(estado.cartas.map((c) => c.par))) {
      assert.equal(estado.cartas.filter((c) => c.par === par).length, 2, `par ${par} em duplicata`);
    }
    assert.equal(estado.fase, "escolhendo");
    assert.equal(estado.tentativas, 0);
    assert.deepEqual([...estado.viradas], []);
    assert.deepEqual([...estado.encontradas], []);
  }
});

test("baralho com pares repetidos ou curto demais nunca quebra o tabuleiro", () => {
  const repetido = [BARALHO[0], BARALHO[0], BARALHO[1], BARALHO[1], BARALHO[2]];
  const estado = criarMemoria({ nivel: 3, desenhos: repetido, sortear: sortear() });
  // 3 pares únicos no baralho, mesmo pedindo 6: entrega o que dá, sem lançar.
  assert.equal(new Set(estado.cartas.map((c) => c.par)).size, 3);
  assert.equal(estado.cartas.length, 6);

  const vazio = criarMemoria({ nivel: 1, desenhos: [], sortear: sortear() });
  assert.equal(vazio.cartas.length, 0);
  assert.equal(vazio.fase, "completo", "tabuleiro sem carta nasce completo, não travado");
});

test("nível fora de 1..3 é limitado, nunca lança", () => {
  for (const bruto of [0, -5, 4, 99, Number.NaN, 2.4]) {
    const n = limitarNivel(bruto);
    assert.ok(n === 1 || n === 2 || n === 3, `limitarNivel(${bruto}) = ${n}`);
  }
  assert.equal(limitarNivel(2), 2);
});

// ---------------------------------------------------------- terceiro toque

test("durante a comparação, o TERCEIRO toque é ignorado por inteiro", () => {
  const inicial = novo(3);
  const [a, b] = cartasDiferentes(inicial);
  const depoisDeDuas = virar(virar(inicial, a).estado, b).estado;

  assert.equal(depoisDeDuas.fase, "comparando");
  assert.equal(depoisDeDuas.viradas.length, 2);

  // Uma terceira carta qualquer, ainda para baixo.
  const terceira = depoisDeDuas.cartas.find((c) => c.id !== a && c.id !== b)!;
  const t = virar(depoisDeDuas, terceira.id);

  assert.equal(t.mudou, false, "terceiro toque não muda estado");
  assert.deepEqual(t.falas, [], "terceiro toque não fala nada");
  assert.equal(t.estado, depoisDeDuas, "o estado devolvido é o mesmo objeto");
  assert.equal(t.estado.viradas.length, 2, "continua com duas cartas na mesa");
  assert.equal(t.estado.tentativas, 1, "e não conta uma tentativa a mais");
});

test("carta já virada nesta jogada, carta já encontrada e id inexistente são inertes", () => {
  const inicial = novo(2);
  const [a, b] = parAberto(inicial);

  // Multi-toque na MESMA carta.
  const uma = virar(inicial, a).estado;
  const repetida = virar(uma, a);
  assert.equal(repetida.mudou, false);
  assert.deepEqual(repetida.falas, []);
  assert.equal(repetida.estado.viradas.length, 1);

  // Id que não existe no tabuleiro.
  const fantasma = virar(uma, "carta-que-nao-existe");
  assert.equal(fantasma.mudou, false);
  assert.deepEqual(fantasma.falas, []);

  // Par já encontrado: as duas cartas ficam inertes para sempre.
  const casado = resolver(virar(uma, b).estado).estado;
  assert.equal(casado.fase, "escolhendo");
  assert.ok(jaEncontrada(casado, a) && jaEncontrada(casado, b));
  for (const id of [a, b]) {
    const t = virar(casado, id);
    assert.equal(t.mudou, false, `carta encontrada ${id} deveria ser inerte`);
    assert.deepEqual(t.falas, []);
    assert.equal(estaVirada(casado, id), true, "e continua mostrada para cima");
  }
});

// ------------------------------------------------------------- comparação

test("virar duas cartas fala o nome de cada uma e conta UMA tentativa", () => {
  const inicial = novo(2);
  const [a, b] = cartasDiferentes(inicial);

  const t1 = virar(inicial, a);
  assert.equal(t1.falas.length, 1);
  assert.equal(t1.falas[0].texto, cartaDe(inicial, a)!.nome);
  assert.equal(t1.falas[0].prioridade, "alta");
  assert.equal(t1.estado.tentativas, 0, "a primeira carta ainda não é uma tentativa");

  const t2 = virar(t1.estado, b);
  assert.equal(t2.falas[0].texto, cartaDe(inicial, b)!.nome);
  assert.equal(t2.estado.tentativas, 1);
  assert.equal(t2.estado.fase, "comparando");
});

test("par errado devolve as cartas e fala INCENTIVO — nunca correção", () => {
  const inicial = novo(3);
  const [a, b] = cartasDiferentes(inicial);
  const comparando = virar(virar(inicial, a).estado, b).estado;

  const r = resolver(comparando);
  assert.equal(r.mudou, true);
  assert.deepEqual([...r.estado.viradas], [], "as duas voltam para baixo");
  assert.deepEqual([...r.estado.encontradas], [], "nada foi encontrado");
  assert.equal(r.estado.fase, "escolhendo");
  assert.equal(r.estado.tentativas, 1, "a tentativa já foi contada em virar()");

  assert.equal(r.falas.length, 1);
  assert.ok(FALAS_QUASE.includes(r.falas[0].texto), `fala inesperada: ${r.falas[0].texto}`);
  // Nenhuma fala do módulo pode acusar erro (regra de produto 1).
  for (const texto of [...FALAS_QUASE, FALA_PAR, FALA_COMPLETO]) {
    assert.doesNotMatch(texto.toLowerCase(), /err|n[ãa]o [ée]|perdeu|errado/);
  }
});

test("par certo trava as cartas para cima e fala 'Achou o par!'", () => {
  const inicial = novo(3);
  const [a, b] = parAberto(inicial);
  const comparando = virar(virar(inicial, a).estado, b).estado;

  const r = resolver(comparando);
  assert.equal(r.mudou, true);
  assert.equal(r.estado.encontradas.length, 1);
  assert.deepEqual([...r.estado.viradas], []);
  assert.equal(r.estado.fase, "escolhendo", "ainda faltam pares");
  assert.equal(r.falas[0].texto, FALA_PAR);
});

test("resolver fora de 'comparando' é inerte", () => {
  const inicial = novo(2);
  assert.equal(resolver(inicial).mudou, false, "sem carta virada");
  const uma = virar(inicial, parAberto(inicial)[0]).estado;
  assert.equal(resolver(uma).mudou, false, "com uma carta só");
  assert.equal(resolver(uma).estado, uma);
});

// ------------------------------------------------------------- conclusão

test("o tabuleiro só chega a 'completo' por pares acertados", () => {
  for (const nivel of NIVEIS_MEMORIA) {
    const inicial = criarMemoria({ nivel, desenhos: BARALHO, sortear: sortear() });
    const { estado, falado } = acharTudo(inicial);

    assert.equal(estado.fase, "completo", `nível ${nivel} deveria completar`);
    assert.equal(estado.encontradas.length, NIVEIS[nivel].pares);
    assert.equal(paresRestantes(estado), 0);
    assert.equal(falado.filter((f) => f === FALA_PAR).length, NIVEIS[nivel].pares);
    assert.equal(falado.at(-1), FALA_COMPLETO, "a festa é a última fala");
    // Todas as cartas para cima no fim.
    for (const c of estado.cartas) assert.equal(estaVirada(estado, c.id), true);
  }
});

test("tabuleiro completo não aceita mais toque e não fala pergunta de novo", () => {
  const { estado } = acharTudo(novo(1));
  for (const c of estado.cartas) assert.equal(virar(estado, c.id).mudou, false);
  assert.equal(resolver(estado).mudou, false);
  assert.deepEqual(repetirPergunta(estado).falas, [], "sem pergunta depois da festa");
});

test("repetir a pergunta fala o mesmo texto do tabuleiro, sem mudar de fase", () => {
  const inicial = novo(2);
  const t = repetirPergunta(inicial);
  assert.equal(t.mudou, false);
  assert.equal(t.estado, inicial);
  assert.equal(t.falas[0].texto, inicial.pergunta);
  assert.doesNotMatch(inicial.pergunta, /\d/, "nenhum número na pergunta");
});

// ------------------------------------------------------------- progressão

test("proximoNivel sobe com poucas tentativas, NUNCA desce e nunca passa de 3", () => {
  for (const nivel of NIVEIS_MEMORIA) {
    const pares = NIVEIS[nivel].pares;
    const inicial = criarMemoria({ nivel, desenhos: BARALHO, sortear: sortear() });

    // Jogada boa: só pares certos ⇒ tentativas === pares (<= pares + 2).
    const boa = acharTudo(inicial).estado;
    const subiu = proximoNivel(nivel, boa);
    assert.equal(subiu, limitarNivel(nivel + 1), `nível ${nivel} deveria subir`);
    assert.ok(subiu >= nivel, "nunca desce");
    assert.ok(subiu <= 3, "nunca passa de 3");

    // Jogada demorada: mesmas cartas, mas com tentativas demais.
    const demorada: EstadoMemoria = { ...boa, tentativas: pares + 3 };
    const ficou = proximoNivel(nivel, demorada);
    assert.equal(ficou, nivel, `nível ${nivel} deveria FICAR, nunca cair`);
  }
});

test("proximoNivel é monotônico em qualquer entrada, inclusive lixo", () => {
  const { estado } = acharTudo(novo(3));
  for (const bruto of [-3, 0, 1, 2, 3, 7, Number.NaN]) {
    const n = proximoNivel(bruto, estado);
    assert.ok(n === 1 || n === 2 || n === 3, `proximoNivel(${bruto}) = ${n}`);
    assert.ok(n >= limitarNivel(bruto), "nunca abaixo do nível recebido");
  }
});

test("tabuleiro ainda aberto não muda de nível", () => {
  const inicial = novo(1);
  assert.equal(proximoNivel(1, inicial), 1);
  const meio = virar(inicial, parAberto(inicial)[0]).estado;
  assert.equal(proximoNivel(2, meio), 2);
});

// ----------------------------------------------------------- determinismo

test("mesma semente, mesmo tabuleiro (nenhum Math.random escondido)", () => {
  for (const nivel of NIVEIS_MEMORIA) {
    const a = criarMemoria({ nivel, desenhos: BARALHO, sortear: criarSorteio(4242) });
    const b = criarMemoria({ nivel, desenhos: BARALHO, sortear: criarSorteio(4242) });
    assert.deepEqual(a, b, `nível ${nivel} não é determinístico`);
  }

  const outro = criarMemoria({ nivel: 3, desenhos: BARALHO, sortear: criarSorteio(9999) });
  const base = criarMemoria({ nivel: 3, desenhos: BARALHO, sortear: criarSorteio(4242) });
  assert.notDeepEqual(
    outro.cartas.map((c) => c.id),
    base.cartas.map((c) => c.id),
    "sementes diferentes deveriam dar tabuleiros diferentes",
  );
});

// ------------------------------------------------------------- vigilância

test("o módulo continua puro: nada de Date/Math.random/DOM/áudio", () => {
  const fonte = readFileSync(new URL("./memoria.ts", import.meta.url), "utf8");
  const codigo = fonte
    // Remove comentários de bloco e de linha: o cabeçalho fala de `Date.now()`
    // e `Math.random()` justamente para dizer que eles NÃO estão aqui.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const proibido of ["Date.now", "document", "window", "speechSynthesis", "Audio"]) {
    assert.ok(!codigo.includes(proibido), `memoria.ts não pode usar ${proibido}`);
  }
  // `Math.random` só como valor PADRÃO de `sortear` — nunca chamado direto.
  assert.doesNotMatch(codigo, /Math\.random\(\)/, "sorteio tem que vir injetado");
});
