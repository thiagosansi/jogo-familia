"use client";

/**
 * /jogo/letras — mini-jogo "letras" (eixo `letras`), dois subjogos escolhidos
 * numa `<TelaEscolha>`, mesmo padrão de `/jogo/ingles`:
 *
 *  - **Som inicial**: "Qual começa com a letra P?" — a cena (`<Palco cena>`)
 *    mostra o GLIFO grande da letra-alvo; as alternativas são desenhos JÁ
 *    conhecidos de outros modos (peça do fundo do mar, bicho de fazenda,
 *    mascote) — nenhuma arte nova. Nunca duas alternativas com a mesma letra
 *    inicial (senão a pergunta teria duas respostas certas).
 *  - **Cadê a letra?**: "Cadê a letra M?" — as alternativas são os próprios
 *    glifos maiúsculos; a letra é ANCORADA numa palavra que a criança já
 *    reconhece (o nome dela > um nome de família > uma figura do catálogo),
 *    para "M" não ser uma letra pelada sem significado.
 *
 * O CONTEÚDO (catálogo, âncoras, `montarRodadaX`, a regra de ouro "nenhuma
 * rodada ambígua") mora inteiro em `@/game/modos/letras` — PURO e testado.
 * Esta tela só: (1) deixa a criança escolher o subjogo (lembrado no aparelho,
 * `useEscolhaLembrada`), (2) carrega o nome da criança e da família UMA vez
 * para montar as âncoras de "Cadê a letra?" (falha em silêncio: sem cadastro
 * nenhum, o catálogo de figuras sozinho já cobre 8 letras — o jogo funciona
 * desde o primeiro uso), e (3) traduz cada rodada para o `<Palco>`.
 *
 * DECISÃO DE VOZ (já tomada em `letras.ts`, repetida aqui por completude): a
 * letra é falada PELO NOME via TTS pt-BR ("P" sai "pê") — a pergunta e a
 * festa são texto normal com a letra dentro, nunca uma sílaba isolada. Por
 * isso esta tela não passa `idioma` nem `vozes` especiais ao `useRodada`: o
 * padrão (`pt-BR`, sem áudio gravado) já resolve certo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bicho } from "@/components/bichos/Bicho";
import { Despedida } from "@/components/Despedida";
import { BotaoAlternativa, Palco } from "@/components/Palco";
import { Personagem } from "@/components/Personagem";
import { TelaEscolha, type OpcaoEscolha } from "@/components/TelaEscolha";
import { BotaoVoltar } from "@/components/objetos/BotaoVoltar";
import { ObjetoMar } from "@/components/objetos/ObjetoMar";
import { useEscolhaLembrada } from "@/components/objetos/useEscolhaLembrada";
import { useSemente } from "@/components/objetos/useSemente";
import estilosObjetos from "@/components/objetos/objetos.module.css";
import {
  dificuldadeInicial,
  registrarRodada,
  type EstadoDificuldade,
  type Sorteio,
} from "@/game/dificuldade";
import type { EstadoRodada } from "@/game/engine";
import { filaDeFala } from "@/game/fala";
import {
  ancorasDe,
  criarSorteio,
  figuraPorId,
  montarRodadaCadeLetra,
  montarRodadaSomInicial,
  type AncoraLetra,
  type DesenhoLetra,
  type RodadaCadeLetra,
  type RodadaSomInicial,
} from "@/game/modos/letras";
import { peca } from "@/game/modos/cores";
import { idFigurinha } from "@/game/recompensa";
import { useSessao, type Sessao } from "@/game/sessao";
import { useRodada } from "@/game/useRodada";
import { addFigurinha, getConfig, listarPersonagens, registrarQuaseLa } from "@/lib/db";
import estilos from "./letras.module.css";

/** Cor das bolhas: neutra, igual às outras telas — a pista é o desenho/glifo. */
const COR_BOTAO = "var(--color-mar-700)";

export default function PaginaLetras() {
  // `key`: a semente muda uma vez, logo depois de hidratar (ver useSemente) —
  // a `key` faz o jogo remontar com a sequência sorteada desta sessão.
  const semente = useSemente();
  return <JogoLetras key={semente} semente={semente} />;
}

// ---------------------------------------------------------------- âncoras

