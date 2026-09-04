/**
 * MODO "NÚMEROS" — conteúdo e montagem de rodada. PURO (sem React, sem DOM,
 * sem IO). Roda em node: `node --test --experimental-strip-types`.
 *
 * PARA QUEM É: a criança tem 5 anos e já conta em voz alta (modo Contar, que
 * vai até 10). O passo seguinte é ligar a QUANTIDADE que ela vê ao SÍMBOLO
 * escrito — reconhecer o "7" como "sete". Este modo faz exatamente isso, e
 * nada além: nunca pede para ler uma palavra, nunca pede para escrever.
 *
 * A ÚNICA EXCEÇÃO AO "SEM NÚMERO NA TELA" DO PROJETO
 * --------------------------------------------------
 * A regra do produto (ver `recompensa.ts`) é que número NÃO aparece em tela
 * de jogo — porque número, ali, seria PLACAR, e não existe placar aqui. Neste
 * modo o algarismo aparece porque ele É O CONTEÚDO ENSINADO, do mesmo jeito
 * que o glifo da letra é o conteúdo do modo Letras. A regra que continua
 * valendo, e que a página tem que garantir, é a original: os únicos dígitos
 * na tela são as ALTERNATIVAS (as respostas possíveis). Nunca um contador de
 * acertos, nunca um cronômetro, nunca "3 de 10".
 *
 * DOIS SUBJOGOS (`SubjogoNumeros`), ambos no eixo `contar`
 * -------------------------------------------------------
 *  - `quantos`: a cena mostra N bichinhos; a criança toca no algarismo N.
 *    "Quantos peixinhos tem?" → toca no "6" → "São seis peixinhos!"
 *  - `somar`: a cena mostra DOIS grupos (a e b) separados; a criança toca no
 *    algarismo do total. "Chegaram dois peixinhos e mais um. Quantos tem
 *    agora?" → toca no "3". Somar aqui é CONTAR TUDO DE NOVO — é assim que
 *    se soma aos 5 anos —, por isso os dois grupos ficam visíveis o tempo
 *    todo em vez de o primeiro sumir.
 *
 * Eles ganham figurinha no eixo `contar` (`contar-<total>`), e não num eixo
 * novo, de propósito: para a criança é o mesmo aprendizado ("eu sei o seis"),
 * e o aquário dela não deve ter duas coleções de peixinho que significam a
 * mesma coisa.
 *
 * DE ONDE VÊM AS PALAVRAS: de `contar.ts` (`numeroPorExtenso`, `falaDoTotal`,
 * `MAX_CONTAGEM`). Nenhuma lista de "um, dois, três" nova mora aqui — uma
 * segunda lista divergiria da primeira na próxima mudança de teto.
 *
 * NÃO DEPENDE DE CADASTRO: as formas e cores vêm de `cores.ts` (a mesma
 * bijeção cor <-> forma dos outros modos), então o modo roda no primeiro uso,
 * com o IndexedDB vazio, sem nenhuma foto ou voz gravada.
 */

import { embaralhar, montarAlternativas, type QtdAlternativas, type Sorteio } from "../dificuldade.ts";
import { MAX_CONTAGEM, corDaForma, falaDoTotal, numeroPorExtenso } from "./contar.ts";
import { FORMAS, IDS_FORMA, type FormaObjeto } from "./cores.ts";

// ------------------------------------------------------------------ tipos

export type SubjogoNumeros = "quantos" | "somar";

/** Nível do subjogo `somar`. 1: a+b até 5. 2: a+b até 10. */
export type NivelSomar = 1 | 2;

/** Total máximo de cada nível de `somar` — o que a criança tem que contar. */
export const TETO_SOMA: Readonly<Record<NivelSomar, number>> = {
  1: 5,
  2: MAX_CONTAGEM,
};

