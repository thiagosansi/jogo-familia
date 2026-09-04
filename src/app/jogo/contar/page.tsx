"use client";

/**
 * /jogo/contar — mini-jogo "contar de 1 a 10" (eixo 3).
 *
 * MECÂNICA: a tela mostra de 1 a 10 bichinhos iguais (o teto era 5 quando a
 * criança tinha 3 anos — ver `MAX_CONTAGEM` no cabeçalho de
 * `@/game/modos/contar`; a progressão continua começando em 1). Cada toque
 * marca um deles com um visto e FALA o número em voz alta ("um... dois...
 * três"); ao marcar o último, o jogo fala o total ("São três peixinhos!"). A
 * criança conta na ordem que quiser, e tocar de novo num bichinho já contado
 * não faz nada — nem conta, nem fala (a regra mora em `@/game/modos/contar`,
 * coberta por `contar.test.ts`).
 *
 * SEM NUMERAL ESCRITO: o progresso aparece como bolinhas que enchem, não como
 * dígito. Nada aqui exige leitura. E não há placar, cronômetro nem erro.
 *
 * POR QUE NÃO USA `useRodada`: aquele hook modela "escolher a alternativa
 * certa entre N", que não é a mecânica daqui. A fala continua saindo pela
 * `FilaDeFala` (um áudio por vez, com dedupe e prioridade) — nunca por
 * `speechSynthesis` cru.
 *
 * NÃO DEPENDE DE CADASTRO: nenhuma foto, nenhum personagem, nenhuma voz
 * gravada. A única ida ao IndexedDB é a figurinha da recompensa, que falha em
 * silêncio.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Despedida } from "@/components/Despedida";
import { BotaoVoltar } from "@/components/objetos/BotaoVoltar";
import { ObjetoMar } from "@/components/objetos/ObjetoMar";
import { useSemente } from "@/components/objetos/useSemente";
import estilos from "@/components/objetos/objetos.module.css";
import { BotaoAlternativa, Palco } from "@/components/Palco";
import type { FaseRodada } from "@/game/engine";
import { filaDeFala } from "@/game/fala";
import {
  comemorar,
  contarObjeto,
  criarContagem,
  falaDoTotal,
  jaContado,
  proximaRodadaContar,
  repetirPergunta,
  type EstadoContagem,
  type FalaContagem,
  type RodadaContar,
} from "@/game/modos/contar";
import { FORMAS, criarSorteio } from "@/game/modos/cores";
import { idFigurinha } from "@/game/recompensa";
import { useSessao } from "@/game/sessao";
import { addFigurinha } from "@/lib/db";

/** Tempo para ouvir o total antes da comemoração. */
const MS_TOTAL = 2200;
/** Respiro entre a comemoração e a próxima rodada. */
const MS_PROXIMA = 1600;
/** Bolha neutra: quem carrega a cor é o bichinho, não o botão. */
const COR_BOTAO = "var(--color-mar-700)";

interface Jogo {
  n: number;
  rodada: RodadaContar;
  estado: EstadoContagem;
}

/** Rodada `n` derivada da semente — pura, então re-render não muda o sorteio. */
function novoJogo(semente: number, n: number, anterior: RodadaContar | null): Jogo {
  const sortear = criarSorteio(semente + n * 7919);
  const rodada = proximaRodadaContar(anterior, sortear);
  return {
    n,
    rodada,
    estado: criarContagem({ quantidade: rodada.quantidade, forma: rodada.forma, sortear }),
  };
}

export default function PaginaContar() {
  // `key`: a semente muda uma vez, logo depois de hidratar (ver useSemente) —
  // a `key` faz o jogo remontar com a sequência sorteada desta sessão.
  const semente = useSemente();
  return <JogoContar key={semente} semente={semente} />;
}

