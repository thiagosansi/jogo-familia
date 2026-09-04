"use client";

/**
 * /jogo/numeros — mini-jogo "números" (eixo `contar`).
 *
 * MECÂNICA: a CENA (slot `cena` do `<Palco>`) mostra os bichinhos; as
 * ALTERNATIVAS são algarismos grandes. A criança conta o que vê e toca no
 * número. Dois subjogos, escolhidos numa `<TelaEscolha>` de dois cartões:
 *
 *   "Quantos tem?"   →  N bichinhos     →  toca no "6"  →  "São seis peixinhos!"
 *   "Somar no mar"   →  dois grupos     →  toca no "3"  →  "São três peixinhos!"
 *
 * O ALGARISMO É O CONTEÚDO, NÃO UM PLACAR
 * ---------------------------------------
 * A regra do produto (ver o cabeçalho de `@/game/recompensa`) é que número
 * não aparece em tela de jogo — porque ali número seria PLACAR, e não existe
 * placar aqui. Neste modo o algarismo aparece porque ele É o que está sendo
 * ensinado: ligar a quantidade vista ao símbolo escrito. A regra que continua
 * valendo, e que ESTA PÁGINA garante, é a original: os únicos dígitos na tela
 * são as alternativas. Nenhum contador de acertos, nenhum cronômetro, nenhum
 * "3 de 10" — nem no feedback, nem no rótulo acessível.
 *
 * DIFICULDADE ATÉ 6: `dificuldadeInicial(2, 6)`. Um algarismo é pequeno e
 * legível, então cabem seis bolhas confortáveis na grade do `<Palco>` (ver o
 * bloco "TETO POR MINI-JOGO" em `@/game/dificuldade`) — ao contrário dos
 * modos com foto ou bicho dentro da bolha, que param em 4. A dificuldade vive
 * no estado desta tela (mesmo padrão de `/jogo/cores`): ela sobe dentro da
 * brincadeira e recomeça em 2 na próxima abertura, que é o certo para uma
 * criança que joga em sessões curtas.
 *
 * FIGURINHA NO EIXO `contar`, e não num eixo novo: para a criança é o mesmo
 * aprendizado ("eu sei o seis"), e o aquário dela não deve ter duas coleções
 * de peixinho que significam a mesma coisa. Ver `@/game/modos/numeros`.
 *
 * NÃO DEPENDE DE CADASTRO: nenhuma foto, nenhum personagem, nenhuma voz
 * gravada — a rota funciona com o IndexedDB vazio, no primeiro uso. A única
 * ida ao banco é a figurinha da recompensa, e ela falha em silêncio.
 */

import { useCallback, useMemo, useState } from "react";
import { Despedida } from "@/components/Despedida";
import { BotaoVoltar } from "@/components/objetos/BotaoVoltar";
import { ObjetoMar } from "@/components/objetos/ObjetoMar";
import { useEscolhaLembrada } from "@/components/objetos/useEscolhaLembrada";
import { useSemente } from "@/components/objetos/useSemente";
import { BotaoAlternativa, Palco } from "@/components/Palco";
import { TelaEscolha, type OpcaoEscolha } from "@/components/TelaEscolha";
import { dificuldadeInicial, registrarRodada } from "@/game/dificuldade";
import { filaDeFala } from "@/game/fala";
import { corDaForma, numeroPorExtenso } from "@/game/modos/contar";
import { criarSorteio, type FormaObjeto } from "@/game/modos/cores";
import {
  montarRodadaQuantos,
  montarRodadaSomar,
  type RodadaQuantos,
  type RodadaSomar,
  type SubjogoNumeros,
} from "@/game/modos/numeros";
import { idFigurinha } from "@/game/recompensa";
import { useSessao, type Sessao } from "@/game/sessao";
import { useRodada } from "@/game/useRodada";
import { addFigurinha, registrarQuaseLa } from "@/lib/db";
import estilos from "./numeros.module.css";

/** Bolha neutra: quem carrega a informação é o algarismo, não o botão. */
const COR_BOTAO = "var(--color-mar-700)";

