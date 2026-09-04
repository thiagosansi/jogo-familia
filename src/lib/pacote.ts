/**
 * Pacote da Família — backup e transporte manual dos personagens.
 *
 * Por quê: o jogo não tem backend por decisão de projeto. Nada de foto ou voz
 * da família (nem das figuras que o pai desenha/fornece) sobe para nuvem, e o
 * repositório fica livre de arte de terceiros. O preço disso é que o conteúdo
 * mora num único dispositivo — se o tablet quebrar ou for trocado, a família se
 * perde. O Pacote é a saída: um arquivo `.json` que o adulto guarda onde quiser
 * (AirDrop, e-mail para si mesmo, pendrive) e recarrega no novo aparelho.
 *
 * Formato: JSON puro com os Blobs em base64. Não é o mais compacto — um ZIP
 * seria ~30% menor — mas não precisa de dependência nenhuma, abre em qualquer
 * editor de texto e sobrevive a ser aberto/salvo por apps de e-mail.
 *
 * Import é idempotente: a chave é o `id` do personagem, então importar o mesmo
 * pacote duas vezes não cria famílias duplicadas.
 */
import { PAPEIS, getPersonagem, listarPersonagens, salvarPersonagem } from "./db.ts";
import type { Papel, Personagem } from "./tipos.ts";

export const PACOTE_TIPO = "jogo-familia/pacote";
/** Suba a versão só em mudança incompatível; o import aceita versões menores. */
export const PACOTE_VERSAO = 1;

/** Um Blob achatado para caber em JSON. */
export interface ArquivoSerializado {
  mime: string;
  base64: string;
}

export interface PersonagemSerializado {
  id: string;
  nome: string;
  papel: Papel;
  criadoEm: number;
  fotoRecorte: ArquivoSerializado;
  vozNome: ArquivoSerializado | null;
  vozFesta: ArquivoSerializado | null;
}

export interface Pacote {
  tipo: string;
  versao: number;
  geradoEm: number;
  personagens: PersonagemSerializado[];
}

export interface ResultadoImport {
  importados: number;
  /** Já existiam (mesmo `id`) ou vieram malformados — em ambos os casos, pulados. */
  ignorados: number;
}

// ------------------------------------------------------------------- base64

/**
 * Bytes -> base64. O laço em blocos existe porque
 * `String.fromCharCode(...bytes)` com um array de alguns MB estoura o limite de
 * argumentos da engine (RangeError) — e uma foto 512x512 mais duas vozes passam
 * disso fácil quando a família tem seis personagens.
 */
function paraBase64(bytes: Uint8Array): string {
  const bloco = 0x8000;
  let binario = "";
  for (let i = 0; i < bytes.length; i += bloco) {
    binario += String.fromCharCode(...bytes.subarray(i, i + bloco));
  }
  return btoa(binario);
}

// O parâmetro de tipo é explícito: sem ele o TS infere `ArrayBufferLike`,
// que não satisfaz `BlobPart` (poderia ser um SharedArrayBuffer).
function deBase64(texto: string): Uint8Array<ArrayBuffer> {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function serializarBlob(blob: Blob): Promise<ArquivoSerializado> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { mime: blob.type || "application/octet-stream", base64: paraBase64(bytes) };
}

function desserializarBlob(arquivo: ArquivoSerializado): Blob {
  return new Blob([deBase64(arquivo.base64)], { type: arquivo.mime });
}

// ------------------------------------------------------------------- export

async function serializarPersonagem(p: Personagem): Promise<PersonagemSerializado> {
  return {
    id: p.id,
    nome: p.nome,
    papel: p.papel,
    criadoEm: p.criadoEm,
    fotoRecorte: await serializarBlob(p.fotoRecorte),
    vozNome: p.vozNome ? await serializarBlob(p.vozNome) : null,
    vozFesta: p.vozFesta ? await serializarBlob(p.vozFesta) : null,
  };
}

