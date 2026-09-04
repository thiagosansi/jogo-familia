"use client";

/**
 * /jogo/familia — "Quem é quem": o coração afetivo do jogo.
 *
 * MECÂNICA: uma pergunta na voz da própria família ("Papai!") e 2 a 4 rostos
 * recortados na tela. A criança toca em quem ela reconhece. Acertou: a foto
 * pula e a pessoa fala com a voz gravada dela. Tocou em outro: careta,
 * "Quase! Olha de novo!" e a pergunta volta — nunca "errou", nunca fim de jogo
 * (garantia estrutural do `@/game/engine`).
 *
 * ESTE É O ÚNICO MODO QUE DEPENDE DE CADASTRO. Com menos de duas caras no
 * banco (ou nenhum familiar, só mascotes) a tela vira um CONVITE ao adulto,
 * com atalho para `/pais` — nunca uma tela branca, nunca um erro. É a
 * bifurcação mais importante deste arquivo, e ela acontece antes de qualquer
 * `montarRodadaFamilia` (que joga se for chamado sem elenco).
 *
 * PRIVACIDADE: fotos e vozes vêm do IndexedDB e não saem daqui. Nada de
 * upload, nada de `<img>` apontando para fora, nada de expor rosto fora da
 * rodada. A `objectURL` de cada foto é criada e revogada pelo `<Personagem>`.
 *
 * HIDRATAÇÃO: o elenco só existe depois de uma leitura assíncrona do
 * IndexedDB, então `<JogoFamilia>` nunca renderiza no servidor — por isso a
 * semente do sorteio pode nascer num `useState` de inicialização preguiçosa,
 * sem risco de divergência entre servidor e cliente.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Despedida } from "@/components/Despedida";
import { BotaoAlternativa, Palco } from "@/components/Palco";
import { Personagem } from "@/components/Personagem";
import { dificuldadeInicial, registrarRodada } from "@/game/dificuldade";
import { useSessao } from "@/game/sessao";
import {
  apresentador,
  criarSorteio,
  montarRodadaFamilia,
  podeJogar,
  rotuloDe,
  vozesDaRodada,
} from "@/game/modos/familia";
import { idFigurinha } from "@/game/recompensa";
import { useRodada } from "@/game/useRodada";
import { addFigurinha, listarPersonagens, registrarQuaseLa } from "@/lib/db";
import type { Personagem as Pessoa } from "@/lib/tipos";
import estilos from "./familia.module.css";

/** Cor das bolhas: neutra e igual para todas — a pista é o rosto, não o botão. */
const COR_BOTAO = "var(--color-mar-700)";

export default function PaginaFamilia() {
  const elenco = useElenco();

  if (elenco === null) return <main className={estilos.carregando} aria-busy="true" />;
  if (!podeJogar(elenco)) return <Convite temAlguem={elenco.length > 0} />;
  return <JogoFamilia fichas={elenco} />;
}

/**
 * Lê os familiares do IndexedDB uma vez. `null` = ainda carregando.
 *
 * Banco indisponível (aba anônima, quota, iOS em modo privado) devolve elenco
 * VAZIO em vez de estourar: a criança cai no convite ao adulto, que é uma tela
 * amigável, e não numa exceção no meio da brincadeira.
 */
function useElenco(): Pessoa[] | null {
  const [elenco, setElenco] = useState<Pessoa[] | null>(null);
  useEffect(() => {
    let vivo = true;
    listarPersonagens()
      .then((lista) => {
        if (vivo) setElenco(lista);
      })
      .catch(() => {
        if (vivo) setElenco([]);
      });
    return () => {
      vivo = false;
    };
  }, []);
  return elenco;
}

// ------------------------------------------------------------------- jogo

