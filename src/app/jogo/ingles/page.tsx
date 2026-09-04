"use client";

/**
 * /jogo/ingles — mini-jogo "inglês" (eixo `ingles`), cinco baralhos num só
 * fluxo: números (1-10), cotidiano (bichos/formas já conhecidos), família
 * (fotos já cadastradas), saudações e cores (red/blue/yellow/green/purple).
 * `<Palco>`/`useRodada` (`@/game/useRodada`) exatamente como os outros
 * mini-jogos.
 *
 * TELA DE ESCOLHA — DECISÃO REVERTIDA (não mexer sem combinar com o dono do
 * projeto): uma versão anterior deste comentário afirmava "SEM tela de
 * escolha, criança de 3 anos não escolhe menu" e a tela entrava direto
 * sorteando entre os baralhos ("Tudo misturado"). O dono do projeto pediu
 * EXPLICITAMENTE a opção de escolha — a frase acima estava errada para este
 * jogo. Por isso `/jogo/ingles` abre em `<TelaEscolhaExercicio>`: seis
 * cartões grandes (Tudo misturado, Números, Palavras, Família, Saudações,
 * Cores), cada um reconhecível pelo DESENHO (a criança ainda não lê — isso
 * continua valendo), no mesmo padrão visual da home — o layout mora no
 * `<TelaEscolha>` compartilhado (`@/components/TelaEscolha`), esta página só
 * diz quais opções existem. A última escolha fica salva no aparelho
 * (`localStorage`, ver `useEscolhaLembrada` + `CHAVE_ESCOLHA_INGLES`) para
 * não obrigar a escolher de novo a cada abertura, e o botão "Trocar" (inferior
 * direito da rodada) sempre permite voltar à escolha sem sair do jogo. NÃO
 * REVERTER isto para "sorteia sozinho, sem tela" de novo.
 *
 * O CONTEÚDO (catálogos, `montarRodadaX`, regra "o inglês nunca chega
 * sozinho" e a exceção documentada dela em `cores`) mora inteiro em
 * `@/game/modos/ingles` — PURO e testado. Esta tela só: (1) deixa a criança
 * escolher o baralho (ou "Tudo misturado", que sorteia entre os cinco como
 * antes), (2) traduz cada rodada para o `<Palco>`, e (3) desenha cada
 * alternativa com o componente certo: contagem visual para números,
 * `<Bicho>`/`<ObjetoMar>` (reaproveitados de animais/cores) para cotidiano,
 * `<Personagem>` (a foto) para família, `<Saudacao>` para saudações, e
 * `<ObjetoMar>` de novo para cores — mas com a MESMA forma sorteada por
 * rodada em todas as alternativas (ver `ConteudoAlternativa`), porque neste
 * baralho a cor é a única pista de propósito.
 *
 * DUAS VOZES, DECISÃO DE PRODUTO JÁ TOMADA (não mexer sem combinar):
 *  - a PERGUNTA e a FESTA-TEXTO são SÓ A PALAVRA-ALVO (ex.: `"Cat!"`, nunca
 *    uma frase carregadora tipo "Show me cat!" — ver o porquê no cabeçalho
 *    de `ingles.ts`) e saem por síntese en-US — por isso `useRodada` recebe
 *    `idioma: "en-US"`.
 *  - a comemoração do acerto toca a voz JÁ GRAVADA de festa de algum
 *    familiar (`personagem.vozFesta`) quando existe — o MESMO áudio de
 *    sempre, nenhuma gravação nova por palavra. No baralho `familia` é a voz
 *    da própria pessoa reconhecida; nos outros quatro (que não têm pessoa
 *    associada) é a de qualquer familiar cadastrado que já tenha essa
 *    gravação — é o "áudio de sempre" do cabeçalho de `ingles.ts`, não uma
 *    escolha pedagógica por baralho. Como a `FilaDeFala` toca OU o áudio OU
 *    o texto (nunca os dois), quando existe voz gravada ela substitui a
 *    festa-texto — e por isso, LOGO DEPOIS, esta tela enfileira a palavra em
 *    inglês de novo por TTS (normal, não corta a voz gravada): é assim que
 *    "toca a voz da família" e "repete a palavra em inglês" acontecem os
 *    dois, sem tocar ao mesmo tempo. Sem voz gravada, a própria festa-texto
 *    (já em inglês) cumpre sozinha esse papel — nada extra é enfileirado.
 *
 * DEGRADAÇÃO SEM CADASTRO: com nenhum personagem salvo,
 * `montarRodadaFamiliaIngles` devolve `null` e o baralho família some do
 * sorteio (cai para cotidiano se for escolhido por uma corrida rara com o
 * cadastro mudando em outra aba) — a tela dos outros quatro baralhos funciona
 * igual, desde o primeiro uso. Ver `construirPasso`. Pela mesma razão, o
 * cartão "Família" só aparece em `<TelaEscolhaExercicio>` quando o elenco dá
 * (ver `palavrasFamiliaJogaveis`) — senão a criança escolheria um cartão que
 * não gera rodada nenhuma.
 *
 * REFORÇO NO ERRO: `ingles.ts` não define `reforcos` (usa o padrão do
 * engine, frases em português) — como `useRodada` fala TUDO desta rodada em
 * en-US, um reforço em português sairia com sotaque errado. Mas nem uma
 * frase em inglês ("Try again!") resolveria: mesma regra do topo do
 * arquivo — a criança não entende a frase, só a palavra. Por isso o
 * reforço do toque errado é a PRÓPRIA `passo.rodada.pergunta` (a palavra-
 * alvo, ex.: `"Cat!"`) repetida, montada como array de 1 item logo abaixo —
 * repetir o alvo é o reforço, não uma frase decorativa que a criança de 3
 * anos não decodifica.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bicho } from "@/components/bichos/Bicho";
import { Despedida } from "@/components/Despedida";
import { BotaoAlternativa, Palco } from "@/components/Palco";
import {
  CLASSE_ICONE_QUADRADO,
  TelaEscolha,
  type OpcaoEscolha,
} from "@/components/TelaEscolha";
import { BotaoVoltar } from "@/components/objetos/BotaoVoltar";
import { ObjetoMar } from "@/components/objetos/ObjetoMar";
import { useEscolhaLembrada } from "@/components/objetos/useEscolhaLembrada";
import { useSemente } from "@/components/objetos/useSemente";
import estilosObjetos from "@/components/objetos/objetos.module.css";
import { Personagem } from "@/components/Personagem";
import { Saudacao } from "@/components/saudacoes/Saudacao";
import {
  dificuldadeInicial,
  embaralhar,
  registrarRodada,
  type EstadoDificuldade,
  type Sorteio,
} from "@/game/dificuldade";
import type { EstadoRodada, FaseRodada } from "@/game/engine";
import { filaDeFala } from "@/game/fala";
import {
  comemorar,
  contarObjeto,
  jaContado,
  repetirPergunta as repetirPerguntaContagem,
  type EstadoContagem,
  type FalaContagem,
  type FaseContagem,
} from "@/game/modos/contar";
import { peca, type CorId } from "@/game/modos/cores";
import {
  BARALHOS_INGLES,
  corInglesPorId,
  criarContagemNumeroIngles,
  criarSorteio,
  IDS_COR_INGLES,
  montarRodadaCoresIngles,
  montarRodadaCotidiano,
  montarRodadaFamiliaIngles,
  montarRodadaNumeros,
  montarRodadaSaudacoes,
  numeroPorId,
  palavraCotidianoPorId,
  palavrasFamiliaJogaveis,
  saudacaoPorId,
  type BaralhoIngles,
  type IdNumero,
  type IdPalavraFamilia,
  type IdSaudacao,
  type RodadaCoresIngles,
  type RodadaCotidiano,
  type RodadaFamiliaIngles,
  type RodadaNumeros,
  type RodadaSaudacoes,
} from "@/game/modos/ingles";
import { idFigurinha } from "@/game/recompensa";
import { useSessao, type Sessao } from "@/game/sessao";
import { useRodada } from "@/game/useRodada";
import { addFigurinha, listarPersonagens, registrarQuaseLa } from "@/lib/db";
import type { Personagem as Pessoa } from "@/lib/tipos";
import estilos from "./ingles.module.css";

/** Cor das bolhas: neutra, igual às outras telas — a pista é o desenho. */
const COR_BOTAO = "var(--color-mar-700)";

