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

/** Eixos de aprendizado — cada modo de jogo alimenta um deles. */
export type Eixo = "familia" | "cores" | "contar" | "animais" | "ingles";

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
   * uuid da família na nuvem, quando este aparelho já veio de um link
   * (`/entrar?familia=…`). Guardado aqui para o aparelho não depender do
   * parâmetro na URL toda vez: é o que diz de quem é o progresso que sobe.
   * Ausente = aparelho 100% local, e a sincronia nem liga.
   */
  familiaNuvemId?: string;
}