/**
 * Uma rodada de "quantos tem?".
 *
 * `correta` e `alternativas` são ALGARISMOS COMO STRING ("7") porque é isso
 * que o engine (`@/game/engine`) troca — ele só conhece ids de alternativa —
 * e é isso que a página escreve dentro da bolha. `quantidade` é o mesmo valor
 * como número, para a página desenhar a cena e montar a figurinha sem ter
 * que fazer `Number(rodada.correta)` (e sem chance de as duas divergirem:
 * `correta === String(quantidade)`, coberto por teste).
 */
export interface RodadaQuantos {
  /** Texto falado e rótulo do `<Palco>`. */
  readonly pergunta: string;
  readonly festa: string;
  readonly correta: string;
  /** Ids (algarismos) já embaralhados. */
  readonly alternativas: readonly string[];
  readonly quantidade: number;
  readonly forma: FormaObjeto;
  readonly cor: string;
}

/**
 * Uma rodada de "somar no mar": os mesmos campos de `RodadaQuantos` mais as
 * duas parcelas. INVARIANTE: `quantidade === a + b` (coberto por teste).
 */
export interface RodadaSomar extends RodadaQuantos {
  readonly a: number;
  readonly b: number;
}

// --------------------------------------------------------- pool e distratores

/** `["1", "2", … , "<maximo>"]` — o universo de respostas possíveis. */
export function poolDeNumeros(maximo: number = MAX_CONTAGEM): string[] {
  return Array.from({ length: Math.max(1, Math.round(maximo)) }, (_, i) => String(i + 1));
}

/**
 * Raio dos distratores "difíceis" do subjogo somar. Ver
 * `alternativasProximas`.
 */
const RAIO_PROXIMO = 3;

/**
 * Distratores PERTO da resposta, para o subjogo somar.
 *
 * Por quê: somando, a criança que errou por um ("contei 6, era 7") está
 * aprendendo; a que escolheu 10 quando a resposta era 3 não estava contando —
 * chutou. Distratores sorteados de todo o pool deixam a rodada resolvível por
 * eliminação grosseira ("são poucos, não pode ser 10"), o que ensina a chutar
 * bem, não a somar. Preferindo ±1..±3 a criança PRECISA contar até o fim.
 *
 * Não é uma regra rígida: se a faixa perto não tiver distratores suficientes
 * (resposta 2 com 6 alternativas na tela), o resto do pool completa — uma
 * rodada com menos alternativas do que a dificuldade pediu seria pior.
 */
function alternativasProximas(
  correta: number,
  qtd: QtdAlternativas,
  maximo: number,
  sortear: Sorteio,
): string[] {
  const alvo = String(correta);
  const outros = poolDeNumeros(maximo).filter((id) => id !== alvo);
  const perto = outros.filter((id) => Math.abs(Number(id) - correta) <= RAIO_PROXIMO);
  const longe = outros.filter((id) => Math.abs(Number(id) - correta) > RAIO_PROXIMO);
  const distratores = [...embaralhar(perto, sortear), ...embaralhar(longe, sortear)].slice(
    0,
    Math.max(0, qtd - 1),
  );
  return embaralhar([alvo, ...distratores], sortear);
}

/** Prende `qtd` no intervalo aceito por `montarAlternativas`. */
function limitarQtd(qtd: number): QtdAlternativas {
  return Math.min(6, Math.max(2, Math.round(qtd) || 2)) as QtdAlternativas;
}

// ------------------------------------------------------------------ falas

/** "Quantos peixinhos tem?" / "Quantas conchas tem?" — concorda com a forma. */
function perguntaQuantos(forma: FormaObjeto): string {
  const f = FORMAS[forma];
  return `${f.genero === "f" ? "Quantas" : "Quantos"} ${f.plural} tem?`;
}

