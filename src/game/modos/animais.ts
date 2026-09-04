/**
 * MODO ANIMAIS — dados e lógica PURA do eixo "animais" (vocabulário e escuta).
 * =============================================================================
 *
 * Duas fases na tela (`/jogo/animais`):
 *  - EXPLORAR: a criança toca no bicho e ouve o som dele. Sem pergunta, sem
 *    certo/errado — é o vocabulário entrando pelo ouvido.
 *  - PERGUNTAR: "Quem faz muuu?" usando o engine (`@/game/useRodada`). O engine
 *    só conhece IDs; o mapa `id -> animal` mora aqui (ver `ANIMAIS`).
 *
 * REGRA DE ÁUDIO (o motivo deste arquivo ser puro)
 * ------------------------------------------------
 * Nenhum som deste modo é um arquivo de licença duvidosa. Cada animal declara
 * a origem do som em `som: FonteSom`, e `public/sons/CREDITOS.md` repete a
 * declaração para leitura humana — `animais.test.ts` verifica que os dois
 * batem. Hoje TODOS os sons são gerados por TTS local (`SpeechSynthesis`
 * pt-BR, via a `FilaDeFala`): zero bytes de áudio de terceiros embarcados,
 * zero risco de licença, e funciona offline no tablet.
 *
 * Se algum dia entrar um arquivo CC0 de verdade, troque `som` do animal para
 * `{ tipo: "arquivo", arquivo: "/sons/vaca.wav", licenca: "CC0 1.0", ... }`:
 * `precarregarSons()` já decodifica, NORMALIZA O VOLUME (pico igual para todos
 * os arquivos) e devolve o Blob pronto para a `FilaDeFala` — sem toque na
 * fila nem no engine. É por isso que a máquina de normalização existe mesmo
 * com a lista de arquivos vazia.
 *
 * Este módulo não importa nada em runtime (só tipos), então roda em
 * `node --test --experimental-strip-types src/game/modos/animais.test.ts`.
 */

import type { ConfigRodada } from "../engine.ts";
import type { ItemFala } from "../fala.ts";

// ------------------------------------------------------------------- dados

export type IdAnimal = "vaca" | "cachorro" | "gato" | "pato" | "galo" | "ovelha";

/**
 * De onde vem o som deste animal — e sob qual licença.
 *
 * `tipo: "tts"`   -> onomatopeia falada pelo sintetizador do próprio aparelho.
 *                    Não embarca arquivo nenhum, então não há o que licenciar.
 * `tipo: "arquivo"` -> só é aceito com licença livre COMPROVADA (CC0 ou
 *                    domínio público) declarada em `licenca` + `origem`.
 */
export interface FonteSom {
  tipo: "tts" | "arquivo";
  /** Caminho em `public/` quando `tipo === "arquivo"`. */
  arquivo?: string;
  /** Licença por extenso. Nunca "desconhecida"/"a definir". */
  licenca: string;
  /** URL ou descrição de onde o arquivo veio (obrigatório para `arquivo`). */
  origem: string;
}

export interface Animal {
  id: IdAnimal;
  /** Nome falado/escrito ("vaca"). */
  nome: string;
  /** Artigo definido, para montar frases ("a vaca", "o galo"). */
  artigo: "a" | "o";
  /** O som que o bicho faz, como a criança fala ("Muuu"). */
  onomatopeia: string;
  /** Cor da bolha na tela (token do design system quando possível). */
  cor: string;
  som: FonteSom;
}

/** Licença usada por todos os sons hoje — repetida em `public/sons/CREDITOS.md`. */
export const LICENCA_TTS =
  "Sem arquivo de áudio embarcado — voz sintetizada no aparelho (SpeechSynthesis pt-BR)";
export const ORIGEM_TTS = "Gerado em tempo real pelo próprio dispositivo";

function tts(): FonteSom {
  return { tipo: "tts", licenca: LICENCA_TTS, origem: ORIGEM_TTS };
}