/**
 * Nome da criança (`Config.nomeCrianca`) + nomes da família
 * (`listarPersonagens()`), lidos UMA vez e traduzidos em âncoras
 * (`ancorasDe`). Falha em silêncio: erro ao ler qualquer um dos dois cai para
 * `[]`/`undefined`, e `ancorasDe` ainda devolve as âncoras das FIGURAS do
 * catálogo — "Cadê a letra?" nunca fica sem o que jogar.
 */
function useAncoras(): readonly AncoraLetra[] {
  const [dados, setDados] = useState<{ nomeCrianca?: string; nomes: readonly string[] } | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      getConfig().catch(() => null),
      listarPersonagens().catch(() => []),
    ]).then(([config, personagens]) => {
      if (!vivo) return;
      setDados({
        nomeCrianca: config?.nomeCrianca,
        nomes: personagens.map((p) => p.nome),
      });
    });
    return () => {
      vivo = false;
    };
  }, []);

  // Enquanto `dados` ainda não chegou (poucos ms), `ancorasDe([])` já cobre 8
  // letras pelas figuras — a rodada nunca espera o cadastro para existir.
  return useMemo(() => ancorasDe(dados?.nomes ?? [], dados?.nomeCrianca), [dados]);
}

// -------------------------------------------------------------------- jogo

export type EscolhaLetras = "som" | "cadeLetra";

const ESCOLHAS_VALIDAS: readonly EscolhaLetras[] = ["som", "cadeLetra"];

/**
 * Chave no `localStorage` — "lembrar a última escolha", mesmo pedido do
 * baralho de inglês (ver `useEscolhaLembrada`).
 */
const CHAVE_ESCOLHA_LETRAS = "jogo-familia:letras";

function JogoLetras({ semente }: { semente: number }) {
  const sessao = useSessao();
  const ancoras = useAncoras();

  // Mesmo padrão de `/jogo/ingles`: `undefined` = segue a lembrada; `null` =
  // "Trocar" pediu a tela de escolha AGORA; um subjogo = a criança escolheu.
  const [lembrada, lembrar] = useEscolhaLembrada(CHAVE_ESCOLHA_LETRAS, ESCOLHAS_VALIDAS);
  const [sobreposta, setSobreposta] = useState<EscolhaLetras | null | undefined>(undefined);
  const escolha = sobreposta !== undefined ? sobreposta : lembrada;

  return (
    <>
      {escolha === null ? (
        <TelaEscolhaLetras
          aoEscolher={(nova) => {
            lembrar(nova);
            setSobreposta(nova);
          }}
        />
      ) : (
        <Rodada
          key={escolha}
          escolha={escolha}
          semente={semente}
          sessao={sessao}
          ancoras={ancoras}
          aoTrocar={() => setSobreposta(null)}
        />
      )}
      {sessao.despedindo ? <Despedida /> : null}
    </>
  );
}

// ------------------------------------------------------------- a rodada

type Passo =
  | { n: number; escolha: "som"; rodada: RodadaSomInicial }
  | { n: number; escolha: "cadeLetra"; rodada: RodadaCadeLetra };

/** A letra-alvo desta rodada, qualquer que seja o subjogo — o que "não repete duas vezes seguidas" persegue. */
function letraAlvo(passo: Passo): string {
  return passo.escolha === "som" ? passo.rodada.letra : passo.rodada.correta;
}

function montarPasso(
  escolha: EscolhaLetras,
  anterior: string | null,
  n: number,
  ancoras: readonly AncoraLetra[],
  qtd: number,
  sortear: Sorteio,
): Passo {
  if (escolha === "som") {
    return { n, escolha, rodada: montarRodadaSomInicial({ qtd, anterior, sortear }) };
  }
  return { n, escolha, rodada: montarRodadaCadeLetra({ ancoras, qtd, anterior, sortear }) };
}

