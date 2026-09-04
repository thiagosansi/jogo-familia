/**
 * Teste do store local — roda em Node com `fake-indexeddb`.
 *
 *   pnpm test
 *
 * Cobre o DoD: gravar um Blob de imagem em `personagens` e recuperá-lo depois
 * de "recarregar a página" (nova conexão ao mesmo banco).
 */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  _resetDB,
  addFigurinha,
  CONFIG_ID,
  CONFIG_PADRAO,
  filtrarPorIdsAtivos,
  getConfig,
  getDB,
  getProgresso,
  gravarProgresso,
  listarPersonagens,
  PROGRESSO_ID,
  reconciliarModosAtivos,
  removerPersonagem,
  salvarPersonagem,
  setConfig,
} from "./db.ts";
import type { Progresso } from "./tipos.ts";

// PNG 1x1 vermelho — faz as vezes de "foto já redimensionada".
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("grava um Blob de foto e recupera após 'reload' da página", async () => {
  const foto = new Blob([PNG_1X1], { type: "image/png" });
  const voz = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" });

  const salvo = await salvarPersonagem({
    nome: "Mamãe",
    papel: "mae",
    fotoRecorte: foto,
    vozNome: voz,
    vozFesta: null,
  });
  assert.ok(salvo.id, "salvarPersonagem deve gerar um id");

  // Simula reload: descarta a conexão memoizada e reabre o mesmo banco.
  _resetDB();

  const lidos = await listarPersonagens();
  assert.equal(lidos.length, 1);
  const p = lidos[0];
  assert.equal(p.nome, "Mamãe");
  assert.equal(p.papel, "mae");
  assert.ok(p.fotoRecorte instanceof Blob, "fotoRecorte deve voltar como Blob");
  assert.equal(p.fotoRecorte.size, PNG_1X1.byteLength);
  assert.equal(p.fotoRecorte.type, "image/png");

  const bytes = new Uint8Array(await p.fotoRecorte.arrayBuffer());
  assert.deepEqual(Buffer.from(bytes), PNG_1X1, "bytes da imagem devem bater");
  assert.ok(p.vozNome instanceof Blob);
  assert.equal(p.vozFesta, null);

  await removerPersonagem(p.id);
  assert.equal((await listarPersonagens()).length, 0);
});

test("config tem default de limite desligado (0) e persiste alterações", async () => {
  const padrao = await getConfig();
  assert.equal(padrao.limiteSessaoMin, 0);
  assert.ok(padrao.modosAtivos.includes("familia"));

  await setConfig({ limiteSessaoMin: 12 });
  _resetDB();
  const depois = await getConfig();
  assert.equal(depois.limiteSessaoMin, 12);
  assert.deepEqual(depois.modosAtivos, padrao.modosAtivos);
});

test("addFigurinha acumula acertos por eixo sem duplicar figurinha", async () => {
  const vazio = await getProgresso();
  assert.equal(vazio.figurinhas.length, 0);
  assert.deepEqual(vazio.porEixo.familia, { acertos: 0, erros: 0 });

  await addFigurinha("peixe-palhaco", "familia");
  await addFigurinha("peixe-palhaco", "familia");
  await addFigurinha("estrela", "cores", { acertou: false });

  _resetDB();
  const p = await getProgresso();
  assert.equal(p.figurinhas.length, 2, "figurinha repetida não duplica");
  assert.deepEqual(p.porEixo.familia, { acertos: 2, erros: 0 });
  assert.deepEqual(p.porEixo.cores, { acertos: 0, erros: 1 });
});

