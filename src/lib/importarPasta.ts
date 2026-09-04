/**
 * Importar uma pasta de imagens direto para o aparelho.
 *
 * Por quê: o cadastro manual (foto -> cropper -> nome -> voz) é ótimo para a
 * mãe e o pai, mas vira suplício quando o adulto já tem uma pasta pronta com
 * sete personagens. Pior: essa arte costuma ser de terceiros (desenho animado
 * favorito da criança). Colocá-la em `public/` seria redistribuir; aqui ela
 * entra pelo `<input type="file">`, é recortada no próprio aparelho e fica no
 * IndexedDB. O repositório e o deploy continuam limpos — ver `.gitignore` e
 * `.vercelignore`, que barram a pasta `imagens/`.
 *
 * O fluxo é em duas etapas de propósito: `planejarImportacao` só olha nomes e
 * caminhos (rápido, sem decodificar imagem nenhuma) para montar a prévia que o
 * adulto confere; `importarPasta` faz o trabalho pesado depois do "confirmar".
 *
 * Este módulo é importado tanto pelo browser quanto pelo `node --test`, então
 * nada de `document`/`canvas` no topo: o pipeline de imagem mora em
 * `prepararImagemImportada`, que só roda quando chamada.
 */
import { PAPEIS, listarPersonagens, novoId, salvarPersonagem } from "./db.ts";
import { normalizarFoto } from "./exif.ts";
import type { Papel, Personagem } from "./tipos.ts";

/** Lado do recorte gravado. Igual ao do `CropperCircular` — o mesmo jogo consome os dois. */
export const LADO_RECORTE = 512;

/**
 * Onde fica o "assunto" da imagem na vertical, quando ela é mais alta que larga.
 * 1/3 e não 1/2: em foto de pessoa e em desenho de personagem a cabeça mora no
 * terço de cima; um recorte centrado corta testa e sobra sapato.
 */
export const FOCO_VERTICAL = 1 / 3;

// --------------------------------------------------------------- entrada

/**
 * O que a importação precisa saber de um arquivo. É o `File` do input reduzido
 * ao mínimo — assim o teste em Node monta entradas sem depender de `File`.
 */
export interface ArquivoImportavel {
  /** Nome com extensão: `bob esponja.png`. */
  nome: string;
  /** Caminho relativo à pasta escolhida: `imagens/personagens/bob esponja.png`. */
  caminho: string;
  /** MIME informado pelo browser. Pode vir vazio — o nome é o desempate. */
  tipo: string;
  blob: Blob;
}

/**
 * Converte um `File` do input. `webkitRelativePath` é vazio no caminho de
 * fallback (seleção múltipla de arquivos, único disponível no Safari do iOS):
 * aí o caminho é só o nome, e a derivação de papel cai no nome do arquivo.
 */
export function deFile(file: File): ArquivoImportavel {
  return {
    nome: file.name,
    caminho: file.webkitRelativePath || file.name,
    tipo: file.type,
    blob: file,
  };
}

/** `true` quando o browser sabe abrir uma pasta inteira (não é o caso do iOS). */
export function suportaPastaInteira(): boolean {
  if (typeof document === "undefined") return false;
  return "webkitdirectory" in document.createElement("input");
}

// ------------------------------------------------------------ nome e papel

const EXTENSOES_IMAGEM = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "bmp",
  "heic",
  "heif",
]);

function extensao(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  return ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : "";
}

/**
 * Aceita só imagem. O `.DS_Store` do macOS entra em toda pasta e chega no input
 * com `type` vazio; arquivos que começam com ponto são metadados do sistema
 * (`._foto.jpg` dos pendrives Mac também) e nunca são conteúdo.
 */
export function ehImagem(arquivo: Pick<ArquivoImportavel, "nome" | "tipo">): boolean {
  if (arquivo.nome.startsWith(".")) return false;
  if (arquivo.tipo.startsWith("image/")) return true;
  return EXTENSOES_IMAGEM.has(extensao(arquivo.nome));
}

/** Minúsculas sem acento — base para comparar nomes e palavras-chave. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Palavras que ficam minúsculas no meio do nome ("Maria do Carmo"). */
const CONECTORES = new Set(["de", "da", "do", "das", "dos", "e", "di", "du"]);

/**
 * `bob esponja.png` -> "Bob Esponja"; `lula molusco.jpeg` -> "Lula Molusco";
 * `02_vovo-maria.jpg` -> "Vovo Maria".
 *
 * Acentos são preservados (`mamãe.jpg` -> "Mamãe"): só a comparação é sem
 * acento, o texto que vai para a tela continua o que o adulto escreveu.
 */
