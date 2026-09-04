"use client";

/**
 * <Bicho> — os seis animais do modo `/jogo/animais`, em SVG.
 *
 *   <Bicho qual="vaca" />
 *   <Bicho qual="galo" rotulo="galo" tamanho="clamp(120px, 26vmin, 240px)" />
 *
 * Arte ORIGINAL, desenhada aqui à mão em coordenadas (viewBox 0 0 100 100), no
 * mesmo vocabulário visual dos mascotes de `<Personagem>`: formas cheias,
 * contorno grosso, olhos redondos grandes. Nada de personagem de terceiros,
 * nada de fonte de emoji (que muda de desenho em cada aparelho).
 *
 * Só desenho: quem cuida de toque, som e animação é a página do modo.
 */

import type { IdAnimal } from "@/game/modos/animais";

export interface BichoProps {
  qual: IdAnimal;
  /** Tamanho do quadro (qualquer valor CSS). Padrão: 100%. */
  tamanho?: string;
  /** Rótulo acessível. Sem ele o desenho é decorativo (`aria-hidden`). */
  rotulo?: string;
  className?: string;
}

export function Bicho({ qual, tamanho, rotulo, className }: BichoProps) {
  const acessivel = rotulo
    ? ({ role: "img" as const, "aria-label": rotulo })
    : ({ "aria-hidden": true as const });

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      focusable="false"
      style={{ inlineSize: tamanho ?? "100%", blockSize: "auto", display: "block" }}
      {...acessivel}
    >
      {DESENHOS[qual]()}
    </svg>
  );
}

/** Olhos redondos com brilho — a mesma "assinatura" dos mascotes do mar. */
function Olhos({ x1, x2, y, r = 7 }: { x1: number; x2: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x1} cy={y} r={r} fill="#fdf6e3" />
      <circle cx={x2} cy={y} r={r} fill="#fdf6e3" />
      <circle cx={x1 + 1} cy={y + 1} r={r / 2.2} fill="#2b1006" />
      <circle cx={x2 + 1} cy={y + 1} r={r / 2.2} fill="#2b1006" />
    </g>
  );
}

const TRACO = "#2b1006";

function Vaca() {
  return (
    <g>
      {/* orelhas */}
      <ellipse cx="16" cy="42" rx="11" ry="7" fill="#fdf6e3" stroke={TRACO} strokeWidth="3.5" />
      <ellipse cx="84" cy="42" rx="11" ry="7" fill="#fdf6e3" stroke={TRACO} strokeWidth="3.5" />
      {/* chifres */}
      <path d="M30 24 q-6 -10 4 -12 q2 7 8 9" fill="#ffd166" stroke={TRACO} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M70 24 q6 -10 -4 -12 q-2 7 -8 9" fill="#ffd166" stroke={TRACO} strokeWidth="3.5" strokeLinejoin="round" />
      {/* cabeça */}
      <ellipse cx="50" cy="52" rx="34" ry="32" fill="#fdf6e3" stroke={TRACO} strokeWidth="4" />
      {/* manchas */}
      <path d="M26 34 q12 -6 16 6 q-10 10 -18 4z" fill={TRACO} opacity="0.85" />
      <circle cx="74" cy="62" r="7" fill={TRACO} opacity="0.85" />
      <Olhos x1={38} x2={62} y={45} />
      {/* focinho */}
      <ellipse cx="50" cy="70" rx="20" ry="13" fill="#f2b5a0" stroke={TRACO} strokeWidth="3.5" />
      <ellipse cx="43" cy="68" rx="3" ry="4" fill={TRACO} />
      <ellipse cx="57" cy="68" rx="3" ry="4" fill={TRACO} />
      <path d="M42 77 q8 5 16 0" stroke={TRACO} strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  );
}

function Cachorro() {
  return (
    <g>
      {/* orelhas caídas */}
      <path d="M20 30 q-12 8 -6 30 q10 4 16 -10z" fill="#a9662f" stroke={TRACO} strokeWidth="4" strokeLinejoin="round" />
      <path d="M80 30 q12 8 6 30 q-10 4 -16 -10z" fill="#a9662f" stroke={TRACO} strokeWidth="4" strokeLinejoin="round" />
      <ellipse cx="50" cy="52" rx="32" ry="30" fill="#e8a33d" stroke={TRACO} strokeWidth="4" />
      {/* mancha do olho */}
      <ellipse cx="63" cy="44" rx="13" ry="12" fill="#a9662f" opacity="0.75" />
      <Olhos x1={38} x2={62} y={45} />
      {/* focinho */}
      <ellipse cx="50" cy="68" rx="16" ry="12" fill="#fdf6e3" stroke={TRACO} strokeWidth="3.5" />
      <ellipse cx="50" cy="62" rx="6" ry="4.5" fill={TRACO} />
      <path d="M50 66 v5 M50 71 q-6 5 -10 0 M50 71 q6 5 10 0" stroke={TRACO} strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* língua */}
      <path d="M46 76 q4 10 8 0z" fill="#ff7a5c" stroke={TRACO} strokeWidth="2.5" strokeLinejoin="round" />
    </g>
  );
}

