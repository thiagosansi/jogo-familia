/**
 * MODO "QUEM É QUEM" — o coração afetivo do jogo. Conteúdo e montagem de
 * rodada, PURO (sem React, sem DOM, sem IndexedDB). Roda em node:
 * `node --test --experimental-strip-types src/game/modos/familia.test.ts`.
 *
 * A criança identifica mamãe, papai, o irmão e os parentes pela FOTO, com a
 * pergunta na VOZ GRAVADA da própria família. É o único modo que depende de
 * cadastro — por isso `podeJogar()` existe e a página tem que chamá-la ANTES
 * de montar rodada: sem gente cadastrada a tela vira convite ao adulto, nunca
 * um erro na cara da criança.
 *
 * O engine (`@/game/engine`) só conhece IDs de alternativa; aqui os IDs são os
 * `personagem.id` do IndexedDB. Este módulo é o mapa `id -> pessoa`.
 *
 *   const fichas = await listarPersonagens();
 *   if (!podeJogar(fichas)) return <Convite />;
 *   const r = montarRodadaFamilia({ fichas, qtd: dif.alternativas, anterior, sortear });
 *   useRodada({ pergunta: r.pergunta, alternativas: r.alternativas, correta: r.correta },
 *              { vozes: vozesDaRodada(r.alvo) });
 *
 * TRÊS REGRAS QUE ESTE MÓDULO GARANTE (e `familia.test.ts` cobre)
 * --------------------------------------------------------------
 * 1. MASCOTE NUNCA É ALVO. Ele entra como distrator e como apresentador
 *    (`apresentador()`), mas ninguém pergunta "cadê o peixinho?" num modo cujo
 *    assunto é a família de verdade.
 * 2. NÃO REPETE O ALVO em rodadas seguidas (`proximoAlvo(..., anterior)`) —
 *    enquanto houver mais de um alvo possível. Com um alvo só, repetir é a
 *    única saída possível e continua jogável.
 * 3. DESAMBIGUAÇÃO PELO NOME. "Cadê o papai?" só sai se existir UM `pai` no
 *    elenco. Dois tios (ambos `parente`), duas mães (mãe e madrasta): a
 *    pergunta passa a usar o NOME ("Cadê Ana?"), porque com dois "titio" na
 *    tela nenhuma resposta seria errada — e uma rodada ambígua é pior do que
 *    uma rodada difícil.
 *
 * VOZ: POR QUE A PERGUNTA USA A VOZ DO ALVO (e não a "voz da mãe narradora")
 * -------------------------------------------------------------------------
 * O cadastro grava dois áudios por pessoa: `vozNome` (a pessoa dizendo como é
 * chamada — "Mamãe") e `vozFesta` ("Isso! Muito bem!"). NÃO existe gravação de
 * "Cadê o papai?". Usar a `vozNome` da mãe como narradora da pergunta faria o
 * jogo dizer "Mamãe" enquanto pede o papai — áudio e texto brigando, que para
 * uma criança de 3 anos é ruído puro.
 *
 * Então a pergunta toca a `vozNome` do ALVO: a criança ouve o papai dizendo
 * "Papai!" e procura o papai. Voz conhecida (o objetivo do brief), nunca
 * semanticamente errada. Sem gravação, `FilaDeFala` cai sozinha para o
 * `SpeechSynthesis` pt-BR com a frase inteira ("Cadê o papai?").
 *
 * O reforço do `quaseLa` fica DE PROPÓSITO sem áudio gravado: o único áudio
 * disponível para isso seria a `vozFesta` ("Isso!"), e comemorar um toque
 * errado ensina a coisa errada. Reforço é TTS, sempre positivo.
 */

import { embaralhar, montarAlternativas, type Sorteio } from "../dificuldade.ts";
import type { Papel, Personagem } from "../../lib/tipos.ts";

// ------------------------------------------------------------------ fichas

/**
 * O mínimo que este módulo precisa saber de uma pessoa. A página passa o
 * `Personagem` inteiro (com foto e vozes) e recebe o mesmo objeto de volta nas
 * alternativas — os genéricos abaixo preservam o tipo de quem chamou.
 */
export type FichaFamiliar = Pick<Personagem, "id" | "nome" | "papel">;

/** Papéis que podem ser ALVO da pergunta. Mascote fora: ele é figurante. */
export const PAPEIS_ALVO: readonly Papel[] = ["mae", "pai", "irmao", "parente"];

export function ehAlvoPossivel(ficha: FichaFamiliar): boolean {
  return PAPEIS_ALVO.includes(ficha.papel);
}