/**
 * Tempos da ETAPA DE CONTAGEM que segue o acerto de uma rodada do baralho
 * `numeros` (ver `iniciarContagemNumeros`/`tocarContagem` em `Rodada`) —
 * mesmo espírito de `MS_TOTAL`/`MS_PROXIMA` em `/jogo/contar`: um respiro
 * para ouvir o total antes da comemoração, e outro antes da próxima rodada.
 */
const MS_TOTAL_CONTAGEM = 2200;
const MS_PROXIMA_CONTAGEM = 1600;

/**
 * Tradução da fase da contagem (`@/game/modos/contar`) para a fase que o
 * `<Palco>` entende — mesmo mapeamento de `/jogo/contar`: "contando" enquanto
 * a criança ainda toca objetos, "acertou" no instante do total, "recompensa"
 * na comemoração silenciosa (`festa: null`, ver `FALAS_CONTAGEM_NUMEROS_INGLES`
 * em `ingles.ts`). Só serve para reaproveitar o MESMO `<Palco>` da rodada,
 * sem inventar uma fase nova nele.
 */
function faseDaContagem(fase: FaseContagem): FaseRodada {
  return fase === "contando" ? "perguntando" : fase === "total" ? "acertou" : "recompensa";
}

export default function PaginaIngles() {
  // `key`: a semente muda uma vez, logo depois de hidratar (ver useSemente) —
  // a `key` faz o jogo remontar com a sequência sorteada desta sessão.
  const semente = useSemente();
  return <JogoIngles key={semente} semente={semente} />;
}

// ---------------------------------------------------------------- baralhos

/** Cada baralho lembra o próprio último alvo — não repete dentro dele mesmo. */
interface Anteriores {
  numeros: IdNumero | null;
  cotidiano: string | null;
  familia: IdPalavraFamilia | null;
  saudacoes: IdSaudacao | null;
  cores: CorId | null;
}

const SEM_ANTERIORES: Anteriores = {
  numeros: null,
  cotidiano: null,
  familia: null,
  saudacoes: null,
  cores: null,
};

type Passo =
  | { n: number; baralho: "numeros"; anteriores: Anteriores; rodada: RodadaNumeros }
  | { n: number; baralho: "cotidiano"; anteriores: Anteriores; rodada: RodadaCotidiano }
  | { n: number; baralho: "familia"; anteriores: Anteriores; rodada: RodadaFamiliaIngles<Pessoa> }
  | { n: number; baralho: "saudacoes"; anteriores: Anteriores; rodada: RodadaSaudacoes }
  | { n: number; baralho: "cores"; anteriores: Anteriores; rodada: RodadaCoresIngles };

