/**
 * Testes das partes puras de `nuvem.ts` — as que dão para exercitar sem browser
 * e sem rede. O foco é a REGRA DE OURO (mascote não sobe) e o comportamento
 * quando não há variáveis de ambiente: o módulo tem que carregar igual e falhar
 * com mensagem, nunca explodir. É isso que mantém o painel abrindo e o jogo
 * 100% local num deploy sem Supabase configurado.
 *
 * `node --test` roda sem `.env.local`, então aqui `nuvemConfigurada()` é sempre
 * false — exatamente o cenário "sem nuvem" que precisa ser garantido.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  NuvemErro,
  PAPEIS_NA_NUVEM,
  carregarFamilia,
  linkDoJogo,
  nuvemConfigurada,
  pastaDoPersonagem,
  podeSubir,
} from "./nuvem.ts";
import { PAPEIS } from "./db.ts";

test("mascote nunca sobe — é arte de terceiros e o bucket é público", () => {
  assert.equal(podeSubir("mascote"), false);
  assert.ok(!PAPEIS_NA_NUVEM.includes("mascote"));
});

test("todo familiar de verdade sobe", () => {
  for (const papel of PAPEIS) {
    if (papel === "mascote") continue;
    assert.equal(podeSubir(papel), true, `${papel} deveria subir`);
  }
  // Nenhum papel novo pode entrar na nuvem sem passar por aqui.
  assert.deepEqual([...PAPEIS_NA_NUVEM].sort(), ["irmao", "mae", "pai", "parente"]);
});

test("sem variáveis de ambiente a nuvem só fica indisponível", () => {
  assert.equal(nuvemConfigurada(), false);
});

test("carregarFamilia sem configuração falha com mensagem, não com crash", async () => {
  await assert.rejects(() => carregarFamilia("qualquer-uuid"), NuvemErro);
});

test("a pasta da mídia é <familia>/<personagem> e sanitiza id fora do padrão", () => {
  assert.equal(pastaDoPersonagem("fam-1", "pes-2"), "fam-1/pes-2");
  // Fallback de `novoId()` no iOS antigo não é uuid; nada de barra extra.
  assert.equal(pastaDoPersonagem("a/b", "c d/e"), "a-b/c-d-e");
  assert.equal(pastaDoPersonagem("", ""), "sem-id/sem-id");
});

test("o link do jogo leva o uuid da família — é ele a credencial", () => {
  assert.equal(
    linkDoJogo("11111111-2222-3333-4444-555555555555", "https://jogo.exemplo"),
    "https://jogo.exemplo/entrar?familia=11111111-2222-3333-4444-555555555555",
  );
});
