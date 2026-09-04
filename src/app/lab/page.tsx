"use client";

/**
 * /lab — bancada de teste do engine de rodada (task 3).
 *
 * Não faz parte do jogo: é onde dá para ver, sem depender dos mini-jogos, que
 *  - as 4 animações do <Personagem> rodam (e param sob prefers-reduced-motion);
 *  - a rodada nunca perde: errar vira careta e volta a perguntar;
 *  - martelar a tela não empilha áudio nem transição.
 *
 * Os mini-jogos das tasks 4/5/6 usam exatamente as mesmas peças:
 * `useRodada` + `<Palco>` + `<BotaoAlternativa>` + `<Personagem>`.
 */

import { useCallback, useMemo, useState } from "react";
import { BotaoAlternativa, Palco } from "@/components/Palco";
import { Personagem, type AnimacaoPersonagem, type Mascote } from "@/components/Personagem";
import { useRodada } from "@/game/useRodada";

const ANIMACOES: AnimacaoPersonagem[] = ["idle", "pulo", "fala", "careta"];

const BICHOS: { id: Mascote; nome: string; cor: string }[] = [
  { id: "estrela", nome: "Estrela", cor: "var(--color-areia)" },
  { id: "caranguejo", nome: "Caranguejo", cor: "var(--color-coral)" },
  { id: "peixe", nome: "Peixe", cor: "var(--color-agua)" },
  { id: "polvo", nome: "Polvo", cor: "#c77dff" },
];

/** Três "fotos" de teste servidas como URL — arte original, zero terceiros. */
const SEMENTES_URL = [
  { id: "url-coral", nome: "por URL", cor: "#ff7a5c" },
  { id: "url-agua", nome: "por URL", cor: "#3ddad7" },
  { id: "url-areia", nome: "por URL", cor: "#ffd166" },
];

/**
 * Um `data:` URL de SVG: exercita o caminho `foto={string}` do <Personagem>
 * (objectURL não é criada, a URL vai direto no `src`) sem nenhum arquivo em
 * `public/`.
 */
function fotoDeTeste(cor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${cor}"/><circle cx="36" cy="42" r="9" fill="#fdf6e3"/><circle cx="64" cy="42" r="9" fill="#fdf6e3"/><circle cx="37" cy="44" r="4" fill="#2b1006"/><circle cx="65" cy="44" r="4" fill="#2b1006"/><path d="M32 66q18 14 36 0" stroke="#2b1006" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default function Lab() {
  const [rodada, setRodada] = useState(0);
  const [qtd, setQtd] = useState(2);
  const [toques, setToques] = useState<string[]>([]);

  const opcoes = useMemo(() => BICHOS.slice(0, qtd), [qtd]);
  const correta = opcoes[rodada % opcoes.length];

  const config = useMemo(
    () => ({
      pergunta: `Cadê o ${correta.nome.toLowerCase()}?`,
      alternativas: opcoes.map((b) => b.id),
      correta: correta.id,
    }),
    [correta, opcoes],
  );

  const registrar = useCallback((linha: string) => {
    setToques((anterior) => [linha, ...anterior].slice(0, 8));
  }, []);

  const { estado, tocar, repetir, falando } = useRodada(config, {
    chave: rodada,
    aoQuaseLa: (e) => registrar(`quaseLa #${e.quaseLas} (${e.ultimaQuase})`),
    aoAcertar: (e) => registrar(`acertou (${e.escolhida})`),
    aoRecompensar: () => {
      registrar("recompensa");
      setRodada((n) => n + 1);
    },
  });

  return (
    <main style={{ padding: "clamp(12px,3vmin,32px)", display: "grid", gap: "24px" }}>
      <section>
        <h2 style={{ margin: "0 0 12px" }}>Animações do &lt;Personagem&gt;</h2>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* Modo "online": a foto chega como URL (string), não como Blob — é
              assim que uma imagem vinda de um servidor entraria. A URL é um
              `data:` de arte ORIGINAL gerada aqui mesmo, de propósito: nada de
              terceiros mora em `public/`, porque `public/` é o que vai para o
              deploy público. A arte licenciada da criança entra pelo painel dos
              pais e fica no IndexedDB do aparelho (ver `importarPasta.ts`). */}
          {SEMENTES_URL.map(({ id, nome, cor }) => (
            <div key={id} data-teste="foto-url" style={{ textAlign: "center" }}>
              <Personagem
                foto={fotoDeTeste(cor)}
                nome={nome}
                animacao="idle"
                tamanho="120px"
                corAro="var(--color-alga)"
              />
            </div>
          ))}
          {ANIMACOES.map((anim, i) => (
            <div key={anim} data-teste={`anim-${anim}`} style={{ textAlign: "center" }}>
              <Personagem
                mascote={BICHOS[i].id}
                nome={anim}
                animacao={anim}
                corAro={BICHOS[i].cor}
                tamanho="120px"
              />
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setQtd((n) => (n >= 4 ? 2 : n + 1))}>
          alternativas: {qtd}
        </button>
        <button type="button" onClick={() => setRodada((n) => n + 1)}>
          próxima rodada
        </button>
        <span data-teste="fase">
          fase: <b>{estado.fase}</b> · quaseLas: <b>{estado.quaseLas}</b> · versão:{" "}
          <b>{estado.versao}</b>
        </span>
      </section>

      <Palco
        pergunta={config.pergunta}
        fase={estado.fase}
        aoRepetir={repetir}
        falando={falando}
        feedback={
          estado.fase === "quaseLa"
            ? "Quase! Tenta de novo 🐠"
            : estado.fase === "acertou" || estado.fase === "recompensa"
              ? "Isso! Muito bem! 🎉"
              : null
        }
      >
        {estado.alternativas.map((id) => {
          const bicho = BICHOS.find((b) => b.id === id)!;
          const errada = estado.fase === "quaseLa" && estado.ultimaQuase === id;
          const certa = estado.escolhida === id;
          return (
            <BotaoAlternativa
              key={id}
              cor={bicho.cor}
              rotulo={bicho.nome}
              travado={estado.fase !== "perguntando"}
              acertou={certa}
              aoTocar={() => tocar(id)}
            >
              <Personagem
                mascote={bicho.id}
                animacao={errada ? "careta" : certa ? "pulo" : "idle"}
                tamanho="clamp(88px, 18vmin, 160px)"
                corAro={bicho.cor}
              />
            </BotaoAlternativa>
          );
        })}
      </Palco>

      <section>
        <h3 style={{ margin: "0 0 8px" }}>Eventos</h3>
        <ol data-teste="eventos" style={{ margin: 0, paddingInlineStart: "1.2em" }}>
          {toques.map((t, i) => (
            <li key={`${t}-${i}`}>{t}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
