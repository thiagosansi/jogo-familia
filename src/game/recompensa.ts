/**
 * RECOMPENSA — o vocabulário das figurinhas. Módulo PURO (sem React, sem DOM).
 * =============================================================================
 *
 * Cada rodada concluída grava uma figurinha em `progresso.figurinhas`
 * (`addFigurinha` em `@/lib/db`). O id é uma STRING montada pelo mini-jogo:
 *
 *   familia-<idDoPersonagem>   → o rosto que ela reconheceu
 *   cor-<corId>                → a peça que ela pegou       (cores.ts)
 *   contar-<1..5>              → o cardume que ela contou   (contar.ts)
 *   animal-<idAnimal>          → o bicho que ela adivinhou  (animais.ts)
 *   ingles-<idPalavra>         → a palavra que ela ouviu    (ingles.ts)
 *   letra-<A..Z>               → a letra que ela achou      (letras.ts)
 *   memoria-<formaObjeto>      → o par que ela virou        (memoria.ts)
 *
 * Este arquivo é o ÚNICO lugar que sabe traduzir esses ids em desenho, nome e
 * posição. O `<Album>` só desenha o que ele mandar — assim um id novo (ou de
 * uma versão futura do jogo) nunca quebra a tela da criança: cai no mascote.
 *
 * POR QUE NÃO HÁ NÚMERO AQUI: a criança de 3 anos não lê. O progresso dela é o
 * aquário enchendo de figurinha — não um contador. Números só aparecem no
 * relatório do adulto (`/pais/progresso`), nunca numa tela de jogo.
 *
 * Imports com extensão `.ts` explícita (e só `import type` para fora de
 * `src/game`): é o que deixa `node --test --experimental-strip-types` rodar
 * este módulo sem bundler. O webpack resolve o mesmo caminho.
 */

import { CORES, FORMAS, nomeDaPeca, type FormaObjeto } from "./modos/cores.ts";
import { ANIMAIS, type IdAnimal } from "./modos/animais.ts";
import type { Mascote } from "@/components/Personagem";
import type { Eixo, Figurinha } from "@/lib/tipos";

// --------------------------------------------------------------- vocabulário

/** Prefixo do id de figurinha por eixo. Manter em sincronia com os mini-jogos. */
export const PREFIXO: Record<Eixo, string> = {
  familia: "familia-",
  cores: "cor-",
  contar: "contar-",
  animais: "animal-",
  ingles: "ingles-",
  letras: "letra-",
  memoria: "memoria-",
};

/** Monta o id de figurinha de um eixo. Use SEMPRE isto nos mini-jogos. */
export function idFigurinha(eixo: Eixo, chave: string | number): string {
  return `${PREFIXO[eixo]}${chave}`;
}

/**
 * Quantas figurinhas diferentes existem no eixo — o "tamanho do álbum".
 * `familia` é `null` de propósito: depende de quem o adulto cadastrou.
 */
export const TOTAL_DO_EIXO: Record<Eixo, number | null> = {
  familia: null,
  cores: CORES.length,
  contar: 5,
  animais: ANIMAIS.length,
  // `ingles` também é `null` de propósito, pelo MESMO motivo de `familia`
  // acima: o total varia com o cadastro. Contagem real do catálogo (ver
  // ingles.ts): NUMEROS_INGLES (10) + COTIDIANO_INGLES (11 = 6 animais de
  // IDS_ANIMAIS + 5 formas de IDS_FORMA) + SAUDACOES_INGLES (4) são fixas —
  // 25 figurinhas sempre alcançáveis. FAMILIA_INGLES (4: mommy/daddy/
  // brother/sister) só entra se `palavrasFamiliaJogaveis` achar papel
  // correspondente no cadastro; com ninguém cadastrado,
  // `montarRodadaFamiliaIngles` devolve `null` e essas 4 nunca aparecem
  // (ver ingles.ts). Um número fixo aqui seria sempre errado para alguém:
  // 29 fica inalcançável para quem não cadastrou família, 25 estoura de
  // 100% para quem cadastrou. `null` evita as duas — `fraseDoEixo` (ver
  // src/app/pais/progresso/page.tsx) já trata `null` mostrando só a
  // contagem ganha, sem denominador.
  ingles: null,
  // `letras` e `memoria` também são `null`, pelo mesmo motivo dos dois acima:
  // o total depende do que o adulto cadastrou. Em "letras" as âncoras vêm do
  // nome da criança e dos nomes da família (`Config.nomeCrianca` +
  // `listarPersonagens`), então quantas das 26 letras chegam a virar
  // figurinha muda de aparelho para aparelho; em "memória" as cartas incluem
  // as fotos cadastradas. Um denominador fixo seria sempre errado para
  // alguém — `fraseDoEixo` (src/app/pais/progresso/page.tsx) já trata `null`
  // mostrando só a contagem ganha, sem denominador.
  letras: null,
  memoria: null,
};

/** Nome do eixo em português, para o relatório do adulto. */
export const NOME_DO_EIXO: Record<Eixo, string> = {
  familia: "Quem é quem",
  cores: "Cores e formas",
  contar: "Contar até 5",
  animais: "Animais",
  ingles: "Primeiras palavras em inglês",
  letras: "Letras e sons",
  memoria: "Jogo da memória",
};

