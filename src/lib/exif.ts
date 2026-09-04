/**
 * Orientação EXIF — sem biblioteca.
 *
 * O problema: o iPhone grava a foto do jeito que o sensor leu (quase sempre em
 * paisagem) e anota num marcador EXIF quanto o visualizador precisa girar. Uma
 * foto tirada em pé chega como 4032x3024 com `Orientation = 6` ("gire 90° no
 * sentido horário"). Se o canvas desenhar os pixels crus, a mãe aparece deitada
 * dentro do recorte circular.
 *
 * O agravante: `redimensionarImagem` (src/lib/media.ts) reencoda em JPEG via
 * canvas — e canvas NÃO propaga EXIF. Ou seja, depois do resize a informação
 * some. Então a ordem obrigatória é: ler a orientação do arquivo ORIGINAL,
 * redimensionar, e só então corrigir os pixels se necessário.
 *
 * "Se necessário" porque os browsers divergem: a opção `imageOrientation` de
 * `createImageBitmap` mudou de `"none"` para `"from-image"` no meio do caminho,
 * e o fallback `<img>` respeita `image-orientation: from-image` por padrão.
 * Em vez de apostar no user agent, `sondarAutoOrientacao()` mede o
 * comportamento real uma vez, com uma imagem 8x4 embutida aqui.
 */
import { redimensionarImagem } from "./media.ts";

/** Valores válidos do tag EXIF `Orientation` (0x0112). 1 = já está em pé. */
export type Orientacao = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Orientações que trocam largura por altura (giro de 90°). */
export function trocaLados(orientacao: Orientacao): boolean {
  return orientacao >= 5;
}

// ------------------------------------------------------------- leitura do EXIF

/** Só o começo do arquivo importa: o APP1 vem antes dos dados da imagem. */
const BYTES_CABECALHO = 128 * 1024;

/**
 * Lê o tag `Orientation` do JPEG. Devolve 1 (sem giro) para qualquer entrada
 * que não seja um JPEG com EXIF legível — PNG, WebP, arquivo truncado, foto sem
 * metadados. Nunca lança: uma foto sem EXIF é o caso comum, não um erro.
 */
export async function lerOrientacaoExif(arquivo: Blob): Promise<Orientacao> {
  try {
    const buffer = await arquivo.slice(0, BYTES_CABECALHO).arrayBuffer();
    return orientacaoDeBytes(new DataView(buffer));
  } catch {
    return 1;
  }
}

/** Versão síncrona sobre bytes já lidos — é o que os testes exercitam. */
export function orientacaoDeBytes(view: DataView): Orientacao {
  if (view.byteLength < 4) return 1;
  if (view.getUint16(0) !== 0xffd8) return 1; // não é JPEG (sem SOI)

  let i = 2;
  while (i + 4 <= view.byteLength) {
    if (view.getUint8(i) !== 0xff) return 1; // fora de sincronia: desiste
    const marcador = view.getUint8(i + 1);
    // SOS (início dos dados) ou EOI: o EXIF, se existisse, já teria aparecido.
    if (marcador === 0xda || marcador === 0xd9) return 1;
    const tamanho = view.getUint16(i + 2);
    if (tamanho < 2) return 1;
    if (marcador === 0xe1) {
      const achado = orientacaoNoApp1(view, i + 4, Math.min(i + 2 + tamanho, view.byteLength));
      if (achado) return achado;
    }
    i += 2 + tamanho;
  }
  return 1;
}

/** Procura o tag 0x0112 dentro de um segmento APP1 ("Exif\0\0" + TIFF + IFD0). */
function orientacaoNoApp1(view: DataView, inicio: number, fim: number): Orientacao | null {
  // Assinatura "Exif\0\0" (6 bytes) antes do cabeçalho TIFF.
  if (inicio + 6 > fim) return null;
  const assinatura = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  for (let k = 0; k < 6; k++) if (view.getUint8(inicio + k) !== assinatura[k]) return null;

  const tiff = inicio + 6;
  if (tiff + 8 > fim) return null;

  // Byte order: "II" (0x4949) little-endian, "MM" (0x4d4d) big-endian.
  const ordem = view.getUint16(tiff);
  if (ordem !== 0x4949 && ordem !== 0x4d4d) return null;
  const little = ordem === 0x4949;
  if (view.getUint16(tiff + 2, little) !== 0x002a) return null; // magic 42

  const ifd0 = tiff + view.getUint32(tiff + 4, little);
  if (ifd0 + 2 > fim) return null;
  const entradas = view.getUint16(ifd0, little);

  for (let e = 0; e < entradas; e++) {
    const entrada = ifd0 + 2 + e * 12;
    if (entrada + 12 > fim) return null;
    if (view.getUint16(entrada, little) !== 0x0112) continue; // não é Orientation
    // Tipo SHORT (3): o valor cabe inline, nos 2 primeiros bytes do campo valor.
    const valor = view.getUint16(entrada + 8, little);
    return valor >= 1 && valor <= 8 ? (valor as Orientacao) : 1;
  }
  return null;
}

// ------------------------------------------------------------------- desenho

/**
 * Aplica a matriz que desfaz `orientacao` no contexto e devolve o tamanho que o
 * canvas precisa ter. Depois desta chamada, desenhe com
 * `ctx.drawImage(img, 0, 0, larguraOrigem, alturaOrigem)` — as coordenadas
 * continuam sendo as da imagem crua; a matriz cuida do resto.
 *
 * Cobre os 8 valores; os que aparecem na prática são 1 (normal), 3 (de cabeça
 * para baixo), 6 (iPhone em pé) e 8 (iPhone em pé, botão para o outro lado).
 */
