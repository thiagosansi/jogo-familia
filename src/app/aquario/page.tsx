"use client";

/**
 * /aquario — o modo sandbox. **Sem regra, sem fim, sem pontuação.**
 *
 * Por que ele existe: aos 3 anos, o que segura a atenção não é o desafio, é
 * causa e efeito. Aqui os mascotes do fundo do mar e os rostos da família
 * cadastrados pelo adulto flutuam devagar; tocar num deles faz ele pular e
 * dizer o próprio nome (com a voz gravada da família quando existe). Não há
 * pergunta certa, não há placar, não há tela de fim.
 *
 * DECISÕES QUE NÃO SÃO NEGOCIÁVEIS
 * --------------------------------
 * 1. Funciona com ZERO personagens cadastrados: os quatro mascotes
 *    (`MASCOTES` de `<Personagem>`) estão sempre no tanque. Um aquário vazio
 *    seria uma tela preta na cara da criança.
 * 2. Sair exige HOLD de ~1,5 s no canto — a mesma filosofia do portão dos pais
 *    (`useSegurar`, de `@/components/PortaoPais`): uma criança de 3 anos toca e
 *    solta, não sustenta pressão. Toque simples NUNCA sai daqui.
 * 3. Movimento em CSS puro (`aquario.module.css`), sem game loop: um
 *    `requestAnimationFrame` por bicho fritaria a bateria do tablet.
 * 4. Toda voz passa pela `FilaDeFala`, então martelar cinco bichos toca cinco
 *    falas EM FILA, nunca sobrepostas.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Album } from "@/components/Album";
import { Despedida } from "@/components/Despedida";
import { Personagem, MASCOTES, type Mascote } from "@/components/Personagem";
import { DURACAO_CONFIRMA_MS, useSegurar } from "@/components/PortaoPais";
import { filaDeFala } from "@/game/fala";
import { useEncerrarQuandoLivre, useSessao } from "@/game/sessao";
import { listarPersonagens } from "@/lib/db";
import type { Personagem as PersonagemSalvo } from "@/lib/tipos";
import estilos from "./aquario.module.css";

/**
 * Hold de saída: ~1,5 s, o mesmo das confirmações da área dos pais.
 * Não é exportado: um arquivo `page.tsx` do App Router só pode exportar o
 * componente e os campos de rota conhecidos.
 */
const DURACAO_SAIDA_MS = DURACAO_CONFIRMA_MS;

/** Nome falado de cada mascote (a criança ouve, não lê). */
const NOME_MASCOTE: Record<Mascote, string> = {
  estrela: "estrela do mar",
  caranguejo: "caranguejo",
  peixe: "peixinho",
  polvo: "polvo",
};

interface Morador {
  id: string;
  nome: string;
  foto: Blob | null;
  mascote?: Mascote;
  voz: Blob | null;
  corAro: string;
}

const CORES_ARO = [
  "var(--color-areia)",
  "var(--color-coral)",
  "var(--color-agua)",
  "var(--color-alga)",
  "#c77dff",
];

/** Os quatro mascotes — o piso do aquário, com ou sem família cadastrada. */
function moradoresMascote(): Morador[] {
  return MASCOTES.map((mascote, i) => ({
    id: `mascote-${mascote}`,
    nome: NOME_MASCOTE[mascote],
    foto: null,
    mascote,
    voz: null,
    corAro: CORES_ARO[i % CORES_ARO.length],
  }));
}

function moradorDePersonagem(p: PersonagemSalvo, i: number): Morador {
  return {
    id: p.id,
    nome: p.nome,
    foto: p.fotoRecorte,
    voz: p.vozNome,
    corAro: CORES_ARO[i % CORES_ARO.length],
  };
}

