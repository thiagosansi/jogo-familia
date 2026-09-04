"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import estilos from "./PortaoPais.module.css";

/** Quanto tempo o adulto precisa segurar para abrir o painel. */
export const DURACAO_PORTAO_MS = 3000;
/** Hold mais curto para confirmar exclusões dentro do painel. */
export const DURACAO_CONFIRMA_MS = 1500;

interface Segurar {
  /** 0 a 1 — quanto do tempo já passou. */
  progresso: number;
  segurando: boolean;
  /** Espalhe em qualquer elemento clicável (`<button>`). */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onKeyUp: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
  };
}

/**
 * "Segure para confirmar" — a trava que separa a criança do painel do adulto.
 *
 * Por que hold e não senha: uma criança de 3 anos não digita, mas também não
 * sustenta pressão por 3 segundos parada — ela toca e solta. Já o adulto faz
 * isso sem pensar, sem teclado aparecendo por cima da tela e sem nada para
 * lembrar. Soltar antes do fim zera o progresso: toques repetidos NÃO acumulam,
 * cada `pointerdown` recomeça do zero.
 *
 * Duas fontes de tempo, de propósito: um `setTimeout` decide quando o hold
 * terminou (confiável mesmo com a aba oculta ou o frame rate no chão) e um
 * `requestAnimationFrame` só pinta o anel. O anel também não é CSS animation
 * porque `prefers-reduced-motion` zera as durações do design system — e este
 * indicador é informação, não enfeite: precisa continuar aparecendo.
 */
export function useSegurar(duracaoMs: number, aoCompletar: () => void): Segurar {
  const [progresso, setProgresso] = useState(0);
  // Estado próprio: "está segurando" não pode depender do anel, que é
  // atualizado por frames e congela em aba oculta.
  const [segurando, setSegurando] = useState(false);
  const animacao = useRef<number | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parar = useCallback(() => {
    if (animacao.current !== null) cancelAnimationFrame(animacao.current);
    animacao.current = null;
    if (relogio.current !== null) clearTimeout(relogio.current);
    relogio.current = null;
    setProgresso(0);
    setSegurando(false);
  }, []);

  const iniciar = useCallback(() => {
    if (relogio.current !== null) return; // já está contando
    const inicio = performance.now();
    setSegurando(true);

    // Quem decide que o hold terminou é o timer, não o loop de animação: o
    // `requestAnimationFrame` é suspenso em aba oculta e engasga sob GC num
    // tablet antigo — o portão não pode depender de frames para abrir.
    relogio.current = setTimeout(() => {
      parar();
      aoCompletar();
    }, duracaoMs);

    // O rAF cuida só do anel. Trava em 0.995 para o preenchimento nunca parecer
    // completo antes de o timer disparar.
    const passo = () => {
      setProgresso(Math.min(0.995, (performance.now() - inicio) / duracaoMs));
      animacao.current = requestAnimationFrame(passo);
    };
    animacao.current = requestAnimationFrame(passo);
  }, [duracaoMs, aoCompletar, parar]);

  // Um unmount no meio do hold (ex.: o portão abriu) não pode deixar rAF solto.
  useEffect(() => parar, [parar]);

  return {
    progresso,
    segurando,
    handlers: {
      onPointerDown: (e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        iniciar();
      },
      onPointerUp: parar,
      // Sem `setPointerCapture`: deslizar o dedo para fora cancela, que é o
      // comportamento esperado de "segure aqui".
      onPointerLeave: parar,
      onPointerCancel: parar,
      onKeyDown: (e) => {
        // O adulto pode estar num teclado (tablet com capa). Ignora autorrepeat.
        if (e.repeat || (e.key !== " " && e.key !== "Enter")) return;
        e.preventDefault();
        iniciar();
      },
      onKeyUp: parar,
      // Segurar no mobile abre o menu de contexto e cancela o gesto.
      onContextMenu: (e) => e.preventDefault(),
    },
  };
}

const RAIO = 54;
const PERIMETRO = 2 * Math.PI * RAIO;

/** Anel de progresso do hold. Puramente visual. */
function Anel({ progresso }: { progresso: number }) {
  return (
    <svg className={estilos.anel} viewBox="0 0 128 128" aria-hidden="true" focusable="false">
      <circle className={estilos.anelTrilho} cx="64" cy="64" r={RAIO} />
      <circle
        className={estilos.anelProgresso}
        cx="64"
        cy="64"
        r={RAIO}
        strokeDasharray={PERIMETRO}
        strokeDashoffset={PERIMETRO * (1 - progresso)}
      />
    </svg>
  );
}

/**
 * Tela-portão do painel dos pais. Ocupa a rota inteira até o hold completar.
 */
export function PortaoPais({ onAbrir }: { onAbrir: () => void }) {
  const { progresso, segurando, handlers } = useSegurar(DURACAO_PORTAO_MS, onAbrir);
  const segundos = Math.max(0, Math.ceil((DURACAO_PORTAO_MS * (1 - progresso)) / 1000));

  return (
    <main className={`tela ${estilos.tela}`}>
      <h1 className="titulo">Área dos pais</h1>
      <p className={estilos.explicacao}>
        Segure o botão por {DURACAO_PORTAO_MS / 1000} segundos para entrar.
      </p>

      <button
        type="button"
        className={estilos.botao}
        data-segurando={segurando || undefined}
        data-teste="portao-botao"
        aria-label={`Segure por ${DURACAO_PORTAO_MS / 1000} segundos para abrir a área dos pais`}
        {...handlers}
      >
        <Anel progresso={progresso} />
        <span className={estilos.rotulo} aria-hidden="true">
          {segurando ? segundos : "Segure"}
        </span>
      </button>

      {/* Só leitores de tela: o valor muda muito rápido para virar texto na tela. */}
      <output className="so-leitor" aria-live="polite">
        {segurando ? `Faltam ${segundos} segundos` : ""}
      </output>

      <Link className={estilos.voltar} href="/">
        Voltar para o jogo
      </Link>
    </main>
  );
}
