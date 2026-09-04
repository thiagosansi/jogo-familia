"use client";

/**
 * /jogo/memoria — jogo da memória (eixo `memoria`).
 * =============================================================================
 *
 * MECÂNICA: um tabuleiro de cartas viradas para baixo, em pares. A criança
 * toca numa carta, ela vira e o jogo FALA o nome do que apareceu ("peixinho",
 * "polvo", "Mamãe"). Na segunda carta o jogo compara: par certo fica para cima
 * para sempre e vira figurinha; par errado volta para baixo com uma frase de
 * incentivo. Fechou o tabuleiro, monta outro — maior se ela foi bem, do MESMO
 * tamanho se não (o tabuleiro nunca encolhe). As regras moram em
 * `@/game/modos/memoria`, cobertas por `memoria.test.ts`.
 *
 * SEM PERDER E SEM NÚMERO: não há vidas, tempo, placar nem contador de
 * tentativas na tela. A única marca de progresso é a carta achada que fica
 * virada — e a figurinha no aquário.
 *
 * POR QUE NÃO USA `<Palco>`: a grade do Palco é `auto-fit`, ela reflui
 * sozinha conforme a largura. Um jogo da memória precisa da grade FIXA do
 * nível (2x2, 3x2, 4x3): a posição da carta é exatamente o que a criança está
 * memorizando, e ela não pode mudar quando o tablet gira. O layout daqui
 * (cabeçalho + tabuleiro + feedback) espelha o do Palco em
 * `memoria.module.css` para as duas telas continuarem parecidas.
 *
 * POR QUE NÃO USA `useRodada`: aquele hook modela "escolher a alternativa
 * certa entre N", que não é a mecânica daqui — e não existe alternativa
 * errada. O padrão de `jogoRef` + timers é o mesmo de `/jogo/contar`. A fala
 * continua saindo pela `FilaDeFala` (um áudio por vez, com dedupe e
 * prioridade) — nunca por `speechSynthesis` cru.
 *
 * NÃO DEPENDE DE CADASTRO: o baralho base são as 5 peças do fundo do mar e os
 * 4 mascotes desenhados — 9 desenhos, mais que os 6 pares do maior tabuleiro.
 * As fotos da família entram como variedade extra QUANDO existem, e a leitura
 * do IndexedDB falha em silêncio.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Despedida } from "@/components/Despedida";
import { BotaoVoltar } from "@/components/objetos/BotaoVoltar";
import { ObjetoMar } from "@/components/objetos/ObjetoMar";
import { useEscolhaLembrada } from "@/components/objetos/useEscolhaLembrada";
import { useSemente } from "@/components/objetos/useSemente";
import { MASCOTES, Personagem } from "@/components/Personagem";
import { filaDeFala } from "@/game/fala";
import { corDaForma } from "@/game/modos/contar";
import { FORMAS, IDS_FORMA, criarSorteio } from "@/game/modos/cores";
import {
  NIVEIS,
  criarMemoria,
  estaVirada,
  jaEncontrada,
  proximoNivel,
  repetirPergunta,
  resolver,
  virar,
  type DesenhoDisponivel,
  type EstadoMemoria,
  type FalaMemoria,
  type NivelMemoria,
} from "@/game/modos/memoria";
import { idFigurinha } from "@/game/recompensa";
import { useSessao } from "@/game/sessao";
import { addFigurinha, listarPersonagens } from "@/lib/db";
import type { Personagem as Pessoa } from "@/lib/tipos";
import estilos from "./memoria.module.css";

/** Respiro para OLHAR as duas cartas antes de o jogo dizer se casaram. */
const MS_COMPARAR = 1100;
/** Respiro entre a festa do tabuleiro completo e o tabuleiro seguinte. */
const MS_PROXIMO = 1600;

/** Nível lembrado neste aparelho. Ver `useEscolhaLembrada` (falha aberta). */
const CHAVE_NIVEL = "jogo-familia:memoria:nivel";
const NIVEIS_VALIDOS = ["1", "2", "3"] as const;

// ------------------------------------------------------------- baralho

