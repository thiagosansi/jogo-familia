/**
 * Teste da importação de pasta — roda em Node com `fake-indexeddb`.
 *
 *   node --test --experimental-strip-types src/lib/importarPasta.test.ts
 *
 * Cobre a lógica que não precisa de canvas: derivação de nome e papel, descarte
 * de `.DS_Store`, dedupe (reimportar a mesma pasta não duplica), detecção de
 * alfa (o PNG do personagem não pode virar JPEG) e o recorte que não decapita.
 * A parte que depende de canvas (`prepararImagemImportada`) é verificada no
 * browser — aqui ela é injetada por `opcoes.processar`.
 */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";

import { DB_NOME, _resetDB, getDB, listarPersonagens, salvarPersonagem } from "./db.ts";
import {
  type ArquivoImportavel,
  calcularRecorte,
  chaveDedupe,
  detectarAlfa,
  ehImagem,
  formatoDeSaida,
  importarPasta,
  papelDoCaminho,
  planejarImportacao,
  tituloDoArquivo,
} from "./importarPasta.ts";

/** A pasta real do usuário, com o `.DS_Store` que o macOS deixa em toda pasta. */
const PASTA_REAL = [
  "imagens/.DS_Store",
  "imagens/personagens/bob esponja.png",
  "imagens/personagens/gary.jpeg",
  "imagens/personagens/lula molusco.jpeg",
  "imagens/personagens/patrick.png",
  "imagens/personagens/planquiton.png",
  "imagens/personagens/sindy.png",
  "imagens/personagens/siriqueijo.jpeg",
];

const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg" };

function entrada(caminho: string): ArquivoImportavel {
  const nome = caminho.split("/").pop() ?? caminho;
  const ext = nome.includes(".") ? nome.slice(nome.lastIndexOf(".") + 1) : "";
  return {
    nome,
    caminho,
    tipo: MIME[ext] ?? "",
    blob: new Blob([caminho], { type: MIME[ext] ?? "" }),
  };
}