/**
 * Catálogo do modo. Seis bichos: dá pool de sobra para as 4 alternativas do
 * nível máximo de `dificuldade.ts` e ainda cabe na tela do tablet em 3x2.
 */
export const ANIMAIS: readonly Animal[] = [
  { id: "vaca", nome: "vaca", artigo: "a", onomatopeia: "Muuu", cor: "#f2b5a0", som: tts() },
  { id: "cachorro", nome: "cachorro", artigo: "o", onomatopeia: "Au au", cor: "#e8a33d", som: tts() },
  { id: "gato", nome: "gato", artigo: "o", onomatopeia: "Miau", cor: "#c77dff", som: tts() },
  { id: "pato", nome: "pato", artigo: "o", onomatopeia: "Quá quá", cor: "#ffd166", som: tts() },
  { id: "galo", nome: "galo", artigo: "o", onomatopeia: "Cocoricó", cor: "#ff7a5c", som: tts() },
  { id: "ovelha", nome: "ovelha", artigo: "a", onomatopeia: "Méé", cor: "#a8dadc", som: tts() },
];

export const IDS_ANIMAIS: readonly IdAnimal[] = ANIMAIS.map((a) => a.id);

const POR_ID = new Map<string, Animal>(ANIMAIS.map((a) => [a.id, a]));

/** Lança se o id não existe: um mini-jogo com id inválido é bug, não UX. */
export function animalPorId(id: string): Animal {
  const animal = POR_ID.get(id);
  if (!animal) throw new Error(`Animal desconhecido: ${id}`);
  return animal;
}

// ------------------------------------------------------------------ falas

/** "Quem faz muuu?" — a pergunta é o SOM, não o nome (é um jogo auditivo). */
export function perguntaDe(id: string): string {
  return `Quem faz ${animalPorId(id).onomatopeia.toLowerCase()}?`;
}

/** "Isso! A vaca faz muuu!" — a comemoração fecha o vínculo som -> bicho. */
export function festaDe(id: string): string {
  const a = animalPorId(id);
  const artigo = a.artigo === "a" ? "A" : "O";
  return `Isso! ${artigo} ${a.nome} faz ${a.onomatopeia.toLowerCase()}!`;
}

/** Reforços do `quaseLa` — sempre convidam a escutar de novo, nunca corrigem. */
export const REFORCOS_ANIMAIS: readonly string[] = [
  "Quase! Escuta de novo!",
  "Ih! Quem será que faz esse som?",
  "Opa! Vamos ouvir mais uma vez!",
];

/**
 * Fala de um toque na fase EXPLORAR.
 *
 * Três detalhes que garantem "nunca sobrepõe" (DoD 2):
 *  - `chave` por animal: martelar o MESMO bicho vira um áudio só (dedupe da fila);
 *  - `prioridade: "normal"`: bichos DIFERENTES entram na fila e tocam em
 *    sequência — som alto cortaria o anterior, que é exatamente o que não
 *    queremos aqui (a criança pediu para ouvir os três);
 *  - `audio`: usa o Blob pré-carregado quando existe; senão a fila cai no TTS.
 */
export function falaDoAnimal(id: string, sons?: ReadonlyMap<string, Blob>): ItemFala {
  const animal = animalPorId(id);
  return {
    chave: `bicho:${animal.id}`,
    texto: animal.onomatopeia,
    audio: sons?.get(animal.id) ?? null,
    prioridade: "normal",
  };
}

/** Fala o NOME do bicho (usada no reforço depois do som, e no aquário). */
export function falaNomeDoAnimal(id: string): ItemFala {
  const animal = animalPorId(id);
  return { chave: `nome:${animal.id}`, texto: animal.nome, prioridade: "normal" };
}

// ----------------------------------------------------------------- rodada

/**
 * Configuração da rodada de PERGUNTAR para o engine.
 *
 * As alternativas vêm de fora (`montarAlternativas` de `dificuldade.ts`) para
 * este módulo continuar sem dependências de runtime — e para a dificuldade
 * adaptativa ser a mesma dos outros três mini-jogos.
 */