/**
 * Desenhos SEMPRE disponíveis: as 5 peças do fundo do mar (com a cor da
 * bijeção de `cores.ts`) e os 4 mascotes. São 9 — mais que os 6 pares do
 * maior tabuleiro, então o jogo roda inteiro sem nenhum cadastro.
 *
 * O `par` é a chave da figurinha (`idFigurinha("memoria", par)`): para as
 * formas ele é o id da forma, que o álbum sabe desenhar como carta; para
 * mascote e pessoa ele não tem desenho próprio e cai no mascote de fallback
 * do `<Album>` — decisão consciente, documentada em `recompensa.ts`.
 */
const BARALHO_BASE: readonly DesenhoDisponivel[] = [
  ...IDS_FORMA.map((forma) => ({
    par: forma,
    desenho: { tipo: "forma" as const, forma, cor: corDaForma(forma) },
    nome: FORMAS[forma].singular,
  })),
  ...MASCOTES.map((mascote) => ({
    par: `mascote-${mascote}`,
    desenho: { tipo: "mascote" as const, mascote },
    nome: mascote === "estrela" ? "estrela do mar" : mascote,
  })),
];

/** A família vira carta com a foto e o nome de cada um — quando há cadastro. */
function baralhoDaFamilia(elenco: readonly Pessoa[]): DesenhoDisponivel[] {
  return elenco.map((p) => ({
    par: p.id,
    desenho: { tipo: "pessoa" as const, personagemId: p.id, nome: p.nome },
    nome: p.nome,
  }));
}

/**
 * Janela de `quantos` desenhos a partir de `deslocamento`, dando a volta.
 * É o que faz dois tabuleiros SEGUIDOS terem cartas diferentes: o
 * deslocamento anda 3 posições por tabuleiro, então pelo menos 3 dos
 * desenhos trocam mesmo no maior nível.
 */
function janela(
  pool: readonly DesenhoDisponivel[],
  deslocamento: number,
  quantos: number,
): DesenhoDisponivel[] {
  if (pool.length === 0) return [];
  const total = Math.min(quantos, pool.length);
  const inicio = ((deslocamento % pool.length) + pool.length) % pool.length;
  return Array.from({ length: total }, (_, i) => pool[(inicio + i) % pool.length]);
}

// -------------------------------------------------------------- página

interface Tabuleiro {
  /** Índice do tabuleiro nesta sessão — semente e janela saem dele. */
  n: number;
  estado: EstadoMemoria;
}

function novoTabuleiro(
  semente: number,
  n: number,
  nivel: NivelMemoria,
  pool: readonly DesenhoDisponivel[],
): Tabuleiro {
  const sortear = criarSorteio(semente + n * 7919 + nivel * 131);
  const pares = NIVEIS[nivel].pares;
  return {
    n,
    estado: criarMemoria({ nivel, desenhos: janela(pool, n * 3, pares), sortear }),
  };
}

export default function PaginaMemoria() {
  // `key`: a semente muda uma vez, logo depois de hidratar (ver useSemente), e
  // o nível lembrado chega no mesmo momento (ver useEscolhaLembrada) — a `key`
  // faz o jogo remontar já no tabuleiro certo, sem piscar o nível 1.
  const semente = useSemente();
  const [lembrado, lembrar] = useEscolhaLembrada(CHAVE_NIVEL, NIVEIS_VALIDOS);
  const nivel = (Number(lembrado ?? "1") || 1) as NivelMemoria;
  return (
    <JogoMemoria
      key={`${semente}:${nivel}`}
      semente={semente}
      nivel={nivel}
      aoMudarNivel={(novo) => lembrar(String(novo) as (typeof NIVEIS_VALIDOS)[number])}
    />
  );
}

