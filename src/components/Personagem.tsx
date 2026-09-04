"use client";

/**
 * <Personagem> — o recorte circular da foto da família (ou um mascote do fundo
 * do mar) com quatro estados de animação em CSS keyframes.
 *
 *   <Personagem foto={mae.fotoRecorte} nome="Mamãe" animacao="idle" />
 *   <Personagem mascote="caranguejo" animacao="careta" tamanho="clamp(120px,26vmin,240px)" />
 *   <Personagem foto={p.fotoRecorte} seguirFala />   // pulsa enquanto o áudio toca
 *
 * Estados: `idle` (balanço lento), `pulo`, `fala` (pulso), `careta`.
 * Sob `prefers-reduced-motion: reduce` o elemento fica ESTÁTICO
 * (`animation-name: none` no CSS Module).
 *
 * A foto chega como `Blob` do IndexedDB: viramos `objectURL` e revogamos no
 * cleanup — sem vazar memória ao trocar de rodada.
 *
 * Sem foto — ou com uma foto que NÃO CARREGA (URL do bucket que sumiu, imagem
 * fora do cache offline) — cai para um mascote SVG desenhado aqui (arte
 * original: estrela do mar, caranguejo, peixinho, polvo). Nada de personagem de
 * terceiros, e nunca um quadrado quebrado na tela da criança.
 */

import { useEffect, useMemo, useState } from "react";
import { filaDeFala } from "@/game/fala";
import estilos from "./Personagem.module.css";

export type AnimacaoPersonagem = "idle" | "pulo" | "fala" | "careta";
export type Mascote = "estrela" | "caranguejo" | "peixe" | "polvo";

export const MASCOTES: readonly Mascote[] = ["estrela", "caranguejo", "peixe", "polvo"];

export interface PersonagemProps {
  /**
   * Foto recortada: `Blob` (vindo do IndexedDB) ou `string` (URL servida pela
   * web — o mesmo componente serve nos dois modos). Sem foto, entra o mascote.
   */
  foto?: Blob | string | null;
  /** Nome exibido embaixo (opcional — a criança não lê, é reforço). */
  nome?: string;
  animacao?: AnimacaoPersonagem;
  /** Qual mascote usar quando não há foto. Padrão: escolhido por `nome`/`id`. */
  mascote?: Mascote;
  /** Tamanho do círculo (qualquer valor CSS). Piso: --toque-min (88px). */
  tamanho?: string;
  /** Cor do aro. Aceita token: `var(--color-agua)`. */
  corAro?: string;
  /** Enquanto a fila de fala estiver tocando, força a animação `fala`. */
  seguirFala?: boolean;
  className?: string;
  /** Texto alternativo. Padrão: o nome, ou o nome do mascote. */
  rotulo?: string;
}

export function Personagem({
  foto,
  nome,
  animacao = "idle",
  mascote,
  tamanho,
  corAro,
  seguirFala = false,
  className,
  rotulo,
}: PersonagemProps) {
  const url = useUrlDaFoto(foto ?? null);
  const falando = useFalando(seguirFala);
  // Foto que não carrega (URL do bucket que sumiu, tablet offline com a imagem
  // fora do cache) cai no mascote. NUNCA um quadrado quebrado na cara da
  // criança. Guardamos QUAL url quebrou, e não um booleano: assim a próxima
  // foto já nasce válida sem efeito de reset.
  const [urlQuebrada, setUrlQuebrada] = useState<string | null>(null);
  const fotoQuebrou = url !== null && urlQuebrada === url;

  const estado: AnimacaoPersonagem = seguirFala && falando ? "fala" : animacao;
  const qual = mascote ?? mascotePara(nome ?? "");
  const alt = rotulo ?? nome ?? `mascote ${qual}`;

  return (
    <div
      className={[estilos.personagem, className].filter(Boolean).join(" ")}
      style={{
        ...(tamanho ? ({ "--tamanho": tamanho } as React.CSSProperties) : null),
        ...(corAro ? ({ "--cor-aro": corAro } as React.CSSProperties) : null),
      }}
    >
      <div className={`${estilos.moldura} ${estilos[estado]}`} data-animacao={estado}>
        {url && !fotoQuebrou ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={estilos.foto}
            src={url}
            alt={alt}
            draggable={false}
            onError={() => setUrlQuebrada(url)}
          />
        ) : (
          <MascoteSvg qual={qual} rotulo={alt} />
        )}
      </div>
      {nome ? <span className={estilos.nome}>{nome}</span> : null}
    </div>
  );
}

/**
 * Fonte da foto -> `src` do <img>.
 *
 * `string` (URL na web) passa direto. `Blob` (IndexedDB) vira `objectURL`,
 * revogado quando o Blob muda e no unmount — só o que criamos é revogado.
 *
 * A URL nasce no `useMemo` (e não num efeito com `setState`) para a foto já
 * sair no primeiro paint — sem o flash de mascote antes da foto aparecer.
 */
