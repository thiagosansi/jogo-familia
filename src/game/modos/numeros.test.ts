/**
 * Testes do modo "números". Node puro, nenhum DOM:
 *
 *   node --test --experimental-strip-types src/game/modos/numeros.test.ts
 *
 * Foco nas garantias que a criança sente na tela:
 *  - a resposta certa é SEMPRE o algarismo da quantidade desenhada
 *    (`correta === String(quantidade)`) — senão a cena e a resposta mentem
 *    uma para a outra;
 *  - somar nunca passa do teto do nível (5 no nível 1, 10 no nível 2) e as
 *    duas parcelas são sempre >= 1 ("chegaram zero peixinhos" não é conta);
 *  - as alternativas nunca repetem um algarismo (dois botões "7" fariam a
 *    criança "errar" a resposta certa);
 *  - o total não repete o da rodada anterior;
 *  - tudo é determinístico com uma semente fixa (a página sorteia UMA semente
 *    depois de hidratar e deriva todas as rodadas dela — ver `useSemente`).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { criarSorteio, FORMAS, IDS_FORMA, type FormaObjeto } from "./cores.ts";
import { MAX_CONTAGEM, corDaForma } from "./contar.ts";
import {
  TETO_SOMA,
  montarRodadaQuantos,
  montarRodadaSomar,
  poolDeNumeros,
  validarCatalogoNumeros,
  type NivelSomar,
  type RodadaQuantos,
} from "./numeros.ts";

const SEMENTE = 20260904;
const SORTEAR = criarSorteio(SEMENTE);

/** Uma sequência de rodadas encadeadas, como a página faz de verdade. */
function sequenciaQuantos(quantas: number, qtd: number, semente = SEMENTE): RodadaQuantos[] {
  const rodadas: RodadaQuantos[] = [];
  let anterior: number | null = null;
  let formaAnterior: FormaObjeto | null = null;
  for (let n = 0; n < quantas; n++) {
    const rodada = montarRodadaQuantos({
      qtd,
      anterior,
      formaAnterior,
      sortear: criarSorteio(semente + n * 7919),
    });
    rodadas.push(rodada);
    anterior = rodada.quantidade;
    formaAnterior = rodada.forma;
  }
  return rodadas;
}

// ------------------------------------------------- a resposta é a quantidade

test("em `quantos`, a correta é o algarismo da quantidade desenhada", () => {
  for (const rodada of sequenciaQuantos(200, 4)) {
    assert.equal(rodada.correta, String(rodada.quantidade));
    assert.ok(
      rodada.quantidade >= 1 && rodada.quantidade <= MAX_CONTAGEM,
      `quantidade fora de 1..10: ${rodada.quantidade}`,
    );
    assert.ok(rodada.alternativas.includes(rodada.correta), "a correta está na tela");
    assert.equal(rodada.cor, corDaForma(rodada.forma), "a cor vem da bijeção de cores.ts");
  }
});

test("em `somar`, a correta é o algarismo de a + b", () => {
  for (const nivel of [1, 2] as const) {
    for (let n = 0; n < 200; n++) {
      const rodada = montarRodadaSomar({ qtd: 4, nivel, sortear: criarSorteio(SEMENTE + n * 31) });
      assert.equal(rodada.quantidade, rodada.a + rodada.b, "quantidade === a + b");
      assert.equal(rodada.correta, String(rodada.quantidade));
      assert.ok(rodada.alternativas.includes(rodada.correta));
    }
  }
});

// ----------------------------------------------------- a soma respeita o teto

test("a soma nunca passa do teto do nível, e as duas parcelas são >= 1", () => {
  assert.equal(TETO_SOMA[1], 5);
  assert.equal(TETO_SOMA[2], MAX_CONTAGEM);
  assert.equal(TETO_SOMA[2], 10, "o nível 2 vai até 10 — nunca acima do teto do modo Contar");

  for (const nivel of [1, 2] as const) {
    for (let n = 0; n < 400; n++) {
      const { a, b, quantidade } = montarRodadaSomar({
        qtd: 3,
        nivel,
        sortear: criarSorteio(SEMENTE + n * 101),
      });
      assert.ok(a >= 1, `a = ${a} tem que ser >= 1`);
      assert.ok(b >= 1, `b = ${b} tem que ser >= 1`);
      assert.ok(
        quantidade <= TETO_SOMA[nivel],
        `nível ${nivel}: ${a}+${b} = ${quantidade} passou do teto ${TETO_SOMA[nivel]}`,
      );
      assert.ok(quantidade <= MAX_CONTAGEM, "nenhuma soma passa de 10 em nível nenhum");
    }
  }
});

