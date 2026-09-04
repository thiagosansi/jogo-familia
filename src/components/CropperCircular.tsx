"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizarFoto } from "@/lib/exif";
import estilos from "./CropperCircular.module.css";

/** Lado do visor em coordenadas lógicas — o círculo é inscrito nele. */
const VISOR = 320;
/** Lado do PNG exportado. 512 basta para o rosto ocupar meia tela do tablet. */
const SAIDA = 512;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

interface Props {
  /** Arquivo cru vindo do `<input type="file">` (ainda com EXIF, ainda enorme). */
  arquivo: Blob;
  /** Recebe o PNG 512x512 com máscara circular. */
  onPronto: (recorte: Blob) => void;
  onCancelar: () => void;
}

interface Ponto {
  x: number;
  y: number;
}

/**
 * Recorte circular sem biblioteca: canvas + pointer events.
 *
 * O que ele resolve, em ordem:
 *  1. Foto de 12 MP trava o canvas e estoura a quota do IndexedDB.
 *  2. Foto de iPhone chega deitada (EXIF `Orientation = 6`).
 *  Os dois são tratados de uma vez por `normalizarFoto` ANTES de qualquer
 *  desenho — daqui para frente os pixels já estão em pé e no tamanho certo.
 *
 * Interação: arrastar posiciona, pinça (dois dedos) ou slider dá zoom. Não há
 * rotação livre nem filtro — o adulto precisa enquadrar um rosto em segundos,
 * não editar uma foto.
 */
