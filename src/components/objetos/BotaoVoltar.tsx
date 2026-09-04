/**
 * <BotaoVoltar> — a saída do mini-jogo para a home.
 *
 * Mora em `components/objetos/` de propósito: os modos "cores" e "contar" são
 * as únicas telas que usam este botão hoje, e um componente com nome genérico
 * na raiz de `components/` colidiria com o dos outros mini-jogos em
 * desenvolvimento.
 *
 * Alvo cheio de 88px (`--toque-min`) no canto inferior esquerdo — longe do
 * cabeçalho do `<Palco>` e do botão da área dos pais (canto superior direito).
 * Só a seta: a criança de 3 anos não lê, mas reconhece a direção.
 */

import Link from "next/link";
import estilos from "./objetos.module.css";

export function BotaoVoltar({ rotulo = "Voltar para o começo" }: { rotulo?: string }) {
  return (
    <Link href="/" className={estilos.voltar} aria-label={rotulo}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none">
        <path
          d="M14.5 5 8 12l6.5 7"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