test("o nível 1 chega a usar toda a faixa até 5, e o nível 2 passa de 5", () => {
  const somas = (nivel: NivelSomar) =>
    new Set(
      Array.from(
        { length: 300 },
        (_, n) => montarRodadaSomar({ qtd: 3, nivel, sortear: criarSorteio(SEMENTE + n * 7) }).quantidade,
      ),
    );
  assert.deepEqual([...somas(1)].sort((x, y) => x - y), [2, 3, 4, 5]);
  const nivel2 = somas(2);
  for (const n of [6, 7, 8, 9, 10]) {
    assert.ok(nivel2.has(n), `o nível 2 tem que chegar a somar ${n}`);
  }
});

// ----------------------------------------------------------- ids únicos

test("as alternativas nunca repetem um algarismo, em nenhuma dificuldade", () => {
  for (const qtd of [2, 3, 4, 5, 6]) {
    for (let n = 0; n < 120; n++) {
      const sortear = criarSorteio(SEMENTE + n * 13 + qtd);
      const q = montarRodadaQuantos({ qtd, sortear });
      assert.equal(new Set(q.alternativas).size, q.alternativas.length, "quantos: ids únicos");
      assert.equal(q.alternativas.length, qtd, `quantos: ${qtd} alternativas na tela`);

      for (const nivel of [1, 2] as const) {
        const s = montarRodadaSomar({ qtd, nivel, sortear: criarSorteio(SEMENTE + n + qtd) });
        assert.equal(new Set(s.alternativas).size, s.alternativas.length, "somar: ids únicos");
        assert.equal(s.alternativas.length, qtd, `somar: ${qtd} alternativas na tela`);
      }
    }
  }
});

test("toda alternativa é um algarismo de 1 a 10 — nunca 0, nunca texto", () => {
  const validos = new Set(poolDeNumeros(MAX_CONTAGEM));
  assert.equal(validos.size, 10);
  assert.equal(validos.has("0"), false, "não existe zero peixinho na tela");
  for (const qtd of [2, 6]) {
    for (let n = 0; n < 100; n++) {
      const q = montarRodadaQuantos({ qtd, sortear: criarSorteio(SEMENTE + n) });
      const s = montarRodadaSomar({ qtd, nivel: 2, sortear: criarSorteio(SEMENTE + n) });
      for (const id of [...q.alternativas, ...s.alternativas]) {
        assert.ok(validos.has(id), `alternativa inválida: ${JSON.stringify(id)}`);
      }
    }
  }
});

// ------------------------------------------------- o anterior não se repete

test("o total nunca repete o da rodada anterior (quantos e somar)", () => {
  const seq = sequenciaQuantos(150, 4);
  for (let i = 1; i < seq.length; i++) {
    assert.notEqual(seq[i].quantidade, seq[i - 1].quantidade, `quantos: repetiu na rodada ${i}`);
    assert.notEqual(seq[i].forma, seq[i - 1].forma, `quantos: repetiu a silhueta na rodada ${i}`);
  }

  for (const nivel of [1, 2] as const) {
    let anterior: number | null = null;
    let formaAnterior: FormaObjeto | null = null;
    for (let n = 0; n < 150; n++) {
      const rodada = montarRodadaSomar({
        qtd: 4,
        nivel,
        anterior,
        formaAnterior,
        sortear: criarSorteio(SEMENTE + n * 7919),
      });
      if (anterior !== null) {
        assert.notEqual(rodada.quantidade, anterior, `somar nível ${nivel}: repetiu o total`);
        assert.notEqual(rodada.forma, formaAnterior, `somar nível ${nivel}: repetiu a silhueta`);
      }
      anterior = rodada.quantidade;
      formaAnterior = rodada.forma;
    }
  }
});

// -------------------------------------------------------------- determinismo

test("a mesma semente dá exatamente a mesma rodada (SSR e re-render)", () => {
  const a = montarRodadaQuantos({ qtd: 4, sortear: criarSorteio(4242) });
  const b = montarRodadaQuantos({ qtd: 4, sortear: criarSorteio(4242) });
  assert.deepEqual(a, b);

  const s1 = montarRodadaSomar({ qtd: 5, nivel: 2, sortear: criarSorteio(4242) });
  const s2 = montarRodadaSomar({ qtd: 5, nivel: 2, sortear: criarSorteio(4242) });
  assert.deepEqual(s1, s2);

  // E sementes diferentes dão rodadas diferentes (senão o "determinismo"
  // acima seria só um sorteio quebrado devolvendo sempre a mesma coisa).
  const variadas = new Set(
    Array.from(
      { length: 40 },
      (_, n) => montarRodadaQuantos({ qtd: 4, sortear: criarSorteio(n * 977) }).correta,
    ),
  );
  assert.ok(variadas.size > 3, `o sorteio travou em ${variadas.size} respostas`);
});