/**
 * Escolhe o próximo baralho (nunca repete o `anterior.baralho`, a menos que
 * só sobre um) e monta a rodada dele. `elenco` é sempre um SNAPSHOT tirado no
 * momento da troca de rodada (via `elencoRef`, ver `Rodada`) — o cadastro
 * pode mudar em outra aba a qualquer momento, mas isso nunca pode reiniciar
 * a rodada em curso, só influenciar a PRÓXIMA.
 */
function montarPasso(
  anterior: Passo | null,
  n: number,
  elenco: readonly Pessoa[],
  sortear: Sorteio,
  qtd: number,
): Passo {
  const podeFamilia = palavrasFamiliaJogaveis(elenco).length > 0;
  const pool = BARALHOS_INGLES.map((b) => b.id).filter((id) => id !== "familia" || podeFamilia);
  const candidatos = anterior ? pool.filter((id) => id !== anterior.baralho) : pool;
  const disponiveis = candidatos.length > 0 ? candidatos : pool;
  const baralho = embaralhar(disponiveis, sortear)[0];
  const anteriores = anterior?.anteriores ?? SEM_ANTERIORES;
  return construirPasso(baralho, n, elenco, anteriores, qtd, sortear);
}

function construirPasso(
  baralho: BaralhoIngles,
  n: number,
  elenco: readonly Pessoa[],
  anteriores: Anteriores,
  qtd: number,
  sortear: Sorteio,
): Passo {
  switch (baralho) {
    case "numeros": {
      const rodada = montarRodadaNumeros({ qtd, anterior: anteriores.numeros, sortear });
      return { n, baralho, rodada, anteriores: { ...anteriores, numeros: rodada.correta } };
    }
    case "cotidiano": {
      const rodada = montarRodadaCotidiano({ qtd, anterior: anteriores.cotidiano, sortear });
      return { n, baralho, rodada, anteriores: { ...anteriores, cotidiano: rodada.correta } };
    }
    case "saudacoes": {
      const rodada = montarRodadaSaudacoes({ qtd, anterior: anteriores.saudacoes, sortear });
      return { n, baralho, rodada, anteriores: { ...anteriores, saudacoes: rodada.correta } };
    }
    case "cores": {
      const rodada = montarRodadaCoresIngles({ qtd, anterior: anteriores.cores, sortear });
      return { n, baralho, rodada, anteriores: { ...anteriores, cores: rodada.correta } };
    }
    case "familia": {
      const rodada = montarRodadaFamiliaIngles({ fichas: elenco, qtd, anterior: anteriores.familia, sortear });
      if (!rodada) {
        // Edge case obrigatório: elenco insuficiente entre a escolha do
        // baralho e a montagem (corrida rara, ou uma escolha "Família"
        // lembrada de uma sessão anterior que ficou obsoleta). Nunca lança —
        // cai para cotidiano, que nunca depende de cadastro.
        return construirPasso("cotidiano", n, elenco, anteriores, qtd, sortear);
      }
      return { n, baralho, rodada, anteriores: { ...anteriores, familia: rodada.palavra.id } };
    }
  }
}

/**
 * Escolha da criança na tela de entrada: um baralho fixo, ou "misturado"
 * (o comportamento de sempre — sorteia entre os quatro, nunca repetindo o
 * anterior).
 */
export type EscolhaIngles = "misturado" | BaralhoIngles;

/** Monta o passo respeitando a escolha: fixo joga SÓ aquele baralho (com a
 * mesma rede de segurança de `construirPasso` para família obsoleta);
 * "misturado" é exatamente o `montarPasso` de sempre. */
function montarPassoParaEscolha(
  escolha: EscolhaIngles,
  anterior: Passo | null,
  n: number,
  elenco: readonly Pessoa[],
  sortear: Sorteio,
  qtd: number,
): Passo {
  if (escolha === "misturado") return montarPasso(anterior, n, elenco, sortear, qtd);
  const anteriores = anterior?.anteriores ?? SEM_ANTERIORES;
  return construirPasso(escolha, n, elenco, anteriores, qtd, sortear);
}

/** A palavra alvo em inglês desta rodada (para repetir por TTS após a voz gravada). */
function palavraAlvo(passo: Passo): string {
  switch (passo.baralho) {
    case "numeros":
      return numeroPorId(passo.rodada.correta).palavra;
    case "cotidiano":
      return palavraCotidianoPorId(passo.rodada.correta).palavra;
    case "saudacoes":
      return saudacaoPorId(passo.rodada.correta).palavra;
    case "cores":
      return corInglesPorId(passo.rodada.correta).palavra;
    case "familia":
      return passo.rodada.palavra.palavra;
  }
}

/** Id da figurinha ("ingles-<id da palavra>", nunca o id da foto/personagem). */
function idPalavraDoPasso(passo: Passo): string {
  return passo.baralho === "familia" ? passo.rodada.palavra.id : passo.rodada.correta;
}

/** Rótulo acessível de uma alternativa (leitor de tela do adulto). */
function rotuloAlternativa(passo: Passo, id: string): string {
  switch (passo.baralho) {
    case "numeros":
      return numeroPorId(id).palavra;
    case "cotidiano":
      return palavraCotidianoPorId(id).palavra;
    case "saudacoes":
      return saudacaoPorId(id).palavra;
    case "cores":
      return corInglesPorId(id).palavra;
    case "familia": {
      const pessoa = passo.rodada.pessoas.find((p) => p.id === id);
      return pessoa?.nome?.trim() || "family";
    }
  }
}

