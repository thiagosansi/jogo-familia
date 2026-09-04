/**
 * MODO "LETRAS" — dois subjogos do eixo `letras`, conteúdo e montagem de
 * rodada PUROS (sem React, sem DOM, sem IO). Roda em node:
 * `node --test --experimental-strip-types src/game/modos/letras.test.ts`.
 *
 * DOIS SUBJOGOS
 * -------------
 *  1. `montarRodadaSomInicial` — "Qual começa com a letra P?": a cena mostra
 *     o GLIFO grande da letra-alvo; as alternativas são desenhos JÁ
 *     conhecidos de outros modos (peça do fundo do mar de `cores.ts`, bicho
 *     de `animais.ts`, mascote de `Personagem.tsx`) — nenhuma arte nova.
 *  2. `montarRodadaCadeLetra` — "Cadê a letra M?": as alternativas são os
 *     PRÓPRIOS glifos maiúsculos; a letra-alvo é ANCORADA numa palavra que a
 *     criança já reconhece (o nome dela, um nome de família, ou — na falta
 *     dos dois — o nome de uma figura do catálogo abaixo), na regra "o
 *     inglês nunca chega sozinho" de `ingles.ts`, adaptada aqui para
 *     alfabetização: uma letra pelada não significa nada para quem está
 *     aprendendo; "M de Mamãe" significa.
 *
 * REGRA DE OURO: NENHUMA RODADA PODE TER DUAS ALTERNATIVAS COM A MESMA
 * LETRA-INICIAL (mesmo espírito de "cor nunca é a única pista" de
 * `cores.ts`). Em `montarRodadaSomInicial` isso é ativamente montado (uma
 * figura por letra distinta, nunca duas do mesmo catálogo com a mesma letra
 * na mesma tela) e verificado de novo antes de devolver a rodada — senão a
 * pergunta "qual começa com P?" teria duas respostas certas. Em
 * `montarRodadaCadeLetra` a garantia é estrutural: as alternativas são
 * `montarAlternativas` sobre o alfabeto inteiro (26 letras únicas), então
 * nunca repetem sozinhas.
 *
 * DECISÃO DE VOZ (produto, já tomada — este módulo só respeita): a letra é
 * falada PELO NOME via síntese pt-BR ("P" sai como "pê", "M" como "eme") —
 * o sintetizador do aparelho já lê uma letra maiúscula sozinha corretamente,
 * então a pergunta/festa aqui é só texto normal com a letra dentro
 * ("Qual começa com a letra P?", "Isso! M de Mamãe!"). O que NUNCA pode
 * acontecer é pedir para o TTS falar uma SÍLABA isolada ("pa", "ma"): o
 * sintetizador pt-BR soletra ("pê-a", "eme-a") em vez de ler o som — por
 * isso este módulo nunca produz texto de sílaba, só a letra inteira ou a
 * palavra-âncora inteira.
 *
 * Uso típico (a página monta o `ConfigRodada` do `useRodada`):
 *
 *   const r = montarRodadaSomInicial({ qtd: dif.alternativas, sortear });
 *   useRodada({ pergunta: r.pergunta, alternativas: r.alternativas, correta: r.correta });
 *
 *   const ancoras = ancorasDe(personagens.map((p) => p.nome), config.nomeCrianca);
 *   const r2 = montarRodadaCadeLetra({ ancoras, qtd: dif.alternativas, sortear });
 *
 * Imports com extensão `.ts` explícita (e só `import type` para fora de
 * `src/game`): é o que deixa `node --test --experimental-strip-types` rodar
 * este módulo sem bundler — `import type` é apagado inteiro pelo "type
 * stripping" do Node, então nunca tenta resolver o alias `@/...` em tempo de
 * execução (só o compilador/bundler do Next.js resolve esse import, e só
 * para o TIPO). Por isso `Mascote` (que mora em `@/components/Personagem`,
 * fora de `src/game`) só pode ser um `import type` aqui — e os VALORES que
 * este módulo precisa desse catálogo (quais mascotes existem) são repetidos
 * como constante local, mesmo padrão de `MASCOTES_FALLBACK` em
 * `@/game/recompensa`.
 */

import {
  embaralhar,
  montarAlternativas,
  TETO_ABSOLUTO,
  type QtdAlternativas,
  type Sorteio,
} from "../dificuldade.ts";
import { IDS_ANIMAIS, animalPorId, type IdAnimal } from "./animais.ts";
import { CORES, FORMAS, IDS_COR, IDS_FORMA, peca, type CorId, type FormaObjeto } from "./cores.ts";
import type { Mascote } from "@/components/Personagem";