/**
 * "Chegaram dois peixinhos e mais um. Quantos tem agora?"
 *
 * O verbo concorda com a PRIMEIRA parcela ("Chegou uma concha e mais duas"),
 * e os dois números saem por extenso no gênero da forma — a criança não lê,
 * então a conta inteira tem que caber na fala. O algarismo aparece só nas
 * alternativas, que é onde ela responde.
 */
function perguntaSomar(a: number, b: number, forma: FormaObjeto): string {
  const f = FORMAS[forma];
  const chegada =
    a === 1
      ? `Chegou ${numeroPorExtenso(1, f.genero)} ${f.singular}`
      : `Chegaram ${numeroPorExtenso(a, f.genero)} ${f.plural}`;
  const quantos = f.genero === "f" ? "Quantas" : "Quantos";
  return `${chegada} e mais ${numeroPorExtenso(b, f.genero)}. ${quantos} tem agora?`;
}

// ---------------------------------------------------------------- sorteios

/** Forma da rodada, evitando repetir a anterior (a silhueta não vira pista). */
function proximaForma(anterior: FormaObjeto | null | undefined, sortear: Sorteio): FormaObjeto {
  const candidatas = IDS_FORMA.filter((f) => f !== anterior);
  return embaralhar(candidatas.length > 0 ? candidatas : IDS_FORMA, sortear)[0];
}

/** Quantidade da rodada em 1..`maximo`, evitando repetir o total anterior. */
function proximaQuantidade(
  anterior: number | null | undefined,
  maximo: number,
  sortear: Sorteio,
): number {
  const todas = Array.from({ length: maximo }, (_, i) => i + 1);
  const candidatas = todas.filter((n) => n !== anterior);
  return embaralhar(candidatas.length > 0 ? candidatas : todas, sortear)[0];
}

// ------------------------------------------------------ rodada "quantos tem?"

export interface OpcoesRodadaQuantos {
  /** Quantas alternativas na tela (vem de `dificuldade.ts`: 2 a 6). */
  qtd: number;
  /** Total da rodada anterior — não repete a mesma resposta duas vezes. */
  anterior?: number | null;
  /** Forma da rodada anterior — não repete a mesma silhueta duas vezes. */
  formaAnterior?: FormaObjeto | null;
  sortear?: Sorteio;
  /** Teto da quantidade desenhada. Padrão `MAX_CONTAGEM` (10). */
  maximo?: number;
}

export function montarRodadaQuantos({
  qtd,
  anterior = null,
  formaAnterior = null,
  sortear = Math.random,
  maximo = MAX_CONTAGEM,
}: OpcoesRodadaQuantos): RodadaQuantos {
  const teto = Math.min(MAX_CONTAGEM, Math.max(1, Math.round(maximo) || MAX_CONTAGEM));
  const forma = proximaForma(formaAnterior, sortear);
  const quantidade = proximaQuantidade(anterior, teto, sortear);
  const total = limitarQtd(qtd);

  return {
    pergunta: perguntaQuantos(forma),
    // Reusa a MESMA frase de total do modo Contar: a criança já ouviu "São
    // seis peixinhos!" contando na mão — aqui ela ouve de novo, agora ligada
    // ao algarismo que acabou de tocar.
    festa: falaDoTotal(quantidade, forma),
    correta: String(quantidade),
    // Distratores de qualquer parte do pool: contar uma cena desenhada não
    // tem o problema de "resolver por eliminação" que somar tem (a criança
    // tem os objetos na frente dela para conferir um a um).
    alternativas: montarAlternativas(poolDeNumeros(teto), String(quantidade), total, sortear),
    quantidade,
    forma,
    cor: corDaForma(forma),
  };
}

// ------------------------------------------------------- rodada "somar no mar"

export interface OpcoesRodadaSomar {
  qtd: number;
  /** 1: a+b até 5. 2: a+b até 10. */
  nivel: NivelSomar;
  /** Total da rodada anterior — não repete a mesma resposta duas vezes. */
  anterior?: number | null;
  formaAnterior?: FormaObjeto | null;
  sortear?: Sorteio;
}