export function tituloDoArquivo(nome: string): string {
  const semExtensao = extensao(nome) ? nome.slice(0, nome.lastIndexOf(".")) : nome;
  const limpo = semExtensao
    // Prefixo de ordenação ("01 ", "02_") não é parte do nome de ninguém.
    .replace(/^\d+\s*[._-]\s*/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpo) return "";

  return limpo
    .split(" ")
    .map((palavra, i) => {
      const base = palavra.toLocaleLowerCase("pt-BR");
      if (i > 0 && CONECTORES.has(normalizarTexto(base))) return base;
      return base.charAt(0).toLocaleUpperCase("pt-BR") + base.slice(1);
    })
    .join(" ");
}

/** Palavras-chave por papel, comparadas por token inteiro (sem acento). */
const PALAVRAS_PAPEL: Array<[Papel, string[]]> = [
  ["mae", ["mae", "mamae", "mamy", "mami"]],
  ["pai", ["pai", "papai", "papi"]],
  ["irmao", ["irmao", "irma", "irmaos", "irmas", "mano", "mana"]],
];

/**
 * Papel derivado do nome do arquivo, por token inteiro.
 *
 * Token inteiro e não `includes`: "patrick" contém "pat" e "planquiton" contém
 * "plan" — casar substring transformaria mascote em pai na primeira distração.
 */
export function papelDoNome(nome: string): Papel | null {
  const tokens = new Set(normalizarTexto(nome).split(/[^a-z]+/).filter(Boolean));
  for (const [papel, chaves] of PALAVRAS_PAPEL) {
    if (chaves.some((c) => tokens.has(c))) return papel;
  }
  return null;
}

/**
 * Papel derivado do caminho completo.
 *
 * Regra: qualquer coisa sob uma pasta `personagens` é mascote (é a arte, não a
 * família); sob `familia` o papel sai do nome do arquivo e cai em `parente`.
 * Sem pasta nenhuma (fallback do iOS) vale só o nome — e o adulto ajusta na
 * prévia, que é justamente para isso.
 */
export function papelDoCaminho(caminho: string, nome = caminho): Papel {
  const pastas = caminho.split("/").slice(0, -1).map(normalizarTexto);
  if (pastas.includes("personagens") || pastas.includes("mascotes")) return "mascote";
  return papelDoNome(nome) ?? "parente";
}

/**
 * Chave de deduplicação. Nome (sem acento, sem espaço sobrando) + papel: é o
 * que o adulto enxerga como "a mesma pessoa". O `id` não serve aqui — cada
 * importação geraria um id novo e a segunda passada duplicaria todo mundo.
 */
export function chaveDedupe(nome: string, papel: Papel): string {
  return `${papel}::${normalizarTexto(nome).replace(/\s+/g, " ").trim()}`;
}

// ------------------------------------------------------------------ plano

export type Situacao = "novo" | "existe" | "repetido";

export interface ItemImportacao {
  /** Estável dentro do plano — serve de `key` no React. */
  id: string;
  arquivo: ArquivoImportavel;
  nome: string;
  papel: Papel;
  /** `existe`: já está no banco. `repetido`: mesmo nome+papel duas vezes na seleção. */
  situacao: Situacao;
  /** Marcado pelo adulto na prévia; começa `true` só para os inéditos. */
  selecionado: boolean;
}

export interface Plano {
  itens: ItemImportacao[];
  /** Nomes dos arquivos descartados por não serem imagem (`.DS_Store` e cia.). */
  descartados: string[];
}

/**
 * Monta a prévia: o que entraria, com que nome e que papel. Não decodifica
 * imagem nenhuma — o adulto vê a lista instantaneamente mesmo com 200 fotos.
 */
export function planejarImportacao(
  arquivos: ArquivoImportavel[],
  existentes: Array<Pick<Personagem, "nome" | "papel">> = [],
): Plano {
  const jaNoBanco = new Set(existentes.map((p) => chaveDedupe(p.nome, p.papel)));
  const vistos = new Set<string>();
  const itens: ItemImportacao[] = [];
  const descartados: string[] = [];

  // Ordem previsível: a mesma da pasta no Finder, não a que o browser entregou.
  const ordenados = [...arquivos].sort((a, b) =>
    a.caminho.localeCompare(b.caminho, "pt-BR", { numeric: true }),
  );

  for (const arquivo of ordenados) {
    if (!ehImagem(arquivo)) {
      descartados.push(arquivo.nome);
      continue;
    }
    const nome = tituloDoArquivo(arquivo.nome);
    if (!nome) {
      descartados.push(arquivo.nome);
      continue;
    }
    const papel = papelDoCaminho(arquivo.caminho, arquivo.nome);
    const chave = chaveDedupe(nome, papel);
    const situacao: Situacao = jaNoBanco.has(chave)
      ? "existe"
      : vistos.has(chave)
        ? "repetido"
        : "novo";
    vistos.add(chave);
    itens.push({
      id: arquivo.caminho,
      arquivo,
      nome,
      papel,
      situacao,
      selecionado: situacao === "novo",
    });
  }

  return { itens, descartados };
}