function useUrlDaFoto(fonte: Blob | string | null): string | null {
  const url = useMemo(
    () => (typeof fonte === "string" ? fonte : fonte ? URL.createObjectURL(fonte) : null),
    [fonte],
  );
  const ehObjectUrl = typeof fonte !== "string" && fonte !== null;
  useEffect(() => {
    if (!url || !ehObjectUrl) return;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url, ehObjectUrl]);
  return url;
}

/** Acompanha a fila de fala só quando pedido (evita assinatura à toa). */
function useFalando(ativo: boolean): boolean {
  const [falando, setFalando] = useState(false);
  useEffect(() => {
    if (!ativo) return;
    return filaDeFala.assinar((evento) => setFalando(evento.falando));
  }, [ativo]);
  return ativo && falando;
}

/** Mascote estável por nome (o mesmo familiar sempre cai no mesmo bicho). */
export function mascotePara(semente: string): Mascote {
  let soma = 0;
  for (let i = 0; i < semente.length; i++) soma = (soma + semente.charCodeAt(i)) % 997;
  return MASCOTES[soma % MASCOTES.length];
}

// ---------------------------------------------------- mascotes (arte original)

function MascoteSvg({ qual, rotulo }: { qual: Mascote; rotulo: string }) {
  return (
    <svg
      className={estilos.mascote}
      viewBox="0 0 100 100"
      role="img"
      aria-label={rotulo}
      focusable="false"
    >
      {qual === "estrela" ? <Estrela /> : null}
      {qual === "caranguejo" ? <Caranguejo /> : null}
      {qual === "peixe" ? <Peixe /> : null}
      {qual === "polvo" ? <Polvo /> : null}
    </svg>
  );
}

/** Olhos redondos usados por todos os mascotes. */
function Olhos({ x1, x2, y, r = 6 }: { x1: number; x2: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x1} cy={y} r={r} fill="#fdf6e3" />
      <circle cx={x2} cy={y} r={r} fill="#fdf6e3" />
      <circle cx={x1 + 1} cy={y + 1} r={r / 2.2} fill="#2b1006" />
      <circle cx={x2 + 1} cy={y + 1} r={r / 2.2} fill="#2b1006" />
    </g>
  );
}

function Estrela() {
  return (
    <g>
      <path
        d="M50 12 L62 40 L92 44 L70 64 L76 92 L50 78 L24 92 L30 64 L8 44 L38 40 Z"
        fill="#ffb703"
        stroke="#d8452a"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <Olhos x1={41} x2={59} y={50} />
      <path d="M40 64 Q50 74 60 64" stroke="#2b1006" strokeWidth="4" fill="none" strokeLinecap="round" />
    </g>
  );
}

function Caranguejo() {
  return (
    <g>
      <path d="M18 46 q-10 -14 2 -22 q6 12 14 14" fill="#ff7a5c" stroke="#d8452a" strokeWidth="4" strokeLinejoin="round" />
      <path d="M82 46 q10 -14 -2 -22 q-6 12 -14 14" fill="#ff7a5c" stroke="#d8452a" strokeWidth="4" strokeLinejoin="round" />
      <ellipse cx="50" cy="58" rx="32" ry="24" fill="#ff7a5c" stroke="#d8452a" strokeWidth="4" />
      <g stroke="#d8452a" strokeWidth="5" strokeLinecap="round">
        <path d="M20 70 L8 82" />
        <path d="M30 78 L24 92" />
        <path d="M80 70 L92 82" />
        <path d="M70 78 L76 92" />
      </g>
      <Olhos x1={40} x2={60} y={50} />
      <path d="M40 66 q10 8 20 0" stroke="#2b1006" strokeWidth="4" fill="none" strokeLinecap="round" />
    </g>
  );
}

function Peixe() {
  return (
    <g>
      <path d="M84 50 L98 32 L98 68 Z" fill="#3ddad7" stroke="#0e4d7a" strokeWidth="4" strokeLinejoin="round" />
      <ellipse cx="48" cy="50" rx="40" ry="28" fill="#3ddad7" stroke="#0e4d7a" strokeWidth="4" />
      <path d="M40 24 q10 -14 20 -2" fill="#2fbf71" stroke="#0e4d7a" strokeWidth="4" strokeLinejoin="round" />
      <Olhos x1={30} x2={30} y={44} r={7} />
      <path d="M18 58 q8 8 16 2" stroke="#0e4d7a" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="62" cy="44" r="5" fill="#2fbf71" />
      <circle cx="70" cy="58" r="4" fill="#2fbf71" />
    </g>
  );
}

function Polvo() {
  return (
    <g>
      <path
        d="M22 58 a28 28 0 0 1 56 0 v10 h-56 Z"
        fill="#c77dff"
        stroke="#6a2c9e"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <g fill="none" stroke="#c77dff" strokeWidth="9" strokeLinecap="round">
        <path d="M28 68 q-6 14 2 22" />
        <path d="M42 70 q-4 16 2 22" />
        <path d="M58 70 q4 16 -2 22" />
        <path d="M72 68 q6 14 -2 22" />
      </g>
      <Olhos x1={40} x2={60} y={48} />
      <path d="M44 62 q6 6 12 0" stroke="#2b1006" strokeWidth="4" fill="none" strokeLinecap="round" />
    </g>
  );
}
