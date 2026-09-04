import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

/**
 * PWA / service worker (Serwist)
 *
 * `@serwist/next` só funciona com webpack. No Next 16 o bundler padrão é o
 * Turbopack (dev e build), então:
 *  - `next dev` (Turbopack): sem service worker.
 *  - `next build --webpack`: gera `public/sw.js` + `public/swe-worker-*.js` e
 *    registra o SW automaticamente no client.
 *  - `next build` (Turbopack) sem `DISABLE_PWA=1`: falha de propósito, para não
 *    publicar o jogo silenciosamente sem service worker (o tablet precisa
 *    abrir offline).
 */
const isDev = process.env.NODE_ENV === "development";
const isTurbopack = Boolean(process.env.TURBOPACK);
const pwaDisabled = process.env.DISABLE_PWA === "1";
// Só o `next build` deve falhar; `next typegen`, `next lint` etc. também carregam a config.
const isBuild = process.argv.includes("build");

if (isBuild && !isDev && isTurbopack && !pwaDisabled) {
  throw new Error(
    "[PWA] O service worker (Serwist) precisa do webpack. Rode `next build --webpack` " +
      "(script `build` do package.json) ou defina DISABLE_PWA=1 para buildar sem PWA.",
  );
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // O SW nunca deve ficar preso em cache HTTP.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: isDev || pwaDisabled,
  // A home entra no precache: o jogo abre offline mesmo na primeira vez que a
  // criança toca no ícone depois de instalar. A revisão muda a cada build.
  additionalPrecacheEntries: [{ url: "/", revision: String(Date.now()) }],
  // Jogo offline-first: nada de recarregar a tela no meio de uma brincadeira.
  reloadOnOnline: false,
});

export default isTurbopack ? nextConfig : withSerwist(nextConfig);
