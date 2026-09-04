"use client";

/**
 * /jogo/cores — mini-jogo "cores e formas" (eixo 2).
 *
 * MECÂNICA: toque simples. "Pega a concha azul!" — a criança toca na peça e ela
 * some numa bolha. Arrastar foi descartado de propósito: aos 3 anos a coordenação
 * para arrastar-e-soltar ainda não está formada, e o toque é o gesto que ela já
 * domina.
 *
 * COR NUNCA É A ÚNICA PISTA: cada cor do catálogo tem uma forma exclusiva
 * (`@/game/modos/cores`, validado no import e em `cores.test.ts`), e a pergunta
 * falada diz as duas coisas. Por isso as bolhas das alternativas são TODAS da
 * mesma cor neutra (azul-mar): quem tem que carregar a cor é o objeto, não o
 * botão.
 *
 * NÃO DEPENDE DE CADASTRO: nenhuma foto, nenhum personagem, nenhuma voz gravada.
 * O modo roda no primeiro uso, antes de o adulto configurar qualquer coisa. A
 * única ida ao IndexedDB é a figurinha da recompensa — e ela falha em silêncio.
 */

import { useCallback, useMemo, useState } from "react";
import { Despedida } from "@/components/Despedida";
import { BotaoVoltar } from "@/components/objetos/BotaoVoltar";
import { ObjetoMar } from "@/components/objetos/ObjetoMar";
import { useSemente } from "@/components/objetos/useSemente";
import estilos from "@/components/objetos/objetos.module.css";
import { BotaoAlternativa, Palco } from "@/components/Palco";
import { dificuldadeInicial, registrarRodada } from "@/game/dificuldade";
import { criarSorteio, montarRodadaCores, nomeDaPeca, type CorId } from "@/game/modos/cores";
import { idFigurinha } from "@/game/recompensa";
import { useSessao } from "@/game/sessao";
import { useRodada } from "@/game/useRodada";
import { addFigurinha, registrarQuaseLa } from "@/lib/db";

/** Cor das bolhas das alternativas: neutra, para não dar dica nem competir. */
const COR_BOTAO = "var(--color-mar-700)";

export default function PaginaCores() {
  // `key`: a semente muda uma vez, logo depois de hidratar (ver useSemente) —
  // a `key` faz o jogo remontar com a sequência sorteada desta sessão.
  const semente = useSemente();
  return <JogoCores key={semente} semente={semente} />;
}

function JogoCores({ semente }: { semente: number }) {
  const sessao = useSessao();
  // `n` e `anterior` andam juntos: trocar de rodada é um setState só.
  const [passo, setPasso] = useState<{ n: number; anterior: CorId | null }>({
    n: 0,
    anterior: null,
  });
  const [dificuldade, setDificuldade] = useState(dificuldadeInicial());

  // Rodada derivada de (semente, passo): pura, então re-render (e o duplo
  // render do StrictMode) sempre dá a MESMA rodada.
  const rodada = useMemo(
    () =>
      montarRodadaCores({
        qtd: dificuldade.alternativas,
        anterior: passo.anterior,
        sortear: criarSorteio(semente + passo.n * 7919),
      }),
    [semente, passo, dificuldade.alternativas],
  );

  const config = useMemo(
    () => ({
      pergunta: rodada.pergunta,
      alternativas: rodada.alternativas,
      correta: rodada.correta,
      festa: rodada.festa,
    }),
    [rodada],
  );

  const proxima = useCallback(
    (quaseLas: number) => {
      setDificuldade((d) => registrarRodada(d, { quaseLas }));
      setPasso((p) => ({ n: p.n + 1, anterior: rodada.correta }));
    },
    [rodada.correta],
  );

  const { estado, tocar, repetir, falando } = useRodada(config, {
    chave: passo.n,
    // Não é derrota (não existe): é o sinal de dificuldade do relatório.
    aoQuaseLa: () => {
      void registrarQuaseLa("cores").catch(() => {});
    },
    aoRecompensar: (e) => {
      // Figurinha por cor aprendida. Sem banco (aba anônima, quota cheia) o
      // jogo continua igual — recompensa é bônus, não requisito.
      void addFigurinha(idFigurinha("cores", rodada.correta), "cores").catch(() => {});
      // Fim da sessão só no fim da rodada: o tempo pode ter acabado no meio
      // dela, mas a comemoração da criança nunca é cortada.
      if (sessao.encerrar()) return;
      proxima(e.quaseLas);
    },
  });

  const feedback =
    estado.fase === "quaseLa"
      ? "Quase! Olha a forma!"
      : estado.fase === "acertou" || estado.fase === "recompensa"
        ? rodada.festa
        : null;

  return (
    <>
      <Palco
        pergunta={rodada.pergunta}
        fase={estado.fase}
        aoRepetir={repetir}
        falando={falando}
        feedback={feedback}
      >
        {estado.alternativas.map((id) => {
          const p = rodada.pecas.find((peca) => peca.id === id)!;
          const certa = estado.escolhida === id;
          const errada = estado.fase === "quaseLa" && estado.ultimaQuase === id;
          return (
            <BotaoAlternativa
              key={id}
              cor={COR_BOTAO}
              rotulo={nomeDaPeca(id)}
              travado={estado.fase !== "perguntando"}
              acertou={certa}
              aoTocar={() => tocar(id)}
            >
              <span
                className={[estilos.peca, certa ? estilos.sumindo : "", errada ? estilos.tremendo : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                <ObjetoMar forma={p.forma} cor={p.hex} />
              </span>
            </BotaoAlternativa>
          );
        })}
      </Palco>
      <BotaoVoltar />
      {sessao.despedindo ? <Despedida /> : null}
    </>
  );
}
