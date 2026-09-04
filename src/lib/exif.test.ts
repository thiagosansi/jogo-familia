/**
 * Teste do leitor de orientação EXIF.
 *
 *   node --test --experimental-strip-types src/lib/exif.test.ts
 *
 * As fixtures não são fotos reais (nenhuma foto de família entra no repo) —
 * são geradas por `node scripts/gerar-jpeg-exif.mjs`, que escreve o segmento
 * APP1 à mão. Rode o gerador antes se `scripts/fixtures/` não existir.
 *
 * Só a leitura e a matriz são testadas aqui: `normalizarFoto` depende de canvas
 * e de `createImageBitmap`, que não existem no Node — essa parte é verificada
 * no browser (ver DoD da área dos pais).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { aplicarOrientacao, orientacaoDeBytes, trocaLados } from "./exif.ts";

const FIXTURES = join(import.meta.dirname, "../../scripts/fixtures");

function view(caminho: string): DataView {
  const b = readFileSync(caminho);
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

test("lê o tag Orientation de JPEGs com EXIF", () => {
  for (const o of [1, 3, 6, 8]) {
    assert.equal(
      orientacaoDeBytes(view(join(FIXTURES, `retrato-exif${o}.jpg`))),
      o,
      `retrato-exif${o}.jpg deve reportar Orientation=${o}`,
    );
  }
  // A sonda embutida em exif.ts é a mesma imagem, em 8x4.
  assert.equal(orientacaoDeBytes(view(join(FIXTURES, "sonda-exif6.jpg"))), 6);
});

test("entrada sem EXIF ou fora do formato cai em 1, sem lançar", () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  assert.equal(orientacaoDeBytes(new DataView(png.buffer, png.byteOffset, png.byteLength)), 1);

  const vazio = new DataView(new ArrayBuffer(0));
  assert.equal(orientacaoDeBytes(vazio), 1);

  // JPEG truncado no meio do APP1: não pode estourar índice.
  const inteiro = readFileSync(join(FIXTURES, "retrato-exif6.jpg"));
  for (const corte of [2, 4, 6, 10, 20, 30]) {
    const parcial = inteiro.subarray(0, corte);
    assert.equal(
      orientacaoDeBytes(new DataView(parcial.buffer, parcial.byteOffset, parcial.byteLength)),
      1,
      `truncado em ${corte} bytes deve cair em 1`,
    );
  }
});

test("trocaLados marca exatamente as orientações de 90 graus", () => {
  assert.deepEqual([1, 2, 3, 4].map((o) => trocaLados(o as 1)), [false, false, false, false]);
  assert.deepEqual([5, 6, 7, 8].map((o) => trocaLados(o as 5)), [true, true, true, true]);
});

/** Contexto 2D falso: só registra a matriz e aplica em pontos. */
function ctxFalso() {
  let m = [1, 0, 0, 1, 0, 0];
  return {
    ctx: {
      transform(a: number, b: number, c: number, d: number, e: number, f: number) {
        // m' = m . novo (mesma composição do canvas real)
        m = [
          m[0] * a + m[2] * b,
          m[1] * a + m[3] * b,
          m[0] * c + m[2] * d,
          m[1] * c + m[3] * d,
          m[0] * e + m[2] * f + m[4],
          m[1] * e + m[3] * f + m[5],
        ];
      },
    } as unknown as CanvasRenderingContext2D,
    ponto: (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
  };
}

test("orientação 6 (iPhone em pé) gira 90 graus no sentido horário", () => {
  const { ctx, ponto } = ctxFalso();
  // Origem: 240x120 (paisagem, como o sensor grava).
  const destino = aplicarOrientacao(ctx, 6, 240, 120);
  assert.deepEqual(destino, { largura: 120, altura: 240 }, "o destino vira retrato");

  // Canto superior-esquerdo da foto crua vai para o superior-DIREITO do destino.
  assert.deepEqual(ponto(0, 0), [120, 0]);
  // E o canto oposto fecha o retângulo 120x240 — sem sair da tela.
  assert.deepEqual(ponto(240, 120), [0, 240]);
});

test("orientações 1, 3 e 8 posicionam a imagem dentro do destino", () => {
  const casos: Array<[1 | 3 | 8, [number, number], [number, number]]> = [
    [1, [0, 0], [240, 120]],
    [3, [240, 120], [0, 0]], // 180 graus: os cantos trocam
    [8, [0, 240], [120, 0]], // 90 graus anti-horário
  ];
  for (const [orientacao, topoEsquerda, baixoDireita] of casos) {
    const { ctx, ponto } = ctxFalso();
    const destino = aplicarOrientacao(ctx, orientacao, 240, 120);
    const esperado = trocaLados(orientacao)
      ? { largura: 120, altura: 240 }
      : { largura: 240, altura: 120 };
    assert.deepEqual(destino, esperado, `destino de ${orientacao}`);
    assert.deepEqual(ponto(0, 0), topoEsquerda, `canto (0,0) de ${orientacao}`);
    assert.deepEqual(ponto(240, 120), baixoDireita, `canto (240,120) de ${orientacao}`);
  }
});
