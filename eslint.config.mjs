import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Recursivo (`**/`) de propósito: além do build da raiz, o repositório
    // hospeda git worktrees em `.claude/worktrees/<agente>/`, cada uma com o
    // seu próprio `.next/` e `public/sw.js` gerados. Sem o `**/`, o `eslint`
    // sem argumento varre esses artefatos e falha com milhares de erros em
    // código que ninguém escreveu.
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    // Service worker gerado pelo Serwist no build.
    "**/public/sw.js",
    "**/public/swe-worker-*.js",
  ]),
]);

export default eslintConfig;