/** Quem pode ser perguntado nesta sessão (mascotes ficam de fora). */
export function alvosPossiveis<T extends FichaFamiliar>(fichas: readonly T[]): T[] {
  return fichas.filter(ehAlvoPossivel);
}

/**
 * Dá para jogar com este elenco?
 *
 * Precisa de pelo menos UM alvo possível (senão não há o que perguntar) e de
 * pelo menos DUAS caras na tela (o engine recusa rodada com uma alternativa
 * só). Um mascote conta como cara na tela, mas nunca como alvo — então
 * "mãe + peixinho" já é um jogo válido, e "só o peixinho" não é.
 */
export function podeJogar(fichas: readonly FichaFamiliar[]): boolean {
  return alvosPossiveis(fichas).length >= 1 && fichas.length >= 2;
}

/** Mestre de cerimônias: o primeiro mascote cadastrado, se houver. */
export function apresentador<T extends FichaFamiliar>(fichas: readonly T[]): T | null {
  return fichas.find((f) => f.papel === "mascote") ?? null;
}

// ------------------------------------------------------------------ rótulos

/** Como cada papel é chamado quando é o único do elenco naquele papel. */
const TERMO_DO_PAPEL: Record<Papel, string> = {
  mae: "a mamãe",
  pai: "o papai",
  irmao: "o irmão",
  parente: "essa pessoa",
  mascote: "o bichinho",
};

/**
 * Papéis cujo termo carinhoso pode substituir o nome ("a mamãe", "o papai").
 * `parente` fica fora: "essa pessoa" não identifica ninguém — tio, tia, avó e
 * madrinha entram todos como `parente`, então lá o nome é obrigatório.
 */
const PAPEIS_COM_APELIDO: readonly Papel[] = ["mae", "pai", "irmao"];

/**
 * Como esta pessoa é chamada NESTE elenco.
 *
 * Usa o apelido do papel ("a mamãe") quando ele é único e identifica sem
 * ambiguidade; cai para o NOME quando duas pessoas dividem o papel (dois tios,
 * mãe e madrasta) — a desambiguação exigida pelo brief. Nome em branco cai
 * para o apelido do papel, para nunca sobrar uma pergunta vazia.
 */
export function rotuloDe(ficha: FichaFamiliar, elenco: readonly FichaFamiliar[]): string {
  const nome = ficha.nome?.trim();
  const soUm = elenco.filter((f) => f.papel === ficha.papel).length <= 1;
  if (PAPEIS_COM_APELIDO.includes(ficha.papel) && soUm) return TERMO_DO_PAPEL[ficha.papel];
  if (nome) return nome;
  return TERMO_DO_PAPEL[ficha.papel];
}

/** "Cadê a mamãe?" / "Cadê Tio João?" */
export function perguntaDe(ficha: FichaFamiliar, elenco: readonly FichaFamiliar[]): string {
  return `Cadê ${rotuloDe(ficha, elenco)}?`;
}

