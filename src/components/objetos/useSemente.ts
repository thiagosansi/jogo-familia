"use client";

/**
 * `useSemente()` — a semente de sorteio dos mini-jogos, sem quebrar hidratação
 * e sem deixar a tela vazia se o sorteio não chegar.
 *
 * O PROBLEMA: as rodadas de cores/contar são sorteadas. Chamar `Math.random()`
 * durante o render faz o HTML do servidor sair diferente do primeiro render do
 * cliente (hydration mismatch). E resolver com `useState(null)` +
 * `useEffect(() => setSemente(...))` é justamente o `setState` dentro de efeito
 * que o compilador do React acusa (cascading render).
 *
 * A SOLUÇÃO: `useSyncExternalStore`. O snapshot do servidor é `SEMENTE_SSR`
 * (uma constante), então o HTML do servidor e o render de hidratação são
 * idênticos; depois de hidratar o React troca para o snapshot do cliente, que é
 * a semente sorteada nesta sessão.
 *
 * POR QUE NÃO DEVOLVE `null`: uma versão anterior devolvia `null` antes de
 * hidratar e a página desenhava um "carregando". Em ambiente onde a troca de
 * snapshot não acontece (hidratação interrompida, tablet velho, extensão que
 * quebra o hydrate), a criança fica olhando uma tela vazia — inaceitável para o
 * público deste jogo. Devolvendo sempre um número, o pior caso é o jogo abrir
 * sempre na mesma sequência de rodadas, e ele continua jogável.
 *
 * A semente do cliente é sorteada UMA vez por carregamento e memoizada no
 * módulo: `getSnapshot` precisa devolver sempre o mesmo valor, senão o React
 * re-renderiza em loop. Cada mini-jogo deriva as suas rodadas dela
 * (`criarSorteio(semente + n * k)`) — aleatório entre sessões, determinístico
 * dentro de uma. Como a semente muda depois de hidratar, use-a como `key` do
 * componente do jogo para ele remontar com a sequência nova.
 */

import { useSyncExternalStore } from "react";

/** Semente do render do servidor (e da hidratação). Jogável por si só. */
export const SEMENTE_SSR = 0;

let semente: number | null = null;

function sementeDaSessao(): number {
  semente ??= 1 + Math.floor(Math.random() * (2 ** 31 - 1));
  return semente;
}

/** Nada muda depois do primeiro snapshot — a assinatura é um no-op. */
function assinar(): () => void {
  return () => {};
}

function sementeDoServidor(): number {
  return SEMENTE_SSR;
}

export function useSemente(): number {
  return useSyncExternalStore(assinar, sementeDaSessao, sementeDoServidor);
}