/**
 * Todos os pares (a, b) válidos de um nível: `a >= 1`, `b >= 1` e
 * `a + b <= TETO_SOMA[nivel]`. Enumerar e sortear (em vez de sortear `a` e
 * depois `b` no que sobrou) mantém a distribuição honesta e — o que importa
 * mais aqui — deixa o "não repetir o total anterior" ser um filtro simples,
 * sem risco de laço que não termina.
 */
function paresDoNivel(nivel: NivelSomar): { a: number; b: number }[] {
  const teto = TETO_SOMA[nivel];
  const pares: { a: number; b: number }[] = [];
  for (let a = 1; a < teto; a++) {
    for (let b = 1; a + b <= teto; b++) pares.push({ a, b });
  }
  return pares;
}

export function montarRodadaSomar({
  qtd,
  nivel,
  anterior = null,
  formaAnterior = null,
  sortear = Math.random,
}: OpcoesRodadaSomar): RodadaSomar {
  const forma = proximaForma(formaAnterior, sortear);
  const todos = paresDoNivel(nivel);
  // Se filtrar o total anterior esvaziasse a lista (não acontece com os
  // níveis de hoje, mas um nível 1 futuro com teto 2 esvaziaria), a rodada
  // repetida é melhor do que rodada nenhuma.
  const candidatos = todos.filter((p) => p.a + p.b !== anterior);
  const { a, b } = embaralhar(candidatos.length > 0 ? candidatos : todos, sortear)[0];
  const quantidade = a + b;
  const total = limitarQtd(qtd);

  return {
    pergunta: perguntaSomar(a, b, forma),
    festa: falaDoTotal(quantidade, forma),
    correta: String(quantidade),
    // Pool 1..MAX_CONTAGEM mesmo no nível 1 (teto de soma 5): um algarismo é
    // um algarismo, e limitar o pool ao teto do nível entregaria a resposta
    // ("só tem opção até 5, então..."). Ver `alternativasProximas`.
    alternativas: alternativasProximas(quantidade, total, MAX_CONTAGEM, sortear),
    quantidade,
    forma,
    cor: corDaForma(forma),
    a,
    b,
  };
}

// ------------------------------------------------------------- invariante

/**
 * A garantia central do modo, verificável de fora: toda resposta possível
 * (1..`MAX_CONTAGEM`) tem palavra falada, toda forma desenhável tem nome no
 * singular e no plural (as perguntas dependem dos dois) e todo par de todo
 * nível de `somar` fecha dentro do teto do nível.
 *
 * Chamada no import (falha alto e cedo, no build/dev) e usada pelos testes —
 * mesmo padrão de `validarCatalogo` em `cores.ts`.
 */
export function validarCatalogoNumeros(): true {
  for (let n = 1; n <= MAX_CONTAGEM; n++) {
    for (const genero of ["m", "f"] as const) {
      const palavra = numeroPorExtenso(n, genero);
      if (!palavra || palavra === String(n)) {
        throw new Error(`Número sem palavra falada (${genero}): ${n}`);
      }
    }
  }
  for (const forma of IDS_FORMA) {
    const f = FORMAS[forma];
    if (!f?.singular || !f?.plural) throw new Error(`Forma sem nome: ${forma}`);
  }
  for (const nivel of [1, 2] as const) {
    const pares = paresDoNivel(nivel);
    if (pares.length === 0) throw new Error(`Nível de soma sem nenhum par: ${nivel}`);
    for (const { a, b } of pares) {
      if (a < 1 || b < 1) throw new Error(`Parcela menor que 1 no nível ${nivel}: ${a}+${b}`);
      if (a + b > TETO_SOMA[nivel]) {
        throw new Error(`Soma acima do teto do nível ${nivel}: ${a}+${b}`);
      }
    }
  }
  return true;
}

validarCatalogoNumeros();