async function perfilLimpo(): Promise<void> {
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

/** Substitui o pipeline de canvas: devolve um "recorte" com bytes previsíveis. */
async function processarFake(arquivo: Blob): Promise<Blob> {
  return new Blob([await arquivo.arrayBuffer()], { type: "image/png" });
}

// ------------------------------------------------------------- nome e papel

test("nome do arquivo vira título legível, com espaço e acento", () => {
  assert.equal(tituloDoArquivo("bob esponja.png"), "Bob Esponja");
  assert.equal(tituloDoArquivo("lula molusco.jpeg"), "Lula Molusco");
  assert.equal(tituloDoArquivo("siriqueijo.jpeg"), "Siriqueijo");
  assert.equal(tituloDoArquivo("mamãe.jpg"), "Mamãe");
  assert.equal(tituloDoArquivo("vovó do coração.jpeg"), "Vovó do Coração");
  assert.equal(tituloDoArquivo("02_tio-zé.jpeg"), "Tio Zé");
  assert.equal(tituloDoArquivo("IMG_2031.JPG"), "Img 2031");
});

test("papel vem da subpasta; dentro de familia, do nome do arquivo", () => {
  assert.equal(papelDoCaminho("imagens/personagens/bob esponja.png"), "mascote");
  assert.equal(papelDoCaminho("imagens/personagens/mamae.png"), "mascote"); // pasta manda
  assert.equal(papelDoCaminho("imagens/familia/mamae.jpg", "mamae.jpg"), "mae");
  assert.equal(papelDoCaminho("imagens/familia/mãe.jpg", "mãe.jpg"), "mae");
  assert.equal(papelDoCaminho("imagens/familia/papai.jpg", "papai.jpg"), "pai");
  assert.equal(papelDoCaminho("imagens/familia/irmã sofia.jpg", "irmã sofia.jpg"), "irmao");
  assert.equal(papelDoCaminho("imagens/familia/vovo.jpg", "vovo.jpg"), "parente");
});

test("palavra-chave casa por token inteiro, não por pedaço do nome", () => {
  // "patrick" contém "pat", "planquiton" contém "plan" — nada disso é pai/mãe.
  assert.equal(papelDoCaminho("patrick.png", "patrick.png"), "parente");
  assert.equal(papelDoCaminho("planquiton.png", "planquiton.png"), "parente");
  assert.equal(papelDoCaminho("siriqueijo.jpeg", "siriqueijo.jpeg"), "parente");
});

test(".DS_Store e não-imagens são descartados", () => {
  assert.equal(ehImagem({ nome: ".DS_Store", tipo: "" }), false);
  assert.equal(ehImagem({ nome: "._bob.png", tipo: "" }), false);
  assert.equal(ehImagem({ nome: "notas.txt", tipo: "text/plain" }), false);
  assert.equal(ehImagem({ nome: "bob esponja.png", tipo: "image/png" }), true);
  // Sem MIME (acontece com pasta vinda de pendrive): decide pela extensão.
  assert.equal(ehImagem({ nome: "gary.jpeg", tipo: "" }), true);
});

// ------------------------------------------------------------------- plano

test("plano da pasta real: 7 personagens com nome legível, .DS_Store fora", () => {
  const plano = planejarImportacao(PASTA_REAL.map(entrada));
  assert.deepEqual(plano.descartados, [".DS_Store"]);
  assert.deepEqual(
    plano.itens.map((i) => [i.nome, i.papel, i.situacao]),
    [
      ["Bob Esponja", "mascote", "novo"],
      ["Gary", "mascote", "novo"],
      ["Lula Molusco", "mascote", "novo"],
      ["Patrick", "mascote", "novo"],
      ["Planquiton", "mascote", "novo"],
      ["Sindy", "mascote", "novo"],
      ["Siriqueijo", "mascote", "novo"],
    ],
  );
  assert.equal(plano.itens.every((i) => i.selecionado), true);
});

test("fallback do iOS: sem pasta no caminho, o papel sai só do nome", () => {
  // Safari do iOS não tem webkitdirectory: os File chegam sem
  // webkitRelativePath, então `caminho` é o próprio nome.
  const soNomes = PASTA_REAL.filter((c) => !c.endsWith(".DS_Store")).map((c) =>
    entrada(c.split("/").pop() as string),
  );
  const plano = planejarImportacao(soNomes);
  assert.equal(plano.itens.length, 7);
  assert.deepEqual(
    plano.itens.map((i) => i.nome).sort(),
    ["Bob Esponja", "Gary", "Lula Molusco", "Patrick", "Planquiton", "Sindy", "Siriqueijo"],
  );
  // Sem a subpasta ninguém é mascote automaticamente — o adulto ajusta na prévia.
  assert.equal(plano.itens.every((i) => i.papel === "parente"), true);

  // E ajustar para mascote na prévia dá exatamente o mesmo resultado do
  // caminho com pasta: mesmas chaves de dedupe.
  const comPasta = planejarImportacao(PASTA_REAL.map(entrada));
  assert.deepEqual(
    plano.itens.map((i) => chaveDedupe(i.nome, "mascote")).sort(),
    comPasta.itens.map((i) => chaveDedupe(i.nome, i.papel)).sort(),
  );
});

test("plano marca quem já está no banco e quem repete dentro da seleção", () => {
  const plano = planejarImportacao(
    [
      ...PASTA_REAL.map(entrada),
      // Mesma pessoa, outro arquivo: repetido dentro da seleção.
      entrada("imagens/personagens/copia/Bob Esponja.PNG"),
    ],
    [{ nome: "Gary", papel: "mascote" }],
  );
  const porNome = new Map(plano.itens.map((i) => [i.id, i.situacao]));
  assert.equal(porNome.get("imagens/personagens/gary.jpeg"), "existe");
  assert.equal(porNome.get("imagens/personagens/copia/Bob Esponja.PNG"), "repetido");
  assert.equal(porNome.get("imagens/personagens/bob esponja.png"), "novo");
});

// -------------------------------------------------------------------- alfa

/** PNG 1x1 RGBA (color type 6) — o formato típico de arte recortada. */
const PNG_RGBA = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** PNG 1x1 de paleta COM chunk tRNS — alfa que não aparece no color type. */
const PNG_PALETA_TRNS = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAgMAAABieywaAAAACVBMVEX///8AAAD///9lPeUcAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=",
  "base64",
);
/** JPEG mínimo (não tem alfa nem se quiser). */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

test("detecta alfa: PNG RGBA e PNG de paleta com tRNS; JPEG não", () => {
  assert.equal(detectarAlfa(new Uint8Array(PNG_RGBA)), true);
  assert.equal(detectarAlfa(new Uint8Array(PNG_PALETA_TRNS)), true);
  assert.equal(detectarAlfa(new Uint8Array(JPEG)), false);
  assert.equal(detectarAlfa(new Uint8Array([])), false);
});

test("formato de saída segue o alfa — PNG transparente nunca vira JPEG", () => {
  // JPEG não carrega alfa: reencodar o Bob Esponja assim daria fundo preto.
  assert.equal(formatoDeSaida(detectarAlfa(new Uint8Array(PNG_RGBA))), "image/png");
  assert.equal(formatoDeSaida(detectarAlfa(new Uint8Array(JPEG))), "image/jpeg");
});

// ----------------------------------------------------------------- recorte