function JogoMemoria({
  semente,
  nivel,
  aoMudarNivel,
}: {
  semente: number;
  nivel: NivelMemoria;
  aoMudarNivel: (nivel: NivelMemoria) => void;
}) {
  const sessao = useSessao();
  const elenco = useElenco();

  // O baralho cresce quando as fotos chegam do IndexedDB. Fica num ref porque
  // ele só é lido na hora de MONTAR um tabuleiro — uma foto que chega no meio
  // de uma jogada não pode trocar as cartas na mesa.
  const pool = useMemo(() => [...BARALHO_BASE, ...baralhoDaFamilia(elenco ?? [])], [elenco]);
  const poolRef = useRef(pool);
  useEffect(() => {
    poolRef.current = pool;
  }, [pool]);

  const [tabuleiro, setTabuleiro] = useState<Tabuleiro>(() =>
    novoTabuleiro(semente, 0, nivel, BARALHO_BASE),
  );

  // Nível VALENDO agora. Normalmente igual ao lembrado (a `key` de
  // `PaginaMemoria` remonta o jogo quando ele sobe), mas com `localStorage`
  // bloqueado (aba anônima, quota) a gravação falha em silêncio e a remontagem
  // nunca vem — então o ref é quem garante que o tabuleiro seguinte já sai no
  // tamanho novo. Sem ele o jogo ficaria preso no nível 1 nesses aparelhos.
  const nivelRef = useRef(nivel);
  const [falando, setFalando] = useState(false);

  // Fonte de verdade síncrona para os handlers: dois `pointerdown` do mesmo
  // tick (multi-touch) precisam ver as cartas atualizadas ANTES do re-render.
  const jogoRef = useRef(tabuleiro);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const limparTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  const agendar = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  const aplicar = useCallback((proximo: Tabuleiro) => {
    jogoRef.current = proximo;
    setTabuleiro(proximo);
  }, []);
  const dizer = useCallback((falas: readonly FalaMemoria[]) => {
    for (const f of falas) {
      filaDeFala.falar({ chave: f.chave, texto: f.texto, prioridade: f.prioridade });
    }
  }, []);

  // Tabuleiro novo: corta o áudio do anterior, mata os timers dele e fala a
  // instrução. `n` só muda quando o tabuleiro muda — virar carta não reemite.
  useEffect(() => {
    limparTimers();
    filaDeFala.cancelar();
    dizer([
      { chave: `pergunta:${tabuleiro.n}`, texto: tabuleiro.estado.pergunta, prioridade: "alta" },
    ]);
  }, [tabuleiro.n, tabuleiro.estado.pergunta, dizer, limparTimers]);

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

  const tocar = useCallback(
    (id: string) => {
      const atual = jogoRef.current;
      const t = virar(atual.estado, id);
      // `mudou: false` = carta já virada/achada, terceiro toque durante a
      // comparação, ou tabuleiro completo: nada acontece.
      if (!t.mudou) return;
      aplicar({ ...atual, estado: t.estado });
      dizer(t.falas);
      if (t.estado.fase !== "comparando") return;

      agendar(() => {
        const antes = jogoRef.current;
        const r = resolver(antes.estado);
        if (!r.mudou) return;
        aplicar({ ...antes, estado: r.estado });
        dizer(r.falas);

        // Par novo? Vira figurinha. (O par errado não gera nada — e também
        // não desconta nada: aqui não existe perder.)
        const novoPar = r.estado.encontradas.find((p) => !antes.estado.encontradas.includes(p));
        if (novoPar) {
          void addFigurinha(idFigurinha("memoria", novoPar), "memoria").catch(() => {});
        }

        if (r.estado.fase !== "completo") return;

        agendar(() => {
          // Fim da sessão: aqui o tabuleiro já foi comemorado por inteiro. O
          // relógio pode ter estourado no meio dele — e ainda assim ninguém
          // corta a fala nem a comemoração da criança.
          if (sessao.encerrar()) return;
          const fechado = jogoRef.current;
          const nivelAtual = nivelRef.current;
          // Nunca desce — quem garante isso é `proximoNivel`.
          const proximo = proximoNivel(nivelAtual, fechado.estado);
          if (proximo !== nivelAtual) {
            nivelRef.current = proximo;
            // Grava para a próxima abertura do jogo. Quando o storage
            // responde, a `key` de `PaginaMemoria` remonta o jogo e descarta
            // o tabuleiro montado abaixo — que é justamente a rede de
            // segurança para quando ela NÃO remonta.
            aoMudarNivel(proximo);
          }
          aplicar(novoTabuleiro(semente, fechado.n + 1, proximo, poolRef.current));
        }, MS_PROXIMO);
      }, MS_COMPARAR);
    },
    [agendar, aplicar, aoMudarNivel, dizer, semente, sessao],
  );

  const repetir = useCallback(() => {
    dizer(repetirPergunta(jogoRef.current.estado).falas);
  }, [dizer]);

  const { estado } = tabuleiro;
  const travado = estado.fase !== "escolhendo";
  // Fotos por id de personagem, montadas UMA vez: cada carta de família só
  // pega o `Blob` daqui (o `<Personagem>` cai no mascote quando falta).
  const fotos = useMemo(
    () => new Map((elenco ?? []).map((p) => [p.id, p.fotoRecorte])),
    [elenco],
  );

  return (
    <>
      <section className={estilos.tela} data-fase={estado.fase} aria-live="polite">
        <header className={estilos.cabecalho}>
          <h1 className={estilos.pergunta}>{estado.pergunta}</h1>
          <button
            type="button"
            className={estilos.repetir}
            onClick={repetir}
            data-falando={falando}
            aria-label="Ouvir a pergunta de novo"
          >
            <IconeSom />
          </button>
        </header>

        <ul
          className={estilos.tabuleiro}
          style={{ "--colunas": estado.colunas } as React.CSSProperties}
        >
          {estado.cartas.map((carta) => (
            <Carta
              key={carta.id}
              nome={carta.nome}
              desenho={carta.desenho}
              foto={fotos.get(carta.par) ?? null}
              virada={estaVirada(estado, carta.id)}
              achada={jaEncontrada(estado, carta.id)}
              travado={travado}
              aoTocar={() => tocar(carta.id)}
            />
          ))}
        </ul>

        {/* Sem número, sem placar: só a comemoração no fim do tabuleiro. */}
        <div className={estilos.feedback} data-fase={estado.fase}>
          {estado.fase === "completo" ? <span>Achou todos!</span> : null}
        </div>
      </section>
      <BotaoVoltar />
      {sessao.despedindo ? <Despedida /> : null}
    </>
  );
}

