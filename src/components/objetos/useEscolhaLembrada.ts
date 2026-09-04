"use client";

/**
 * `useEscolhaLembrada(chave, validas)` — a última escolha da criança neste
 * aparelho, lembrada sem quebrar hidratação.
 * =============================================================================
 *
 * O QUE RESOLVE: um mini-jogo que abre numa tela de escolha (`<TelaEscolha>`)
 * não pode obrigar a criança a escolher de novo a cada abertura — ela abre o
 * jogo dez vezes num dia. A escolha fica no `localStorage` do aparelho.
 *
 * POR QUE `useSyncExternalStore` E NÃO `useState(() => ler())`: a leitura
 * acontece durante a HIDRATAÇÃO do componente, e o HTML do servidor nunca
 * teve `localStorage`. Um valor lido direto no inicializador do `useState`
 * divergiria do servidor sempre que já existisse escolha salva — hydration
 * mismatch de verdade (foi confirmado no overlay de erro do Next.js quando
 * este código morava em `/jogo/ingles/page.tsx`). `useSyncExternalStore` usa
 * `getServerSnapshot` (`null`) durante a hidratação — igual ao servidor, sem
 * mismatch — e troca para o valor real do cliente logo depois. É o mesmo
 * padrão de `useSemente` (ver o porquê lá).
 *
 * FALHA ABERTA: `localStorage` bloqueado (aba anônima, quota cheia, storage
 * desligado) devolve `null` e engole o erro na gravação. Sem valor lembrado
 * a tela de escolha simplesmente aparece — nunca uma tela quebrada.
 *
 * `validas` é a lista de ids que o mini-jogo aceita HOJE: um valor salvo por
 * uma versão anterior (baralho que não existe mais) é tratado como "nunca
 * escolheu", nunca propagado para dentro do jogo.
 *
 *   const CHAVE = "jogo-familia:ingles:escolha";
 *   const VALIDAS = ["misturado", "numeros"] as const;   // constante de módulo
 *   const [lembrada, lembrar] = useEscolhaLembrada(CHAVE, VALIDAS);
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Ouvintes do "store": só existem para `useSyncExternalStore` re-renderizar
 * quem lembrou uma escolha nova. Um `Set` global (e não por chave) porque a
 * relê é barata — `getSnapshot` bate no `localStorage`, que devolve string,
 * e o React compara por `Object.is`: quem não mudou não re-renderiza.
 */
const ouvintes = new Set<() => void>();

function assinar(aoMudar: () => void): () => void {
  ouvintes.add(aoMudar);
  return () => {
    ouvintes.delete(aoMudar);
  };
}

function avisar(): void {
  for (const ouvinte of [...ouvintes]) ouvinte();
}

/** `null` = nunca escolheu, valor salvo inválido, ou storage indisponível. */
function ler<T extends string>(chave: string, validas: readonly T[]): T | null {
  try {
    const bruta = localStorage.getItem(chave);
    return bruta !== null && (validas as readonly string[]).includes(bruta) ? (bruta as T) : null;
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* Sem storage a escolha desta sessão ainda funciona — só não fica lembrada. */
  }
}

/** Sempre `null` no servidor (não existe `localStorage`) — igual a nunca ter
 *  escolhido, então o HTML do servidor é sempre a tela de escolha. */
function noServidor(): null {
  return null;
}

export function useEscolhaLembrada<T extends string>(
  chave: string,
  validas: readonly T[],
): [T | null, (valor: T) => void] {
  // `validas` num ref para `ler` depender só de `chave`: se `getSnapshot`
  // trocasse de identidade a cada render (por um array literal na chamada),
  // o React reassinaria o store toda vez. O ref deixa o hook seguro mesmo
  // para quem passa a lista inline.
  const validasRef = useRef(validas);
  useEffect(() => {
    validasRef.current = validas;
  }, [validas]);

  const lerAgora = useCallback(() => ler(chave, validasRef.current), [chave]);
  const valor = useSyncExternalStore(assinar, lerAgora, noServidor);

  const lembrar = useCallback(
    (novo: T) => {
      gravar(chave, novo);
      avisar();
    },
    [chave],
  );

  return [valor, lembrar];
}