test("progresso salvo antes do eixo 'ingles' existir lê com o eixo zerado", async () => {
  // Simula um aparelho com progresso de uma versão anterior do app: grava
  // direto no IndexedDB um registro SEM a chave "ingles" em porEixo — é
  // exatamente a forma que um `Progresso` antigo tinha antes deste eixo
  // nascer. `gravarProgresso` sempre grava a forma nova, então escrevemos
  // via `getDB` para simular o dado legado de verdade.
  const antigo = {
    id: PROGRESSO_ID,
    figurinhas: [{ id: "familia-x", eixo: "familia", conquistadaEm: 1 }],
    porEixo: {
      familia: { acertos: 1, erros: 0 },
      cores: { acertos: 0, erros: 0 },
      contar: { acertos: 0, erros: 0 },
      animais: { acertos: 0, erros: 0 },
      // "ingles" de propósito ausente aqui.
    },
    atualizadoEm: 1,
  } as unknown as Progresso;

  const db = await getDB();
  await db.put("progresso", antigo);
  _resetDB();

  const p = await getProgresso();
  assert.deepEqual(p.porEixo.ingles, { acertos: 0, erros: 0 });
  // O resto do progresso antigo não deve ter sido perdido na mescla.
  assert.deepEqual(p.porEixo.familia, { acertos: 1, erros: 0 });
  assert.equal(p.figurinhas.length, 1);

  // Depois de lido, gravar de novo tem que persistir o eixo zerado (e não só
  // devolver um objeto calculado na hora que some no próximo reload).
  await gravarProgresso(p);
  _resetDB();
  const p2 = await getProgresso();
  assert.deepEqual(p2.porEixo.ingles, { acertos: 0, erros: 0 });
});

// -------------------------------------------------- reconciliarModosAtivos

test("reconciliarModosAtivos: sem salvo, devolve o padrão inteiro", () => {
  const padrao = ["familia", "cores", "contar"];
  assert.deepEqual(reconciliarModosAtivos(padrao, undefined), padrao);
});

test("reconciliarModosAtivos: subconjunto salvo de ids conhecidos é respeitado", () => {
  // Este é o caso que a verificação manual (escrever um subconjunto no
  // IndexedDB e recarregar) precisa demonstrar: ids que já existiam na base
  // conhecida e foram deixados de fora do salvo NÃO voltam.
  const padrao = ["familia", "cores", "contar", "animais", "aquario", "ingles"];
  const base = padrao; // toda a base atual é "conhecida" neste teste
  const salvo = ["familia", "cores"];
  assert.deepEqual(reconciliarModosAtivos(padrao, salvo, base), ["familia", "cores"]);
});

test("reconciliarModosAtivos: modo novo do padrão ausente do salvo não fica escondido", () => {
  // Simula exatamente o cenário do brief: um aparelho salvou a config ANTES
  // de "modo-novo" existir. A base conhecida representa o padrão de quando
  // o salvo foi escrito — sem "modo-novo". O padrão ATUAL já o inclui.
  const baseAntiga = ["familia", "cores", "contar"];
  const padraoAtual = ["familia", "cores", "contar", "modo-novo"];
  const salvoAntigo = ["familia"]; // adulto (na prática: nunca) só tinha "familia" salvo

  const reconciliado = reconciliarModosAtivos(padraoAtual, salvoAntigo, baseAntiga);

  // "cores" e "contar" são da base antiga e foram deixados de fora do salvo:
  // continuam de fora, exatamente como o subconjunto pedia.
  assert.ok(!reconciliado.includes("cores"));
  assert.ok(!reconciliado.includes("contar"));
  // "modo-novo" não pertence à base antiga — nunca existiu uma tela para o
  // adulto tê-lo desligado de propósito, então aparece mesmo ausente do salvo.
  assert.ok(reconciliado.includes("modo-novo"), "modo novo não pode ficar escondido");
  assert.ok(reconciliado.includes("familia"));
});

test("reconciliarModosAtivos: id desconhecido no salvo é ignorado sem quebrar", () => {
  const padrao = ["familia", "cores"];
  const salvo = ["familia", "modo-que-nao-existe-mais"];
  const reconciliado = reconciliarModosAtivos(padrao, salvo, padrao);
  assert.deepEqual(reconciliado, ["familia"]);
});