/** `montarAlternativas`/`dificuldadeInicial(2, 6)` — nunca menos de 2, nunca mais de 6. */
function clampQtd(n: number): QtdAlternativas {
  return Math.min(TETO_ABSOLUTO, Math.max(2, Math.round(n))) as QtdAlternativas;
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Primeira letra de uma palavra, em maiúscula e SEM ACENTO (`Ç` -> `C`,
 * `Â` -> `A`) — via `normalize("NFD")`, que separa a letra-base do sinal
 * diacrítico, e um regex que descarta só os diacríticos (faixa Unicode
 * `U+0300`-`U+036F`, os "combining diacritical marks"). `null` quando a
 * palavra não começa com uma letra do alfabeto (vazia, só espaço, começa com
 * número/símbolo) — chamado por `ancorasDe` (descarta a palavra) e pelo
 * catálogo abaixo (`figura`, que lança: todo item do catálogo TEM que render
 * uma letra).
 */
export function normalizarLetra(bruta: string): string | null {
  const primeira = bruta.trim().charAt(0);
  if (!primeira) return null;
  const semAcento = primeira.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  return /^[A-Z]$/.test(semAcento) ? semAcento : null;
}

// ============================================================ som inicial

/**
 * Como desenhar esta figura — sempre um desenho JÁ existente (nenhuma arte
 * nova): uma peça do fundo do mar (`cores.ts`), um bicho de fazenda
 * (`animais.ts`) ou um mascote do fundo do mar (`Personagem.tsx`).
 */
export type DesenhoLetra =
  | { readonly tipo: "forma"; readonly forma: FormaObjeto; readonly cor: CorId }
  | { readonly tipo: "animal"; readonly animal: IdAnimal }
  | { readonly tipo: "mascote"; readonly mascote: Mascote };

export interface FiguraLetra {
  readonly id: string;
  /** Nome falado/exibido para o adulto ("peixinho", "vaca"). */
  readonly nome: string;
  /** Letra inicial, derivada de `nome` (maiúscula, sem acento). */
  readonly letra: string;
  readonly desenho: DesenhoLetra;
}

/** A cor exclusiva de cada forma, herdada da bijeção de `cores.ts` (mesmo padrão de `ingles.ts`). */
const COR_POR_FORMA = new Map<FormaObjeto, CorId>(CORES.map((c) => [c.forma, c.id]));

function corDaForma(forma: FormaObjeto): CorId {
  const cor = COR_POR_FORMA.get(forma);
  if (!cor) throw new Error(`Forma sem cor correspondente no catálogo de cores: ${forma}`);
  return cor;
}

/** Monta uma figura derivando `letra` de `nome` — lança se `nome` não render uma letra (bug de catálogo, não de dado do usuário). */
function figura(id: string, nome: string, desenho: DesenhoLetra): FiguraLetra {
  const letra = normalizarLetra(nome);
  if (!letra) throw new Error(`Não foi possível derivar a letra inicial de "${nome}" (id: ${id}).`);
  return { id, nome, letra, desenho };
}

/**
 * Mascotes do fundo do mar usados aqui: só os que NÃO duplicam a forma já
 * coberta acima (`peixe`/`estrela` já entram via `cores.ts`) — repetido de
 * `Personagem.tsx` (`MASCOTES`) porque um import de valor de fora de
 * `src/game` quebraria `node --test` (ver cabeçalho do arquivo). Mudar a
 * lista de mascotes lá exige mudar aqui também — `letras.test.ts` não tem
 * como flagrar isso sozinho, é o preço documentado da duplicação.
 */
const MASCOTES_LETRAS: readonly Mascote[] = ["polvo", "caranguejo"];

/**
 * Catálogo do subjogo "som inicial". Treze figuras, oito letras distintas
 * (P, C, E, B, A, V, G, O) — dá pool de sobra para o teto de 6 alternativas
 * de `dificuldade.ts` (`TETO_ABSOLUTO`) sem repetir letra na mesma tela.
 */
export const FIGURAS: readonly FiguraLetra[] = [
  figura("forma-peixe", FORMAS.peixe.singular, { tipo: "forma", forma: "peixe", cor: corDaForma("peixe") }),
  figura("forma-concha", FORMAS.concha.singular, { tipo: "forma", forma: "concha", cor: corDaForma("concha") }),
  figura("forma-estrela", FORMAS.estrela.singular, { tipo: "forma", forma: "estrela", cor: corDaForma("estrela") }),
  figura("forma-bolha", FORMAS.bolha.singular, { tipo: "forma", forma: "bolha", cor: corDaForma("bolha") }),
  figura("forma-aguaViva", FORMAS.aguaViva.singular, {
    tipo: "forma",
    forma: "aguaViva",
    cor: corDaForma("aguaViva"),
  }),
  figura("animal-vaca", animalPorId("vaca").nome, { tipo: "animal", animal: "vaca" }),
  figura("animal-cachorro", animalPorId("cachorro").nome, { tipo: "animal", animal: "cachorro" }),
  figura("animal-gato", animalPorId("gato").nome, { tipo: "animal", animal: "gato" }),
  figura("animal-pato", animalPorId("pato").nome, { tipo: "animal", animal: "pato" }),
  figura("animal-galo", animalPorId("galo").nome, { tipo: "animal", animal: "galo" }),
  figura("animal-ovelha", animalPorId("ovelha").nome, { tipo: "animal", animal: "ovelha" }),
  figura("mascote-polvo", "polvo", { tipo: "mascote", mascote: "polvo" }),
  figura("mascote-caranguejo", "caranguejo", { tipo: "mascote", mascote: "caranguejo" }),
];

const FIGURA_POR_ID = new Map<string, FiguraLetra>(FIGURAS.map((f) => [f.id, f]));

export function figuraPorId(id: string): FiguraLetra {
  const achada = FIGURA_POR_ID.get(id);
  if (!achada) throw new Error(`Figura desconhecida no modo letras: ${id}`);
  return achada;
}

/** Figuras agrupadas por letra inicial — o "pool por letra" que as duas rodadas sorteiam. */
const FIGURAS_POR_LETRA = new Map<string, FiguraLetra[]>();
for (const f of FIGURAS) {
  const lista = FIGURAS_POR_LETRA.get(f.letra) ?? [];
  lista.push(f);
  FIGURAS_POR_LETRA.set(f.letra, lista);
}

/** Letras distintas cobertas pelo catálogo, na ordem de primeira aparição. */
export const LETRAS_FIGURAS: readonly string[] = [...FIGURAS_POR_LETRA.keys()];

/** As 26 letras do alfabeto — pool de distratores de `montarRodadaCadeLetra`. */
export const ALFABETO: readonly string[] = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

/** Nenhuma alternativa desta rodada compartilha letra com outra (a garantia central do módulo). */
export function letrasDistintas(figuras: readonly FiguraLetra[]): boolean {
  const letras = figuras.map((f) => f.letra);
  return new Set(letras).size === letras.length;
}

/**
 * Validação do catálogo — chamada no import (falha alto e cedo) e reusada
 * pelos testes: ids únicos, letra bem formada, e todo desenho referenciado
 * existe de verdade nos catálogos de origem (`cores.ts`/`animais.ts`/
 * `Personagem.tsx`), com a cor de cada `forma` batendo com a bijeção de
 * `cores.ts`.
 */
export function validarCatalogoLetras(): true {
  const ids = new Set<string>();
  const idsFormaValidos = new Set<string>(IDS_FORMA);
  const idsCorValidos = new Set<string>(IDS_COR);
  const idsAnimalValidos = new Set<string>(IDS_ANIMAIS);

  for (const f of FIGURAS) {
    if (ids.has(f.id)) throw new Error(`Id repetido no catálogo de letras: ${f.id}`);
    ids.add(f.id);
    if (!/^[A-Z]$/.test(f.letra)) throw new Error(`Letra malformada em ${f.id}: "${f.letra}"`);

    if (f.desenho.tipo === "forma") {
      if (!idsFormaValidos.has(f.desenho.forma)) {
        throw new Error(`Figura de letras referencia forma inexistente: ${f.desenho.forma}`);
      }
      if (!idsCorValidos.has(f.desenho.cor) || peca(f.desenho.cor).forma !== f.desenho.forma) {
        throw new Error(`Figura de letras com cor que não bate com a bijeção de cores.ts: ${f.id}`);
      }
    } else if (f.desenho.tipo === "animal") {
      if (!idsAnimalValidos.has(f.desenho.animal)) {
        throw new Error(`Figura de letras referencia animal inexistente: ${f.desenho.animal}`);
      }
    } else {
      if (!MASCOTES_LETRAS.includes(f.desenho.mascote)) {
        throw new Error(`Figura de letras referencia mascote inexistente: ${f.desenho.mascote}`);
      }
    }
  }

  if (LETRAS_FIGURAS.length < TETO_ABSOLUTO) {
    throw new Error(
      `Catálogo de letras precisa de pelo menos ${TETO_ABSOLUTO} letras distintas para o teto de dificuldade (tem ${LETRAS_FIGURAS.length}).`,
    );
  }

  return true;
}

validarCatalogoLetras();

/** Sorteia a próxima letra-alvo do "som inicial", evitando repetir a anterior. */
function proximaLetraSomInicial(anterior: string | null | undefined, sortear: Sorteio): string {
  const candidatas = LETRAS_FIGURAS.filter((l) => l !== anterior);
  const pool = candidatas.length > 0 ? candidatas : LETRAS_FIGURAS;
  return embaralhar(pool, sortear)[0];
}

export interface RodadaSomInicial {
  readonly pergunta: string;
  readonly festa: string;
  /** Letra-alvo desta rodada (a mesma de `figuraPorId(correta).letra`). */
  readonly letra: string;
  /** Id de `FiguraLetra` — não confundir com a letra. */
  readonly correta: string;
  readonly alternativas: readonly string[];
  /** Conteúdo de cada alternativa, na mesma ordem — o mapa `id -> figura`. */
  readonly figuras: readonly FiguraLetra[];
}

export interface OpcoesRodadaSomInicial {
  /** Quantas alternativas na tela (vem de `dificuldade.ts`: 2 a 6). */
  qtd: number;
  /** Letra da rodada anterior — não repete o alvo duas vezes seguidas. */
  anterior?: string | null;
  sortear?: Sorteio;
}

export function montarRodadaSomInicial({
  qtd,
  anterior = null,
  sortear = Math.random,
}: OpcoesRodadaSomInicial): RodadaSomInicial {
  const letraAlvo = proximaLetraSomInicial(anterior, sortear);
  const figurasDoAlvo = FIGURAS_POR_LETRA.get(letraAlvo);
  if (!figurasDoAlvo || figurasDoAlvo.length === 0) {
    throw new Error(`Nenhuma figura cadastrada para a letra ${letraAlvo}.`);
  }
  const correta = embaralhar(figurasDoAlvo, sortear)[0];

  const total = Math.min(Math.max(2, Math.round(qtd)), LETRAS_FIGURAS.length);
  const outrasLetras = embaralhar(
    LETRAS_FIGURAS.filter((l) => l !== letraAlvo),
    sortear,
  ).slice(0, total - 1);
  const distratores = outrasLetras.map((letra) => {
    const pool = FIGURAS_POR_LETRA.get(letra)!;
    return embaralhar(pool, sortear)[0];
  });

  const figuras = embaralhar([correta, ...distratores], sortear);

  // Rede de segurança (mesmo espírito de `formasDistintas` em `cores.ts`): o
  // sorteio acima já garante uma figura por letra distinta, mas se um bug
  // futuro quebrar essa garantia a rodada morre aqui, não na frente da
  // criança — nunca duas respostas certas para "qual começa com P?".
  if (!letrasDistintas(figuras)) {
    throw new Error("Rodada de 'som inicial' com duas figuras da mesma letra — a pergunta ficaria ambígua.");
  }

  return {
    pergunta: `Qual começa com a letra ${letraAlvo}?`,
    festa: `Isso! ${maiuscula(correta.nome)} começa com ${letraAlvo}!`,
    letra: letraAlvo,
    correta: correta.id,
    alternativas: figuras.map((f) => f.id),
    figuras,
  };
}

// ============================================================ cadê a letra

/** De onde veio a palavra que ancora esta letra — usada só para depuração/telemetria; a rodada não distingue. */
export type FonteAncora = "crianca" | "familia" | "figura";

export interface AncoraLetra {
  /** Maiúscula, sem acento (ver `normalizarLetra`). */
  readonly letra: string;
  /** A palavra inteira, como deve ser falada/exibida ("Mamãe", "Ana Clara", "Peixinho"). */
  readonly palavra: string;
  readonly fonte: FonteAncora;
}

/**
 * Monta as âncoras "letra -> palavra que a criança reconhece", na prioridade
 * CRIANÇA > FAMÍLIA > FIGURA (mesma regra de `ingles.ts`: uma letra pelada
 * não ensina nada — precisa vir grudada numa palavra conhecida). Cada letra
 * aparece NO MÁXIMO UMA VEZ: a primeira fonte que a cobrir vence, e uma
 * letra sem NENHUMA âncora simplesmente fica de fora (nunca vira rodada,
 * então nunca aparece — ver `montarRodadaCadeLetra`).
 *
 * Funciona sem `nomeCrianca` e sem `nomes` (edge case obrigatório): o
 * catálogo `FIGURAS` sozinho já cobre 8 letras, então `montarRodadaCadeLetra`
 * sempre tem o que jogar desde o primeiro uso.
 */
export function ancorasDe(nomes: readonly string[], nomeCrianca?: string): readonly AncoraLetra[] {
  const porLetra = new Map<string, AncoraLetra>();

  const tentar = (palavraBruta: string | undefined | null, fonte: FonteAncora, capitalizar: boolean) => {
    if (!palavraBruta) return;
    const letra = normalizarLetra(palavraBruta);
    if (!letra) return;
    if (porLetra.has(letra)) return; // já tem âncora de uma fonte de prioridade maior/igual
    const palavra = palavraBruta.trim();
    porLetra.set(letra, { letra, palavra: capitalizar ? maiuscula(palavra) : palavra, fonte });
  };

  tentar(nomeCrianca, "crianca", false);
  for (const nome of nomes) tentar(nome, "familia", false);
  // Nomes próprios (criança/família) já chegam capitalizados pelo adulto; o
  // catálogo guarda nomes comuns em minúscula ("peixinho"), então só ESTA
  // fonte precisa da capitalização para "P de Peixinho" sair certo.
  for (const f of FIGURAS) tentar(f.nome, "figura", true);

  return [...porLetra.values()].sort((a, b) => (a.letra < b.letra ? -1 : a.letra > b.letra ? 1 : 0));
}

function proximaAncora(
  ancoras: readonly AncoraLetra[],
  anterior: string | null | undefined,
  sortear: Sorteio,
): AncoraLetra {
  if (ancoras.length === 0) {
    throw new Error("Nenhuma âncora disponível para montar a rodada de 'Cadê a letra?'.");
  }
  const candidatas = ancoras.filter((a) => a.letra !== anterior);
  const pool = candidatas.length > 0 ? candidatas : ancoras;
  return embaralhar(pool, sortear)[0];
}

export interface RodadaCadeLetra {
  readonly pergunta: string;
  readonly festa: string;
  /** A letra-alvo (maiúscula) — também é o id da alternativa correta. */
  readonly correta: string;
  readonly alternativas: readonly string[];
  /** A âncora usada nesta rodada (para a página, se precisar mostrar a palavra). */
  readonly ancora: AncoraLetra;
}

export interface OpcoesRodadaCadeLetra {
  ancoras: readonly AncoraLetra[];
  /** Quantas alternativas na tela (vem de `dificuldade.ts`: 2 a 6). */
  qtd: number;
  /** Letra da rodada anterior — não repete o alvo duas vezes seguidas. */
  anterior?: string | null;
  sortear?: Sorteio;
}

export function montarRodadaCadeLetra({
  ancoras,
  qtd,
  anterior = null,
  sortear = Math.random,
}: OpcoesRodadaCadeLetra): RodadaCadeLetra {
  const ancora = proximaAncora(ancoras, anterior, sortear);
  // As alternativas vêm do alfabeto inteiro (26 letras, todas únicas) — nunca
  // duas alternativas compartilham letra, por construção (ver cabeçalho).
  const alternativas = montarAlternativas(ALFABETO, ancora.letra, clampQtd(qtd), sortear);

  return {
    pergunta: `Cadê a letra ${ancora.letra}?`,
    festa: `Isso! ${ancora.letra} de ${ancora.palavra}!`,
    correta: ancora.letra,
    alternativas,
    ancora,
  };
}

// ------------------------------------------------------------------- rng

/**
 * PRNG determinístico (mulberry32) — mesmo contrato de `Sorteio` usado pelos
 * outros modos (`cores.ts`, `ingles.ts`). Nos testes, a semente fixa deixa a
 * rodada reproduzível.
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