/**
 * Qual `Blob` de festa tocar. No baralho `familia`, a voz da PRÓPRIA pessoa
 * reconhecida; nos outros quatro, a de qualquer familiar cadastrado que já
 * tenha essa gravação — "o mesmo áudio de sempre", como documenta o
 * cabeçalho de `ingles.ts`. `null` = sem gravação disponível, a festa-texto
 * (já em inglês) cai para TTS sozinha.
 */
function escolherVozFesta(passo: Passo, elenco: readonly Pessoa[]): Blob | null {
  if (passo.baralho === "familia") {
    const alvo = passo.rodada.pessoas.find((p) => p.id === passo.rodada.correta);
    return alvo?.vozFesta ?? null;
  }
  return elenco.find((p) => p.vozFesta)?.vozFesta ?? null;
}

// ------------------------------------------------------- escolha lembrada

/**
 * Chave no `localStorage` — "lembrar a última escolha" pedido no brief. NÃO
 * MUDAR: quem já jogou tem a escolha salva sob esta chave, e trocá-la faria
 * o jogo "esquecer" o baralho de todo mundo.
 */
const CHAVE_ESCOLHA_INGLES = "jogo-familia:ingles:escolha";

/**
 * Os ids aceitos HOJE. Um valor salvo por uma versão anterior que não esteja
 * aqui é tratado como "nunca escolheu" (ver `useEscolhaLembrada`), então a
 * tela de escolha aparece em vez de o jogo tentar montar um baralho morto.
 * Constante de MÓDULO de propósito: identidade estável entre renders.
 */
const ESCOLHAS_VALIDAS: readonly EscolhaIngles[] = [
  "misturado",
  "numeros",
  "cotidiano",
  "familia",
  "saudacoes",
  "cores",
];

// -------------------------------------------------------------------- jogo

