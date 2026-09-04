"use client";

/**
 * /jogo/animais — eixo 4 (vocabulário e escuta).
 *
 * Duas fases, escolhidas pela própria criança num botão gigante:
 *
 *  EXPLORAR  (padrão)  toca no bicho -> ouve o som dele. Sem pergunta, sem
 *                      certo nem errado. É causa e efeito puro, que é o que
 *                      segura a atenção aos 3 anos.
 *  PERGUNTAR           "Quem faz muuu?" — o engine da task 3 (`useRodada`),
 *                      com dificuldade adaptativa de 2 a 4 alternativas.
 *
 * Áudio: TODO som passa pela `FilaDeFala` (`@/game/fala`), então martelar a
 * tela nunca sobrepõe vozes — os sons entram na fila e tocam um por vez. Os
 * sons são pré-carregados em `precarregarSons()` no mount (ver a licença de
 * cada um em `public/sons/CREDITOS.md`).
 *
 * O conteúdo (nome, som, cor, licença) mora em `@/game/modos/animais`, que é
 * puro e testado em node por `animais.test.ts`.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bicho } from "@/components/bichos/Bicho";
import { Despedida } from "@/components/Despedida";
import { BotaoAlternativa, Palco } from "@/components/Palco";
import { filaDeFala } from "@/game/fala";
import {
  ANIMAIS,
  IDS_ANIMAIS,
  animalPorId,
  configRodadaAnimais,
  falaDoAnimal,
  precarregarSons,
  proximoAnimal,
  type IdAnimal,
} from "@/game/modos/animais";
import {
  dificuldadeInicial,
  montarAlternativas,
  registrarRodada,
  type EstadoDificuldade,
} from "@/game/dificuldade";
import type { EstadoRodada } from "@/game/engine";
import { idFigurinha } from "@/game/recompensa";
import { useEncerrarQuandoLivre, useSessao, type Sessao } from "@/game/sessao";
import { useRodada } from "@/game/useRodada";
import { addFigurinha, registrarQuaseLa } from "@/lib/db";
import estilos from "./animais.module.css";

type Fase = "explorar" | "perguntar";

export default function ModoAnimais() {
  const [fase, setFase] = useState<Fase>("explorar");
  // A sessão é do MODO, não da fase: trocar entre "brincar" e "adivinhar" não
  // reinicia o relógio nem duplica a despedida.
  const sessao = useSessao();
  // Blobs já decodificados e com volume normalizado. Vazio enquanto os sons
  // forem TTS (hoje são todos) — a fila cai no sintetizador sozinha.
  const [sons, setSons] = useState<ReadonlyMap<string, Blob>>(() => new Map());

  // Pré-carga: decodificar/aquecer ANTES do primeiro toque, nunca dentro dele.
  useEffect(() => {
    let vivo = true;
    void precarregarSons().then((mapa) => {
      if (vivo) setSons(mapa);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <>
      {fase === "explorar" ? (
        <Explorar sons={sons} sessao={sessao} aoTrocarFase={() => setFase("perguntar")} />
      ) : (
        <Perguntar sessao={sessao} aoTrocarFase={() => setFase("explorar")} />
      )}
      {sessao.despedindo ? <Despedida /> : null}
    </>
  );
}

// ------------------------------------------------------------- fase explorar

function Explorar({
  sons,
  sessao,
  aoTrocarFase,
}: {
  sons: ReadonlyMap<string, Blob>;
  sessao: Sessao;
  aoTrocarFase: () => void;
}) {
  const [tocado, setTocado] = useState<IdAnimal | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fase livre: não há rodada para esperar. O ponto seguro é o silêncio — o
  // tchau nunca entra por cima do "muuu" que a criança acabou de pedir.
  useEncerrarQuandoLivre(sessao, () => !filaDeFala.falando);

  // Sair da tela (ou trocar de fase) não pode deixar som tocando sozinho.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      filaDeFala.cancelar();
    },
    [],
  );

  const tocar = useCallback(
    (id: IdAnimal) => {
      // Prioridade `normal` + chave por bicho (ver `falaDoAnimal`): tocar em
      // três bichos seguidos toca os três EM FILA; martelar o mesmo bicho toca
      // uma vez só. Nunca há dois sons ao mesmo tempo.
      filaDeFala.falar(falaDoAnimal(id, sons));
      setTocado(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setTocado(null), 700);
    },
    [sons],
  );

  return (
    <main className={estilos.tela}>
      <h1 className={estilos.instrucao}>Toque nos bichos!</h1>

      <ul className={estilos.grade}>
        {ANIMAIS.map((animal) => (
          <li key={animal.id}>
            <button
              type="button"
              className={estilos.bolha}
              style={{ "--cor": animal.cor } as React.CSSProperties}
              // `pointerdown`: o `click` chega ~300 ms depois no tablet e o som
              // tem que sair junto com o dedo.
              onPointerDown={() => tocar(animal.id)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                tocar(animal.id);
              }}
              data-tocado={tocado === animal.id}
              data-teste={`bicho-${animal.id}`}
              aria-label={`${animal.nome} — ouvir o som`}
            >
              <Bicho qual={animal.id} />
            </button>
          </li>
        ))}
      </ul>

      <div className={estilos.cantos}>
        <BotaoVoltar />
        <button
          type="button"
          className={estilos.trocarFase}
          onClick={aoTrocarFase}
          data-teste="ir-perguntar"
        >
          <IconeOrelha />
          <span>Adivinhar</span>
        </button>
      </div>
    </main>
  );
}

// ------------------------------------------------------------ fase perguntar

interface RodadaAnimais {
  n: number;
  correta: IdAnimal;
  alternativas: string[];
}

function sortearRodada(
  dificuldade: EstadoDificuldade,
  anterior: IdAnimal | null,
  n: number,
): RodadaAnimais {
  const correta = proximoAnimal(anterior);
  return {
    n,
    correta,
    alternativas: montarAlternativas(IDS_ANIMAIS, correta, dificuldade.alternativas),
  };
}

function Perguntar({ sessao, aoTrocarFase }: { sessao: Sessao; aoTrocarFase: () => void }) {
  // A dificuldade vive num ref: mudá-la NÃO pode reiniciar a rodada em curso.
  const dificuldade = useRef<EstadoDificuldade>(dificuldadeInicial());
  // A primeira rodada usa a dificuldade inicial (2 alternativas) — ler o ref
  // aqui seria ler durante o render.
  const [rodada, setRodada] = useState<RodadaAnimais>(() =>
    sortearRodada(dificuldadeInicial(), null, 0),
  );

  // Fim da rodada (sempre por acerto — não existe derrota): ajusta a
  // dificuldade com os `quaseLa` DESTA rodada e sorteia a próxima.
  // `useRodada` guarda os ganchos num ref atualizado a cada render, então este
  // callback SEMPRE enxerga a rodada corrente — não é preciso ler o estado de
  // dentro do updater (e não se pode: `encerrar()` faz setState, e um updater
  // tem que ser puro).
  const encerrarSessao = sessao.encerrar;
  const aoRecompensar = useCallback(
    (estadoFinal: EstadoRodada) => {
      dificuldade.current = registrarRodada(dificuldade.current, {
        quaseLas: estadoFinal.quaseLas,
      });
      // Figurinha do bicho conquistado. Não é placar: a criança não vê número
      // nenhum — é o que alimenta o progresso guardado para o adulto.
      void addFigurinha(idFigurinha("animais", rodada.correta), "animais").catch(() => {});
      // Fim da sessão no fim da rodada: o tempo pode ter acabado enquanto ela
      // pensava, mas a comemoração dela nunca é cortada no meio.
      if (encerrarSessao()) return;
      setRodada((atual) => sortearRodada(dificuldade.current, atual.correta, atual.n + 1));
    },
    [encerrarSessao, rodada.correta],
  );

  const aoQuaseLa = useCallback(() => {
    // Não é derrota (não existe): é o sinal de dificuldade do relatório.
    void registrarQuaseLa("animais").catch(() => {});
  }, []);

  const { estado, tocar, repetir, falando } = useRodada(
    configRodadaAnimais(rodada.correta, rodada.alternativas),
    { chave: rodada.n, aoRecompensar, aoQuaseLa },
  );

  const animalCerto = animalPorId(rodada.correta);

  return (
    <main className={`${estilos.tela} ${estilos.telaPalco}`}>
      <Palco
        pergunta={estado.pergunta}
        fase={estado.fase}
        aoRepetir={repetir}
        falando={falando}
        feedback={
          estado.fase === "acertou" || estado.fase === "recompensa" ? (
            <span className={estilos.figurinha}>
              <Bicho qual={animalCerto.id} rotulo={animalCerto.nome} />
              {animalCerto.onomatopeia}!
            </span>
          ) : estado.fase === "quaseLa" ? (
            <span>Quase!</span>
          ) : null
        }
      >
        {estado.alternativas.map((id) => {
          const animal = animalPorId(id);
          return (
            <BotaoAlternativa
              key={id}
              aoTocar={() => tocar(id)}
              travado={estado.fase !== "perguntando"}
              acertou={estado.escolhida === id}
              cor={animal.cor}
              rotulo={animal.nome}
            >
              <Bicho qual={animal.id} className={estilos.alternativa} />
            </BotaoAlternativa>
          );
        })}
      </Palco>

      <div className={`${estilos.cantos} ${estilos.cantosFixos}`}>
        <BotaoVoltar />
        <button
          type="button"
          className={estilos.trocarFase}
          onClick={() => {
            filaDeFala.cancelar();
            aoTrocarFase();
          }}
          data-teste="ir-explorar"
        >
          <IconePata />
          <span>Brincar</span>
        </button>
      </div>
    </main>
  );
}

// -------------------------------------------------------------------- ícones

function BotaoVoltar() {
  return (
    <Link href="/" className={estilos.canto} aria-label="Voltar para a tela inicial">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M3 11.5 12 4l9 7.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5.5 10.5V20h13v-9.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}

/** Orelha/ouvido: "vamos escutar e adivinhar". */
function IconeOrelha() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M8 9a4 4 0 1 1 8 0c0 2.5-2.5 3-2.5 5.5A2.5 2.5 0 0 1 11 17"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M11 20a4 4 0 0 1-4-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** Patinha: "voltar a brincar solto". */
function IconePata() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <ellipse cx="7" cy="9" rx="2.3" ry="3" />
      <ellipse cx="12" cy="6.5" rx="2.3" ry="3" />
      <ellipse cx="17" cy="9" rx="2.3" ry="3" />
      <path d="M12 11c3.5 0 6 2.4 6 4.8 0 2-1.7 3.2-3.6 3.2-1 0-1.6-.4-2.4-.4s-1.4.4-2.4.4C7.7 19 6 17.8 6 15.8 6 13.4 8.5 11 12 11Z" />
    </svg>
  );
}
