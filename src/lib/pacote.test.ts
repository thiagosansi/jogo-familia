/**
 * Teste do Pacote da Família — roda em Node com `fake-indexeddb`.
 *
 *   node --test --experimental-strip-types src/lib/pacote.test.ts
 *
 * Cobre o DoD: exportar, apagar o banco inteiro (perfil limpo, como um tablet
 * novo) e importar reproduz cada personagem com foto e voz byte a byte. E
 * importar o MESMO pacote de novo não duplica ninguém.
 */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";

import { DB_NOME, _resetDB, getDB, listarPersonagens, salvarPersonagem } from "./db.ts";
import {
  PACOTE_TIPO,
  PACOTE_VERSAO,
  PacoteInvalidoError,
  exportarPacote,
  importarPacote,
  nomeArquivoPacote,
} from "./pacote.ts";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
// Bytes "de áudio" com valores fora do ASCII: pega bug de base64 que perde
// byte alto (o clássico de usar TextDecoder no lugar de charCodeAt).
const VOZ = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff, 0x80, 0x7f]);

/** Apaga o banco e a conexão memoizada — equivale a instalar o app num tablet novo. */
async function perfilLimpo(): Promise<void> {
  // Fechar a conexão ANTES de apagar: com ela aberta o `deleteDatabase` fica
  // bloqueado e nunca resolve (o teste trava, não falha).
  (await getDB()).close();
  _resetDB();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NOME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  _resetDB();
}

async function bytes(blob: Blob): Promise<Buffer> {
  return Buffer.from(new Uint8Array(await blob.arrayBuffer()));
}

test("exportar -> perfil limpo -> importar reproduz foto e voz byte a byte", async () => {
  await perfilLimpo();

  await salvarPersonagem({
    nome: "Mamãe",
    papel: "mae",
    fotoRecorte: new Blob([PNG_1X1], { type: "image/png" }),
    vozNome: new Blob([VOZ], { type: "audio/webm" }),
    vozFesta: new Blob([VOZ, VOZ], { type: "audio/webm" }),
  });
  await salvarPersonagem({
    nome: "Bob Esponja",
    papel: "mascote",
    fotoRecorte: new Blob([PNG_1X1], { type: "image/png" }),
    vozNome: null,
    vozFesta: null,
  });

  const antes = await listarPersonagens();
  const pacote = await exportarPacote();
  assert.equal(pacote.type, "application/json");

  // O pacote precisa ser JSON legível — é o que o adulto guarda no e-mail.
  const json = JSON.parse(await pacote.text());
  assert.equal(json.tipo, PACOTE_TIPO);
  assert.equal(json.versao, PACOTE_VERSAO);
  assert.equal(json.personagens.length, 2);

  await perfilLimpo();
  assert.equal((await listarPersonagens()).length, 0, "perfil limpo deve começar vazio");

  const r = await importarPacote(pacote);
  assert.deepEqual(r, { importados: 2, ignorados: 0 });

  const depois = await listarPersonagens();
  assert.equal(depois.length, 2);
  for (let i = 0; i < antes.length; i++) {
    const a = antes[i];
    const b = depois[i];
    assert.equal(b.id, a.id, "id preservado (é a chave do dedupe)");
    assert.equal(b.nome, a.nome);
    assert.equal(b.papel, a.papel);
    assert.equal(b.criadoEm, a.criadoEm, "criadoEm preservado (mantém a ordem da lista)");
    assert.equal(b.fotoRecorte.type, a.fotoRecorte.type);
    assert.deepEqual(await bytes(b.fotoRecorte), await bytes(a.fotoRecorte), "foto idêntica");
    if (a.vozNome) {
      assert.ok(b.vozNome, "voz do nome deve voltar");
      assert.equal(b.vozNome.type, a.vozNome.type);
      assert.deepEqual(await bytes(b.vozNome), await bytes(a.vozNome), "voz idêntica");
      assert.deepEqual(await bytes(b.vozFesta!), await bytes(a.vozFesta!));
    } else {
      assert.equal(b.vozNome, null);
      assert.equal(b.vozFesta, null);
    }
  }
});

test("importar o mesmo pacote duas vezes não duplica (dedupe por id)", async () => {
  await perfilLimpo();
  await salvarPersonagem({
    nome: "Papai",
    papel: "pai",
    fotoRecorte: new Blob([PNG_1X1], { type: "image/png" }),
    vozNome: null,
    vozFesta: null,
  });
  const pacote = await exportarPacote();

  await perfilLimpo();
  assert.deepEqual(await importarPacote(pacote), { importados: 1, ignorados: 0 });
  assert.deepEqual(await importarPacote(pacote), { importados: 0, ignorados: 1 });
  assert.equal((await listarPersonagens()).length, 1, "segundo import não duplica");
});

test("import não sobrescreve voz regravada depois do export", async () => {
  await perfilLimpo();
  const p = await salvarPersonagem({
    nome: "Mamãe",
    papel: "mae",
    fotoRecorte: new Blob([PNG_1X1], { type: "image/png" }),
    vozNome: null,
    vozFesta: null,
  });
  const pacote = await exportarPacote();

  // Depois do backup o adulto grava a voz neste aparelho.
  await salvarPersonagem({ ...p, vozNome: new Blob([VOZ], { type: "audio/webm" }) });

  assert.deepEqual(await importarPacote(pacote), { importados: 0, ignorados: 1 });
  const [atual] = await listarPersonagens();
  assert.ok(atual.vozNome, "a voz gravada depois do export sobrevive ao import");
});

test("arquivo estranho vira erro amigável, não exceção crua", async () => {
  await perfilLimpo();
  await assert.rejects(
    () => importarPacote(new Blob(["isto não é json"], { type: "application/json" })),
    PacoteInvalidoError,
  );
  await assert.rejects(
    () => importarPacote(new Blob([JSON.stringify({ tipo: "outra-coisa" })])),
    PacoteInvalidoError,
  );
  await assert.rejects(
    () =>
      importarPacote(
        new Blob([JSON.stringify({ tipo: PACOTE_TIPO, versao: 99, personagens: [] })]),
      ),
    PacoteInvalidoError,
  );
});

test("entradas malformadas dentro de um pacote válido são puladas, não quebram o import", async () => {
  await perfilLimpo();
  const pacote = new Blob([
    JSON.stringify({
      tipo: PACOTE_TIPO,
      versao: 1,
      geradoEm: Date.now(),
      personagens: [
        { id: "ok", nome: "Vovó", papel: "parente", criadoEm: 1, fotoRecorte: { mime: "image/png", base64: PNG_1X1.toString("base64") }, vozNome: null, vozFesta: null },
        { id: "sem-foto", nome: "Ninguém", papel: "parente", criadoEm: 2 },
        { id: "papel-inventado", nome: "X", papel: "dragao", criadoEm: 3, fotoRecorte: { mime: "image/png", base64: "" } },
        null,
      ],
    }),
  ]);
  assert.deepEqual(await importarPacote(pacote), { importados: 1, ignorados: 3 });
});

test("nomeArquivoPacote usa data local no formato ano-mes-dia", () => {
  assert.equal(nomeArquivoPacote(new Date(2026, 8, 2)), "familia-2026-09-02.json");
});