test("recorte quadrado centra na horizontal e ancora no terço de cima", () => {
  // Retrato 600x1200: o lado é 600 e a janela começa em 1/3 do que sobra —
  // pega a cabeça, não os pés.
  assert.deepEqual(calcularRecorte(600, 1200), { sx: 0, sy: 200, lado: 600 });
  // Paisagem 1200x600: centrado na horizontal, sem sobra vertical.
  assert.deepEqual(calcularRecorte(1200, 600), { sx: 300, sy: 0, lado: 600 });
  // Já quadrada: não corta nada.
  assert.deepEqual(calcularRecorte(512, 512), { sx: 0, sy: 0, lado: 512 });
  // Centrado cortaria a cabeça de uma imagem bem alta; o terço superior não.
  assert.ok(calcularRecorte(400, 1600).sy < (1600 - 400) / 2);
});

// -------------------------------------------------------------- gravação

test("importar a pasta cria os 7 personagens; reimportar não duplica", async () => {
  await perfilLimpo();

  const plano = planejarImportacao(PASTA_REAL.map(entrada));
  const primeira = await importarPasta(plano.itens, { processar: processarFake });
  assert.deepEqual(primeira, { importados: 7, ignorados: 0, falhas: [] });

  const gravados = await listarPersonagens();
  // Ordenado aqui porque `listarPersonagens` ordena por `criadoEm` e os sete
  // caem no mesmo milissegundo — o desempate é a ordem de chave do banco.
  assert.deepEqual(
    gravados.map((p) => p.nome).sort(),
    ["Bob Esponja", "Gary", "Lula Molusco", "Patrick", "Planquiton", "Sindy", "Siriqueijo"],
  );
  assert.equal(gravados.every((p) => p.papel === "mascote"), true);
  assert.equal(gravados.every((p) => p.fotoRecorte.size > 0), true);
  assert.equal(gravados.every((p) => p.vozNome === null), true);

  // Segunda passada na MESMA pasta: o plano já marca todo mundo como existente
  // e nada é gravado de novo.
  const plano2 = planejarImportacao(PASTA_REAL.map(entrada), gravados);
  assert.equal(plano2.itens.every((i) => i.situacao === "existe"), true);
  assert.equal(plano2.itens.some((i) => i.selecionado), false);

  // Mesmo forçando a importação de todos, a dedupe do banco segura.
  const segunda = await importarPasta(plano2.itens, { processar: processarFake });
  assert.deepEqual(segunda, { importados: 0, ignorados: 7, falhas: [] });
  assert.equal((await listarPersonagens()).length, 7);
});

test("uma imagem quebrada não derruba o resto da importação", async () => {
  await perfilLimpo();
  const plano = planejarImportacao(PASTA_REAL.map(entrada));
  const r = await importarPasta(plano.itens, {
    processar: async (arquivo) => {
      const texto = await arquivo.text();
      if (texto.includes("gary")) throw new Error("imagem corrompida");
      return processarFake(arquivo);
    },
  });
  assert.deepEqual(r, { importados: 6, ignorados: 0, falhas: ["gary.jpeg"] });
  assert.equal((await listarPersonagens()).length, 6);
});

test("o adulto pode renomear e trocar o papel na prévia antes de confirmar", async () => {
  await perfilLimpo();
  const plano = planejarImportacao([entrada("bob esponja.png")]);
  const editado = { ...plano.itens[0], nome: "  Bob  ", papel: "mascote" as const };
  assert.deepEqual(await importarPasta([editado], { processar: processarFake }), {
    importados: 1,
    ignorados: 0,
    falhas: [],
  });
  const [gravado] = await listarPersonagens();
  assert.equal(gravado.nome, "Bob"); // espaços de sobra não viram nome
  assert.equal(gravado.papel, "mascote");

  // Item sem nome nenhum é ignorado, não grava personagem anônimo.
  const vazio = { ...plano.itens[0], nome: "   " };
  assert.deepEqual(await importarPasta([vazio], { processar: processarFake }), {
    importados: 0,
    ignorados: 1,
    falhas: [],
  });
});

test("progresso é reportado item a item", async () => {
  await perfilLimpo();
  await salvarPersonagem({
    nome: "Gary",
    papel: "mascote",
    fotoRecorte: new Blob([PNG_RGBA], { type: "image/png" }),
    vozNome: null,
    vozFesta: null,
  });
  const plano = planejarImportacao(PASTA_REAL.map(entrada));
  const passos: Array<[number, number]> = [];
  await importarPasta(plano.itens, {
    processar: processarFake,
    aoProgredir: (feitos, total) => passos.push([feitos, total]),
  });
  // Inclusive o que foi pulado por já existir: a barra não pode travar nele.
  assert.deepEqual(passos, [
    [1, 7],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
    [6, 7],
    [7, 7],
  ]);
  assert.equal((await listarPersonagens()).length, 7);
});
