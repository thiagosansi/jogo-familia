/**
 * <ObjetoMar> — as cinco silhuetas do fundo do mar usadas pelos modos
 * "cores e formas" e "contar de 1 a 5". ARTE ORIGINAL, desenhada à mão em SVG
 * (nada de personagem de terceiros, nada de biblioteca de ícones).
 *
 *   <ObjetoMar forma="concha" cor="#3a86ff" rotulo="concha azul" />
 *
 * REGRA DE ACESSIBILIDADE: a forma é tão informativa quanto a cor. Cada cor do
 * catálogo (`@/game/modos/cores`) tem uma silhueta exclusiva, então a criança
 * daltônica resolve a rodada pela silhueta. Por isso o desenho é chapado, com
 * contorno escuro grosso e sem degradê: a diferença entre concha, estrela,
 * água-viva, bolha e peixe tem que ser óbvia a um metro de distância.
 *
 * COMO A COR ENTRA: o `<svg>` recebe `color: <cor>` e as partes principais
 * usam `fill="currentColor"`. Os detalhes (nervuras, olhos, brilho) vêm de
 * classes do CSS Module com `color-mix(... currentColor ...)` — presentation
 * attribute não resolve `var()`, então nada de `fill="var(--x)"` aqui.
 *
 * TAMANHO: o SVG ocupa 100% do container e mantém proporção 1:1. Quem garante
 * o alvo de 88px é o `<BotaoAlternativa>` (`--toque-min`), não este componente.
 */

import type { FormaObjeto } from "@/game/modos/cores";
import estilos from "./objetos.module.css";

export interface ObjetoMarProps {
  forma: FormaObjeto;
  /** Qualquer cor CSS. Vira `color` do SVG e pinta o `currentColor`. */
  cor: string;
  /** Rótulo acessível ("concha azul"). Sem ele o desenho é decorativo. */
  rotulo?: string;
  /** Inclinação em graus — só para os bichinhos não ficarem enfileirados iguais. */
  giro?: number;
  className?: string;
}

export function ObjetoMar({ forma, cor, rotulo, giro = 0, className }: ObjetoMarProps) {
  const acessivel = rotulo
    ? { role: "img" as const, "aria-label": rotulo }
    : { "aria-hidden": true as const };

  return (
    <svg
      viewBox="0 0 100 100"
      className={[estilos.objeto, className].filter(Boolean).join(" ")}
      style={{ color: cor, ...(giro ? { rotate: `${giro}deg` } : null) }}
      focusable="false"
      {...acessivel}
    >
      <g className={estilos.contorno}>{DESENHOS[forma]}</g>
    </svg>
  );
}

/**
 * Um `<g>` por forma. Mantidos aqui (e não em arquivos soltos) porque são
 * pequenos e é assim que dá para comparar as cinco silhuetas de uma olhada —
 * elas precisam ser diferentes ENTRE SI, esse é o requisito.
 */
const DESENHOS: Record<FormaObjeto, React.ReactNode> = {
  // Concha: leque com dobradiça embaixo e cinco lóbulos na borda de cima.
  concha: (
    <>
      <path
        d="M50 90 L10 44 Q19 20 27 40 Q35 14 42 37 Q50 10 58 37 Q65 14 73 40 Q81 20 90 44 Z"
        fill="currentColor"
      />
      <g className={estilos.detalhe} fill="none" strokeWidth="3.5" strokeLinecap="round">
        <path d="M50 86 L28 44" />
        <path d="M50 86 L42 40" />
        <path d="M50 86 L50 30" />
        <path d="M50 86 L58 40" />
        <path d="M50 86 L72 44" />
      </g>
      <circle cx="50" cy="86" r="6" className={estilos.detalheCheio} />
    </>
  ),

  // Estrela do mar: cinco braços gordos e bolinhas de textura.
  estrela: (
    <>
      <path
        d="M50 8 L62 37 L93 39 L69 59 L77 90 L50 72 L23 90 L31 59 L7 39 L38 37 Z"
        fill="currentColor"
        strokeLinejoin="round"
      />
      <g className={estilos.detalheCheio}>
        <circle cx="50" cy="30" r="3.4" />
        <circle cx="38" cy="52" r="3.4" />
        <circle cx="62" cy="52" r="3.4" />
        <circle cx="44" cy="70" r="3.4" />
        <circle cx="58" cy="70" r="3.4" />
      </g>
    </>
  ),

  // Água-viva: cúpula alta, saia ondulada e quatro tentáculos.
  aguaViva: (
    <>
      <g className={estilos.detalhe} fill="none" strokeWidth="5" strokeLinecap="round">
        <path d="M30 60 C25 70 34 76 28 90" />
        <path d="M43 63 C39 74 48 80 42 92" />
        <path d="M57 63 C61 74 52 80 58 92" />
        <path d="M70 60 C75 70 66 76 72 90" />
      </g>
      <path
        d="M14 56 C14 26 30 8 50 8 C70 8 86 26 86 56 C76 50 72 64 62 60 C55 57 54 64 50 64 C46 64 45 57 38 60 C28 64 24 50 14 56 Z"
        fill="currentColor"
      />
      <g className={estilos.brilho}>
        <ellipse cx="36" cy="30" rx="8" ry="11" transform="rotate(-18 36 30)" />
      </g>
    </>
  ),

  // Bolha: círculo com anel interno e brilho — leve e redonda.
  bolha: (
    <>
      <circle cx="50" cy="50" r="38" fill="currentColor" />
      <circle
        cx="50"
        cy="50"
        r="27"
        fill="none"
        className={estilos.detalhe}
        strokeWidth="3.5"
      />
      <ellipse cx="36" cy="34" rx="9" ry="12" transform="rotate(-30 36 34)" className={estilos.brilho} />
    </>
  ),

  // Peixinho: corpo oval, rabo triangular, barbatana e olho grande.
  peixe: (
    <>
      <path d="M70 50 L95 28 L95 72 Z" fill="currentColor" strokeLinejoin="round" />
      <ellipse cx="43" cy="50" rx="33" ry="23" fill="currentColor" />
      <path d="M40 28 Q50 12 60 30" fill="currentColor" strokeLinejoin="round" />
      <circle cx="24" cy="43" r="8" className={estilos.brilho} />
      <circle cx="24" cy="43" r="4" className={estilos.pupila} />
      <path d="M46 62 Q56 70 66 62" className={estilos.detalhe} fill="none" strokeWidth="3.5" strokeLinecap="round" />
    </>
  ),
};