/** "Isso! A mamãe!" — a comemoração repete quem é, que é o aprendizado. */
export function festaDe(ficha: FichaFamiliar, elenco: readonly FichaFamiliar[]): string {
  return `Isso! ${maiuscula(rotuloDe(ficha, elenco))}!`;
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Reforços do `quaseLa`. Sempre positivos e convidativos — nenhum diz que
 * errou, nenhum nomeia quem ela tocou por engano.
 */
export const REFORCOS_FAMILIA: readonly string[] = [
  "Quase! Olha de novo!",
  "Ih! Cadê?",
  "Tá quase! Procura mais um pouquinho!",
  "Opa! Tenta de novo!",
];

// ------------------------------------------------------------------ rodada

export interface RodadaFamilia<T extends FichaFamiliar = FichaFamiliar> {
  /** Texto falado (fallback do TTS) e rótulo do `<Palco>`. */
  readonly pergunta: string;
  readonly festa: string;
  readonly reforcos: readonly string[];
  /** IDs para o engine, já embaralhados. */
  readonly alternativas: readonly string[];
  readonly correta: string;
  /** A pessoa procurada. */
  readonly alvo: T;
  /** As pessoas das alternativas, na MESMA ordem — o mapa `id -> pessoa`. */
  readonly pessoas: readonly T[];
}

export interface OpcoesRodadaFamilia<T extends FichaFamiliar> {
  fichas: readonly T[];
  /** Quantas caras na tela (vem de `dificuldade.ts`: 2, 3 ou 4). */
  qtd: number;
  /** Força o alvo (testes/roteiro). */
  correta?: string;
  /** Id do alvo da rodada anterior — não repete duas vezes seguidas. */
  anterior?: string | null;
  sortear?: Sorteio;
}

/**
 * Monta uma rodada válida para o engine sem-derrota.
 *
 * Os distratores saem PRIMEIRO dos outros familiares (é assim que a criança
 * aprende a diferenciar mamãe de titia); mascotes só entram para completar a
 * tela quando não há familiares suficientes. `qtd` é um teto, não uma promessa:
 * com 2 pessoas cadastradas a rodada tem 2 alternativas mesmo no nível 4.
 */
export function montarRodadaFamilia<T extends FichaFamiliar>({
  fichas,
  qtd,
  correta,
  anterior = null,
  sortear = Math.random,
}: OpcoesRodadaFamilia<T>): RodadaFamilia<T> {
  if (!podeJogar(fichas)) {
    throw new Error(
      "Elenco insuficiente para o modo família — a página deve checar podeJogar() e mostrar o convite ao adulto.",
    );
  }

  const alvo = correta
    ? (fichas.find((f) => f.id === correta) ?? null)
    : proximoAlvo(fichas, anterior, sortear);
  if (!alvo) throw new Error(`Alvo desconhecido no elenco: ${correta}`);
  if (!ehAlvoPossivel(alvo)) throw new Error(`Mascote não pode ser alvo: ${alvo.id}`);

  const total = Math.min(Math.max(2, Math.round(qtd)), fichas.length);

  // Familiares primeiro (distratores "de verdade")...
  const poolFamiliar = alvosPossiveis(fichas).map((f) => f.id);
  let ids = montarAlternativas(poolFamiliar, alvo.id, clampQtd(total), sortear);

  // ...e mascotes só para completar a tela.
  if (ids.length < total) {
    const extras = embaralhar(
      fichas.filter((f) => !ids.includes(f.id)).map((f) => f.id),
      sortear,
    ).slice(0, total - ids.length);
    ids = embaralhar([...ids, ...extras], sortear);
  }

  const porId = new Map(fichas.map((f) => [f.id, f]));
  const pessoas = ids.map((id) => porId.get(id)!);

  return {
    pergunta: perguntaDe(alvo, fichas),
    festa: festaDe(alvo, fichas),
    reforcos: REFORCOS_FAMILIA,
    alternativas: ids,
    correta: alvo.id,
    alvo,
    pessoas,
  };
}

/** `montarAlternativas` só aceita 2|3|4 — o elenco pode pedir menos/mais. */
function clampQtd(n: number): 2 | 3 | 4 {
  return Math.min(4, Math.max(2, n)) as 2 | 3 | 4;
}

/**
 * Sorteia o alvo da próxima rodada evitando repetir o `anterior`. Com um único
 * alvo possível não há como evitar — e aí repetir é melhor do que não jogar.
 */
export function proximoAlvo<T extends FichaFamiliar>(
  fichas: readonly T[],
  anterior: string | null | undefined,
  sortear: Sorteio = Math.random,
): T {
  const alvos = alvosPossiveis(fichas);
  if (alvos.length === 0) throw new Error("Nenhum familiar cadastrado para ser o alvo.");
  const candidatos = alvos.filter((f) => f.id !== anterior);
  const pool = candidatos.length > 0 ? candidatos : alvos;
  return embaralhar(pool, sortear)[0];
}

// -------------------------------------------------------------------- vozes

/** O que `useRodada` espera em `opcoes.vozes` (`Blob` do IndexedDB ou URL). */
export interface VozesDaRodada {
  pergunta: Blob | string | null;
  festa: Blob | string | null;
  reforco: Blob | string | null;
}

/**
 * Vozes desta rodada. Ver o cabeçalho: pergunta e festa saem na voz do ALVO;
 * o reforço é sempre TTS. `null` em qualquer slot NÃO trava nada — a
 * `FilaDeFala` fala o texto com `SpeechSynthesis` pt-BR.
 */
export function vozesDaRodada(
  alvo: Pick<Personagem, "vozNome" | "vozFesta"> | null | undefined,
): VozesDaRodada {
  return {
    pergunta: alvo?.vozNome ?? null,
    festa: alvo?.vozFesta ?? alvo?.vozNome ?? null,
    reforco: null,
  };
}

// ---------------------------------------------------------------------- rng

/**
 * PRNG determinístico (mulberry32) — o mesmo contrato de `Sorteio` de
 * `dificuldade.ts`. A página sorteia UMA semente depois de montar e deriva
 * todas as rodadas dela, então re-render (e o duplo render do StrictMode) dá
 * sempre a MESMA rodada; nos testes a semente fixa deixa tudo reproduzível.
 */
export function criarSorteio(semente: number): Sorteio {
  let a = (semente >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
