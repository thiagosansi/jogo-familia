"use client";

/**
 * PONTE REACT do engine — é isto que as tasks 4/5/6 vão usar no dia a dia.
 *
 * Junta três coisas que ninguém deveria reimplementar por mini-jogo:
 *  1. o estado puro de `engine.ts`;
 *  2. a fila de fala (`fala.ts`), inclusive as vozes gravadas da família;
 *  3. os timers `quaseLa -> perguntando` e `acertou -> recompensa`, com
 *     cleanup no unmount e na troca de rodada (zero vazamento de timer).
 *
 * Exemplo (mini-jogo da família):
 *
 *   const { estado, tocar, repetir, falando } = useRodada(
 *     { pergunta: "Cadê a mamãe?", alternativas: ids, correta: idMae },
 *     {
 *       vozes: { pergunta: mae.vozNome, festa: mae.vozFesta },
 *       aoRecompensar: () => addFigurinha("peixe", "familia"),
 *     },
 *   );
 *
 *   <Palco pergunta="Cadê a mamãe?" fase={estado.fase} aoRepetir={repetir}>
 *     {ids.map((id) => (
 *       <BotaoAlternativa key={id} aoTocar={() => tocar(id)} ... />
 *     ))}
 *   </Palco>
 *
 * A identidade de `config` define a rodada: passe um objeto novo (ou mude
 * `chave`) para começar outra. Tudo é resetado e os timers, cancelados.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  criarRodada,
  continuar as continuarRodada,
  recompensar as recompensarRodada,
  repetirPergunta,
  tocar as tocarRodada,
  type ConfigRodada,
  type EstadoRodada,
  type FalaDaRodada,
} from "./engine";
import { filaDeFala, IDIOMA_PADRAO, type FonteAudio, type Idioma } from "./fala";

/**
 * Vozes da rodada. Cada uma aceita `Blob` (gravada no aparelho, IndexedDB) ou
 * `string` (URL servida pela web) — o mini-jogo não muda se o jogo passar a
 * buscar os áudios de um servidor.
 */
export interface VozesRodada {
  /** Voz que lê a pergunta (ex.: `personagem.vozNome`). */
  pergunta?: FonteAudio | null;
  /** Voz da comemoração (ex.: `personagem.vozFesta`). */
  festa?: FonteAudio | null;
  /** Voz do reforço do `quaseLa`. */
  reforco?: FonteAudio | null;
}

export interface OpcoesRodada {
  vozes?: VozesRodada;
  /**
   * Identidade da rodada. Passe um contador quando duas rodadas seguidas
   * puderem ter a MESMA pergunta e as mesmas alternativas — sem isto o hook
   * entende que nada mudou e não reinicia.
   */
  chave?: string | number;
  /**
   * Idioma do TTS desta rodada — repassado a cada `filaDeFala.falar`.
   * Padrão: `"pt-BR"`. O modo de inglês passa `"en-US"` aqui; a fila usa a
   * mesma `FilaDeFala`, só muda o `Idioma` de cada item.
   */
  idioma?: Idioma;
  /** Fala a pergunta ao montar a rodada. Padrão: true. */
  falarAoIniciar?: boolean;
  /** Duração da careta antes de voltar a perguntar. */
  msQuaseLa?: number;
  /** Espera entre o acerto e a recompensa. */
  msRecompensa?: number;
  aoQuaseLa?: (estado: EstadoRodada) => void;
  aoAcertar?: (estado: EstadoRodada) => void;
  aoRecompensar?: (estado: EstadoRodada) => void;
}

export const MS_QUASE_LA = 1800;
export const MS_RECOMPENSA = 1400;