function Gato() {
  return (
    <g>
      {/* orelhas pontudas */}
      <path d="M22 34 L20 12 L42 26z" fill="#c77dff" stroke={TRACO} strokeWidth="4" strokeLinejoin="round" />
      <path d="M78 34 L80 12 L58 26z" fill="#c77dff" stroke={TRACO} strokeWidth="4" strokeLinejoin="round" />
      <ellipse cx="50" cy="54" rx="33" ry="29" fill="#c77dff" stroke={TRACO} strokeWidth="4" />
      {/* listras */}
      <g stroke={TRACO} strokeWidth="3" strokeLinecap="round" opacity="0.7">
        <path d="M42 30 l3 8" />
        <path d="M50 28 l0 9" />
        <path d="M58 30 l-3 8" />
      </g>
      <Olhos x1={38} x2={62} y={50} />
      {/* focinho + bigodes */}
      <path d="M50 62 l-5 -5 h10z" fill="#ff7a5c" stroke={TRACO} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M50 62 v4 M50 66 q-6 6 -11 1 M50 66 q6 6 11 1" stroke={TRACO} strokeWidth="3" fill="none" strokeLinecap="round" />
      <g stroke={TRACO} strokeWidth="2.5" strokeLinecap="round">
        <path d="M32 60 L14 56 M32 66 L14 68" />
        <path d="M68 60 L86 56 M68 66 L86 68" />
      </g>
    </g>
  );
}

function Pato() {
  return (
    <g>
      {/* topete */}
      <path d="M44 22 q6 -14 14 -4" stroke={TRACO} strokeWidth="4" fill="none" strokeLinecap="round" />
      <ellipse cx="50" cy="50" rx="30" ry="29" fill="#ffd166" stroke={TRACO} strokeWidth="4" />
      <Olhos x1={39} x2={61} y={42} />
      {/* bico grande */}
      <ellipse cx="50" cy="66" rx="24" ry="12" fill="#e8a33d" stroke={TRACO} strokeWidth="4" />
      <path d="M28 66 h44" stroke={TRACO} strokeWidth="3" strokeLinecap="round" />
      {/* pés */}
      <path d="M34 84 l-8 8 h16z" fill="#e8a33d" stroke={TRACO} strokeWidth="3" strokeLinejoin="round" />
      <path d="M66 84 l8 8 h-16z" fill="#e8a33d" stroke={TRACO} strokeWidth="3" strokeLinejoin="round" />
    </g>
  );
}

function Galo() {
  return (
    <g>
      {/* crista */}
      <path
        d="M32 26 q2 -14 10 -8 q4 -14 12 -6 q6 -12 12 2 q-10 6 -34 12z"
        fill="#d8452a"
        stroke={TRACO}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <ellipse cx="50" cy="52" rx="30" ry="28" fill="#ff7a5c" stroke={TRACO} strokeWidth="4" />
      <Olhos x1={39} x2={61} y={45} />
      {/* bico aberto (ele está cantando) */}
      <path d="M50 58 L76 54 L50 66z" fill="#ffd166" stroke={TRACO} strokeWidth="3.5" strokeLinejoin="round" />
      {/* barbela */}
      <path d="M46 72 q-2 12 8 12 q8 -2 4 -12z" fill="#d8452a" stroke={TRACO} strokeWidth="3.5" strokeLinejoin="round" />
    </g>
  );
}

function Ovelha() {
  return (
    <g>
      {/* lã: círculos em volta */}
      <g fill="#fdf6e3" stroke={TRACO} strokeWidth="3.5">
        <circle cx="30" cy="34" r="13" />
        <circle cx="50" cy="26" r="14" />
        <circle cx="70" cy="34" r="13" />
        <circle cx="24" cy="54" r="13" />
        <circle cx="76" cy="54" r="13" />
        <circle cx="34" cy="70" r="12" />
        <circle cx="66" cy="70" r="12" />
        <circle cx="50" cy="50" r="22" />
      </g>
      {/* rosto */}
      <ellipse cx="50" cy="56" rx="19" ry="20" fill="#a8dadc" stroke={TRACO} strokeWidth="4" />
      {/* orelhinhas */}
      <ellipse cx="30" cy="54" rx="8" ry="5" fill="#a8dadc" stroke={TRACO} strokeWidth="3.5" transform="rotate(-20 30 54)" />
      <ellipse cx="70" cy="54" rx="8" ry="5" fill="#a8dadc" stroke={TRACO} strokeWidth="3.5" transform="rotate(20 70 54)" />
      <Olhos x1={43} x2={57} y={54} r={6} />
      <path d="M44 66 q6 6 12 0" stroke={TRACO} strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  );
}

/** Mapa id -> desenho. Record garante que todo `IdAnimal` tem arte. */
const DESENHOS: Record<IdAnimal, () => React.ReactElement> = {
  vaca: Vaca,
  cachorro: Cachorro,
  gato: Gato,
  pato: Pato,
  galo: Galo,
  ovelha: Ovelha,
};
