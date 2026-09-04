"use client";

/**
 * SESSÃO — o limite de tempo de brincadeira, com despedida ritualizada.
 * =============================================================================
 *
 * O PROBLEMA REAL: arrancar o tablet da mão de uma criança de 3 anos é briga
 * certa. Se quem encerra é um personagem que se despede ("Tchau, até amanhã!"),
 * a criança entrega o aparelho — o fim vira parte da brincadeira.
 *
 * REGRAS QUE NÃO SÃO NEGOCIÁVEIS
 * ------------------------------
 * 1. **A criança NUNCA vê o tempo.** Sem relógio, sem barra, sem contagem
 *    regressiva. Antecipar o fim gera ansiedade e some com a atenção. Quem vê
 *    o limite é o adulto, no painel (`config.limiteSessaoMin`; hoje o padrão
 *    está em 0 = desligado, ver regra 4).
 * 2. **O timer não corta no meio de nada.** Ele só ARMA o fim (`expirou`);
 *    quem escolhe o momento é a tela, num ponto seguro — fim de rodada nos
 *    mini-jogos, fila de fala vazia no aquário. Um "tchau" por cima da
 *    comemoração seria exatamente o corte que a criança sente como punição.
 * 3. **Sessão é do aparelho, não da tela.** Trocar de mini-jogo não reinicia o
 *    relógio: ele vive no `sessionStorage` (some ao fechar o app, sobrevive a
 *    um reload no meio da brincadeira).
 * 4. **Limite <= 0 significa SEM limite.** O adulto pode desligar o recurso.
 *    Sem limite = sem despedida, ponto final — mesmo que uma sessão anterior
 *    já tenha se despedido (`encerradaEm` preenchido) antes do limite ser
 *    desligado. Ver `despedidaPendente`. Hoje o padrão (`CONFIG_PADRAO` em
 *    `src/lib/db.ts`) está com o limite desligado; 7 min é o valor de volta.
 *
 * COMO UMA TELA USA (mini-jogo — ponto seguro = fim da rodada):
 *
 *   const sessao = useSessao();
 *   ...
 *   aoRecompensar: () => {
 *     void addFigurinha(...);
 *     if (sessao.encerrar()) return;   // acabou o tempo: congela aqui
 *     proximaRodada();
 *   }
 *   ...
 *   {sessao.despedindo ? <Despedida /> : null}
 *
 * COMO O AQUÁRIO USA (sem rodada — ponto seguro = ninguém falando):
 *
 *   useEncerrarQuandoLivre(sessao, () => !filaDeFala.falando);
 */

import { useCallback, useEffect, useRef, useState } from "react";
// Relativo (não `@/lib/db`) de propósito: este arquivo precisa ser
// carregável por `node --test` puro (sem o resolvedor de alias do Next.js) —
// ver `src/game/sessao.test.ts` e o padrão em `src/game/modos/familia.ts`.
import { getConfig } from "../lib/db.ts";

/** Chave no `sessionStorage`. Fechar o app zera — cada abertura é uma sessão. */
export const CHAVE_SESSAO = "jogo-familia:sessao";

export interface EstadoSessao {
  /** Quando esta sessão começou (epoch ms). */
  inicio: number;
  /** Quando o personagem se despediu. `null` = a sessão ainda está de pé. */
  encerradaEm: number | null;
}

// `sessionStorage` lança em contextos exóticos (iOS em modo privado antigo,
// webview com storage bloqueado). O espelho em memória mantém a sessão
// funcionando dentro da mesma navegação, que é o caso que importa.
let memoria: EstadoSessao | null = null;

function ler(): EstadoSessao | null {
  try {
    const cru = sessionStorage.getItem(CHAVE_SESSAO);
    if (!cru) return memoria;
    const dado = JSON.parse(cru) as Partial<EstadoSessao>;
    if (typeof dado?.inicio !== "number") return memoria;
    return { inicio: dado.inicio, encerradaEm: dado.encerradaEm ?? null };
  } catch {
    return memoria;
  }
}

function gravar(estado: EstadoSessao): EstadoSessao {
  memoria = estado;
  try {
    sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(estado));
  } catch {
    /* memória basta */
  }
  return estado;
}

/**
 * A sessão corrente, criando uma se ainda não houver. `agora` é injetável para
 * teste — nada aqui chama `Date.now()` escondido quando o chamador informa.
 */
export function sessaoAtual(agora: number = Date.now()): EstadoSessao {
  return ler() ?? gravar({ inicio: agora, encerradaEm: null });
}

/**
 * Só LÊ (`null` se ainda não há sessão). O relatório dos pais usa esta: abrir
 * o relatório não pode ligar o relógio da criança.
 */
export function lerSessao(): EstadoSessao | null {
  return ler();
}

/**
 * Recomeça o relógio. Chamado pelo adulto em `/pais/progresso` ("liberar mais
 * um tempinho") — é o único jeito de continuar depois da despedida sem fechar
 * o app, e ele vive atrás do portão de propósito.
 */
export function reiniciarSessao(agora: number = Date.now()): EstadoSessao {
  return gravar({ inicio: agora, encerradaEm: null });
}

/** Marca que a despedida aconteceu. Entrar num jogo de novo despede na hora. */
export function marcarEncerrada(agora: number = Date.now()): EstadoSessao {
  return gravar({ ...sessaoAtual(agora), encerradaEm: agora });
}