export function useRodada(config: ConfigRodada, opcoes: OpcoesRodada = {}) {
  const {
    vozes,
    chave = "",
    falarAoIniciar = true,
    msQuaseLa = MS_QUASE_LA,
    msRecompensa = MS_RECOMPENSA,
  } = opcoes;

  // "É outra rodada?" — os mini-jogos remontam `config` a cada render, então a
  // identidade do objeto não serve; a assinatura do conteúdo serve.
  const assinatura = `${chave}|${config.pergunta}|${config.correta}|${config.alternativas.join(",")}`;

  const [interno, setInterno] = useState(() => ({ assinatura, rodada: criarRodada(config) }));
  // Ajuste de estado durante o render (padrão oficial do React para "props
  // mudaram, o estado derivado tem que mudar junto"): evita renderizar um
  // frame com a rodada anterior.
  let atual = interno;
  if (atual.assinatura !== assinatura) {
    atual = { assinatura, rodada: criarRodada(config) };
    setInterno(atual);
  }
  const estado = atual.rodada;
  const [falando, setFalando] = useState(false);

  // Fonte de verdade síncrona para os handlers: dois `pointerdown` do mesmo
  // tick (multi-touch) precisam enxergar o bloqueio do primeiro ANTES do
  // re-render. Só é escrito em handlers/efeitos — nunca durante o render.
  const estadoRef = useRef(estado);
  // Callbacks e vozes em ref: mudar uma delas não pode reiniciar a rodada.
  const ganchos = useRef(opcoes);
  const vozesRef = useRef(vozes);
  useEffect(() => {
    ganchos.current = opcoes;
    vozesRef.current = vozes;
  });

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const limparTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  const agendar = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const dizer = useCallback((falas: readonly FalaDaRodada[]) => {
    const idiomaAtual = ganchos.current.idioma;
    for (const fala of falas) {
      const v = vozesRef.current;
      const audio =
        fala.motivo === "pergunta"
          ? v?.pergunta
          : fala.motivo === "festa"
            ? v?.festa
            : v?.reforco;
      filaDeFala.falar({
        // Chave própria (motivo + idioma + texto): o padrão de `fala.ts` já
        // separa por idioma, mas aqui também precisamos separar "pergunta"
        // de "festa" mesmo com o mesmo texto — por isso montamos a chave
        // explicitamente em vez de deixar o padrão da fila decidir.
        chave: `${fala.motivo}:${idiomaAtual ?? IDIOMA_PADRAO}:${fala.texto}`,
        texto: fala.texto,
        audio: audio ?? null,
        prioridade: fala.prioridade,
        idioma: idiomaAtual,
      });
    }
  }, []);

  // Entrada de uma rodada nova (`versao === 0` só acontece uma vez por rodada):
  // corta o áudio da anterior, mata os timers dela e fala a pergunta.
  useEffect(() => {
    if (estado.versao !== 0) return;
    estadoRef.current = estado;
    limparTimers();
    filaDeFala.cancelar();
    if (falarAoIniciar) {
      dizer([{ motivo: "pergunta", texto: estado.pergunta, prioridade: "alta" }]);
    }
  }, [estado, falarAoIniciar, dizer, limparTimers]);

  // Desmontou (trocou de tela / voltou para a home): nada continua tocando.
  useEffect(
    () => () => {
      limparTimers();
      filaDeFala.cancelar();
    },
    [limparTimers],
  );

  // Pulso de fala do <Personagem>.
  useEffect(() => filaDeFala.assinar(({ falando: f }) => setFalando(f)), []);

  const tocar = useCallback(
    (alternativa: string) => {
      const t = tocarRodada(estadoRef.current, alternativa);
      if (!t.mudou) return; // toque ignorado: nada fala, nada muda
      estadoRef.current = t.estado;
      setInterno((s) => ({ ...s, rodada: t.estado }));
      dizer(t.falas);

      if (t.estado.fase === "quaseLa") {
        ganchos.current.aoQuaseLa?.(t.estado);
        agendar(() => {
          const volta = continuarRodada(estadoRef.current);
          if (!volta.mudou) return;
          estadoRef.current = volta.estado;
          setInterno((s) => ({ ...s, rodada: volta.estado }));
        }, msQuaseLa);
      } else if (t.estado.fase === "acertou") {
        ganchos.current.aoAcertar?.(t.estado);
        agendar(() => {
          const r = recompensarRodada(estadoRef.current);
          if (!r.mudou) return;
          estadoRef.current = r.estado;
          setInterno((s) => ({ ...s, rodada: r.estado }));
          ganchos.current.aoRecompensar?.(r.estado);
        }, msRecompensa);
      }
    },
    [agendar, dizer, msQuaseLa, msRecompensa],
  );

  const repetir = useCallback(() => {
    dizer(repetirPergunta(estadoRef.current).falas);
  }, [dizer]);

  return useMemo(
    () => ({ estado, tocar, repetir, falando }),
    [estado, tocar, repetir, falando],
  );
}