// ------------------------------------------------------------------ desenhos

/**
 * O que o `<Album>` tem que desenhar. Nenhuma variante carrega texto: a
 * figurinha é uma FIGURA (o rótulo existe só para leitor de tela).
 */
export type DesenhoFigurinha =
  /** Peça do fundo do mar (modo cores). */
  | { tipo: "objeto"; forma: FormaObjeto; cor: string }
  /** Bichinhos repetidos (modo contar): a criança vê a quantidade, não o número. */
  | { tipo: "cardume"; quantidade: number; forma: FormaObjeto; cor: string }
  /** Bicho do modo animais. */
  | { tipo: "bicho"; qual: IdAnimal }
  /**
   * Letra do modo "letras": o GLIFO é o desenho (o `<Album>` mostra um "P"
   * grande dentro da bolha). É a única figurinha com texto, e é de propósito:
   * a letra não tem silhueta que a substitua — ela É o símbolo que a criança
   * está aprendendo a reconhecer. Isso não abre exceção para número: número
   * na tela da criança continua proibido (ver o cabeçalho).
   */
  | { tipo: "letra"; letra: string }
  /**
   * Carta do jogo da memória: a mesma peça do fundo do mar de `cores.ts`,
   * desenhada pelo `<ObjetoMar>`. Variante própria (e não `objeto`) porque o
   * id vem da FORMA, não da cor — a cor sai da bijeção do catálogo.
   */
  | { tipo: "carta"; forma: FormaObjeto; cor: string }
  /** Rosto da família — o `<Album>` procura a foto no IndexedDB. */
  | { tipo: "pessoa"; personagemId: string }
  /** Fallback: id desconhecido nunca vira tela quebrada. */
  | { tipo: "mascote"; qual: Mascote };

const MASCOTES_FALLBACK: readonly Mascote[] = ["estrela", "caranguejo", "peixe", "polvo"];