/**
 * Monta o pacote com TODOS os personagens gravados. Devolve um Blob pronto para
 * `URL.createObjectURL` + `<a download>`.
 */
export async function exportarPacote(): Promise<Blob> {
  const personagens = await listarPersonagens();
  const pacote: Pacote = {
    tipo: PACOTE_TIPO,
    versao: PACOTE_VERSAO,
    geradoEm: Date.now(),
    personagens: await Promise.all(personagens.map(serializarPersonagem)),
  };
  return new Blob([JSON.stringify(pacote)], { type: "application/json" });
}

/** `familia-2026-09-02.json` — nome sugerido para o download. */
export function nomeArquivoPacote(quando: Date = new Date()): string {
  const d = (n: number) => String(n).padStart(2, "0");
  return `familia-${quando.getFullYear()}-${d(quando.getMonth() + 1)}-${d(quando.getDate())}.json`;
}

// ------------------------------------------------------------------- import

function ehArquivo(v: unknown): v is ArquivoSerializado {
  const a = v as ArquivoSerializado | null;
  return !!a && typeof a.base64 === "string" && typeof a.mime === "string";
}

/** Rejeita entradas malformadas antes de encostar no banco. */
function validar(v: unknown): PersonagemSerializado | null {
  const p = v as Partial<PersonagemSerializado> | null;
  if (!p || typeof p !== "object") return null;
  if (typeof p.id !== "string" || !p.id) return null;
  if (typeof p.nome !== "string" || !p.nome) return null;
  if (!PAPEIS.includes(p.papel as Papel)) return null;
  if (!ehArquivo(p.fotoRecorte)) return null;
  return {
    id: p.id,
    nome: p.nome,
    papel: p.papel as Papel,
    criadoEm: typeof p.criadoEm === "number" ? p.criadoEm : Date.now(),
    fotoRecorte: p.fotoRecorte,
    vozNome: ehArquivo(p.vozNome) ? p.vozNome : null,
    vozFesta: ehArquivo(p.vozFesta) ? p.vozFesta : null,
  };
}

/** Erro com texto que pode ir direto para a tela do adulto. */
export class PacoteInvalidoError extends Error {}

/**
 * Lê um Pacote e grava os personagens que ainda não existem.
 *
 * Dedupe por `id`: personagem já presente conta em `ignorados` e NÃO é
 * sobrescrito — o adulto pode ter regravado a voz da mãe neste aparelho depois
 * de exportar, e um import não pode desfazer isso silenciosamente.
 */
export async function importarPacote(arquivo: Blob): Promise<ResultadoImport> {
  let bruto: unknown;
  try {
    bruto = JSON.parse(await arquivo.text());
  } catch {
    throw new PacoteInvalidoError("Esse arquivo não é um Pacote da Família.");
  }

  const pacote = bruto as Partial<Pacote> | null;
  if (!pacote || pacote.tipo !== PACOTE_TIPO || !Array.isArray(pacote.personagens)) {
    throw new PacoteInvalidoError("Esse arquivo não é um Pacote da Família.");
  }
  if (typeof pacote.versao !== "number" || pacote.versao > PACOTE_VERSAO) {
    throw new PacoteInvalidoError(
      "Esse pacote foi criado numa versão mais nova do jogo. Atualize o aplicativo e tente de novo.",
    );
  }

  let importados = 0;
  let ignorados = 0;
  for (const entrada of pacote.personagens) {
    const valido = validar(entrada);
    if (!valido) {
      ignorados++;
      continue;
    }
    if (await getPersonagem(valido.id)) {
      ignorados++;
      continue;
    }
    await salvarPersonagem({
      id: valido.id,
      criadoEm: valido.criadoEm,
      nome: valido.nome,
      papel: valido.papel,
      fotoRecorte: desserializarBlob(valido.fotoRecorte),
      vozNome: valido.vozNome ? desserializarBlob(valido.vozNome) : null,
      vozFesta: valido.vozFesta ? desserializarBlob(valido.vozFesta) : null,
    });
    importados++;
  }
  return { importados, ignorados };
}
