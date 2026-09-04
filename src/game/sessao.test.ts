/**
 * Testes das funções puras de sessão (limite de tempo + despedida). Rodam em
 * node puro (nenhum DOM, nenhum `sessionStorage`) — por isso testam só
 * `limiteEmMs`, `faltaMs` e `despedidaPendente`, não o hook `useSessao` (que
 * depende de React e não tem runner neste projeto).
 *
 *   node --test --experimental-strip-types src/game/sessao.test.ts
 *
 * Cobre o bug corrigido junto com o limite padrão desligado: uma sessão que
 * já se despediu (`encerradaEm` preenchido) não pode mais despedir de novo
 * quando o limite está desligado (`limiteMs === null`).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { despedidaPendente, faltaMs, limiteEmMs, type EstadoSessao } from "./sessao.ts";

const T0 = 1_000_000;

function estado(overrides: Partial<EstadoSessao> = {}): EstadoSessao {
  return { inicio: T0, encerradaEm: null, ...overrides };
}

// ------------------------------------------------------------- limiteEmMs

test("limiteEmMs: zero, negativo e ausente viram 'sem limite' (null)", () => {
  assert.equal(limiteEmMs(0), null);
  assert.equal(limiteEmMs(-5), null);
  assert.equal(limiteEmMs(undefined), null);
  assert.equal(limiteEmMs(Number.NaN), null);
});

test("limiteEmMs: minutos positivos viram milissegundos", () => {
  assert.equal(limiteEmMs(7), 7 * 60_000);
  assert.equal(limiteEmMs(0.5), 30_000);
});

// -------------------------------------------------------------- faltaMs

test("faltaMs: sem limite (null) devolve null, mesmo com sessão em andamento", () => {
  assert.equal(faltaMs(estado(), null, T0 + 1000), null);
});

test("faltaMs: com limite, devolve quanto falta (negativo = já passou)", () => {
  const limite = 60_000;
  assert.equal(faltaMs(estado(), limite, T0 + 10_000), 50_000);
  assert.equal(faltaMs(estado(), limite, T0 + 70_000), -10_000);
});

// -------------------------------------------------------- despedidaPendente

test("despedidaPendente: sem limite é sempre false, mesmo com encerradaEm preenchido", () => {
  // Este é o bug corrigido: uma despedida de ANTES do adulto desligar o
  // limite não pode continuar valendo depois que o limite foi desligado.
  const sessaoJaDespedida = estado({ encerradaEm: T0 + 5000 });
  assert.equal(despedidaPendente(sessaoJaDespedida, null, T0 + 6000), false);
});

test("despedidaPendente: sem limite é false mesmo com o tempo bem passado", () => {
  assert.equal(despedidaPendente(estado(), null, T0 + 999_999_999), false);
});

test("despedidaPendente: com limite e encerradaEm preenchido, despede", () => {
  const sessaoJaDespedida = estado({ encerradaEm: T0 + 5000 });
  assert.equal(despedidaPendente(sessaoJaDespedida, 60_000, T0 + 6000), true);
});

test("despedidaPendente: com limite e prazo vencido (sem encerradaEm ainda), despede", () => {
  assert.equal(despedidaPendente(estado(), 60_000, T0 + 60_001), true);
});

test("despedidaPendente: com limite e ainda dentro do prazo, não despede", () => {
  assert.equal(despedidaPendente(estado(), 60_000, T0 + 30_000), false);
});