/**
 * Chave no `localStorage` da última brincadeira escolhida. NÃO MUDAR: quem já
 * jogou tem a escolha salva sob esta chave, e trocá-la faria o jogo "esquecer"
 * o subjogo de todo mundo.
 */
const CHAVE_ESCOLHA_NUMEROS = "jogo-familia:numeros";

/**
 * Os ids aceitos HOJE. Um valor salvo por uma versão anterior que não esteja
 * aqui é tratado como "nunca escolheu" (ver `useEscolhaLembrada`), então a
 * tela de escolha aparece em vez de o jogo tentar montar uma rodada morta.
 * Constante de MÓDULO de propósito: identidade estável entre renders.
 */
const ESCOLHAS_VALIDAS: readonly SubjogoNumeros[] = ["quantos", "somar"];

/**
 * Nível do somar, derivado da dificuldade: com 3 alternativas ou mais na tela
 * a criança já demonstrou que conta a faixa pequena, então a soma passa a ir
 * até 10. É o mesmo casamento "dificuldade da grade ↔ dificuldade do
 * conteúdo" que o baralho de números do inglês faz.
 */
function nivelDoSomar(alternativas: number): 1 | 2 {
  return alternativas >= 3 ? 2 : 1;
}

export default function PaginaNumeros() {
  // `key`: a semente muda uma vez, logo depois de hidratar (ver useSemente) —
  // a `key` faz o jogo remontar com a sequência sorteada desta sessão.
  const semente = useSemente();
  return <JogoNumeros key={semente} semente={semente} />;
}

function JogoNumeros({ semente }: { semente: number }) {
  const sessao = useSessao();

  // A escolha lembrada, com uma sobreposição desta sessão: `undefined` = segue
  // a lembrada; `null` = "Trocar" pediu a tela de escolha AGORA (sem apagar o
  // que está salvo no aparelho); um subjogo = acabou de escolher.
  const [lembrada, lembrar] = useEscolhaLembrada(CHAVE_ESCOLHA_NUMEROS, ESCOLHAS_VALIDAS);
  const [sobreposta, setSobreposta] = useState<SubjogoNumeros | null | undefined>(undefined);
  const escolha = sobreposta !== undefined ? sobreposta : lembrada;

  return (
    <>
      {escolha === null ? (
        <TelaEscolhaSubjogo
          aoEscolher={(nova) => {
            lembrar(nova);
            setSobreposta(nova);
          }}
        />
      ) : (
        <Rodada
          key={escolha}
          subjogo={escolha}
          semente={semente}
          sessao={sessao}
          aoTrocar={() => setSobreposta(null)}
        />
      )}
      {sessao.despedindo ? <Despedida /> : null}
    </>
  );
}

/** O que muda de uma rodada para a outra. `n` também é a `chave` do engine. */
interface Passo {
  n: number;
  /** Total da rodada anterior — não repete a mesma resposta duas vezes. */
  anterior: number | null;
  /** Silhueta da rodada anterior — não repete o mesmo bichinho. */
  formaAnterior: FormaObjeto | null;
}