// ----------------------------------------------------------------- imagem

/**
 * Detecta se os bytes carregam canal alfa.
 *
 * Existe porque `redimensionarImagem` devolve JPEG, e JPEG não tem alfa: um PNG
 * de personagem com fundo transparente reencodado assim ganha um fundo preto
 * (o canvas em branco é rgba(0,0,0,0), e descartar o alfa deixa o preto). O
 * pipeline consulta isto para escolher o formato de saída.
 *
 * Só o cabeçalho importa; passar os primeiros 64 KB basta.
 */
export function detectarAlfa(bytes: Uint8Array): boolean {
  if (temAssinatura(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return alfaPng(bytes);
  }
  // RIFF????WEBP
  if (temAssinatura(bytes, [0x52, 0x49, 0x46, 0x46]) && texto(bytes, 8, 4) === "WEBP") {
    return alfaWebp(bytes);
  }
  // GIF87a/GIF89a: a transparência é por índice da paleta, invisível no
  // cabeçalho. Assume que tem — no pior caso grava um PNG maior que o preciso.
  if (texto(bytes, 0, 3) === "GIF") return true;
  return false;
}

function temAssinatura(bytes: Uint8Array, assinatura: number[]): boolean {
  if (bytes.length < assinatura.length) return false;
  return assinatura.every((b, i) => bytes[i] === b);
}

function texto(bytes: Uint8Array, inicio: number, tamanho: number): string {
  if (bytes.length < inicio + tamanho) return "";
  let s = "";
  for (let i = inicio; i < inicio + tamanho; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * PNG: color type 4 (cinza+alfa) e 6 (RGBA) têm alfa por pixel; 0, 2 e 3 só têm
 * alfa se existir um chunk `tRNS` (o caso do PNG de paleta com um índice
 * transparente, que ferramentas de recorte adoram gerar).
 */
function alfaPng(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8; // pula a assinatura
  let colorType = -1;
  while (i + 8 <= bytes.length) {
    const tamanho = view.getUint32(i);
    const tipo = texto(bytes, i + 4, 4);
    if (tipo === "IHDR" && i + 8 + 10 <= bytes.length) colorType = bytes[i + 8 + 9];
    if (tipo === "tRNS") return true;
    // IDAT começa os dados: tRNS, se existisse, já teria aparecido.
    if (tipo === "IDAT" || tipo === "IEND") break;
    i += 12 + tamanho; // tamanho(4) + tipo(4) + dados + crc(4)
    if (tamanho < 0 || !Number.isFinite(tamanho)) break;
  }
  return colorType === 4 || colorType === 6;
}

/** WebP: `VP8X` traz um flag de alfa; `VP8L` guarda o bit 28 do cabeçalho. */
function alfaWebp(bytes: Uint8Array): boolean {
  const chunk = texto(bytes, 12, 4);
  if (chunk === "VP8X") return bytes.length > 20 && (bytes[20] & 0x10) !== 0;
  if (chunk === "ALPH") return true;
  if (chunk === "VP8L" && bytes.length > 25) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // byte 20 é a assinatura 0x2f; o cabeçalho de 4 bytes vem logo depois.
    const cabecalho = view.getUint32(21, true);
    return ((cabecalho >>> 28) & 1) === 1;
  }
  return false;
}

/**
 * Retângulo quadrado a recortar de uma imagem `largura`x`altura`.
 *
 * Horizontal sempre centrado; vertical ancorado em `foco` (0 = topo, 1 = base)
 * para não decapitar o personagem numa imagem em pé.
 */
export function calcularRecorte(
  largura: number,
  altura: number,
  foco = FOCO_VERTICAL,
): { sx: number; sy: number; lado: number } {
  const lado = Math.max(1, Math.min(largura, altura));
  return {
    sx: Math.round((largura - lado) / 2),
    sy: Math.round((altura - lado) * foco),
    lado,
  };
}

/** Formato de saída do recorte. PNG só quando é preciso — JPEG pesa bem menos. */
export function formatoDeSaida(comAlfa: boolean): "image/png" | "image/jpeg" {
  return comAlfa ? "image/png" : "image/jpeg";
}

/** Quantos bytes do começo do arquivo bastam para decidir sobre o alfa. */
const BYTES_CABECALHO = 64 * 1024;

/**
 * Deixa uma imagem da pasta pronta para virar personagem: orientação corrigida,
 * recorte quadrado de {@link LADO_RECORTE} e formato que não perde alfa.
 *
 * Dois caminhos, de propósito:
 *  - sem alfa (a foto de família típica, JPEG): passa por `normalizarFoto`, que
 *    resolve o EXIF do iPhone e reduz antes do recorte;
 *  - com alfa (o PNG de personagem): vai direto do arquivo original para o
 *    canvas. `normalizarFoto` devolveria JPEG e o fundo transparente viraria
 *    preto — e PNG não carrega orientação EXIF, então não se perde nada.
 *
 * Só roda no browser (usa canvas).
 */
export async function prepararImagemImportada(arquivo: Blob): Promise<Blob> {
  const cabecalho = new Uint8Array(await arquivo.slice(0, BYTES_CABECALHO).arrayBuffer());
  const comAlfa = detectarAlfa(cabecalho);
  const fonte = comAlfa ? arquivo : await normalizarFoto(arquivo, 1024);

  const bitmap = await carregarImagem(fonte);
  const largura = "width" in bitmap ? bitmap.width : 0;
  const altura = "height" in bitmap ? bitmap.height : 0;
  const { sx, sy, lado } = calcularRecorte(largura, altura);

  const canvas = document.createElement("canvas");
  canvas.width = LADO_RECORTE;
  canvas.height = LADO_RECORTE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    fecharSePuder(bitmap);
    throw new Error("Canvas 2D indisponível — não foi possível recortar a imagem.");
  }
  // Nada de fillRect antes: o canvas nasce transparente e é isso que preserva o
  // fundo vazado do personagem.
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, lado, lado, 0, 0, LADO_RECORTE, LADO_RECORTE);
  fecharSePuder(bitmap);

  const mime = formatoDeSaida(comAlfa);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, 0.85),
  );
  if (!blob) throw new Error("Falha ao gravar a imagem importada.");
  return blob;
}