export function CropperCircular({ arquivo, onPronto, onCancelar }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagemRef = useRef<ImageBitmap | null>(null);
  const [tamanho, setTamanho] = useState<{ w: number; h: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [desloc, setDesloc] = useState<Ponto>({ x: 0, y: 0 });

  // Gesto: um dedo arrasta, dois dedos dão pinça.
  const ponteiros = useRef(new Map<number, Ponto>());
  const distanciaAnterior = useRef<number | null>(null);

  // ------------------------------------------------------------ carregamento
  useEffect(() => {
    let vivo = true;
    let bitmap: ImageBitmap | null = null;
    (async () => {
      try {
        const pronta = await normalizarFoto(arquivo, 1024);
        bitmap = await createImageBitmap(pronta);
        if (!vivo) {
          bitmap.close();
          return;
        }
        imagemRef.current = bitmap;
        setTamanho({ w: bitmap.width, h: bitmap.height });
      } catch {
        if (vivo) setErro("Não consegui abrir essa foto. Tente escolher outra.");
      }
    })();
    return () => {
      vivo = false;
      imagemRef.current = null;
      bitmap?.close();
    };
  }, [arquivo]);

  // ------------------------------------------------------------- geometria
  /** Escala que faz o menor lado cobrir o círculo inteiro (zoom 1 = "cobrir"). */
  const escalaBase = tamanho ? VISOR / Math.min(tamanho.w, tamanho.h) : 1;

  const limites = useCallback(
    (z: number) => {
      if (!tamanho) return { x: 0, y: 0 };
      const s = escalaBase * z;
      return {
        x: Math.max(0, (tamanho.w * s - VISOR) / 2),
        y: Math.max(0, (tamanho.h * s - VISOR) / 2),
      };
    },
    [tamanho, escalaBase],
  );

  /** Impede buraco transparente: a imagem nunca descobre o círculo. */
  const prender = useCallback(
    (p: Ponto, z: number): Ponto => {
      const lim = limites(z);
      return {
        x: Math.min(lim.x, Math.max(-lim.x, p.x)),
        y: Math.min(lim.y, Math.max(-lim.y, p.y)),
      };
    },
    [limites],
  );

  /** Retângulo de destino da imagem, em coordenadas do visor. */
  const retangulo = useCallback(
    (z: number, d: Ponto) => {
      if (!tamanho) return { x: 0, y: 0, w: VISOR, h: VISOR };
      const s = escalaBase * z;
      const w = tamanho.w * s;
      const h = tamanho.h * s;
      return { x: (VISOR - w) / 2 + d.x, y: (VISOR - h) / 2 + d.y, w, h };
    },
    [tamanho, escalaBase],
  );

  // --------------------------------------------------------------- desenho
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imagemRef.current;
    if (!canvas || !img || !tamanho) return;

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== VISOR * dpr) {
      canvas.width = VISOR * dpr;
      canvas.height = VISOR * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VISOR, VISOR);

    const r = retangulo(zoom, desloc);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);

    // Véu fora do círculo: mostra o que fica de fora sem escondê-lo por completo,
    // para o adulto entender o enquadramento.
    ctx.save();
    ctx.fillStyle = "rgba(4, 29, 51, 0.72)";
    ctx.beginPath();
    ctx.rect(0, 0, VISOR, VISOR);
    ctx.arc(VISOR / 2, VISOR / 2, VISOR / 2, 0, Math.PI * 2, true); // sentido oposto = furo
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(VISOR / 2, VISOR / 2, VISOR / 2 - 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }, [tamanho, zoom, desloc, retangulo]);

  // ---------------------------------------------------------------- gestos
  /** Cliente -> coordenadas do visor (o canvas é escalado por CSS). */
  const paraVisor = (e: React.PointerEvent): Ponto => {
    const caixa = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - caixa.left) * (VISOR / caixa.width),
      y: (e.clientY - caixa.top) * (VISOR / caixa.height),
    };
  };

  const aoDescer = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    ponteiros.current.set(e.pointerId, paraVisor(e));
    distanciaAnterior.current = null;
  };

  const aoMover = (e: React.PointerEvent) => {
    if (!ponteiros.current.has(e.pointerId) || !tamanho) return;
    const atual = paraVisor(e);
    const anterior = ponteiros.current.get(e.pointerId)!;
    ponteiros.current.set(e.pointerId, atual);

    const todos = [...ponteiros.current.values()];
    if (todos.length >= 2) {
      // Pinça: a razão entre as distâncias vira fator de zoom, e o zoom
      // acontece EM VOLTA do ponto médio dos dedos (senão a foto foge da mão).
      const [a, b] = todos;
      const distancia = Math.hypot(a.x - b.x, a.y - b.y);
      const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (distanciaAnterior.current && distancia > 0) {
        const fator = distancia / distanciaAnterior.current;
        aplicarZoom(zoom * fator, meio);
      }
      distanciaAnterior.current = distancia;
      return;
    }

    setDesloc((d) => prender({ x: d.x + (atual.x - anterior.x), y: d.y + (atual.y - anterior.y) }, zoom));
  };

  const aoSubir = (e: React.PointerEvent) => {
    ponteiros.current.delete(e.pointerId);
    if (ponteiros.current.size < 2) distanciaAnterior.current = null;
  };

  /** Muda o zoom mantendo fixo o ponto `ancora` do visor (centro por padrão). */
  const aplicarZoom = (bruto: number, ancora?: Ponto) => {
    if (!tamanho) return;
    const novo = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, bruto));
    const alvo = ancora ?? { x: VISOR / 2, y: VISOR / 2 };
    setDesloc((d) => {
      const antes = retangulo(zoom, d);
      // Onde o ponto âncora cai dentro da imagem, em fração (0..1).
      const u = (alvo.x - antes.x) / antes.w;
      const v = (alvo.y - antes.y) / antes.h;
      const s = escalaBase * novo;
      const w = tamanho.w * s;
      const h = tamanho.h * s;
      return prender({ x: alvo.x - u * w - (VISOR - w) / 2, y: alvo.y - v * h - (VISOR - h) / 2 }, novo);
    });
    setZoom(novo);
  };

  // -------------------------------------------------------------- exportar
  const confirmar = async () => {
    const img = imagemRef.current;
    if (!img || salvando) return;
    setSalvando(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = SAIDA;
      canvas.height = SAIDA;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("sem canvas 2d");
      ctx.imageSmoothingQuality = "high";
      // Máscara circular: o PNG sai com o canto transparente, então o jogo pode
      // colar o rosto em qualquer fundo sem precisar de border-radius.
      ctx.beginPath();
      ctx.arc(SAIDA / 2, SAIDA / 2, SAIDA / 2, 0, Math.PI * 2);
      ctx.clip();

      const k = SAIDA / VISOR;
      const r = retangulo(zoom, desloc);
      ctx.drawImage(img, r.x * k, r.y * k, r.w * k, r.h * k);

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("toBlob vazio");
      onPronto(blob);
    } catch {
      setErro("Não consegui recortar essa foto. Tente outra.");
    } finally {
      setSalvando(false);
    }
  };

  // ---------------------------------------------------------------- render
  if (erro) {
    return (
      <div className={estilos.caixa}>
        <p className={estilos.erro}>{erro}</p>
        <button type="button" className={estilos.acao} onClick={onCancelar}>
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className={estilos.caixa}>
      <p className={estilos.dica}>Arraste para centralizar o rosto. Use a pinça ou a barra para aproximar.</p>

      <canvas
        ref={canvasRef}
        className={estilos.visor}
        data-teste="cropper-visor"
        aria-label="Prévia do recorte circular da foto"
        role="img"
        style={{ visibility: tamanho ? "visible" : "hidden" }}
        onPointerDown={aoDescer}
        onPointerMove={aoMover}
        onPointerUp={aoSubir}
        onPointerCancel={aoSubir}
      />
      {!tamanho && <p className={estilos.dica}>Preparando a foto…</p>}

      <label className={estilos.zoom}>
        <span aria-hidden="true">−</span>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.01}
          value={zoom}
          data-teste="cropper-zoom"
          aria-label="Aproximar a foto"
          onChange={(e) => aplicarZoom(Number(e.target.value))}
        />
        <span aria-hidden="true">+</span>
      </label>

      <div className={estilos.acoes}>
        <button type="button" className={estilos.acao} onClick={onCancelar}>
          Trocar foto
        </button>
        <button
          type="button"
          className={`${estilos.acao} ${estilos.acaoPrimaria}`}
          data-teste="cropper-confirmar"
          onClick={confirmar}
          disabled={!tamanho || salvando}
        >
          Usar esta foto
        </button>
      </div>
    </div>
  );
}