// --------------------------------------------------------------- carta

interface CartaProps {
  nome: string;
  desenho: EstadoMemoria["cartas"][number]["desenho"];
  /** Foto do familiar, quando a carta é `pessoa` e o cadastro tem a imagem. */
  foto: Blob | null;
  virada: boolean;
  achada: boolean;
  travado: boolean;
  aoTocar: () => void;
}

/**
 * Uma carta. Mesmo tratamento de ponteiro de `<BotaoAlternativa>`: age no
 * `pointerdown` (o `click` chega ~300 ms depois em alguns navegadores móveis)
 * e o primeiro dedo "prende" o botão, então multi-touch na MESMA carta dispara
 * uma vez só. Dedos em cartas diferentes são barrados no módulo puro (a fase
 * `comparando` ignora todo toque).
 */
function Carta({ nome, desenho, foto, virada, achada, travado, aoTocar }: CartaProps) {
  const ponteiro = useRef<number | null>(null);
  const inerte = travado || achada;

  const aoPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (inerte) return;
      if (ponteiro.current !== null) return;
      ponteiro.current = e.pointerId;
      aoTocar();
    },
    [aoTocar, inerte],
  );

  const soltar = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (ponteiro.current === e.pointerId) ponteiro.current = null;
  }, []);

  // Teclado (adulto testando / acessibilidade): o clique não passa pelo
  // pointerdown, então tratamos aqui.
  const aoTeclar = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (inerte) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      aoTocar();
    },
    [aoTocar, inerte],
  );

  return (
    <li>
      <button
        type="button"
        className={estilos.carta}
        onPointerDown={aoPointerDown}
        onPointerUp={soltar}
        onPointerCancel={soltar}
        onPointerLeave={soltar}
        onKeyDown={aoTeclar}
        data-virada={virada}
        data-achada={achada}
        aria-disabled={inerte}
        // A carta para baixo não entrega o que tem atrás nem para o leitor de
        // tela — seria a resposta pronta.
        aria-label={virada ? nome : "carta virada para baixo"}
      >
        <span className={estilos.faces}>
          <span className={`${estilos.face} ${estilos.costas}`} aria-hidden="true" />
          <span className={`${estilos.face} ${estilos.frente}`} aria-hidden="true">
            <span className={estilos.desenho}>
              {desenho.tipo === "forma" ? (
                <ObjetoMar forma={desenho.forma} cor={desenho.cor} />
              ) : desenho.tipo === "mascote" ? (
                <Personagem mascote={desenho.mascote} tamanho="100%" />
              ) : (
                <Personagem foto={foto} rotulo={desenho.nome} tamanho="100%" />
              )}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

/** Lista da família. Sem cadastro (ou com o banco fora) devolve lista vazia. */
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

function IconeSom() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4 9v6h4l5 4V5L8 9H4Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
