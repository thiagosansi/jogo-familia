/**
 * Tipos compartilhados do jogo. Tudo mora no dispositivo — zero backend.
 *
 * Este arquivo é SÓ TIPOS (nenhum export de runtime). Assim todo import dele é
 * `import type`, que some na compilação — o que deixa `node --test` rodar os
 * módulos direto com type stripping, sem bundler. Constantes de runtime
 * (PAPEIS, EIXOS) ficam em `db.ts`.
 */

/** Papel do familiar dentro do jogo (define ícone/agrupamento nas telas). */
export type Papel = "mae" | "pai" | "irmao" | "parente" | "mascote";

/** Um familiar cadastrado pelo adulto: foto recortada + vozes gravadas. */
export interface Personagem {
  id: string;
  nome: string;
  papel: Papel;
  /** Foto já redimensionada (ver `redimensionarImagem`) — nunca sai do device. */
  fotoRecorte: Blob;
  /** Áudio com o nome ("Mamãe"). */
  vozNome: Blob | null;
  /** Áudio de comemoração ("Isso! Muito bem!"). */
  vozFesta: Blob | null;
  criadoEm: number;
}

/**
 * Eixos de aprendizado — cada modo de jogo alimenta um deles.
 *
 * União FECHADA de propósito: `PREFIXO`, `TOTAL_DO_EIXO` e `NOME_DO_EIXO`
 * (`@/game/recompensa`) são `Record<Eixo, …>`, então o compilador cobra a
 * entrada nova de quem acrescentar um eixo aqui — nenhum eixo chega ao
 * relatório dos pais sem nome nem à figurinha sem prefixo.
 */
export type Eixo =
  | "familia"
  | "cores"
  | "contar"
  | "animais"
  | "ingles"
  | "letras"
  | "memoria";

/** Placar por eixo: quantas rodadas certas e erradas. */
export interface AcertosEixo {
  acertos: number;
  erros: number;
}

/** Figurinha conquistada (recompensa do aquário). */
export interface Figurinha {
  id: string;
  eixo: Eixo;
  conquistadaEm: number;
}

/** Progresso agregado — um único registro (id fixo `PROGRESSO_ID`). */
export interface Progresso {
  id: string;
  figurinhas: Figurinha[];
  porEixo: Record<Eixo, AcertosEixo>;
  atualizadoEm: number;
}

/** Preferências do adulto (área dos pais). */
export interface Config {
  id: string;
  /** Limite de tempo por sessão, em minutos. */
  limiteSessaoMin: number;
  /** Modos habilitados na home. */
  modosAtivos: string[];
  /**
   * Nome da criança, digitado pelo adulto no painel dos pais.
   *
   * SEMPRE OPCIONAL, e nenhum modo pode exigi-lo: quem usa é o modo "Letras"
   * (`/jogo/letras`), para ancorar uma letra na palavra que a criança mais
   * reconhece — "B de Bia". Sem nome cadastrado o modo simplesmente ancora
   * nas outras fontes (família e figuras) e continua jogável do primeiro
   * uso, como todo o resto do jogo.
   *
   * String vazia nunca é gravada: o painel grava `undefined` quando o campo
   * fica em branco (ver `src/app/pais/page.tsx`), para "sem nome" ter uma
   * representação só.
   */
  nomeCrianca?: string;
  /**
   * uuid da família na nuvem, quando este aparelho já veio de um link
   * (`/entrar?familia=…`). Guardado aqui para o aparelho não depender do
   * parâmetro na URL toda vez: é o que diz de quem é o progresso que sobe.
   * Ausente = aparelho 100% local, e a sincronia nem liga.
   */
  familiaNuvemId?: string;
}
