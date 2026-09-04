"use client";

import { useEffect } from "react";
import { registrarGesto, unlockAudio } from "@/lib/media";

/**
 * iOS Safari só deixa tocar áudio se o AudioContext for criado/retomado dentro
 * de um gesto do usuário. Este componente escuta o PRIMEIRO `pointerdown` do
 * documento (e um `touchend` de reforço para o Safari antigo) e destrava o
 * contexto — depois disso todo som do jogo funciona.
 *
 * O mesmo handler também chama `registrarGesto()`: no Chrome desktop
 * `speechSynthesis.speak()` sem gesto prévio falha silenciosamente
 * (`not-allowed`), então `motorDoBrowser` (em `game/fala.ts`) espera esse
 * sinal antes de tentar falar — sem ele a 1ª pergunta da rodada seria
 * engolida ao abrir a página direto pela URL.
 *
 * Não renderiza nada.
 */
export function DesbloqueioAudio() {
  useEffect(() => {
    let feito = false;
    const destravar = () => {
      if (feito) return;
      feito = true;
      registrarGesto();
      void unlockAudio();
      remover();
    };
    const opcoes = { capture: true } as const;
    const remover = () => {
      document.removeEventListener("pointerdown", destravar, opcoes);
      document.removeEventListener("touchend", destravar, opcoes);
      document.removeEventListener("keydown", destravar, opcoes);
    };
    document.addEventListener("pointerdown", destravar, opcoes);
    document.addEventListener("touchend", destravar, opcoes);
    document.addEventListener("keydown", destravar, opcoes);
    return remover;
  }, []);

  return null;
}