test("getConfig: subconjunto salvo de ids da base antiga é respeitado de ponta a ponta", async () => {
  // `MODOS_PADRAO_BASE` (o corte que congela o padrão de ANTES de "ingles")
  // contém só os 5 modos originais — "ingles" fica de fora de propósito.
  // Então um subconjunto salvo desses 5 ids antigos precisa ser respeitado
  // por `getConfig` (exclusão deliberada continua de fora), exatamente o
  // que a verificação manual no navegador (escrever um subconjunto e
  // recarregar) exige. É a mesma regra do teste unitário de
  // `reconciliarModosAtivos` acima, só que passando pelo caminho real de
  // `getConfig` e com a base padrão (sem passar `baseConhecida`).
  const db = await getDB();
  await db.put("config", {
    id: CONFIG_ID,
    limiteSessaoMin: 0,
    modosAtivos: ["familia", "cores"],
  });
  _resetDB();

  const config = await getConfig();
  // "contar", "animais" e "aquario" são da base antiga e foram deixados de
  // fora do salvo: continuam de fora. "ingles" não é da base antiga —
  // aparece mesmo ausente do salvo (é o caso do teste seguinte).
  assert.deepEqual(config.modosAtivos, ["familia", "cores", "ingles"]);
});

test("getConfig: aparelho com config salva ANTES de 'ingles' existir mostra ingles ativo", async () => {
  // Este é o caso REAL que motivou `reconciliarModosAtivos`: um aparelho
  // salvou a config quando só existiam os 5 modos originais — o array salvo
  // não tem "ingles" porque ele nem existia ainda, não porque o adulto o
  // desligou. `getConfig` precisa mostrar "ingles" ativo mesmo assim.
  const db = await getDB();
  await db.put("config", {
    id: CONFIG_ID,
    limiteSessaoMin: 0,
    modosAtivos: ["familia", "cores", "contar", "animais", "aquario"],
  });
  _resetDB();

  const config = await getConfig();
  assert.ok(config.modosAtivos.includes("ingles"), "ingles não pode ficar escondido");
  // Nenhum dos 5 antigos foi excluído de propósito: todos continuam ativos,
  // e o resultado bate com o padrão inteiro de hoje.
  assert.deepEqual(config.modosAtivos, CONFIG_PADRAO.modosAtivos);
});

// ------------------------------------------------------- filtrarPorIdsAtivos

test("filtrarPorIdsAtivos: filtra normalmente por um subconjunto de ids válidos", () => {
  const itens = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const filtrado = filtrarPorIdsAtivos(itens, ["b"], (i) => i.id);
  assert.deepEqual(filtrado, [{ id: "b" }]);
});

test("filtrarPorIdsAtivos: ids nulo (falha ao ler config) devolve todos os itens", () => {
  const itens = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(filtrarPorIdsAtivos(itens, null, (i) => i.id), itens);
});

test("filtrarPorIdsAtivos: lista vazia de ids devolve todos os itens", () => {
  const itens = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(filtrarPorIdsAtivos(itens, [], (i) => i.id), itens);
});

test("filtrarPorIdsAtivos: filtro que não sobra ninguém (só ids desconhecidos) devolve todos", () => {
  const itens = [{ id: "a" }, { id: "b" }];
  const filtrado = filtrarPorIdsAtivos(itens, ["id-que-nao-existe"], (i) => i.id);
  assert.deepEqual(filtrado, itens);
});

test("filtrarPorIdsAtivos: id desconhecido misturado com válido é ignorado sem quebrar", () => {
  const itens = [{ id: "a" }, { id: "b" }];
  const filtrado = filtrarPorIdsAtivos(itens, ["a", "id-que-nao-existe"], (i) => i.id);
  assert.deepEqual(filtrado, [{ id: "a" }]);
});
