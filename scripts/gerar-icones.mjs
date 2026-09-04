// Gera os ícones PNG do PWA sem dependências externas (encoder PNG mínimo).
// Rode com: node scripts/gerar-icones.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const FUNDO = hex("#062a4a");
const FUNDO2 = hex("#0e4d7a");
const CORAL = hex("#ff7a5c");
const AREIA = hex("#ffd166");
const ESCURO = hex("#2b1006");

// Desenha o peixinho: `scale` = fração do lado ocupada pela arte (safe zone).
function desenhar(size, scale) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const s = size * scale;
  const set = (x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // fundo: degradê vertical do mar
      const t = y / size;
      const bg = FUNDO.map((c, i) => Math.round(c + (FUNDO2[i] - c) * (1 - t) * 0.9));
      set(x, y, bg);

      const dx = x - cx;
      const dy = y - cy;
      // corpo: elipse
      const corpo = (dx + s * 0.06) ** 2 / (s * 0.34) ** 2 + dy ** 2 / (s * 0.24) ** 2 <= 1;
      // cauda: triângulo à direita
      const tailX = dx - s * 0.26;
      const cauda = tailX >= 0 && tailX <= s * 0.22 && Math.abs(dy) <= (tailX / (s * 0.22)) * s * 0.22;
      if (corpo || cauda) set(x, y, CORAL);
      // barbatana de cima
      if (dy < 0 && dy > -s * 0.34 && Math.abs(dx + s * 0.02) < s * 0.14 && corpo === false && dy > -s * 0.3) {
        const topo = -s * 0.24 * (1 - Math.abs(dx + s * 0.02) / (s * 0.14));
        if (dy > topo - s * 0.12 && dy < -s * 0.18) set(x, y, AREIA);
      }
      // olho
      if ((dx + s * 0.22) ** 2 + (dy + s * 0.06) ** 2 <= (s * 0.045) ** 2) set(x, y, ESCURO);
      // bolha
      const bx = dx + s * 0.42;
      const by = dy + s * 0.3;
      const rb = Math.sqrt(bx * bx + by * by);
      if (rb <= s * 0.07 && rb >= s * 0.045) set(x, y, AREIA);
    }
  }
  return px;
}

const alvos = [
  ["icon-192.png", 192, 0.8],
  ["icon-512.png", 512, 0.8],
  ["icon-512-maskable.png", 512, 0.56], // safe zone do maskable
  ["apple-touch-icon.png", 180, 0.78],
];
for (const [nome, size, scale] of alvos) {
  writeFileSync(join(OUT, nome), png(size, desenhar(size, scale)));
  console.log("gerado", nome, size);
}
