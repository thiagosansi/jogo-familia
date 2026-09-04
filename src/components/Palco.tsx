"use client";

/**
 * <Palco> — o layout de UMA rodada, igual para os 4 mini-jogos:
 * pergunta (com botão de repetir a fala) + grade de alternativas + feedback.
 *
 *   const { estado, tocar, repetir, falando } = useRodada(config, { vozes });
 *
 *   <Palco
 *     pergunta="Cadê a mamãe?"
 *     fase={estado.fase}
 *     aoRepetir={repetir}
 *     falando={falando}
 *     feedback={estado.fase === "quaseLa" ? "Quase!" : null}
 *   >
 *     {estado.alternativas.map((id) => (
 *       <BotaoAlternativa
 *         key={id}
 *         aoTocar={() => tocar(id)}
 *         travado={estado.fase !== "perguntando"}
 *         acertou={estado.escolhida === id}
 *         rotulo={nomeDe(id)}
 *       >
 *         <Personagem foto={fotoDe(id)} animacao="idle" />
 *       </BotaoAlternativa>
 *     ))}
 *   </Palco>
 *
 * Portrait e landscape saem do mesmo markup (grade auto-fit). Todo alvo
 * respeita `--toque-min` (88px).
 *
 * SLOT `cena` (opcional) — entre a pergunta e a grade
 * ---------------------------------------------------
 * Alguns modos precisam mostrar ALGO sobre o que a pergunta fala, e não só
 * as alternativas: o cardume que a criança tem que contar ("Quantos
 * peixinhos tem?") ou o glifo da letra ("Qual começa com a letra P?"). Isso
 * não cabe na `pergunta` — ela é o `<h1>`, texto falado pela `filaDeFala` —
 * nem numa alternativa, que é alvo de toque.
 *
 *   <Palco pergunta="Quantos peixinhos tem?" cena={<Cardume n={4} />} …>
 *
 * A `cena` é DECORATIVA: nada dentro dela é tocável (a rodada se resolve na
 * grade), e sem ela o layout é exatamente o de antes — a `<div>` só existe
 * quando o modo passa alguma coisa.
 */

import { useCallback, useRef, type ReactNode } from "react";
import type { FaseRodada } from "@/game/engine";
import estilos from "./Palco.module.css";

export interface PalcoProps {
  /** Texto (ou conteúdo) da pergunta. */
  pergunta: ReactNode;
  fase: FaseRodada;
  /** Repete a fala da pergunta. Sem isto, o botão não aparece. */
  aoRepetir?: () => void;
  /** Está tocando áudio agora? Só anima o botão de repetir. */
  falando?: boolean;
  /**
   * Desenho da rodada, entre a pergunta e as alternativas (cardume a contar,
   * glifo da letra…). Decorativo: não recebe toque. Omitido = layout de
   * antes, sem nenhum elemento a mais.
   */
  cena?: ReactNode;
  /** Alternativas (use <BotaoAlternativa>). */
  children: ReactNode;
  /** Área de feedback: careta, comemoração, figurinha. */
  feedback?: ReactNode;
  className?: string;
}

export function Palco({
  pergunta,
  fase,
  aoRepetir,
  falando = false,
  cena,
  children,
  feedback,
  className,
}: PalcoProps) {
  return (
    <section
      className={[estilos.palco, className].filter(Boolean).join(" ")}
      data-fase={fase}
      aria-live="polite"
    >
      <header className={estilos.cabecalho}>
        <h1 className={estilos.pergunta}>{pergunta}</h1>
        {aoRepetir ? (
          <button
            type="button"
            className={estilos.repetir}
            onClick={aoRepetir}
            data-falando={falando}
            aria-label="Ouvir a pergunta de novo"
          >
            <IconeSom />
          </button>
        ) : null}
      </header>

      {cena ? <div className={estilos.cena}>{cena}</div> : null}

      <ul className={estilos.grade}>{children}</ul>

      <div className={estilos.feedback} data-fase={fase}>
        {feedback}
      </div>
    </section>
  );
}

export interface BotaoAlternativaProps {
  /** Chamado UMA vez por toque, no `pointerdown` (feedback em < 100 ms). */
  aoTocar: () => void;
  /** Fase != perguntando: o botão continua visível, só não responde. */
  travado?: boolean;
  /** Esta foi a alternativa correta escolhida (animação de comemoração). */
  acertou?: boolean;
  /** Cor da bolha (aceita token, ex.: `var(--color-coral)`). */
  cor?: string;
  /** Rótulo acessível — a criança não lê, é para leitor de tela/adulto. */
  rotulo?: string;
  children: ReactNode;
}

/**
 * Alvo de toque de uma alternativa.
 *
 * Multi-touch: o primeiro `pointerdown` "prende" o botão (guarda o
 * `pointerId`); dedos extras no MESMO botão não disparam nada. Dedos em
 * botões DIFERENTES são barrados no engine (janela de bloqueio), então a
 * rodada inteira conta um toque só.
 *
 * Usamos `pointerdown` (não `click`) porque o clique só chega ~300 ms depois
 * em alguns navegadores móveis — e o feedback tem que ser imediato.
 */
export function BotaoAlternativa({
  aoTocar,
  travado = false,
  acertou = false,
  cor,
  rotulo,
  children,
}: BotaoAlternativaProps) {
  const ponteiro = useRef<number | null>(null);

  const aoPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (travado) return;
      if (ponteiro.current !== null) return; // já tem um dedo neste botão
      ponteiro.current = e.pointerId;
      aoTocar();
    },
    [aoTocar, travado],
  );

  const soltar = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (ponteiro.current === e.pointerId) ponteiro.current = null;
  }, []);

  // Teclado (adulto testando / acessibilidade): o clique não passa pelo
  // pointerdown, então tratamos aqui — e ignoramos o clique sintético do mouse
  // que vem depois do pointerdown.
  const aoTeclar = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (travado) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      aoTocar();
    },
    [aoTocar, travado],
  );

  return (
    <li>
      <button
        type="button"
        className={estilos.alternativa}
        style={cor ? ({ "--cor": cor } as React.CSSProperties) : undefined}
        onPointerDown={aoPointerDown}
        onPointerUp={soltar}
        onPointerCancel={soltar}
        onPointerLeave={soltar}
        onKeyDown={aoTeclar}
        data-travado={travado}
        data-acertou={acertou}
        aria-label={rotulo}
        aria-disabled={travado}
      >
        {children}
      </button>
    </li>
  );
}

function IconeSom() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4 9v6h4l5 4V5L8 9H4Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