// -------------------------------------------------------------------- falas

test("a pergunta e a festa concordam em gênero e número (pt-BR)", () => {
  const peixe = montarRodadaQuantos({ qtd: 2, sortear: SORTEAR, maximo: 1 });
  assert.equal(peixe.quantidade, 1, "maximo 1 força a rodada de um objeto só");

  // Uma rodada por forma, pedindo a forma pela `formaAnterior` das outras é
  // frágil; aqui basta conferir a frase montada para cada forma do catálogo.
  for (const forma of IDS_FORMA) {
    const f = FORMAS[forma];
    let rodada: RodadaQuantos | null = null;
    for (let n = 0; n < 200 && rodada === null; n++) {
      const tentativa = montarRodadaQuantos({ qtd: 2, sortear: criarSorteio(SEMENTE + n) });
      if (tentativa.forma === forma) rodada = tentativa;
    }
    assert.ok(rodada, `nenhuma rodada sorteou a forma ${forma}`);
    const esperado = f.genero === "f" ? "Quantas" : "Quantos";
    assert.equal(
      rodada.pergunta,
      `${esperado} ${f.plural} tem?`,
      `pergunta errada para ${forma}`,
    );
    assert.match(rodada.festa, /^(É|São) /, "a festa reusa `falaDoTotal` do modo Contar");
  }
});

test("a pergunta do somar fala a conta inteira, sem nenhum algarismo escrito", () => {
  for (const nivel of [1, 2] as const) {
    for (let n = 0; n < 200; n++) {
      const rodada = montarRodadaSomar({ qtd: 3, nivel, sortear: criarSorteio(SEMENTE + n * 3) });
      const f = FORMAS[rodada.forma];
      // Sem dígito na fala: o algarismo aparece só nas ALTERNATIVAS, que é
      // onde a criança responde (ver o cabeçalho de numeros.ts).
      assert.doesNotMatch(rodada.pergunta, /\d/, `pergunta com dígito: ${rodada.pergunta}`);
      assert.doesNotMatch(rodada.festa, /\d/, `festa com dígito: ${rodada.festa}`);
      // O verbo concorda com a primeira parcela.
      assert.match(rodada.pergunta, rodada.a === 1 ? /^Chegou / : /^Chegaram /);
      assert.match(rodada.pergunta, f.genero === "f" ? /Quantas tem agora\?$/ : /Quantos tem agora\?$/);
    }
  }
  // O exemplo do brief, montado à mão: dois peixinhos + um.
  let exemplo = null;
  for (let n = 0; n < 500 && exemplo === null; n++) {
    const r = montarRodadaSomar({ qtd: 3, nivel: 1, sortear: criarSorteio(n) });
    if (r.forma === "peixe" && r.a === 2 && r.b === 1) exemplo = r;
  }
  assert.ok(exemplo, "nenhuma rodada sorteou peixe com 2 + 1");
  assert.equal(exemplo.pergunta, "Chegaram dois peixinhos e mais um. Quantos tem agora?");
  assert.equal(exemplo.festa, "São três peixinhos!");
});

// ------------------------------------------------------- distratores próximos

test("no somar, os distratores ficam perto da resposta quando dá", () => {
  // Com 2 alternativas na tela o único distrator tem que estar a no máximo 3
  // da resposta — é o que obriga a criança a contar em vez de eliminar pelo
  // tamanho ("são poucos, não pode ser 10").
  for (let n = 0; n < 300; n++) {
    const r = montarRodadaSomar({ qtd: 2, nivel: 2, sortear: criarSorteio(SEMENTE + n * 17) });
    const distrator = Number(r.alternativas.find((id) => id !== r.correta));
    assert.ok(
      Math.abs(distrator - r.quantidade) <= 3,
      `distrator ${distrator} longe demais de ${r.quantidade}`,
    );
  }
});

// --------------------------------------- catálogo e autossuficiência

test("o catálogo é validado no import e continua válido", () => {
  assert.equal(validarCatalogoNumeros(), true);
});

test("o conteúdo é autossuficiente: não depende de personagens, fotos ou IndexedDB", () => {
  const fonte = readFileSync(new URL("./numeros.ts", import.meta.url), "utf8");
  const imports = [...fonte.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(
    imports.sort(),
    ["../dificuldade.ts", "./contar.ts", "./cores.ts"],
    "o modo números não importa db/fotos/vozes",
  );
  // Com o IndexedDB vazio a primeira rodada tem que existir do mesmo jeito.
  const primeira = montarRodadaQuantos({ qtd: 2, sortear: criarSorteio(0) });
  assert.equal(primeira.alternativas.length, 2);
});
