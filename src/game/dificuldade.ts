/**
 * DIFICULDADE ADAPTATIVA — lógica PURA (sem React, sem IO).
 *
 * Regra (mesma para os 4 mini-jogos):
 *  - começa com 2 alternativas;
 *  - 3 acertos consecutivos      -> sobe um nível (3, depois 4 alternativas);
 *  - 2 `quaseLa` consecutivos    -> desce um nível (mínimo 2 alternativas).
 *
 * Acerto zera o contador de `quaseLa` e vice-versa: só sequências contam.
 * Ao mudar de nível os contadores zeram, então "mais 3 acertos" para ir de
 * 3 para 4 alternativas são 3 acertos NOVOS.
 *
 * Como as tasks 4/5/6 usam:
 *
 *   let dif = dificuldadeInicial();                       // ou hidratarDificuldade(salvo)
 *   const alts = montarAlternativas(pool, correta, dif.alternativas);
 *   // ... rodada ...
 *   dif = registrarAcerto(dif);                           // ou registrarQuaseLa(dif)
 *   await setConfig({ ... })                              // persistir: serializarDificuldade(dif)
 *
 * A persistência fica fora daqui de propósito (mantém a lógica testável em
 * node): use `serializarDificuldade` / `hidratarDificuldade` com `config` ou
 * `progresso` do `@/lib/db`.
 */

/** Quantidade de alternativas na tela. Não existe nível além de 4. */
export type QtdAlternativas = 2 | 3 | 4;

export const MIN_ALTERNATIVAS: QtdAlternativas = 2;
export const MAX_ALTERNATIVAS: QtdAlternativas = 4;

/** Acertos consecutivos para subir um nível. */
export const ACERTOS_PARA_SUBIR = 3;
/** `quaseLa` consecutivos para descer um nível. */
export const QUASES_PARA_DESCER = 2;

export interface EstadoDificuldade {
  readonly alternativas: QtdAlternativas;
  readonly acertosSeguidos: number;
  readonly quasesSeguidos: number;
}

export function dificuldadeInicial(
  alternativas: QtdAlternativas = MIN_ALTERNATIVAS,
): EstadoDificuldade {
  return { alternativas, acertosSeguidos: 0, quasesSeguidos: 0 };
}

function subir(n: QtdAlternativas): QtdAlternativas {
  return (n < MAX_ALTERNATIVAS ? n + 1 : n) as QtdAlternativas;
}

function descer(n: QtdAlternativas): QtdAlternativas {
  return (n > MIN_ALTERNATIVAS ? n - 1 : n) as QtdAlternativas;
}

/** Acerto: soma na sequência de acertos, zera a de `quaseLa`, sobe se bateu 3. */
export function registrarAcerto(estado: EstadoDificuldade): EstadoDificuldade {
  const acertos = estado.acertosSeguidos + 1;
  if (acertos >= ACERTOS_PARA_SUBIR && estado.alternativas < MAX_ALTERNATIVAS) {
    return { alternativas: subir(estado.alternativas), acertosSeguidos: 0, quasesSeguidos: 0 };
  }
  return {
    alternativas: estado.alternativas,
    // No teto, o contador satura (não faz sentido acumular sem ter para onde subir).
    acertosSeguidos: Math.min(acertos, ACERTOS_PARA_SUBIR),
    quasesSeguidos: 0,
  };
}

/**
 * `quaseLa`: soma na sequência de quases, zera a de acertos, desce se bateu 2.
 * Descer NÃO é punição — é o jogo ficando mais fácil para a criança acertar.
 */
export function registrarQuaseLa(estado: EstadoDificuldade): EstadoDificuldade {
  const quases = estado.quasesSeguidos + 1;
  if (quases >= QUASES_PARA_DESCER && estado.alternativas > MIN_ALTERNATIVAS) {
    return { alternativas: descer(estado.alternativas), acertosSeguidos: 0, quasesSeguidos: 0 };
  }
  return {
    alternativas: estado.alternativas,
    acertosSeguidos: 0,
    quasesSeguidos: Math.min(quases, QUASES_PARA_DESCER),
  };
}

/** Aplica o resultado de uma rodada inteira (acerto com N quases pelo caminho). */
export function registrarRodada(
  estado: EstadoDificuldade,
  resultado: { quaseLas: number },
): EstadoDificuldade {
  let proximo = estado;
  for (let i = 0; i < resultado.quaseLas; i++) proximo = registrarQuaseLa(proximo);
  return registrarAcerto(proximo);
}

// ------------------------------------------------------- sorteio das opções

/** `Math.random` por padrão; injete um gerador determinístico nos testes. */
export type Sorteio = () => number;

/**
 * Monta as alternativas de uma rodada: a correta + `qtd - 1` distratores do
 * pool, embaralhadas. Se o pool não tiver distratores suficientes, devolve o
 * que dá (nunca menos que a correta) — a rodada continua jogável.
 */
export function montarAlternativas(
  pool: readonly string[],
  correta: string,
  qtd: QtdAlternativas,
  sortear: Sorteio = Math.random,
): string[] {
  const distratores = embaralhar(
    pool.filter((id) => id !== correta),
    sortear,
  ).slice(0, Math.max(0, qtd - 1));
  return embaralhar([correta, ...distratores], sortear);
}

/** Fisher-Yates com gerador injetável. */
export function embaralhar<T>(itens: readonly T[], sortear: Sorteio = Math.random): T[] {
  const copia = [...itens];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(sortear() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// ------------------------------------------------------------- persistência

/** Forma serializável (JSON) para guardar em `config`/`progresso`. */
export interface DificuldadeSalva {
  alternativas: number;
  acertosSeguidos: number;
  quasesSeguidos: number;
}

export function serializarDificuldade(estado: EstadoDificuldade): DificuldadeSalva {
  return { ...estado };
}

/** Lê o que veio do disco com tolerância a lixo/versão antiga. */
export function hidratarDificuldade(valor: unknown): EstadoDificuldade {
  if (!valor || typeof valor !== "object") return dificuldadeInicial();
  const bruto = valor as Partial<DificuldadeSalva>;
  const alternativas = Math.min(
    MAX_ALTERNATIVAS,
    Math.max(MIN_ALTERNATIVAS, Math.round(Number(bruto.alternativas) || MIN_ALTERNATIVAS)),
  ) as QtdAlternativas;
  return {
    alternativas,
    acertosSeguidos: limitar(bruto.acertosSeguidos, ACERTOS_PARA_SUBIR),
    quasesSeguidos: limitar(bruto.quasesSeguidos, QUASES_PARA_DESCER),
  };
}

function limitar(valor: unknown, teto: number): number {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, teto);
}
