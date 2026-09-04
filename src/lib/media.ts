/**
 * Utilitários de mídia — tudo roda no dispositivo, nada é enviado para lugar nenhum.
 */

/**
 * Reduz a imagem para caber em `maxPx` no lado maior e devolve um Blob JPEG.
 *
 * Por quê: a quota do IndexedDB é limitada e uma foto crua de câmera de tablet
 * passa fácil de 5 MB. Sempre passe a foto por aqui antes de `salvarPersonagem`.
 * Imagens já menores que `maxPx` não são ampliadas (só recomprimidas).
 */
export async function redimensionarImagem(file: Blob, maxPx = 1024): Promise<Blob> {
  const bitmap = await carregarBitmap(file);
  const { width, height } = bitmap;
  const escala = Math.min(1, maxPx / Math.max(width, height));
  const w = Math.max(1, Math.round(width * escala));
  const h = Math.max(1, Math.round(height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível — não foi possível redimensionar a foto.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ("close" in bitmap) bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82),
  );
  if (!blob) throw new Error("Falha ao converter a foto redimensionada.");
  return blob;
}

/** `createImageBitmap` com fallback para <img> (Safari antigo). */
async function carregarBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // segue para o fallback
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      img.src = url;
    });
  } finally {
    // O bitmap já foi decodificado; liberar a URL não invalida o <img> carregado.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// ------------------------------------------------------------------- gesto

/**
 * Rastreia se já houve o 1º gesto do usuário (pointerdown/touchend/keydown).
 *
 * Por quê: no Chrome desktop, `speechSynthesis.speak()` e `AudioContext` sem
 * gesto prévio falham silenciosamente (`not-allowed` / contexto suspenso que
 * nunca dispara `onended`) — ver `fala.ts`. Não dá para usar
 * `navigator.userActivation` como fonte de verdade (Safari antigo não tem
 * essa API), então mantemos nosso próprio contrato: `DesbloqueioAudio` chama
 * `registrarGesto()` no primeiro gesto, e `motorDoBrowser` espera por ele
 * antes de tentar tocar qualquer som.
 */
let gestoOcorreu = false;
let resolverGesto: (() => void) | null = null;
const promessaGesto = new Promise<void>((resolve) => {
  resolverGesto = resolve;
});

/** `true` se o usuário já interagiu com a página nesta sessão. */
export function houveGesto(): boolean {
  return gestoOcorreu;
}

/**
 * Marca que o 1º gesto do usuário aconteceu. Idempotente — chamadas
 * subsequentes são no-op (a Promise de módulo só resolve uma vez).
 */
export function registrarGesto(): void {
  if (gestoOcorreu) return;
  gestoOcorreu = true;
  resolverGesto?.();
  resolverGesto = null;
}

/**
 * Espera o 1º gesto do usuário. Resolve na hora se já houve gesto. Aceita um
 * `AbortSignal` opcional (ex.: cancelamento da fila de fala) para não deixar
 * a fala pendurada esperando um gesto que nunca vem — nesse caso resolve
 * (sem rejeitar) e o chamador deve checar `sinal.aborted` antes de tocar.
 */
export function esperarGesto(sinal?: AbortSignal): Promise<void> {
  if (gestoOcorreu) return Promise.resolve();
  if (!sinal) return promessaGesto;
  if (sinal.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const finalizar = () => {
      sinal.removeEventListener("abort", finalizar);
      resolve();
    };
    // `.then` some do listener sozinho quando a promessa de gesto resolve
    // primeiro — só o listener do `abort` precisa de remoção explícita.
    void promessaGesto.then(finalizar);
    sinal.addEventListener("abort", finalizar, { once: true });
  });
}

// ------------------------------------------------------------------- áudio

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

/** AudioContext singleton do app (null antes do primeiro gesto do usuário). */
export function getAudioContext(): AudioContext | null {
  return ctx;
}

/**
 * Cria/retoma o AudioContext. OBRIGATÓRIO no iOS Safari: o áudio só toca se o
 * contexto for criado/resumido dentro de um gesto do usuário. O layout chama
 * isto no primeiro `pointerdown` do documento.
 *
 * Idempotente e seguro de chamar em qualquer gesto.
 */
export async function unlockAudio(): Promise<AudioContext | null> {
  if (typeof window === "undefined") return null;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;

  ctx ??= new Ctor();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      // Gesto não aceito (ex.: chamada fora de handler) — tenta no próximo toque.
      return ctx;
    }
  }
  // Buffer mudo de 1 frame: destrava a saída de áudio no iOS.
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    // Sem impacto: o resume() acima já é o essencial.
  }
  return ctx;
}