function JogoFamilia({ fichas }: { fichas: Pessoa[] }) {
  const sessao = useSessao();
  // Uma semente por carregamento: as rodadas são derivadas dela, então
  // re-render (e o duplo render do StrictMode) dá sempre a MESMA rodada.
  const [semente] = useState(() => 1 + Math.floor(Math.random() * (2 ** 31 - 1)));
  // `n` e `anterior` andam juntos: trocar de rodada é um setState só.
  const [passo, setPasso] = useState<{ n: number; anterior: string | null }>({
    n: 0,
    anterior: null,
  });
  const [dificuldade, setDificuldade] = useState(dificuldadeInicial());

  const rodada = useMemo(
    () =>
      montarRodadaFamilia({
        fichas,
        qtd: dificuldade.alternativas,
        anterior: passo.anterior,
        sortear: criarSorteio(semente + passo.n * 7919),
      }),
    [fichas, semente, passo, dificuldade.alternativas],
  );

  const config = useMemo(
    () => ({
      pergunta: rodada.pergunta,
      alternativas: rodada.alternativas,
      correta: rodada.correta,
      reforcos: rodada.reforcos,
      festa: rodada.festa,
    }),
    [rodada],
  );

  // Pergunta e festa na voz gravada do alvo; sem gravação a `FilaDeFala` fala
  // o texto com `SpeechSynthesis` pt-BR (ver o cabeçalho de `modos/familia`).
  const vozes = useMemo(() => vozesDaRodada(rodada.alvo), [rodada]);

  const { estado, tocar, repetir, falando } = useRodada(config, {
    chave: passo.n,
    vozes,
    // Não é derrota (não existe): é o sinal de dificuldade do relatório.
    aoQuaseLa: () => {
      void registrarQuaseLa("familia").catch(() => {});
    },
    aoRecompensar: (e) => {
      // Uma figurinha por pessoa reconhecida. Sem banco a recompensa some, mas
      // o jogo continua — recompensa é bônus, não requisito.
      void addFigurinha(idFigurinha("familia", rodada.correta), "familia").catch(() => {});
      // FIM DA SESSÃO: só aqui, com a rodada encerrada e a comemoração já
      // disparada. O tempo pode ter acabado no meio da rodada — e ainda assim
      // ninguém corta a fala nem a animação da criança.
      if (sessao.encerrar()) return;
      setDificuldade((d) => registrarRodada(d, { quaseLas: e.quaseLas }));
      setPasso((p) => ({ n: p.n + 1, anterior: rodada.correta }));
    },
  });

  const mc = apresentador(fichas);
  const acertou = estado.fase === "acertou" || estado.fase === "recompensa";
  const feedback = acertou
    ? rodada.festa
    : estado.fase === "quaseLa"
      ? "Quase! Olha de novo!"
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
          const pessoa = rodada.pessoas.find((p) => p.id === id)!;
          const certa = estado.escolhida === id;
          const errada = estado.fase === "quaseLa" && estado.ultimaQuase === id;
          return (
            <BotaoAlternativa
              key={id}
              cor={COR_BOTAO}
              rotulo={rotuloDe(pessoa, fichas)}
              travado={estado.fase !== "perguntando"}
              acertou={certa}
              aoTocar={() => tocar(id)}
            >
              <Personagem
                foto={pessoa.fotoRecorte}
                nome={rotuloDe(pessoa, fichas)}
                // Acertou: pula e pulsa enquanto a voz gravada dela toca.
                animacao={certa ? "pulo" : errada ? "careta" : "idle"}
                seguirFala={certa}
                tamanho="var(--toque-card)"
                corAro={certa ? "var(--color-alga)" : undefined}
              />
            </BotaoAlternativa>
          );
        })}
      </Palco>

      {/* Mestre de cerimônias: o mascote cadastrado (ou o do fundo do mar).
          Decorativo — pulsa junto com a fala e não recebe toque. */}
      <div className={estilos.apresentador} aria-hidden="true">
        <Personagem
          foto={mc?.fotoRecorte ?? null}
          mascote="polvo"
          animacao="idle"
          seguirFala
          tamanho="clamp(56px, 11vmin, 104px)"
          corAro="var(--color-agua)"
        />
      </div>

      <Link href="/" className={estilos.voltar} aria-label="Voltar para o começo">
        <SetaVoltar />
      </Link>

      {sessao.despedindo ? <Despedida /> : null}
    </>
  );
}

// ---------------------------------------------------------------- convite

/**
 * Tela de convite ao adulto (0 ou 1 pessoa cadastrada — ou só mascotes).
 *
 * Fala com o ADULTO, não com a criança: é ele quem precisa cadastrar. Por isso
 * tem texto de verdade e um alvo grande para `/pais` (que continua atrás do
 * portão de segurar 3 segundos). Para a criança sobra o polvo e a saída para a
 * home, para ela nunca ficar presa numa tela que não dá para jogar.
 */
function Convite({ temAlguem }: { temAlguem: boolean }) {
  return (
    <main className={estilos.convite}>
      <div className={estilos.convidados} aria-hidden="true">
        <Personagem mascote="polvo" animacao="idle" tamanho="clamp(96px, 20vmin, 180px)" />
        <Personagem mascote="peixe" animacao="idle" tamanho="clamp(76px, 16vmin, 140px)" />
        <Personagem mascote="estrela" animacao="idle" tamanho="clamp(76px, 16vmin, 140px)" />
      </div>

      <h1 className={estilos.tituloConvite}>Cadê a família?</h1>
      <p className={estilos.textoConvite}>
        {temAlguem
          ? "Falta pouco! Este jogo precisa de pelo menos duas pessoas para a criança escolher."
          : "Este jogo é feito com as fotos e as vozes de vocês."}{" "}
        Um adulto pode cadastrar a mamãe, o papai, os irmãos e quem mais fizer parte — leva um
        minutinho e tudo fica só neste aparelho.
      </p>

      <div className={estilos.acoesConvite}>
        <Link href="/pais" className={estilos.botaoPais}>
          Cadastrar a família
        </Link>
        <Link href="/" className={estilos.botaoHome}>
          Escolher outro jogo
        </Link>
      </div>
    </main>
  );
}

function SetaVoltar() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none">
      <path
        d="M14.5 5 8 12l6.5 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
