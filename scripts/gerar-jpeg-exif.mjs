/**
 * Gera JPEGs de teste com marcador EXIF `Orientation` — sem dependências.
 *
 * Por quê: o DoD da área dos pais exige provar que uma foto de iPhone
 * (`Orientation = 6`, sensor deitado) aparece em pé dentro do recorte. Fotos
 * reais não entram no repositório (decisão do projeto: nenhuma imagem de
 * família ou de terceiros versionada), então a fixture é sintetizada aqui.
 *
 *   node scripts/gerar-jpeg-exif.mjs [--out <dir>] [--base64]
 *
 * Saída (em `--out`, padrão `scripts/fixtures/`):
 *   retrato-exif1.jpg .. retrato-exif8.jpg  — 240x120, um marcador por canto
 *   sonda-exif6.jpg                          — 8x4, usada como sonda no browser
 *
 * `--base64` imprime o base64 da sonda (é o que fica embutido em src/lib/exif.ts).
 */
import { deflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ------------------------------------------------------------------ PNG (RGB)

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(tipo, dados) {
  const cabecalho = Buffer.alloc(8);
  cabecalho.writeUInt32BE(dados.length, 0);
  cabecalho.write(tipo, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tipo, "ascii"), dados])), 0);
  return Buffer.concat([cabecalho, dados, crc]);
}

/** PNG RGB de `w`x`h`; `pixel(x, y)` devolve `[r, g, b]`. */
function png(w, h, pixel) {
  const linhas = [];
  for (let y = 0; y < h; y++) {
    const linha = Buffer.alloc(1 + w * 3); // filtro 0 + RGB
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      linha[1 + x * 3] = r;
      linha[2 + x * 3] = g;
      linha[3 + x * 3] = b;
    }
    linhas.push(linha);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(linhas), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ----------------------------------------------------------------- EXIF APP1

/**
 * Monta o segmento APP1 mínimo com um único tag: Orientation (0x0112).
 * Layout: FFE1 <len> "Exif\0\0" <TIFF little-endian> <IFD0 com 1 entrada>.
 */
function app1Orientacao(orientacao) {
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "ascii"); // little-endian
  tiff.writeUInt16LE(0x002a, 2); // magic 42
  tiff.writeUInt32LE(8, 4); // offset do IFD0
  tiff.writeUInt16LE(1, 8); // 1 entrada
  tiff.writeUInt16LE(0x0112, 10); // tag Orientation
  tiff.writeUInt16LE(3, 12); // tipo SHORT
  tiff.writeUInt32LE(1, 14); // count
  tiff.writeUInt16LE(orientacao, 18); // valor inline
  tiff.writeUInt32LE(0, 22); // sem próximo IFD

  const corpo = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const marcador = Buffer.alloc(4);
  marcador.writeUInt16BE(0xffe1, 0);
  marcador.writeUInt16BE(corpo.length + 2, 2); // o campo length inclui a si mesmo
  return Buffer.concat([marcador, corpo]);
}

/**
 * Remove todos os segmentos APPn (JFIF, EXIF do sips, Photoshop...) para
 * deixar a sonda o menor possível. Para antes do primeiro marcador de dados.
 */
function limparApps(jpeg) {
  const partes = [jpeg.subarray(0, 2)];
  let i = 2;
  while (i + 3 < jpeg.length && jpeg[i] === 0xff) {
    const marcador = jpeg[i + 1];
    if (marcador === 0xda) break; // SOS: daqui pra frente é imagem
    const tamanho = 2 + jpeg.readUInt16BE(i + 2);
    if (marcador < 0xe0 || marcador > 0xef) partes.push(jpeg.subarray(i, i + tamanho));
    i += tamanho;
  }
  partes.push(jpeg.subarray(i));
  return Buffer.concat(partes);
}

/** Injeta o APP1 depois do SOI (e depois do APP0/JFIF, se houver). */
export function inserirOrientacao(jpeg, orientacao) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("não é JPEG (SOI ausente)");
  let corte = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) corte = 4 + jpeg.readUInt16BE(4);
  return Buffer.concat([jpeg.subarray(0, corte), app1Orientacao(orientacao), jpeg.subarray(corte)]);
}

// -------------------------------------------------------------------- driver

function pngParaJpeg(bufferPng) {
  const dir = join(tmpdir(), `jpeg-exif-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const entrada = join(dir, "in.png");
  const saida = join(dir, "out.jpg");
  writeFileSync(entrada, bufferPng);
  execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "best", entrada, "--out", saida], {
    stdio: "ignore",
  });
  const jpeg = readFileSync(saida);
  rmSync(dir, { recursive: true, force: true });
  return jpeg;
}

/**
 * 240x120 (paisagem, como sai do sensor de um iPhone deitado).
 * Metade de cima vermelha, metade de baixo azul, quadrado verde no canto
 * superior-esquerdo. Depois de aplicar Orientation=6 (girar 90° horário) o
 * resultado correto é 120x240 com o verde no canto superior-DIREITO.
 */
function imagemTeste(x, y, w, h) {
  if (x < w * 0.2 && y < h * 0.35) return [40, 200, 90]; // marcador verde
  return y < h / 2 ? [220, 50, 50] : [40, 90, 220];
}

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const dirSaida = outIdx >= 0 ? args[outIdx + 1] : join(import.meta.dirname, "fixtures");
mkdirSync(dirSaida, { recursive: true });

const baseGrande = pngParaJpeg(png(240, 120, (x, y) => imagemTeste(x, y, 240, 120)));
for (const o of [1, 3, 6, 8]) {
  const arquivo = join(dirSaida, `retrato-exif${o}.jpg`);
  writeFileSync(arquivo, inserirOrientacao(baseGrande, o));
  console.log(`${arquivo}  (240x120, Orientation=${o})`);
}

// Sonda: a menor imagem possível que ainda distingue paisagem de retrato.
const sonda = inserirOrientacao(limparApps(pngParaJpeg(png(8, 4, (x, y) => imagemTeste(x, y, 8, 4)))), 6);
const arquivoSonda = join(dirSaida, "sonda-exif6.jpg");
writeFileSync(arquivoSonda, sonda);
console.log(`${arquivoSonda}  (8x4, Orientation=6, ${sonda.length} bytes)`);

if (args.includes("--base64")) {
  console.log("\n--- base64 da sonda (embutir em src/lib/exif.ts) ---");
  console.log(sonda.toString("base64"));
}