/**
 * Lê os familiares do IndexedDB uma vez. `null` = ainda carregando (o
 * primeiro round trata isso como elenco vazio — ver `Rodada` — então a
 * tela nunca fica esperando antes de mostrar a primeira rodada).
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

function JogoIngles({ semente }: { semente: number }) {
  const sessao = useSessao();
  const elenco = useElenco();

  // Snapshot síncrono do elenco para a TROCA de rodada (ver `montarPasso`):
  // ler `elenco` (estado) direto na escolha do próximo baralho faria a
  // rodada ATUAL mudar de conteúdo se o cadastro mudasse no meio dela — o
  // ref só é lido no início de uma rodada nova, nunca durante uma em curso.
  const elencoRef = useRef<readonly Pessoa[]>([]);
  useEffect(() => {
    elencoRef.current = elenco ?? [];
  }, [elenco]);

  // A escolha lembrada (ver `useEscolhaLembrada`), com uma sobreposição desta
  // sessão: `undefined` = segue a lembrada; `null` = "Trocar" pediu a tela de
  // escolha AGORA (sem apagar o que está salvo no aparelho); um baralho = a
  // criança acabou de escolher. `null` = mostrar a tela de escolha.
  const [lembrada, lembrar] = useEscolhaLembrada(CHAVE_ESCOLHA_INGLES, ESCOLHAS_VALIDAS);
  const [sobreposta, setSobreposta] = useState<EscolhaIngles | null | undefined>(undefined);
  const escolha = sobreposta !== undefined ? sobreposta : lembrada;

  return (
    <>
      {escolha === null ? (
        <TelaEscolhaExercicio
          elenco={elenco}
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
          elenco={elenco}
          elencoRef={elencoRef}
          aoTrocar={() => setSobreposta(null)}
        />
      )}
      {sessao.despedindo ? <Despedida /> : null}
    </>
  );
}

function Rodada({
  escolha,
  semente,
  sessao,
  elenco,
  elencoRef,
  aoTrocar,
}: {
  escolha: EscolhaIngles;
  semente: number;
  sessao: Sessao;
  elenco: readonly Pessoa[] | null;
  elencoRef: React.RefObject<readonly Pessoa[]>;
  aoTrocar: () => void;
}) {
  // Dificuldade num ref (mesmo padrão de `/jogo/animais`): mudá-la nunca pode
  // reiniciar a rodada em curso. Reinicia do zero a cada baralho escolhido
  // (este componente remonta por `key={escolha}` em `JogoIngles`).
  const dificuldade = useRef<EstadoDificuldade>(dificuldadeInicial());

  // Nada de ler `elencoRef`/`dificuldade` aqui: são refs, e a inicialização
  // preguiçosa do `useState` ainda conta como "durante o render" para o
  // lint de refs. `elenco ?? []` é seguro (não é leitura de ref): no pior
  // caso (cadastro ainda carregando) a primeira rodada de família cai para
  // cotidiano, como sempre foi (ver `construirPasso`).
  const [passo, setPasso] = useState<Passo>(() =>
    montarPassoParaEscolha(escolha, null, 0, elenco ?? [], criarSorteio(semente), dificuldadeInicial().alternativas),
  );

  const config = useMemo(
    () => ({
      pergunta: passo.rodada.pergunta,
      alternativas: passo.rodada.alternativas,
      correta: passo.rodada.correta,
      festa: passo.rodada.festa,
      // Reforço do toque errado: repete a palavra-alvo (ver cabeçalho do
      // arquivo) — mesmo texto de `pergunta`, já formatado como "Palavra!".
      reforcos: [passo.rodada.pergunta],
    }),
    [passo],
  );

  const vozFesta = escolherVozFesta(passo, elenco ?? []);
  const vozes = useMemo(() => ({ festa: vozFesta }), [vozFesta]);

  const aoQuaseLa = useCallback(() => {
    // Não é derrota (não existe): é o sinal de dificuldade do relatório.
    void registrarQuaseLa("ingles").catch(() => {});
  }, []);

  // Acertou: se uma voz gravada vai tocar no lugar da festa-texto, enfileira
  // a palavra em inglês por TTS logo atrás (prioridade normal — entra na fila,
  // não corta a voz gravada). Sem voz gravada, a festa-texto já é a palavra
  // em inglês — nada extra a enfileirar (ver cabeçalho do arquivo).
  const aoAcertar = useCallback(() => {
    if (!vozFesta) return;
    filaDeFala.falar({
      texto: palavraAlvo(passo),
      idioma: "en-US",
      prioridade: "normal",
    });
  }, [vozFesta, passo]);

  const encerrarSessao = sessao.encerrar;

  // ------------------------------------------ etapa de contagem (números)
  //
  // Pedido do dono do produto: depois de acertar uma rodada do baralho
  // `numeros`, a criança toca e conta os objetos em inglês ("one... two...
  // three…") antes da próxima rodada — ver `criarContagemNumeroIngles` em
  // `ingles.ts`, que reaproveita a MESMA máquina de `@/game/modos/contar`
  // (mesma regra de ouro: não existe perder, toque repetido não fala de
  // novo). `contagem === null` fora dessa etapa; `contagemRef` é a fonte de
  // verdade síncrona para os handlers (mesmo motivo de `estadoRef` dentro de
  // `useRodada`: dois toques no mesmo tick precisam ver a contagem já
  // atualizada antes do re-render).
  const [contagem, setContagem] = useState<EstadoContagem | null>(null);
  const contagemRef = useRef<EstadoContagem | null>(null);
  const timersContagem = useRef<ReturnType<typeof setTimeout>[]>([]);

  const limparTimersContagem = useCallback(() => {
    for (const t of timersContagem.current) clearTimeout(t);
    timersContagem.current = [];
  }, []);
  const agendarContagem = useCallback((fn: () => void, ms: number) => {
    timersContagem.current.push(setTimeout(fn, ms));
  }, []);
  // Saiu da tela com uma contagem em andamento: nada continua agendado
  // (mesmo cuidado de `/jogo/contar`). `filaDeFala.cancelar()` já é feito
  // pelo próprio unmount de `useRodada`, que compartilha a mesma fila.
  useEffect(
    () => () => {
      limparTimersContagem();
    },
    [limparTimersContagem],
  );

  const dizerContagem = useCallback((falas: readonly FalaContagem[]) => {
    for (const f of falas) {
      filaDeFala.falar({ chave: f.chave, texto: f.texto, prioridade: f.prioridade, idioma: "en-US" });
    }
  }, []);

  // "Ir para a próxima rodada" — extraído para ser chamado tanto no fim
  // normal de uma rodada (baralhos != números) quanto no fim da contagem.
  const avancarProximaRodada = useCallback(() => {
    setPasso((atual) =>
      montarPassoParaEscolha(
        escolha,
        atual,
        atual.n + 1,
        elencoRef.current,
        criarSorteio(semente + (atual.n + 1) * 7919),
        dificuldade.current.alternativas,
      ),
    );
  }, [escolha, semente, elencoRef]);

  const iniciarContagemNumeros = useCallback(
    (concluido: Extract<Passo, { baralho: "numeros" }>) => {
      // Semente derivada, DIFERENTE da usada para montar a PRÓXIMA rodada
      // (`semente + (n+1)*7919`, em `avancarProximaRodada`) — só decide o
      // giro de cada peixinho, sem interferir no sorteio do resto do jogo.
      const sortear = criarSorteio(semente + concluido.n * 7919 + 1);
      const novo = criarContagemNumeroIngles(concluido.rodada.correta, sortear, concluido.rodada.pergunta);
      contagemRef.current = novo;
      setContagem(novo);
    },
    [semente],
  );

  const tocarContagem = useCallback(
    (id: string) => {
      const atual = contagemRef.current;
      if (!atual) return;
      const t = contarObjeto(atual, id);
      // `mudou: false` = objeto já contado (ou fase errada) — regra de ouro
      // "não existe perder", igual a `/jogo/contar`: nada acontece.
      if (!t.mudou) return;
      contagemRef.current = t.estado;
      setContagem(t.estado);
      dizerContagem(t.falas);
      if (t.estado.fase !== "total") return;

      agendarContagem(() => {
        const depoisDoTotal = contagemRef.current;
        if (!depoisDoTotal) return;
        const festa = comemorar(depoisDoTotal);
        if (!festa.mudou) return;
        contagemRef.current = festa.estado;
        setContagem(festa.estado);
        // `festa.falas` é sempre `[]` aqui (`FALAS_CONTAGEM_NUMEROS_INGLES.
        // festa === null`, ver `ingles.ts`): a comemoração já aconteceu no
        // acerto do número. Chamamos `dizerContagem` do mesmo jeito, para o
        // comportamento continuar certo mesmo se isso mudar um dia.
        dizerContagem(festa.falas);

        agendarContagem(() => {
          // Ponto seguro (ver `useSessao`): só aqui, com a contagem já
          // comemorada por inteiro, a despedida pode encerrar a sessão —
          // nunca no meio da contagem.
          contagemRef.current = null;
          setContagem(null);
          if (encerrarSessao()) return;
          avancarProximaRodada();
        }, MS_PROXIMA_CONTAGEM);
      }, MS_TOTAL_CONTAGEM);
    },
    [agendarContagem, dizerContagem, encerrarSessao, avancarProximaRodada],
  );

  const repetirContagem = useCallback(() => {
    const atual = contagemRef.current;
    if (!atual) return;
    dizerContagem(repetirPerguntaContagem(atual).falas);
  }, [dizerContagem]);

  const aoRecompensar = useCallback(
    (estadoFinal: EstadoRodada) => {
      dificuldade.current = registrarRodada(dificuldade.current, { quaseLas: estadoFinal.quaseLas });
      // Figurinha da palavra aprendida — UMA vez por rodada, aqui. A etapa
      // de contagem que pode seguir (baralho `numeros`, abaixo) é só reforço
      // de vocabulário: NUNCA concede figurinha nem acerto de novo no eixo
      // `ingles`. Sem banco (aba anônima, quota cheia) o jogo continua igual
      // — recompensa é bônus, não requisito.
      void addFigurinha(idFigurinha("ingles", idPalavraDoPasso(passo)), "ingles").catch(() => {});

      if (passo.baralho === "numeros") {
        // O fim de sessão seguro acontece DEPOIS da contagem inteira (dentro
        // de `tocarContagem`) — nunca aqui, senão a despedida cortaria a
        // contagem no meio (regra do brief).
        iniciarContagemNumeros(passo);
        return;
      }

      // Fim da sessão só no fim da rodada: o tempo pode ter acabado no meio
      // dela, mas a comemoração da criança nunca é cortada.
      if (encerrarSessao()) return;
      avancarProximaRodada();
    },
    [passo, encerrarSessao, avancarProximaRodada, iniciarContagemNumeros],
  );

  const { estado, tocar, repetir, falando } = useRodada(config, {
    chave: passo.n,
    idioma: "en-US",
    vozes,
    aoQuaseLa,
    aoAcertar,
    aoRecompensar,
  });

  const acertou = estado.fase === "acertou" || estado.fase === "recompensa";
  const feedback = acertou
    ? passo.rodada.festa
    : estado.fase === "quaseLa"
      ? "Almost! Look again!"
      : null;

  // Etapa de contagem ativa (baralho `numeros`, pós-acerto): troca a
  // pergunta/fase/feedback/repetir e as alternativas do MESMO <Palco> pelos
  // objetos de tocar-e-contar — nenhuma navegação, nenhum remount. A fase da
  // RODADA (`estado.fase`) continua "recompensa" o tempo todo (só muda de
  // verdade quando `avancarProximaRodada` monta a rodada seguinte), então
  // "Trocar" abaixo já fica travado sozinho durante toda a contagem.
  const perguntaAtual = contagem ? contagem.pergunta : estado.pergunta;
  const faseAtual: FaseRodada = contagem ? faseDaContagem(contagem.fase) : estado.fase;
  const aoRepetirAtual = contagem ? repetirContagem : repetir;
  const feedbackAtual = contagem ? (
    <>
      <ul
        className={estilosObjetos.pontos}
        aria-label={`${contagem.contados.length} of ${contagem.objetos.length} counted`}
      >
        {contagem.objetos.map((objeto, i) => (
          <li
            key={objeto.id}
            className={estilosObjetos.ponto}
            data-cheio={i < contagem.contados.length ? "true" : "false"}
          />
        ))}
      </ul>
      {contagem.fase !== "contando" && contagem.falas.total ? (
        // `falas.total` é `null` no pacote do inglês (ver `ingles.ts`): o
        // último número contado já É o total, então não existe frase extra
        // para mostrar aqui — nem em voz (já corrigido em `contar.ts`), nem
        // por escrito, senão a tela ecoa o que o áudio parou de ecoar.
        <span>{contagem.falas.total(contagem.objetos.length, contagem.forma)}</span>
      ) : null}
    </>
  ) : (
    feedback
  );

  return (
    <>
      <Palco pergunta={perguntaAtual} fase={faseAtual} aoRepetir={aoRepetirAtual} falando={falando} feedback={feedbackAtual}>
        {contagem
          ? contagem.objetos.map((objeto, i) => {
              const contado = jaContado(contagem, objeto.id);
              return (
                <BotaoAlternativa
                  key={objeto.id}
                  cor={COR_BOTAO}
                  rotulo={`fish ${i + 1}${contado ? " (counted)" : ""}`}
                  travado={contagem.fase !== "contando"}
                  acertou={contagem.fase !== "contando"}
                  aoTocar={() => tocarContagem(objeto.id)}
                >
                  <span className={[estilosObjetos.peca, contado ? estilosObjetos.contado : ""].join(" ").trim()}>
                    <ObjetoMar forma={objeto.forma} cor={objeto.cor} giro={objeto.giro} />
                  </span>
                </BotaoAlternativa>
              );
            })
          : estado.alternativas.map((id) => {
              const certa = estado.escolhida === id;
              const errada = estado.fase === "quaseLa" && estado.ultimaQuase === id;
              return (
                <BotaoAlternativa
                  key={id}
                  cor={COR_BOTAO}
                  rotulo={rotuloAlternativa(passo, id)}
                  travado={estado.fase !== "perguntando"}
                  acertou={certa}
                  aoTocar={() => tocar(id)}
                >
                  <ConteudoAlternativa passo={passo} id={id} certa={certa} errada={errada} />
                </BotaoAlternativa>
              );
            })}
      </Palco>
      <BotaoVoltar />
      {/* "Trocar" só ativo perguntando: trocar durante "quaseLa"/comemoração
          cortaria a tentativa ou a festa no meio (regra do brief) — e, pelo
          MESMO motivo, fica travado sozinho durante toda a etapa de
          contagem que segue um acerto de números (ver comentário acima).
          Canto inferior direito: longe do voltar (inferior esquerdo, 88px) e
          do `<AvisoVoz>` (empilhado sobre o voltar). */}
      <button
        type="button"
        className={estilos.trocar}
        onClick={() => {
          filaDeFala.cancelar();
          aoTrocar();
        }}
        disabled={estado.fase !== "perguntando"}
        data-teste="ingles-trocar-exercicio"
      >
        <IconeTrocar />
        <span>Trocar</span>
      </button>
    </>
  );
}