export function configRodadaAnimais(
  correta: string,
  alternativas: readonly string[],
): ConfigRodada {
  return {
    pergunta: perguntaDe(correta),
    alternativas,
    correta,
    festa: festaDe(correta),
    reforcos: REFORCOS_ANIMAIS,
  };
}

/** `Math.random` por padrão; injete um gerador determinístico nos testes. */
export type Sorteio = () => number;

/**
 * Sorteia o próximo animal da rodada evitando repetir o anterior — duas
 * rodadas seguidas com o mesmo bicho parecem um jogo travado.
 */
export function proximoAnimal(
  anterior: string | null,
  sortear: Sorteio = Math.random,
  pool: readonly string[] = IDS_ANIMAIS,
): IdAnimal {
  const candidatos = pool.filter((id) => id !== anterior);
  const lista = candidatos.length > 0 ? candidatos : pool;
  const i = Math.min(lista.length - 1, Math.floor(sortear() * lista.length));
  return lista[i] as IdAnimal;
}

// ------------------------------------------------- normalização de volume

/**
 * Pico alvo depois da normalização. 0.89 (e não 1.0) deixa headroom: som
 * batendo no teto distorce no alto-falante fraco de tablet.
 */
export const PICO_ALVO = 0.89;
/** Teto do ganho: um arquivo quase mudo não pode virar chiado amplificado 50x. */
export const GANHO_MAXIMO = 8;

/** Maior valor absoluto entre todos os canais (0 quando não há amostra). */
export function picoDe(canais: readonly Float32Array[]): number {
  let pico = 0;
  for (const canal of canais) {
    for (let i = 0; i < canal.length; i++) {
      const v = Math.abs(canal[i]);
      if (v > pico) pico = v;
    }
  }
  return pico;
}

/** Ganho que leva `pico` até `alvo`, limitado por `GANHO_MAXIMO`. */
export function ganhoNormalizador(pico: number, alvo: number = PICO_ALVO): number {
  if (!(pico > 0) || !Number.isFinite(pico)) return 1;
  return Math.min(GANHO_MAXIMO, alvo / pico);
}

/**
 * Normaliza os canais NO LUGAR e devolve o ganho aplicado. É isto que faz
 * todos os arquivos embarcados soarem no mesmo volume (edge case da task):
 * sem isso, um "muuu" gravado baixo assusta ninguém e um "au au" alto assusta
 * a criança.
 */
export function normalizarCanais(canais: readonly Float32Array[], alvo: number = PICO_ALVO): number {
  const ganho = ganhoNormalizador(picoDe(canais), alvo);
  if (ganho === 1) return 1;
  for (const canal of canais) {
    for (let i = 0; i < canal.length; i++) canal[i] = Math.max(-1, Math.min(1, canal[i] * ganho));
  }
  return ganho;
}

/**
 * PCM float -> WAV 16 bits. A `FilaDeFala` toca `Blob`s via `decodeAudioData`,
 * e WAV é o formato mais barato de escrever à mão (e o mais compatível).
 */