function Rodada({
  escolha,
  semente,
  sessao,
  ancoras,
  aoTrocar,
}: {
  escolha: EscolhaLetras;
  semente: number;
  sessao: Sessao;
  ancoras: readonly AncoraLetra[];
  aoTrocar: () => void;
}) {
  // Dificuldade num ref (mesmo padrão de `/jogo/ingles`): mudá-la nunca pode
  // reiniciar a rodada em curso. Teto 6 (não o padrão 4): as alternativas
  // aqui são pequenas — um algarismo não, um glifo/desenho — e cabem mais na
  // mesma tela (ver o cabeçalho de `dificuldade.ts`).
  const dificuldade = useRef<EstadoDificuldade>(dificuldadeInicial(2, 6));

  // Snapshot síncrono das âncoras para a TROCA de rodada: ler `ancoras`
  // (prop) direto na hora de montar a PRÓXIMA rodada é seguro (não é uma
  // leitura de ref durante o render), mas guardamos num ref para o cadastro
  // mudando em outra aba nunca alterar a rodada EM CURSO — só influencia a
  // próxima (mesmo cuidado de `elencoRef` em `/jogo/ingles`).
  const ancorasRef = useRef(ancoras);
  useEffect(() => {
    ancorasRef.current = ancoras;
  }, [ancoras]);

  const [passo, setPasso] = useState<Passo>(() =>
    montarPasso(escolha, null, 0, ancoras, dificuldadeInicial(2, 6).alternativas, criarSorteio(semente)),
  );

  const config = useMemo(
    () => ({
      pergunta: passo.rodada.pergunta,
      alternativas: passo.rodada.alternativas,
      correta: passo.rodada.correta,
      festa: passo.rodada.festa,
    }),
    [passo],
  );

  const avancarProximaRodada = useCallback(() => {
    setPasso((atual) =>
      montarPasso(
        escolha,
        letraAlvo(atual),
        atual.n + 1,
        ancorasRef.current,
        dificuldade.current.alternativas,
        criarSorteio(semente + (atual.n + 1) * 7919),
      ),
    );
  }, [escolha, semente]);

  const encerrarSessao = sessao.encerrar;

  const aoQuaseLa = useCallback(() => {
    // Não é derrota (não existe): é o sinal de dificuldade do relatório.
    void registrarQuaseLa("letras").catch(() => {});
  }, []);

  const aoRecompensar = useCallback(
    (estadoFinal: EstadoRodada) => {
      dificuldade.current = registrarRodada(dificuldade.current, { quaseLas: estadoFinal.quaseLas });
      // Figurinha da LETRA aprendida (não da figura/âncora) — os dois
      // subjogos convergem no mesmo `letra-<A..Z>` (ver `PREFIXO.letras` em
      // `@/game/recompensa`), então acertar "P de Pato" em qualquer um dos
      // dois enche o mesmo espaço do álbum.
      void addFigurinha(idFigurinha("letras", letraAlvo(passo)), "letras").catch(() => {});
      // Fim da sessão só no fim da rodada: a comemoração da criança nunca é
      // cortada no meio.
      if (encerrarSessao()) return;
      avancarProximaRodada();
    },
    [passo, encerrarSessao, avancarProximaRodada],
  );

  const { estado, tocar, repetir, falando } = useRodada(config, {
    chave: passo.n,
    aoQuaseLa,
    aoRecompensar,
  });

  const acertou = estado.fase === "acertou" || estado.fase === "recompensa";
  const feedback = acertou ? passo.rodada.festa : estado.fase === "quaseLa" ? "Quase! Olha bem!" : null;

  // Só o subjogo "som inicial" tem cena: o glifo grande da letra que a
  // pergunta está pedindo. "Cadê a letra?" não precisa — os próprios glifos
  // já SÃO as alternativas.
  const cena =
    passo.escolha === "som" ? (
      <Glifo letra={passo.rodada.letra} tamanho="clamp(90px, 22vmin, 200px)" rotulo={`letra ${passo.rodada.letra}`} />
    ) : undefined;

  return (
    <>
      <Palco pergunta={estado.pergunta} fase={estado.fase} aoRepetir={repetir} falando={falando} cena={cena} feedback={feedback}>
        {estado.alternativas.map((id) => {
          const certa = estado.escolhida === id;
          const errada = estado.fase === "quaseLa" && estado.ultimaQuase === id;
          const classeAnimada = [
            estilosObjetos.peca,
            certa ? estilosObjetos.sumindo : "",
            errada ? estilosObjetos.tremendo : "",
          ]
            .filter(Boolean)
            .join(" ");

          if (passo.escolha === "som") {
            const figuraAlt = figuraPorId(id);
            return (
              <BotaoAlternativa
                key={id}
                cor={COR_BOTAO}
                rotulo={figuraAlt.nome}
                travado={estado.fase !== "perguntando"}
                acertou={certa}
                aoTocar={() => tocar(id)}
              >
                <span className={classeAnimada}>
                  <DesenhoDaFigura desenho={figuraAlt.desenho} />
                </span>
              </BotaoAlternativa>
            );
          }

          return (
            <BotaoAlternativa
              key={id}
              cor={COR_BOTAO}
              rotulo={`letra ${id}`}
              travado={estado.fase !== "perguntando"}
              acertou={certa}
              aoTocar={() => tocar(id)}
            >
              <span className={classeAnimada}>
                <Glifo letra={id} />
              </span>
            </BotaoAlternativa>
          );
        })}
      </Palco>

      <BotaoVoltar />
      {/* "Trocar" só ativo perguntando — mesmo motivo/posição de `/jogo/ingles`:
          trocar durante "quaseLa"/comemoração cortaria a tentativa ou a festa. */}
      <button
        type="button"
        className={estilos.trocar}
        onClick={() => {
          filaDeFala.cancelar();
          aoTrocar();
        }}
        disabled={estado.fase !== "perguntando"}
        data-teste="letras-trocar-exercicio"
      >
        <IconeTrocar />
        <span>Trocar</span>
      </button>
    </>
  );
}