export default function Aquario() {
  const router = useRouter();
  const [familia, setFamilia] = useState<PersonagemSalvo[]>([]);
  const [pulando, setPulando] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessao = useSessao();

  // O aquário não tem rodada para esperar: o ponto seguro é o silêncio, com
  // ninguém no meio de um pulo. O tchau nunca corta a fala de um morador que a
  // criança acabou de cutucar.
  // (`useEncerrarQuandoLivre` guarda esta função num ref renovado a cada
  // render, então ela sempre lê o `pulando` atual.)
  useEncerrarQuandoLivre(sessao, () => !filaDeFala.falando && pulando === null);

  // A família é um bônus: se o IndexedDB falhar (aba privativa, quota), o
  // aquário abre do mesmo jeito, só com os mascotes.
  useEffect(() => {
    let vivo = true;
    void listarPersonagens()
      .then((lista) => {
        if (vivo) setFamilia(lista);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  // Trocar de tela não pode deixar voz tocando nem timer solto.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      filaDeFala.cancelar();
    },
    [],
  );

  const moradores = useMemo<Morador[]>(
    () => [...familia.map(moradorDePersonagem), ...moradoresMascote()],
    [familia],
  );

  const cutucar = useCallback((morador: Morador) => {
    // `normal` + chave por morador: cinco toques rápidos = cinco falas em fila
    // (nunca sobrepostas); martelar o mesmo bicho = uma fala só.
    filaDeFala.falar({
      chave: `aquario:${morador.id}`,
      texto: morador.nome,
      audio: morador.voz,
      prioridade: "normal",
    });
    setPulando(morador.id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPulando(null), 900);
  }, []);

  const sair = useCallback(() => {
    filaDeFala.cancelar();
    router.push("/");
  }, [router]);

  return (
    <main className={estilos.tanque}>
      <Bolhas />

      {/* As figurinhas conquistadas, coladas no vidro. Ficam ATRÁS do toque
          (pointer-events: none) para não roubarem o cutucão dos moradores. */}
      <Album variante="aquario" />

      {moradores.map((morador, i) => (
        <button
          key={morador.id}
          type="button"
          className={estilos.morador}
          // Fases e durações diferentes por posição: ninguém nada em sincronia.
          style={
            {
              "--dur": `${9 + (i % 5) * 1.7}s`,
              "--atraso": `-${(i * 2.3) % 9}s`,
            } as React.CSSProperties
          }
          onPointerDown={() => cutucar(morador)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            cutucar(morador);
          }}
          data-teste={`morador-${morador.id}`}
          aria-label={morador.nome}
        >
          <Personagem
            foto={morador.foto}
            mascote={morador.mascote}
            nome={morador.nome}
            animacao={pulando === morador.id ? "pulo" : "idle"}
            corAro={morador.corAro}
            tamanho="clamp(88px, 18vmin, 190px)"
            rotulo={morador.nome}
          />
        </button>
      ))}

      <BotaoSaida aoSair={sair} />

      {/* Para o ADULTO. A criança não lê — e é exatamente por isso que a saída
          é um hold e não um botão. */}
      <p className={estilos.dica}>Segure o cantinho para sair</p>

      {sessao.despedindo ? <Despedida /> : null}
    </main>
  );
}

// -------------------------------------------------------------------- saída

const RAIO = 54;
const PERIMETRO = 2 * Math.PI * RAIO;

/**
 * Saída por HOLD. Toque simples não faz nada: `useSegurar` zera o progresso no
 * `pointerup`/`pointerleave`/`pointercancel`, e cada toque recomeça do zero
 * (toques repetidos não acumulam).
 */
function BotaoSaida({ aoSair }: { aoSair: () => void }) {
  const { progresso, segurando, handlers } = useSegurar(DURACAO_SAIDA_MS, aoSair);

  return (
    <button
      type="button"
      className={estilos.saida}
      data-segurando={segurando}
      data-teste="aquario-sair"
      aria-label={`Segure por ${DURACAO_SAIDA_MS / 1000} segundos para sair do aquário`}
      {...handlers}
    >
      <svg className={estilos.anel} viewBox="0 0 128 128" aria-hidden="true" focusable="false">
        <circle className={estilos.anelTrilho} cx="64" cy="64" r={RAIO} />
        <circle
          className={estilos.anelProgresso}
          cx="64"
          cy="64"
          r={RAIO}
          strokeDasharray={PERIMETRO}
          strokeDashoffset={PERIMETRO * (1 - progresso)}
        />
      </svg>
      <svg className={estilos.icone} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M10 8 6 12l4 4M6 12h9"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

// ------------------------------------------------------------------- bolhas

/** Bolhinhas subindo. Decoração pura: `pointer-events: none`, sem estado. */
function Bolhas() {
  const bolhas = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        esquerda: `${(i * 8.3 + 4) % 96}%`,
        tam: `${1.6 + (i % 4) * 1.1}vmin`,
        dur: `${11 + (i % 6) * 2.4}s`,
        atraso: `-${(i * 1.7) % 12}s`,
        desvio: `${((i % 3) - 1) * 5}vmin`,
      })),
    [],
  );

  return (
    <div className={estilos.bolhas} aria-hidden="true">
      {bolhas.map((b, i) => (
        <span
          key={i}
          style={
            {
              insetInlineStart: b.esquerda,
              "--tam": b.tam,
              "--dur": b.dur,
              "--atraso": b.atraso,
              "--desvio": b.desvio,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
