"use client";

/**
 * `<TelaEscolha>` — a tela de "qual brincadeira?" de um mini-jogo.
 * =============================================================================
 *
 * Nasceu dentro de `/jogo/ingles` (onde era `TelaEscolhaExercicio`) e saiu de
 * lá quando o segundo e o terceiro modo passaram a precisar da mesma tela:
 * "Números" (Quantos? / Somar) e "Letras" (Som inicial / Cadê a letra).
 *
 * DECISÕES QUE VIERAM JUNTO (não reverter sem combinar com o dono do projeto)
 * --------------------------------------------------------------------------
 * 1. **A criança não lê.** Cada opção é reconhecível pelo DESENHO e pela COR;
 *    o `rotulo` é reforço para o adulto e para leitor de tela. Tire o texto e
 *    a tela continua navegável.
 * 2. **O visual é o da home, de propósito.** As classes são as GLOBAIS
 *    `.tela` / `.grade-modos` / `.card-modo` (`globals.css`), as mesmas dos
 *    cartões da home — escolher um baralho é a continuação de escolher um
 *    jogo, e a criança já aprendeu esse gesto. Duplicar essas regras num
 *    módulo local criaria uma segunda linguagem visual que sai do lugar na
 *    primeira mudança da home; por isso o módulo daqui só carrega o que
 *    `globals.css` não cobre (ver `TelaEscolha.module.css`).
 * 3. **Alvo grande.** `.card-modo` já garante `--toque-card` (150–320px) —
 *    nenhuma opção fica menor que um dedo de criança.
 *
 * Não decide nada: quem sabe quais opções existem, qual foi escolhida e o que
 * fazer com a escolha é o mini-jogo. Para lembrar a última escolha no
 * aparelho, use `useEscolhaLembrada` (`@/components/objetos/useEscolhaLembrada`).
 */

import type { ReactNode } from "react";
import { BotaoVoltar } from "@/components/objetos/BotaoVoltar";
import estilos from "./TelaEscolha.module.css";

export interface OpcaoEscolha<T extends string = string> {
  /** Id estável — é o que volta em `aoEscolher` e o que fica lembrado. */
  readonly id: T;
  /** Reforço escrito, para o adulto e para o leitor de tela. */
  readonly rotulo: string;
  /** Cor do cartão (aceita token, ex.: `var(--color-coral)`). */
  readonly cor: string;
  /** O desenho — é por ele que a criança escolhe. */
  readonly icone: ReactNode;
}

export interface TelaEscolhaProps<T extends string> {
  /** Título da tela. Some visualmente (`.so-leitor`): é para leitor de tela. */
  titulo: string;
  opcoes: readonly OpcaoEscolha<T>[];
  aoEscolher: (id: T) => void;
  /**
   * Ainda lendo o que decide as opções (o cadastro da família, por exemplo).
   * Mostra só o fundo — mesmo padrão de `useIdsAtivos` na home — para nenhum
   * cartão "pipocar" um instante depois de a tela aparecer.
   */
  carregando?: boolean;
  /** Prefixo dos `data-teste` dos botões (ex.: `"ingles-escolher-"`). */
  prefixoTeste?: string;
}

export function TelaEscolha<T extends string>({
  titulo,
  opcoes,
  aoEscolher,
  carregando = false,
  prefixoTeste = "escolher-",
}: TelaEscolhaProps<T>) {
  if (carregando) {
    return (
      <main className="tela" aria-busy="true">
        <h1 className="so-leitor">{titulo}</h1>
        <BotaoVoltar />
      </main>
    );
  }

  return (
    <main className="tela">
      <h1 className="so-leitor">{titulo}</h1>
      <ul className="grade-modos">
        {opcoes.map((op) => (
          <li key={op.id}>
            <button
              type="button"
              className="card-modo"
              style={{ "--cor": op.cor } as React.CSSProperties}
              aria-label={op.rotulo}
              onClick={() => aoEscolher(op.id)}
              data-teste={`${prefixoTeste}${op.id}`}
            >
              {op.icone}
              {/* Reforço para o adulto — a criança navega pelo desenho. */}
              <span aria-hidden="true">{op.rotulo}</span>
            </button>
          </li>
        ))}
      </ul>
      <BotaoVoltar />
    </main>
  );
}

/**
 * Classe para um ícone que NÃO é `<ObjetoMar>` (`<Bicho>`, `<Saudacao>`, um
 * `<svg>` próprio) dentro de um cartão. Exportada porque é uma armadilha do
 * `.card-modo`, não um enfeite:
 *
 * `globals.css` tem `.card-modo svg { max-block-size: 55% }`. Dentro de um
 * wrapper flex/grid sem altura própria, esses 55% resolvem contra uma altura
 * de referência pequena e ESMAGAM o desenho (medido no navegador com
 * `getBoundingClientRect`: 60x33 em vez de 60x60 — 33 é exatamente 55% de
 * 60). `<ObjetoMar>` escapa sozinho porque já define `max-block-size: 100%`
 * no módulo dele; os outros precisam disto. CSS Module nunca entra em
 * `@layer`, então sempre vence a regra global, não importa a especificidade
 * — e o quadrado vem do `aspect-ratio: 1 / 1`.
 */
export const CLASSE_ICONE_QUADRADO = estilos.iconeQuadrado;