// -------------------------------------------------------- tela de escolha

type OpcaoIngles = OpcaoEscolha<EscolhaIngles>;

/** Tamanho comum dos desenhos das opções — absoluto (não `%`), porque
 * `<Personagem>`/`<Bicho>`/`<Saudacao>` aplicam `tamanho` como estilo
 * inline (vence qualquer CSS), e um valor em `%` dentro de um cartão flex
 * sem altura definida (`.card-modo`) resolveria de forma imprevisível. Uma
 * fração fixa de `--toque-card` (150–320px) escala do mesmo jeito que os
 * próprios cartões. */
const TAMANHO_ICONE_ESCOLHA = "clamp(90px, 18vmin, 190px)";
const TAMANHO_ICONE_COMPOSTO = "clamp(28px, 7vmin, 60px)";

const OPCAO_MISTURADO: OpcaoIngles = {
  id: "misturado",
  rotulo: "Tudo misturado",
  // Mesma cor do cartão "Inglês" na home — esta tela é a continuação dele.
  cor: "var(--color-coral-escuro)",
  icone: (
    // Uma amostra de cada baralho, para "um pouco de tudo" ser reconhecível
    // pelo desenho — nenhuma arte nova, só uma mistura das quatro já usadas
    // dentro da própria rodada.
    <span className={estilos.iconeMisturado} aria-hidden="true">
      <ObjetoMar forma="peixe" cor="var(--color-agua)" className={estilos.pontoMisturado} />
      <Bicho qual="gato" tamanho={TAMANHO_ICONE_COMPOSTO} className={CLASSE_ICONE_QUADRADO} />
      <Saudacao qual="hello" tamanho={TAMANHO_ICONE_COMPOSTO} className={CLASSE_ICONE_QUADRADO} />
      <ObjetoMar forma="estrela" cor="var(--color-areia)" className={estilos.pontoMisturado} />
    </span>
  ),
};