export function codificarWav(canais: readonly Float32Array[], taxaAmostragem: number): ArrayBuffer {
  const nCanais = Math.max(1, canais.length);
  const nAmostras = canais[0]?.length ?? 0;
  const bytesPorAmostra = 2;
  const blocoAlinhamento = nCanais * bytesPorAmostra;
  const tamanhoDados = nAmostras * blocoAlinhamento;
  const buffer = new ArrayBuffer(44 + tamanhoDados);
  const view = new DataView(buffer);

  const texto = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  texto(0, "RIFF");
  view.setUint32(4, 36 + tamanhoDados, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  view.setUint32(16, 16, true); // tamanho do bloco fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, nCanais, true);
  view.setUint32(24, taxaAmostragem, true);
  view.setUint32(28, taxaAmostragem * blocoAlinhamento, true);
  view.setUint16(32, blocoAlinhamento, true);
  view.setUint16(34, 8 * bytesPorAmostra, true);
  texto(36, "data");
  view.setUint32(40, tamanhoDados, true);

  let offset = 44;
  for (let i = 0; i < nAmostras; i++) {
    for (let c = 0; c < nCanais; c++) {
      const amostra = Math.max(-1, Math.min(1, canais[c]?.[i] ?? 0));
      view.setInt16(offset, Math.round(amostra * (amostra < 0 ? 0x8000 : 0x7fff)), true);
      offset += 2;
    }
  }
  return buffer;
}

// --------------------------------------------------- pré-carga (navegador)

/**
 * Cache dos sons já decodificados e normalizados. Module-level de propósito:
 * entrar e sair da tela do modo não paga o download/decode de novo.
 */
const cacheSons = new Map<string, Blob>();
let precarga: Promise<ReadonlyMap<string, Blob>> | null = null;

/**
 * Espera o `SpeechSynthesis` publicar as vozes.
 *
 * É a "pré-carga" dos sons de TTS: no Chrome `getVoices()` volta vazio até o
 * evento `voiceschanged`, e falar antes disso sai com a voz errada (ou em
 * inglês). Chamar isto ao montar a tela é o que faz o PRIMEIRO toque no bicho
 * responder na hora, sem engasgo.
 */
export function aquecerVozes(esperaMs = 1500): Promise<void> {
  const sintese: SpeechSynthesis | undefined = globalThis.speechSynthesis;
  if (!sintese) return Promise.resolve();
  if (sintese.getVoices().length > 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const pronto = () => {
      clearTimeout(timer);
      sintese.removeEventListener("voiceschanged", pronto);
      resolve();
    };
    const timer = setTimeout(pronto, esperaMs);
    sintese.addEventListener("voiceschanged", pronto, { once: true });
  });
}

/**
 * Baixa, DECODIFICA e NORMALIZA todos os sons de arquivo antes do primeiro
 * toque — decodificar dentro do handler atrasaria o som em centenas de ms.
 * Também aquece as vozes do TTS. Idempotente: a segunda chamada reaproveita.
 *
 * Falha de rede/codec não quebra o jogo: o animal cai no TTS (a `FilaDeFala`
 * já faz esse fallback quando o Blob não decodifica).
 */
export function precarregarSons(): Promise<ReadonlyMap<string, Blob>> {
  precarga ??= (async () => {
    await aquecerVozes();
    const arquivos = ANIMAIS.filter((a) => a.som.tipo === "arquivo" && a.som.arquivo);
    if (arquivos.length === 0) return cacheSons;

    const { getAudioContext, unlockAudio } = await import("@/lib/media");
    const ctx = getAudioContext() ?? (await unlockAudio());
    if (!ctx) {
      // Sem gesto do usuário ainda: não cacheia nada e deixa tentar de novo.
      precarga = null;
      return cacheSons;
    }

    await Promise.all(
      arquivos.map(async (animal) => {
        if (cacheSons.has(animal.id)) return;
        try {
          const resposta = await fetch(animal.som.arquivo!);
          if (!resposta.ok) return;
          const bruto = await ctx.decodeAudioData(await resposta.arrayBuffer());
          const canais: Float32Array[] = [];
          for (let c = 0; c < bruto.numberOfChannels; c++) canais.push(bruto.getChannelData(c));
          normalizarCanais(canais);
          const wav = codificarWav(canais, bruto.sampleRate);
          cacheSons.set(animal.id, new Blob([wav], { type: "audio/wav" }));
        } catch {
          // Sem som de arquivo para este bicho: a fila usa o TTS.
        }
      }),
    );
    return cacheSons;
  })();
  return precarga;
}

/** Só para testes: esquece o que já foi pré-carregado. */
export function _resetSons(): void {
  cacheSons.clear();
  precarga = null;
}