function Rodada({
  subjogo,
  semente,
  sessao,
  aoTrocar,
}: {
  subjogo: SubjogoNumeros;
  semente: number;
  sessao: Sessao;
  aoTrocar: () => void;
}) {
  const [passo, setPasso] = useState<Passo>({ n: 0, anterior: null, formaAnterior: null });
  // Teto 6 (e não o padrão 4): as alternativas são algarismos — ver o
  // cabeçalho. Recomeça em 2 a cada abertura, de propósito.
  const [dificuldade, setDificuldade] = useState(() => dificuldadeInicial(2, 6));

  // Rodada derivada de (subjogo, semente, passo, dificuldade): pura, então
  // re-render (e o duplo render do StrictMode) sempre dá a MESMA rodada.
  const rodada: RodadaQuantos | RodadaSomar = useMemo(() => {
    const sortear = criarSorteio(semente + passo.n * 7919);
    const comum = {
      qtd: dificuldade.alternativas,
      anterior: passo.anterior,
      formaAnterior: passo.formaAnterior,
      sortear,
    };
    return subjogo === "somar"
      ? montarRodadaSomar({ ...comum, nivel: nivelDoSomar(dificuldade.alternativas) })
      : montarRodadaQuantos(comum);
  }, [subjogo, semente, passo, dificuldade.alternativas]);

  const config = useMemo(
    () => ({
      pergunta: rodada.pergunta,
      alternativas: rodada.alternativas,
      correta: rodada.correta,
      festa: rodada.festa,
      // Reforço do toque errado: manda contar de novo, sem nunca dizer que
      // errou (não existe errar aqui — existe "quase").
      reforcos: ["Quase! Conta de novo!", "Vamos contar juntos!"],
    }),
    [rodada],
  );

  const proxima = useCallback(
    (quaseLas: number) => {
      setDificuldade((d) => registrarRodada(d, { quaseLas }));
      setPasso((p) => ({
        n: p.n + 1,
        anterior: rodada.quantidade,
        formaAnterior: rodada.forma,
      }));
    },
    [rodada.quantidade, rodada.forma],
  );

  const { estado, tocar, repetir, falando } = useRodada(config, {
    chave: passo.n,
    // Não é derrota (não existe): é o sinal de dificuldade do relatório do
    // adulto. Mesmo eixo da figurinha — é o mesmo aprendizado.
    aoQuaseLa: () => {
      void registrarQuaseLa("contar").catch(() => {});
    },
    aoRecompensar: (e) => {
      // Figurinha da QUANTIDADE aprendida, no eixo `contar` (o cardume do
      // álbum). Sem banco (aba anônima, quota cheia) o jogo continua igual —
      // recompensa é bônus, não requisito.
      void addFigurinha(idFigurinha("contar", rodada.quantidade), "contar").catch(() => {});
      // Fim da sessão só no fim da rodada: o tempo pode ter acabado no meio
      // dela, mas a comemoração da criança nunca é cortada.
      if (sessao.encerrar()) return;
      proxima(e.quaseLas);
    },
  });

  const acertou = estado.fase === "acertou" || estado.fase === "recompensa";
  const feedback = acertou
    ? rodada.festa
    : estado.fase === "quaseLa"
      ? "Quase! Conta de novo!"
      : null;

  return (
    <>
      <Palco
        pergunta={rodada.pergunta}
        fase={estado.fase}
        aoRepetir={repetir}
        falando={falando}
        cena={<Cena rodada={rodada} passo={passo.n} />}
        feedback={feedback}
      >
        {estado.alternativas.map((id) => {
          const certa = estado.escolhida === id;
          const errada = estado.fase === "quaseLa" && estado.ultimaQuase === id;
          return (
            <BotaoAlternativa
              key={id}
              cor={COR_BOTAO}
              // O rótulo acessível é a PALAVRA ("sete"): um leitor de tela
              // lendo "7" solto já basta para o adulto, mas a palavra é o que
              // a criança ouve no jogo — os dois têm que bater.
              rotulo={numeroPorExtenso(Number(id))}
              travado={estado.fase !== "perguntando"}
              acertou={certa}
              aoTocar={() => tocar(id)}
            >
              <span
                className={[
                  estilos.algarismo,
                  certa ? estilos.acertou : "",
                  errada ? estilos.errou : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-hidden="true"
              >
                {id}
              </span>
            </BotaoAlternativa>
          );
        })}
      </Palco>
      <BotaoVoltar />
      {/* "Trocar" só ativo perguntando: trocar durante "quaseLa"/comemoração
          cortaria a tentativa ou a festa no meio. */}
      <button
        type="button"
        className={estilos.trocar}
        onClick={() => {
          filaDeFala.cancelar();
          aoTrocar();
        }}
        disabled={estado.fase !== "perguntando"}
        data-teste="numeros-trocar-exercicio"
      >
        <IconeTrocar />
        <span>Trocar</span>
      </button>
    </>
  );
}

// ------------------------------------------------------------------- cena

/**
 * O desenho sobre o qual a pergunta fala. Decorativo (`pointer-events: none`
 * no `<Palco>`): a rodada se resolve nos algarismos, e um toque na cena não
 * pode parecer uma resposta.
 *
 * `aria-hidden` porque a informação já está na pergunta falada — um leitor de
 * tela anunciando "peixinho, peixinho, peixinho…" entregaria a resposta de
 * um jeito que o áudio do jogo não entrega.
 */
function Cena({ rodada, passo }: { rodada: RodadaQuantos | RodadaSomar; passo: number }) {
  if ("a" in rodada) {
    return (
      <span className={estilos.grupos} aria-hidden="true">
        <span className={estilos.grupo}>
          <Bichinhos quantidade={rodada.a} forma={rodada.forma} cor={rodada.cor} />
        </span>
        {/* `key` com o número do passo: o grupo que "chegou" remonta a cada
            rodada, então a animação de entrada roda de novo. */}
        <span key={passo} className={[estilos.grupo, estilos.chegando].join(" ")}>
          <Bichinhos quantidade={rodada.b} forma={rodada.forma} cor={rodada.cor} />
        </span>
      </span>
    );
  }

  return (
    <span className={estilos.cardume} aria-hidden="true">
      <Bichinhos quantidade={rodada.quantidade} forma={rodada.forma} cor={rodada.cor} />
    </span>
  );
}

function Bichinhos({
  quantidade,
  forma,
  cor,
}: {
  quantidade: number;
  forma: FormaObjeto;
  cor: string;
}) {
  return (
    <>
      {Array.from({ length: quantidade }, (_, i) => (
        <ObjetoMar
          key={i}
          forma={forma}
          cor={cor}
          // Giro alternado pequeno: os bichinhos não ficam enfileirados
          // idênticos (o que os faz parecer um padrão a decorar em vez de
          // coisas a contar), sem virar bagunça.
          giro={(i % 3) * 9 - 9}
          className={estilos.bicho}
        />
      ))}
    </>
  );
}

// -------------------------------------------------------- tela de escolha

/**
 * A tela de entrada de `/jogo/numeros`: dois cartões, cada um reconhecível
 * pelo DESENHO (a criança não lê — o `rotulo` é reforço para o adulto e para
 * leitor de tela). O layout é do `<TelaEscolha>` compartilhado; ver o
 * cabeçalho dele para as decisões de UX.
 *
 * NENHUM ALGARISMO nos ícones, de propósito: um cartão não tem resposta
 * certa para escrever ao lado, e um número solto ali seria decoração — a
 * exceção do modo vale só para as alternativas de uma rodada de verdade.
 */
function TelaEscolhaSubjogo({ aoEscolher }: { aoEscolher: (id: SubjogoNumeros) => void }) {
  const opcoes: OpcaoEscolha<SubjogoNumeros>[] = [
    {
      id: "quantos",
      rotulo: "Quantos tem?",
      // Mesma cor do cartão "Números" na home — esta tela é a continuação dele.
      cor: "var(--color-anemona)",
      icone: (
        <span className={estilos.iconeQuantos} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <ObjetoMar
              key={i}
              forma="peixe"
              cor={corDaForma("peixe")}
              className={estilos.pontoIcone}
            />
          ))}
        </span>
      ),
    },
    {
      id: "somar",
      rotulo: "Somar no mar",
      cor: "var(--color-agua)",
      icone: (
        <span className={estilos.iconeSomar} aria-hidden="true">
          <span className={estilos.iconeGrupo}>
            {[0, 1].map((i) => (
              <ObjetoMar
                key={i}
                forma="concha"
                cor={corDaForma("concha")}
                className={estilos.pontoIcone}
              />
            ))}
          </span>
          <span className={estilos.iconeGrupo}>
            <ObjetoMar
              forma="concha"
              cor={corDaForma("concha")}
              className={estilos.pontoIcone}
            />
          </span>
        </span>
      ),
    },
  ];

  return (
    <TelaEscolha
      titulo="Números — escolha a brincadeira"
      opcoes={opcoes}
      aoEscolher={aoEscolher}
      prefixoTeste="numeros-escolher-"
    />
  );
}

/** Grade 2x2: "escolher outro" — o mesmo vocabulário de ícone de menu. */
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