function fecharSePuder(img: ImageBitmap | HTMLImageElement): void {
  if ("close" in img) img.close();
}

/** `createImageBitmap` com fallback para `<img>` (Safari antigo). */
async function carregarImagem(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // segue para o fallback
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// --------------------------------------------------------------- gravação

export interface ResultadoImportPasta {
  importados: number;
  /** Pulados por já existirem (mesmo nome + papel) ou por repetição na seleção. */
  ignorados: number;
  /** Imagens que não abriram — o resto da importação continua. */
  falhas: string[];
}

export interface OpcoesImportPasta {
  /**
   * Injetável para teste: em Node não há canvas. O padrão é o pipeline real
   * ({@link prepararImagemImportada}).
   */
  processar?: (arquivo: Blob) => Promise<Blob>;
  /** Chamado a cada item concluído — a tela mostra "3 de 7". */
  aoProgredir?: (feitos: number, total: number) => void;
}

/**
 * Grava os itens confirmados na prévia.
 *
 * A dedupe é refeita aqui contra o banco (e não só contra o plano) porque entre
 * montar a prévia e confirmar o adulto pode ter renomeado alguém, trocado o
 * papel — ou simplesmente reimportado a mesma pasta. Reimportar não duplica: o
 * personagem existente é preservado como está, com voz e recorte que já tinha.
 */
export async function importarPasta(
  itens: ItemImportacao[],
  opcoes: OpcoesImportPasta = {},
): Promise<ResultadoImportPasta> {
  const processar = opcoes.processar ?? prepararImagemImportada;
  const existentes = new Set(
    (await listarPersonagens()).map((p) => chaveDedupe(p.nome, p.papel)),
  );

  let importados = 0;
  let ignorados = 0;
  const falhas: string[] = [];
  const total = itens.length;
  let feitos = 0;

  for (const item of itens) {
    feitos++;
    const nome = item.nome.trim();
    const papel: Papel = PAPEIS.includes(item.papel) ? item.papel : "parente";
    const chave = chaveDedupe(nome, papel);
    if (!nome || existentes.has(chave)) {
      ignorados++;
      opcoes.aoProgredir?.(feitos, total);
      continue;
    }
    try {
      const fotoRecorte = await processar(item.arquivo.blob);
      await salvarPersonagem({
        id: novoId(),
        nome,
        papel,
        fotoRecorte,
        vozNome: null,
        vozFesta: null,
      });
      existentes.add(chave);
      importados++;
    } catch {
      falhas.push(item.arquivo.nome);
    }
    opcoes.aoProgredir?.(feitos, total);
  }

  return { importados, ignorados, falhas };
}