/** Hash estável (FNV-1a de bolso). Mesma string ⇒ mesmo número, sempre. */
export function baralhar(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function corDaPeca(id: string): string | null {
  return CORES.find((c) => c.id === id)?.hex ?? null;
}

/**
 * A peça do catálogo que tem esta forma. Existe pela bijeção cor <-> forma de
 * `cores.ts` (validada no import de lá): dada a forma, a cor é única. É o que
 * deixa o id da memória ser só a forma — sem repetir a cor no id, que
 * poderia contradizer o catálogo numa versão futura.
 */
function pecaDaForma(forma: string): { hex: string; id: string; forma: FormaObjeto } | null {
  const achada = CORES.find((c) => c.forma === forma);
  return achada ? { hex: achada.hex, id: achada.id, forma: achada.forma } : null;
}

/** `letra-<A..Z>`: exatamente UMA letra maiúscula sem acento. Resto é lixo. */
function letraValida(bruta: string): string | null {
  return /^[A-Z]$/.test(bruta) ? bruta : null;
}

/** Cor do cardume de contagem — amarelo areia, igual ao token do design system. */
export const COR_CARDUME = "#ffd166";

/**
 * Traduz o id gravado no IndexedDB em desenho. NUNCA lança: id desconhecido
 * (versão futura, dado corrompido, importação de outro aparelho) vira mascote.
 */
export function desenhoDaFigurinha(id: string): DesenhoFigurinha {
  if (id.startsWith(PREFIXO.cores)) {
    const corId = id.slice(PREFIXO.cores.length);
    const hex = corDaPeca(corId);
    const peca = CORES.find((c) => c.id === corId);
    if (hex && peca) return { tipo: "objeto", forma: peca.forma, cor: hex };
  }

  if (id.startsWith(PREFIXO.contar)) {
    const n = Number(id.slice(PREFIXO.contar.length));
    if (Number.isInteger(n) && n >= 1 && n <= 5) {
      return { tipo: "cardume", quantidade: n, forma: "peixe", cor: COR_CARDUME };
    }
  }

  if (id.startsWith(PREFIXO.animais)) {
    const qual = id.slice(PREFIXO.animais.length);
    if (ANIMAIS.some((a) => a.id === qual)) return { tipo: "bicho", qual: qual as IdAnimal };
  }

  if (id.startsWith(PREFIXO.letras)) {
    const letra = letraValida(id.slice(PREFIXO.letras.length));
    if (letra) return { tipo: "letra", letra };
  }

  if (id.startsWith(PREFIXO.memoria)) {
    const peca = pecaDaForma(id.slice(PREFIXO.memoria.length));
    if (peca) return { tipo: "carta", forma: peca.forma, cor: peca.hex };
    // Par de foto da família ou de mascote (ver memoria.ts): não tem desenho
    // próprio no álbum, cai no mascote como qualquer id sem tradução.
  }

  if (id.startsWith(PREFIXO.familia)) {
    const personagemId = id.slice(PREFIXO.familia.length);
    if (personagemId) return { tipo: "pessoa", personagemId };
  }

  return { tipo: "mascote", qual: MASCOTES_FALLBACK[baralhar(id) % MASCOTES_FALLBACK.length] };
}

/**
 * Rótulo acessível da figurinha. `nomes` mapeia id de personagem → nome, para
 * o eixo família (o `<Album>` passa o que leu do banco; sem ele sai "alguém da
 * família", nunca um id cru na tela).
 */
export function nomeDaFigurinha(id: string, nomes?: ReadonlyMap<string, string>): string {
  const d = desenhoDaFigurinha(id);
  switch (d.tipo) {
    case "objeto":
      return nomeDaPeca(id.slice(PREFIXO.cores.length));
    case "cardume": {
      const f = FORMAS[d.forma];
      return d.quantidade === 1 ? `1 ${f.singular}` : `${d.quantidade} ${f.plural}`;
    }
    case "letra":
      // "letra P" e não só "P": um leitor de tela lê a letra solta como
      // palavra ("pê" vira "p"), e o adulto que abre o relatório precisa
      // entender o item sem contexto.
      return `letra ${d.letra}`;
    case "carta": {
      const peca = CORES.find((c) => c.forma === d.forma);
      return peca ? nomeDaPeca(peca.id) : FORMAS[d.forma].singular;
    }
    case "bicho":
      return ANIMAIS.find((a) => a.id === d.qual)?.nome ?? d.qual;
    case "pessoa":
      return nomes?.get(d.personagemId) ?? "alguém da família";
    case "mascote":
      return `mascote ${d.qual}`;
  }
}

/** O eixo a que o id pertence (independe do que foi gravado no registro). */
export function eixoDaFigurinha(id: string): Eixo | null {
  for (const eixo of Object.keys(PREFIXO) as Eixo[]) {
    if (id.startsWith(PREFIXO[eixo])) return eixo;
  }
  return null;
}

// -------------------------------------------------------------------- slots

export interface SlotFigurinha {
  /** Posição em % da largura/altura do tanque. */
  x: number;
  y: number;
  /** Inclinação da colagem, em graus. */
  giro: number;
}

/**
 * Onde a figurinha `i` fica COLADA no vidro do aquário.
 *
 * Três exigências, nesta ordem:
 *  1. **Determinístico.** Recarregar a página não pode embaralhar o álbum — a
 *     criança precisa reencontrar a figurinha dela no mesmo canto.
 *  2. **Nada sobrescreve nada.** A figurinha `i` e a `i+1` ocupam slots
 *     diferentes de uma faixa de borda; quem chega depois nunca cobre quem já
 *     estava (a ordem é a de conquista, ver `ordenarFigurinhas`).
 *  3. **Fora do caminho.** Os slots ficam na moldura do tanque, deixando o
 *     miolo livre para os moradores que a criança cutuca.
 *
 * Passando de `SLOTS` figurinhas o anel recomeça deslocado para dentro, então
 * um álbum grande adensa em vez de empilhar em cima.
 */
const BAIXO = 9;
const CIMA = 7;
const LADO = 6;
export const SLOTS = BAIXO + CIMA + LADO * 2;

export function slotFigurinha(i: number): SlotFigurinha {
  const volta = Math.floor(i / SLOTS);
  const k = i % SLOTS;
  // Cada volta encolhe o anel: a moldura vira duas, três molduras.
  const recuo = volta * 9;
  const giro = ((baralhar(`slot-${i}`) % 25) - 12) / 1.2;

  if (k < BAIXO) {
    // Começa em 16% e para em 94%: o canto inferior esquerdo é do botão de
    // saída (hold) e o direito, da dica do adulto. Figurinha em cima deles
    // esconderia a saída — mesmo sem roubar o toque.
    return { x: 16 + (k * 78) / (BAIXO - 1), y: 87 - recuo, giro };
  }
  if (k < BAIXO + CIMA) {
    const j = k - BAIXO;
    return { x: 10 + (j * 80) / (CIMA - 1), y: 8 + recuo, giro };
  }
  if (k < BAIXO + CIMA + LADO) {
    const j = k - BAIXO - CIMA;
    return { x: 5 + recuo, y: 22 + (j * 56) / (LADO - 1), giro };
  }
  const j = k - BAIXO - CIMA - LADO;
  return { x: 95 - recuo, y: 22 + (j * 56) / (LADO - 1), giro };
}

// ------------------------------------------------------------------ coleção

/**
 * Ordem de colagem: a mais antiga primeiro. É isto que garante que o slot de
 * cada figurinha não muda quando chega uma nova (a nova entra no FIM).
 * Empate de timestamp desempata pelo id — nunca por ordem de leitura do banco.
 */
export function ordenarFigurinhas(figurinhas: readonly Figurinha[]): Figurinha[] {
  return [...figurinhas].sort(
    (a, b) => a.conquistadaEm - b.conquistadaEm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Só as figurinhas de um eixo, na ordem de conquista. */
export function figurinhasDoEixo(figurinhas: readonly Figurinha[], eixo: Eixo): Figurinha[] {
  return ordenarFigurinhas(figurinhas).filter((f) => (eixoDaFigurinha(f.id) ?? f.eixo) === eixo);
}