/** Minutos → ms, tratando limite ausente/zero/negativo como "sem limite". */
export function limiteEmMs(limiteMin: number | undefined): number | null {
  if (typeof limiteMin !== "number" || !Number.isFinite(limiteMin) || limiteMin <= 0) return null;
  return Math.round(limiteMin * 60_000);
}

/** Quanto falta (ms) — `null` quando não há limite. Negativo = já passou. */
export function faltaMs(
  estado: EstadoSessao,
  limiteMs: number | null,
  agora: number = Date.now(),
): number | null {
  if (limiteMs === null) return null;
  return estado.inicio + limiteMs - agora;
}

/**
 * A despedida deve estar (ou ficar) na tela agora?
 *
 * Sem limite (`limiteMs === null`) é sempre `false` — mesmo que `estado`
 * carregue um `encerradaEm` de uma sessão que se despediu ANTES de o adulto
 * desligar o limite. Sem essa checagem primeiro, desligar o limite não
 * bastava: uma sessão já encerrada continuava despedindo para sempre, porque
 * `armar` olhava `encerradaEm` antes de olhar o limite (bug corrigido aqui).
 */
export function despedidaPendente(
  estado: EstadoSessao,
  limiteMs: number | null,
  agora: number = Date.now(),
): boolean {
  if (limiteMs === null) return false;
  if (estado.encerradaEm !== null) return true;
  const falta = faltaMs(estado, limiteMs, agora);
  return falta !== null && falta <= 0;
}

// ---------------------------------------------------------------- hook React

export interface Sessao {
  /** O tempo acabou? (Ainda NÃO quer dizer que a despedida começou.) */
  expirou: boolean;
  /** A despedida está na tela agora. */
  despedindo: boolean;
  /**
   * Chame num PONTO SEGURO (fim de rodada). Devolve `true` se assumiu o fim —
   * nesse caso a tela deve congelar e renderizar `<Despedida>`; `false` quer
   * dizer "ainda tem tempo, siga o jogo".
   */
  encerrar: () => boolean;
}

/**
 * Liga a tela ao relógio da sessão.
 *
 * Detalhe importante: se a sessão JÁ foi encerrada (a criança voltou para a
 * home e entrou noutro jogo), a despedida aparece na montagem — senão o limite
 * viraria "mais uma rodada" a cada tela, e o combinado com o adulto morre.
 */
export function useSessao(): Sessao {
  const [expirou, setExpirou] = useState(false);
  const [despedindo, setDespedindo] = useState(false);
  // Fonte síncrona para `encerrar`, que é chamado de dentro de callbacks
  // memoizados do `useRodada` (não enxergam o state do render corrente).
  const expirouRef = useRef(false);
  const despedindoRef = useRef(false);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const armar = (limiteMs: number | null) => {
      if (!vivo) return;
      const estado = sessaoAtual();

      // Sem limite: nunca despede, nem por prazo, nem por uma despedida
      // anterior (o adulto pode ter desligado o limite depois dela).
      if (!despedidaPendente(estado, limiteMs)) {
        const falta = faltaMs(estado, limiteMs);
        if (falta === null) return; // sem limite configurado
        // O prazo é ABSOLUTO: se a aba ficar em segundo plano e o timer
        // atrasar, ele só dispara mais tarde — nunca antes da hora.
        timer = setTimeout(() => {
          if (!vivo) return;
          expirouRef.current = true;
          setExpirou(true);
        }, falta);
        return;
      }

      expirouRef.current = true;
      setExpirou(true);
      // Já se despediu nesta sessão: não há segunda chance sem o adulto —
      // mostra a despedida direto, sem esperar um novo ponto seguro.
      if (estado.encerradaEm !== null) {
        despedindoRef.current = true;
        setDespedindo(true);
      }
    };

    // Config indisponível (aba anônima, quota) NÃO pode travar o jogo: sem
    // limite conhecido, a brincadeira segue.
    void getConfig()
      .then((c) => armar(limiteEmMs(c.limiteSessaoMin)))
      .catch(() => {});

    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const encerrar = useCallback(() => {
    if (!expirouRef.current) return false;
    if (!despedindoRef.current) {
      despedindoRef.current = true;
      marcarEncerrada();
      setDespedindo(true);
    }
    return true;
  }, []);

  return { expirou, despedindo, encerrar };
}

/**
 * Para telas SEM rodada (o aquário): tenta encerrar assim que `livre()` disser
 * que não há fala nem animação em curso. Sondagem curta em vez de assinatura
 * porque as condições vêm de fontes diferentes (fila de fala, timer de pulo) —
 * 300 ms é imperceptível para a criança e barato para a bateria, e só roda
 * depois que o tempo já acabou.
 */
export function useEncerrarQuandoLivre(sessao: Sessao, livre: () => boolean): void {
  const { expirou, despedindo, encerrar } = sessao;
  const livreRef = useRef(livre);
  useEffect(() => {
    livreRef.current = livre;
  });

  useEffect(() => {
    if (!expirou || despedindo) return;
    if (livreRef.current()) {
      encerrar();
      return;
    }
    const id = setInterval(() => {
      if (livreRef.current()) encerrar();
    }, 300);
    return () => clearInterval(id);
  }, [expirou, despedindo, encerrar]);
}
