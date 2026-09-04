/**
 * DIFICULDADE ADAPTATIVA — lógica PURA (sem React, sem IO).
 *
 * Regra (mesma para todos os mini-jogos):
 *  - começa com 2 alternativas;
 *  - 3 acertos consecutivos      -> sobe um nível (3, depois 4 alternativas);
 *  - 2 `quaseLa` consecutivos    -> desce um nível (mínimo 2 alternativas).
 *
 * Acerto zera o contador de `quaseLa` e vice-versa: só sequências contam.
 * Ao mudar de nível os contadores zeram, então "mais 3 acertos" para ir de
 * 3 para 4 alternativas são 3 acertos NOVOS.
 *
 * TETO POR MINI-JOGO (`maximo`)
 * -----------------------------
 * O teto NÃO é mais global. `MAX_ALTERNATIVAS = 4` continua sendo o padrão —
 * é o que cabe confortavelmente numa bolha grande de tablet com foto ou
 * bicho dentro, e é o teto dos modos escritos para a criança de 3 anos
 * (família, cores, contar, animais, inglês). Os modos escritos para os 5
 * anos (números, letras) mostram alternativas pequenas — um algarismo, um
 * glifo — e comportam mais opções na mesma tela, então pedem um teto maior
 * passando `dificuldadeInicial(2, 6)`.
 *
 * `TETO_ABSOLUTO = 6` é o limite do TIPO (`QtdAlternativas`): nenhum modo,
 * nem dado velho vindo do disco, sobe além disso. Seis é onde a grade
 * `auto-fit` do `<Palco>` ainda dá alvo maior que `--toque-min` (88px) num
 * tablet em retrato — passar disso vira alvo pequeno demais para um dedo de
 * criança, que é o único motivo pelo qual existe um teto.
 *
 * Como os mini-jogos usam:
 *
 *   let dif = dificuldadeInicial();                       // teto padrão (4)
 *   let dif = dificuldadeInicial(2, 6);                   // números, letras
 *   // ou hidratarDificuldade(salvo), que preserva o `maximo` gravado
 *   const alts = montarAlternativas(pool, correta, dif.alternativas);
 *   // ... rodada ...
 *   dif = registrarAcerto(dif);                           // ou registrarQuaseLa(dif)
 *   await setConfig({ ... })                              // persistir: serializarDificuldade(dif)
 *
 * A persistência fica fora daqui de propósito (mantém a lógica testável em
 * node): use `serializarDificuldade` / `hidratarDificuldade` com `config` ou
 * `progresso` do `@/lib/db`.
 */

/** Quantidade de alternativas na tela. Não existe nível além de 6. */
export type QtdAlternativas = 2 | 3 | 4 | 5 | 6;

export const MIN_ALTERNATIVAS: QtdAlternativas = 2;
/** Teto PADRÃO — o de quem não pede outro em `dificuldadeInicial`. */
export const MAX_ALTERNATIVAS: QtdAlternativas = 4;
/** Teto do TIPO: nem um mini-jogo nem um dado salvo passam daqui. */
export const TETO_ABSOLUTO: QtdAlternativas = 6;

/** Acertos consecutivos para subir um nível. */
export const ACERTOS_PARA_SUBIR = 3;
/** `quaseLa` consecutivos para descer um nível. */
export const QUASES_PARA_DESCER = 2;

export interface EstadoDificuldade {
  readonly alternativas: QtdAlternativas;
  /** Teto DESTE mini-jogo. Viaja com o estado (e é persistido) para o modo
   *  não "perder" o teto dele ao reabrir o app. */
  readonly maximo: QtdAlternativas;
  readonly acertosSeguidos: number;
  readonly quasesSeguidos: number;
}

export function dificuldadeInicial(
  alternativas: QtdAlternativas = MIN_ALTERNATIVAS,
  maximo: QtdAlternativas = MAX_ALTERNATIVAS,
): EstadoDificuldade {
  return { alternativas, maximo, acertosSeguidos: 0, quasesSeguidos: 0 };
}

function subir(n: QtdAlternativas, maximo: QtdAlternativas): QtdAlternativas {
  return (n < maximo ? n + 1 : n) as QtdAlternativas;
}

function descer(n: QtdAlternativas): QtdAlternativas {
  return (n > MIN_ALTERNATIVAS ? n - 1 : n) as QtdAlternativas;
}

/** Acerto: soma na sequência de acertos, zera a de `quaseLa`, sobe se bateu 3. */
export function registrarAcerto(estado: EstadoDificuldade): EstadoDificuldade {
  const acertos = estado.acertosSeguidos + 1;
  if (acertos >= ACERTOS_PARA_SUBIR && estado.alternativas < estado.maximo) {
    return {
      alternativas: subir(estado.alternativas, estado.maximo),
      maximo: estado.maximo,
      acertosSeguidos: 0,
      quasesSeguidos: 0,
    };
  }
  return {
    alternativas: estado.alternativas,
    maximo: estado.maximo,
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
    return {
      alternativas: descer(estado.alternativas),
      maximo: estado.maximo,
      acertosSeguidos: 0,
      quasesSeguidos: 0,
    };
  }
  return {
    alternativas: estado.alternativas,
    maximo: estado.maximo,
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
  /** Ausente no que foi salvo ANTES do teto por mini-jogo existir — hidrata
   *  como `MAX_ALTERNATIVAS` (4), que era o teto único daquela época. */
  maximo?: number;
  acertosSeguidos: number;
  quasesSeguidos: number;
}

export function serializarDificuldade(estado: EstadoDificuldade): DificuldadeSalva {
  return { ...estado };
}

/**
 * Lê o que veio do disco com tolerância a lixo/versão antiga.
 *
 * Dois tetos entram aqui, nesta ordem: `TETO_ABSOLUTO` (o do tipo, contra
 * dado corrompido ou de uma versão futura) e depois o `maximo` do próprio
 * estado — um aparelho que jogou "números" com teto 6 e voltou para um modo
 * de teto 4 nunca reabre com 6 bolhas na tela.
 */
export function hidratarDificuldade(valor: unknown): EstadoDificuldade {
  if (!valor || typeof valor !== "object") return dificuldadeInicial();
  const bruto = valor as Partial<DificuldadeSalva>;
  const maximo = entre(bruto.maximo, MAX_ALTERNATIVAS);
  const alternativas = Math.min(maximo, entre(bruto.alternativas, MIN_ALTERNATIVAS)) as
    QtdAlternativas;
  return {
    alternativas,
    maximo,
    acertosSeguidos: limitar(bruto.acertosSeguidos, ACERTOS_PARA_SUBIR),
    quasesSeguidos: limitar(bruto.quasesSeguidos, QUASES_PARA_DESCER),
  };
}

/** Arredonda e prende entre `MIN_ALTERNATIVAS` e `TETO_ABSOLUTO`. */
function entre(valor: unknown, padrao: QtdAlternativas): QtdAlternativas {
  const n = Math.round(Number(valor)) || padrao;
  return Math.min(TETO_ABSOLUTO, Math.max(MIN_ALTERNATIVAS, n)) as QtdAlternativas;
}

function limitar(valor: unknown, teto: number): number {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, teto);
}