const OPCAO_NUMEROS: OpcaoIngles = {
  id: "numeros",
  rotulo: "Números",
  cor: "var(--color-agua)",
  icone: (
    // Ícone do CARTÃO DE ESCOLHA (não uma alternativa de rodada) — 4
    // peixinhos fixos, sem algarismo, porque não existe um "número certo"
    // aqui para escrever ao lado. DECISÃO SOBRE NUMERAL REVERTIDA (só para
    // as alternativas de verdade, ver `ConteudoAlternativa`/`.algarismo` em
    // ingles.module.css): este comentário dizia "no espírito do modo
    // Contar: nunca um numeral escrito" — o dono do projeto pediu
    // EXPLICITAMENTE que o algarismo apareça junto da quantidade dentro da
    // rodada de números, para a criança ligar quantidade + símbolo + palavra
    // ouvida ao mesmo tempo. Esse pedido não muda este ícone (não há valor
    // a escrever aqui), só as alternativas reais do baralho.
    <span className={estilos.iconeContagem} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <ObjetoMar key={i} forma="peixe" cor="var(--color-mar-900)" className={estilos.pontoIcone} />
      ))}
    </span>
  ),
};

const OPCAO_PALAVRAS: OpcaoIngles = {
  id: "cotidiano",
  rotulo: "Palavras",
  cor: "var(--color-alga)",
  icone: (
    // O baralho `cotidiano` sorteia OU um bicho OU uma forma (ver
    // `ConteudoAlternativa`) — o cartão mostra os dois juntos.
    <span className={estilos.iconeDupla} aria-hidden="true">
      <Bicho qual="cachorro" tamanho={TAMANHO_ICONE_COMPOSTO} className={CLASSE_ICONE_QUADRADO} />
      <ObjetoMar forma="concha" cor="var(--color-areia)" className={estilos.pontoIcone} />
    </span>
  ),
};

const OPCAO_SAUDACOES: OpcaoIngles = {
  id: "saudacoes",
  rotulo: "Saudações",
  cor: "var(--color-areia)",
  icone: <Saudacao qual="hello" tamanho={TAMANHO_ICONE_ESCOLHA} className={CLASSE_ICONE_QUADRADO} />,
};

const OPCAO_CORES: OpcaoIngles = {
  id: "cores",
  rotulo: "Cores",
  cor: "var(--color-mar-500)",
  icone: (
    // A MESMA forma em cores diferentes — o desenho do próprio cartão já
    // ensaia a exceção documentada no cabeçalho de `ingles.ts`: neste
    // baralho a COR é a pista (não a forma, como no resto do jogo).
    <span className={estilos.iconeCores} aria-hidden="true">
      {IDS_COR_INGLES.map((id) => (
        <ObjetoMar key={id} forma="bolha" cor={peca(id).hex} className={estilos.pontoIcone} />
      ))}
    </span>
  ),
};