function JogoContar({ semente }: { semente: number }) {
  const sessao = useSessao();
  const [jogo, setJogo] = useState<Jogo>(() => novoJogo(semente, 0, null));
  const [falando, setFalando] = useState(false);

  // Fonte de verdade síncrona para os handlers: dois `pointerdown` do mesmo
  // tick (multi-touch) precisam ver a contagem atualizada ANTES do re-render.
  const jogoRef = useRef(jogo);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const limparTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  const agendar = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  const aplicar = useCallback((proximo: Jogo) => {
    jogoRef.current = proximo;
    setJogo(proximo);
  }, []);
  const dizer = useCallback((falas: readonly FalaContagem[]) => {
    for (const f of falas) {
      filaDeFala.falar({ chave: f.chave, texto: f.texto, prioridade: f.prioridade });
    }
  }, []);

  // Rodada nova: corta o áudio da anterior, mata os timers dela e fala a pergunta.
  useEffect(() => {
    limparTimers();
    filaDeFala.cancelar();
    dizer([
      { chave: `pergunta:${jogo.n}`, texto: jogo.estado.pergunta, prioridade: "alta" },
    ]);
    // `pergunta` só muda quando a rodada muda: contar um bichinho não reemite.
  }, [jogo.n, jogo.estado.pergunta, dizer, limparTimers]);

  // Saiu da tela: nada continua tocando nem agendado.
  useEffect(
    () => () => {
      limparTimers();
      filaDeFala.cancelar();
    },
    [limparTimers],
  );

  // Pulso de fala do botão de repetir.
  useEffect(() => filaDeFala.assinar(({ falando: f }) => setFalando(f)), []);

  const contar = useCallback(
    (id: string) => {
      const atual = jogoRef.current;
      const t = contarObjeto(atual.estado, id);
      // `mudou: false` = bichinho já contado (ou fase errada): nada acontece.
      if (!t.mudou) return;
      aplicar({ ...atual, estado: t.estado });
      dizer(t.falas);
      if (t.estado.fase !== "total") return;

      agendar(() => {
        const depoisDoTotal = jogoRef.current;
        const festa = comemorar(depoisDoTotal.estado);
        if (!festa.mudou) return;
        aplicar({ ...depoisDoTotal, estado: festa.estado });
        dizer(festa.falas);
        void addFigurinha(
          idFigurinha("contar", depoisDoTotal.estado.objetos.length),
          "contar",
        ).catch(() => {});

        agendar(() => {
          // Fim da sessão: aqui a contagem já foi comemorada por inteiro. O
          // relógio pode ter estourado no meio dela — e ainda assim ninguém
          // corta a fala nem a animação da criança.
          if (sessao.encerrar()) return;
          const anterior = jogoRef.current;
          aplicar(novoJogo(semente, anterior.n + 1, anterior.rodada));
        }, MS_PROXIMA);
      }, MS_TOTAL);
    },
    [agendar, aplicar, dizer, semente, sessao],
  );

  const repetir = useCallback(() => {
    dizer(repetirPergunta(jogoRef.current.estado).falas);
  }, [dizer]);

  const { estado } = jogo;
  const total = estado.objetos.length;
  const contados = estado.contados.length;
  const forma = FORMAS[estado.forma];
  // O <Palco> fala a língua do engine; aqui é só a tradução das fases.
  const fase: FaseRodada =
    estado.fase === "contando" ? "perguntando" : estado.fase === "total" ? "acertou" : "recompensa";

  return (
    <>
      <Palco
        pergunta={estado.pergunta}
        fase={fase}
        aoRepetir={repetir}
        falando={falando}
        feedback={
          <>
            {/* Progresso visual, sem numeral: uma bolinha por bichinho. */}
            <ul className={estilos.pontos} aria-label={`${contados} de ${total} contados`}>
              {estado.objetos.map((objeto, i) => (
                <li
                  key={objeto.id}
                  className={estilos.ponto}
                  data-cheio={i < contados ? "true" : "false"}
                />
              ))}
            </ul>
            {estado.fase !== "contando" ? <span>{falaDoTotal(total, estado.forma)}</span> : null}
          </>
        }
      >
        {estado.objetos.map((objeto, i) => {
          const contado = jaContado(estado, objeto.id);
          return (
            <BotaoAlternativa
              key={objeto.id}
              cor={COR_BOTAO}
              rotulo={`${forma.singular} ${i + 1}${contado ? " (já contado)" : ""}`}
              travado={estado.fase !== "contando"}
              acertou={estado.fase !== "contando"}
              aoTocar={() => contar(objeto.id)}
            >
              <span className={[estilos.peca, contado ? estilos.contado : ""].join(" ").trim()}>
                <ObjetoMar forma={objeto.forma} cor={objeto.cor} giro={objeto.giro} />
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