export function aplicarOrientacao(
  ctx: CanvasRenderingContext2D,
  orientacao: Orientacao,
  largura: number,
  altura: number,
): { largura: number; altura: number } {
  switch (orientacao) {
    case 2: // espelhada na horizontal
      ctx.transform(-1, 0, 0, 1, largura, 0);
      break;
    case 3: // 180°
      ctx.transform(-1, 0, 0, -1, largura, altura);
      break;
    case 4: // espelhada na vertical
      ctx.transform(1, 0, 0, -1, 0, altura);
      break;
    case 5: // transposta
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6: // 90° horário — o caso do iPhone
      ctx.transform(0, 1, -1, 0, altura, 0);
      break;
    case 7: // transversa
      ctx.transform(0, -1, -1, 0, altura, largura);
      break;
    case 8: // 90° anti-horário
      ctx.transform(0, -1, 1, 0, 0, largura);
      break;
    default:
      break; // 1: nada a fazer
  }
  return trocaLados(orientacao)
    ? { largura: altura, altura: largura }
    : { largura, altura };
}

// -------------------------------------------------------------------- sonda

/**
 * JPEG 8x4 (paisagem) com `Orientation = 6` gravado no EXIF. Gerado por
 * `node scripts/gerar-jpeg-exif.mjs --base64` — regenere de lá se precisar
 * mexer. Embutido em base64 porque a sonda precisa funcionar offline, antes de
 * qualquer fetch, e um asset em /public seria mais uma requisição para o
 * service worker cuidar.
 */
const SONDA_EXIF6 =
  "/9j/4QAiRXhpZgAASUkqAAgAAAABABIBAwABAAAABgAAAAAAAAD/wAARCAAEAAgDAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/9sAQwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/90ABAAB/9oADAMBAAIRAxEAPwD8+dZ8beJ/EGpXOr6vqX2vUbvyftFx9j06DzPs8EVtF+6trKCBNkEMSfJEm7bubc5dm/19f7Pr6Ib1/wCIR/8Am++J3/0bH4H4N/TS+kv9H/w34c8I/CPxK/1S8POEv7Y/1f4f/wBTeAM//s/+3s+zPibNv+FbibhfN87xf1vPM5zLG/7bmOI9h9Z+rYb2WDo4ehS//9k=";

let sonda: Promise<boolean> | null = null;

/**
 * `true` quando o pipeline de decodificação do browser JÁ gira a imagem pelo
 * EXIF sozinho (então corrigir de novo giraria duas vezes).
 *
 * Mede o comportamento real passando a sonda 8x4 pelo MESMO caminho que as
 * fotos percorrem (`redimensionarImagem`): se o resultado voltar em retrato, o
 * browser aplicou a orientação. Memoizado — roda no máximo uma vez por sessão.
 * Em caso de erro assume `false` (corrigir manualmente), que é o comportamento
 * dos browsers antigos.
 */
export function sondarAutoOrientacao(): Promise<boolean> {
  sonda ??= (async () => {
    try {
      const bytes = Uint8Array.from(atob(SONDA_EXIF6), (c) => c.charCodeAt(0));
      const original = new Blob([bytes], { type: "image/jpeg" });
      const passada = await redimensionarImagem(original, 64);
      const { largura, altura } = await medir(passada);
      return altura > largura; // 8x4 virou 4x8 => o browser girou sozinho
    } catch {
      return false;
    }
  })();
  return sonda;
}

/** Só para testes: esquece o resultado memoizado da sonda. */
export function _resetSonda(): void {
  sonda = null;
}

async function medir(blob: Blob): Promise<{ largura: number; altura: number }> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(blob);
    const medida = { largura: bmp.width, altura: bmp.height };
    bmp.close();
    return medida;
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ largura: img.naturalWidth, altura: img.naturalHeight });
      img.onerror = () => reject(new Error("não foi possível medir a imagem"));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// ------------------------------------------------------------- normalização

/**
 * Prepara uma foto vinda da câmera/galeria para o recorte: reduz para `maxPx`
 * (uma foto de 12 MP trava o canvas e estoura a quota do IndexedDB) e garante
 * que os pixels já estejam em pé, sem depender de EXIF daqui para a frente.
 *
 * Devolve JPEG. Quem consome (o cropper) pode tratar como imagem comum.
 */
export async function normalizarFoto(arquivo: Blob, maxPx = 1024): Promise<Blob> {
  const orientacao = await lerOrientacaoExif(arquivo);
  const reduzida = await redimensionarImagem(arquivo, maxPx);
  if (orientacao === 1) return reduzida;
  if (await sondarAutoOrientacao()) return reduzida; // o browser já girou
  return girar(reduzida, orientacao);
}

/** Reencoda `blob` com a matriz de `orientacao` aplicada. */
async function girar(blob: Blob, orientacao: Orientacao): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas 2D indisponível — não foi possível girar a foto.");
  }
  // Ordem importa: atribuir width/height zera a matriz do contexto, então o
  // canvas é dimensionado ANTES de aplicar a orientação.
  const girado = trocaLados(orientacao);
  canvas.width = girado ? bitmap.height : bitmap.width;
  canvas.height = girado ? bitmap.width : bitmap.height;
  aplicarOrientacao(ctx, orientacao, bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
  bitmap.close();

  const saida = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!saida) throw new Error("Falha ao gravar a foto girada.");
  return saida;
}
