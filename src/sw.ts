/// <reference lib="webworker" />
// Service worker gerado pelo @serwist/next (webpack) em `public/sw.js`.
// Em desenvolvimento o SW fica desabilitado (ver next.config.ts).
import { defaultCache } from "@serwist/next/worker";
import { NetworkFirst, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injetado pelo InjectManifest no build (lista de assets para precache).
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Navegações (HTML): rede primeiro, cache como rede de segurança. É isto
    // que faz a home abrir com o tablet em modo avião depois da 1ª visita.
    {
      matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
      handler: new NetworkFirst({ cacheName: "paginas", networkTimeoutSeconds: 3 }),
    },
    // O resto (JS, CSS, fontes, imagens) segue o cache padrão do Serwist.
    ...defaultCache,
  ],
});

// Fallback offline: se uma navegação falhar e não houver cache, mostra uma
// tela amigável em vez do erro do navegador. Sem texto essencial: o adulto lê,
// a criança vê o botão grande.
const OFFLINE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Sem conexão</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#062a4a;color:#fdf6e3;padding:24px;text-align:center}
  main{max-width:420px}
  h1{font-size:1.5rem;margin:0 0 8px}
  p{margin:0 0 24px;line-height:1.5;opacity:.85}
  button{font:inherit;font-size:1.25rem;font-weight:700;background:#ff7a5c;color:#2b1006;border:0;border-radius:24px;min-height:88px;width:100%}
</style>
</head>
<body>
<main>
  <div style="font-size:72px" aria-hidden="true">🐠</div>
  <h1>Peixinho perdido</h1>
  <p>Não deu para abrir o jogo agora. Toque no botão para tentar de novo.</p>
  <button onclick="location.reload()">Tentar de novo</button>
</main>
</body>
</html>`;

serwist.setCatchHandler(async ({ request }) => {
  if (request.destination === "document") {
    // A home vai no precache (ver additionalPrecacheEntries em next.config.ts),
    // então mesmo uma rota nunca visitada cai numa tela jogável, não num erro.
    const home = await serwist.matchPrecache("/");
    if (home) return home;
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return Response.error();
});

serwist.addEventListeners();