/** Só chamada quando `podeFamilia` é `true` — sempre acha um representante. */
function opcaoFamilia(representante: Pessoa): OpcaoIngles {
  return {
    id: "familia",
    rotulo: "Família",
    cor: "var(--color-coral)",
    icone: (
      <Personagem
        foto={representante.fotoRecorte}
        rotulo="Família"
        animacao="idle"
        tamanho={TAMANHO_ICONE_ESCOLHA}
      />
    ),
  };
}

/**
 * A tela de entrada de `/jogo/ingles`: quais opções entram e com que desenho.
 * O layout (cartões grandes no padrão visual da home) é do `<TelaEscolha>`
 * compartilhado — ver o cabeçalho dele para as decisões de UX.
 *
 * "Família" só entra na lista quando o elenco dá para jogar (edge case
 * obrigatório do brief): sem isso a criança escolheria um cartão que não
 * gera rodada nenhuma. Enquanto o cadastro ainda carrega (`elenco === null`,
 * poucos milissegundos), a tela fica só com o fundo (`carregando`) — mesmo
 * padrão de `useIdsAtivos` na home — para o cartão não "pipocar" depois.
 */
function TelaEscolhaExercicio({
  elenco,
  aoEscolher,
}: {
  elenco: readonly Pessoa[] | null;
  aoEscolher: (escolha: EscolhaIngles) => void;
}) {
  const jogaveis = elenco === null ? [] : palavrasFamiliaJogaveis(elenco);
  const representante =
    elenco !== null && jogaveis.length > 0
      ? (elenco.find((p) => jogaveis.some((j) => j.papel === p.papel)) ?? null)
      : null;

  const opcoes: OpcaoIngles[] = [
    OPCAO_MISTURADO,
    OPCAO_NUMEROS,
    OPCAO_PALAVRAS,
    ...(representante ? [opcaoFamilia(representante)] : []),
    OPCAO_SAUDACOES,
    OPCAO_CORES,
  ];

  return (
    <TelaEscolha
      titulo="Inglês — escolha a brincadeira"
      opcoes={opcoes}
      aoEscolher={aoEscolher}
      carregando={elenco === null}
      prefixoTeste="ingles-escolher-"
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

// -------------------------------------------------------- desenho de cada alternativa

/**
 * O que desenhar dentro de uma alternativa, por baralho. `familia` usa a
 * animação própria do `<Personagem>` (pulo/careta); os outros quatro reaproveitam
 * o wrapper `.peca`/`.sumindo`/`.tremendo` de `objetos.module.css`, o mesmo
 * usado por "cores" e "contar" — nenhuma animação nova.
 */
function ConteudoAlternativa({
  passo,
  id,
  certa,
  errada,
}: {
  passo: Passo;
  id: string;
  certa: boolean;
  errada: boolean;
}) {
  if (passo.baralho === "familia") {
    const pessoa = passo.rodada.pessoas.find((p) => p.id === id)!;
    return (
      <Personagem
        foto={pessoa.fotoRecorte}
        nome={pessoa.nome}
        animacao={certa ? "pulo" : errada ? "careta" : "idle"}
        seguirFala={certa}
        tamanho="var(--toque-card)"
        corAro={certa ? "var(--color-alga)" : undefined}
      />
    );
  }

  const classeAnimada = [estilosObjetos.peca, certa ? estilosObjetos.sumindo : "", errada ? estilosObjetos.tremendo : ""]
    .filter(Boolean)
    .join(" ");

  if (passo.baralho === "numeros") {
    const item = numeroPorId(id);
    return (
      <span className={classeAnimada}>
        {/* Algarismo + quantidade desenhada JUNTOS — pedido explícito do
         * dono do projeto (ver `.algarismo` em ingles.module.css): a
         * criança liga três coisas de uma vez — a quantidade que vê, o
         * símbolo escrito (`item.id`, ex.: "8") e a palavra que ouve
         * (`Eight!`). O algarismo é `aria-hidden`: o rótulo acessível já
         * vem de `rotulo` no <BotaoAlternativa> (a palavra em inglês), não
         * duplicar aqui. */}
        <span className={estilos.numeroConteudo}>
          <span className={estilos.algarismo} aria-hidden="true">
            {item.id}
          </span>
          <span className={estilos.contagem} aria-hidden="true">
            {Array.from({ length: item.valor }, (_, i) => (
              <ObjetoMar
                key={i}
                forma="peixe"
                cor="var(--color-agua)"
                className={estilos.pontoContagem}
              />
            ))}
          </span>
        </span>
      </span>
    );
  }

  if (passo.baralho === "cotidiano") {
    const item = palavraCotidianoPorId(id);
    return (
      <span className={classeAnimada}>
        {item.desenho.tipo === "animal" ? (
          <Bicho qual={item.desenho.animal} />
        ) : (
          <ObjetoMar forma={item.desenho.forma} cor={peca(item.desenho.cor).hex} />
        )}
      </span>
    );
  }

  if (passo.baralho === "cores") {
    // A MESMA forma (`passo.rodada.forma`, sorteada uma vez para a rodada
    // inteira) em todas as alternativas — só a cor muda. Ver a exceção
    // documentada no cabeçalho de `ingles.ts`: aqui a cor é a única pista,
    // de propósito.
    return (
      <span className={classeAnimada}>
        <ObjetoMar forma={passo.rodada.forma} cor={peca(id).hex} />
      </span>
    );
  }

  // saudacoes
  return (
    <span className={classeAnimada}>
      <Saudacao qual={id as IdSaudacao} />
    </span>
  );
}