/** O que desenhar dentro de uma alternativa de "som inicial" — nenhuma arte nova, só os desenhos já validados dos outros modos. */
function DesenhoDaFigura({ desenho }: { desenho: DesenhoLetra }) {
  if (desenho.tipo === "forma") return <ObjetoMar forma={desenho.forma} cor={peca(desenho.cor).hex} />;
  if (desenho.tipo === "animal") return <Bicho qual={desenho.animal} />;
  return <Personagem mascote={desenho.mascote} animacao="idle" tamanho="100%" />;
}

/** O glifo maiúsculo grande — o desenho do subjogo "Cadê a letra?" e a cena de "Som inicial". */
function Glifo({ letra, tamanho, rotulo }: { letra: string; tamanho?: string; rotulo?: string }) {
  const acessivel = rotulo ? { role: "img" as const, "aria-label": rotulo } : { "aria-hidden": true as const };
  return (
    <span
      className={estilos.glifo}
      style={tamanho ? ({ "--tamanho": tamanho } as React.CSSProperties) : undefined}
      {...acessivel}
    >
      {letra}
    </span>
  );
}

// -------------------------------------------------------- tela de escolha

type OpcaoLetras = OpcaoEscolha<EscolhaLetras>;

const TAMANHO_ICONE_PEQUENO = "clamp(28px, 7vmin, 60px)";

const OPCAO_SOM: OpcaoLetras = {
  id: "som",
  rotulo: "Som inicial",
  cor: "var(--color-agua)",
  icone: (
    <span className={estilos.iconeSom} aria-hidden="true">
      <Glifo letra="P" tamanho={TAMANHO_ICONE_PEQUENO} />
      <ObjetoMar forma="peixe" cor="var(--color-areia)" className={estilos.pontoIcone} />
    </span>
  ),
};

const OPCAO_CADE_LETRA: OpcaoLetras = {
  id: "cadeLetra",
  rotulo: "Cadê a letra?",
  cor: "var(--color-coral)",
  icone: (
    <span className={estilos.iconeCade} aria-hidden="true">
      <Glifo letra="A" tamanho={TAMANHO_ICONE_PEQUENO} />
      <Glifo letra="B" tamanho={TAMANHO_ICONE_PEQUENO} />
      <Glifo letra="C" tamanho={TAMANHO_ICONE_PEQUENO} />
    </span>
  ),
};

function TelaEscolhaLetras({ aoEscolher }: { aoEscolher: (escolha: EscolhaLetras) => void }) {
  return (
    <TelaEscolha
      titulo="Letras — escolha a brincadeira"
      opcoes={[OPCAO_SOM, OPCAO_CADE_LETRA]}
      aoEscolher={aoEscolher}
      prefixoTeste="letras-escolher-"
    />
  );
}

// -------------------------------------------------------------------- ícones

/** Grade 2x2: "escolher outro" — mesmo ícone de `/jogo/ingles`. */
function IconeTrocar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2.2" />
      <rect x="14" y="14" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}
