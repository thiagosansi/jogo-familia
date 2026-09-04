"use client";

/**
 * /jogo/ingles — mini-jogo "inglês" (eixo `ingles`), quatro baralhos num só
 * fluxo: números (1-10), cotidiano (bichos/formas já conhecidos), família
 * (fotos já cadastradas) e saudações. `<Palco>`/`useRodada` (`@/game/useRodada`)
 * exatamente como os outros mini-jogos.
 *
 * TELA DE ESCOLHA — DECISÃO REVERTIDA (não mexer sem combinar com o dono do
 * projeto): uma versão anterior deste comentário afirmava "SEM tela de
 * escolha, criança de 3 anos não escolhe menu" e a tela entrava direto
 * sorteando entre os quatro baralhos ("Tudo misturado"). O dono do projeto
 * pediu EXPLICITAMENTE a opção de escolha — a frase acima estava errada para
 * este jogo. Por isso `/jogo/ingles` abre em `<TelaEscolhaExercicio>`: cinco
 * cartões grandes (Tudo misturado, Números, Palavras, Família, Saudações),
 * cada um reconhecível pelo DESENHO (a criança ainda não lê — isso continua
 * valendo), no mesmo padrão visual da home (`.tela`/`.grade-modos`/
 * `.card-modo` de `globals.css`). A última escolha fica salva no aparelho
 * (`localStorage`, ver `lerEscolhaSalva`/`salvarEscolha`) para não obrigar a
 * escolher de novo a cada abertura, e o botão "Trocar" (canto inferior
 * direito da rodada) sempre permite voltar à escolha sem sair do jogo. NÃO
 * REVERTER isto para "sorteia sozinho, sem tela" de novo.
 *
 * O CONTEÚDO (catálogos, `montarRodadaX`, regra "o inglês nunca chega
 * sozinho") mora inteiro em `@/game/modos/ingles` — PURO e testado. Esta
 * tela só: (1) deixa a criança escolher o baralho (ou "Tudo misturado", que
 * sorteia entre os quatro como antes), (2) traduz cada rodada para o
 * `<Palco>`, e (3) desenha cada alternativa com o componente certo:
 * contagem visual para números, `<Bicho>`/`<ObjetoMar>` (reaproveitados de
 * animais/cores) para cotidiano, `<Personagem>` (a foto) para família,
 * `<Saudacao>` para saudações.
 *
 * DUAS VOZES, DECISÃO DE PRODUTO JÁ TOMADA (não mexer sem combinar):
 *  - a PERGUNTA e a FESTA-TEXTO ("Show me \"cat\"!" / "Yes! \"Cat\"!") saem
 *    por síntese en-US — por isso `useRodada` recebe `idioma: "en-US"`.
 *  - a comemoração do acerto toca a voz JÁ GRAVADA de festa de algum
 *    familiar (`personagem.vozFesta`) quando existe — o MESMO áudio de
 *    sempre, nenhuma gravação nova por palavra. No baralho `familia` é a voz
 *    da própria pessoa reconhecida; nos outros três (que não têm pessoa
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
 * cadastro mudando em outra aba) — a tela dos outros três baralhos funciona
 * igual, desde o primeiro uso. Ver `construirPasso`. Pela mesma razão, o
 * cartão "Família" só aparece em `<TelaEscolhaExercicio>` quando o elenco dá
 * (ver `palavrasFamiliaJogaveis`) — senão a criança escolheria um cartão que
 * não gera rodada nenhuma.
 *
 * REFORÇOS EM INGLÊS: `ingles.ts` não define `reforcos` (usa o padrão do
 * engine, em português) — como `useRodada` fala TUDO desta rodada em
 * en-US, um reforço em português sairia com sotaque errado. Por isso esta
 * tela fornece o próprio array em inglês (`REFORCOS_INGLES`), só texto,
 * nada de lógica nova.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Bicho } from "@/components/bichos/Bicho";
import { Despedida } from "@/components/Despedida";
import { BotaoAlternativa, Palco } from "@/components/Palco";
import { BotaoVoltar } from "@/components/objetos/BotaoVoltar";
import { ObjetoMar } from "@/components/objetos/ObjetoMar";
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
import type { EstadoRodada } from "@/game/engine";
import { filaDeFala } from "@/game/fala";
import { peca } from "@/game/modos/cores";
import {
  BARALHOS_INGLES,
  criarSorteio,
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

/** Ver o porquê no cabeçalho do arquivo: `ingles.ts` não define reforços. */
const REFORCOS_INGLES: readonly string[] = [
  "Try again!",
  "Almost! Look again!",
  "Oops! One more try!",
  "So close! Try again!",
];

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
}

const SEM_ANTERIORES: Anteriores = { numeros: null, cotidiano: null, familia: null, saudacoes: null };

type Passo =
  | { n: number; baralho: "numeros"; anteriores: Anteriores; rodada: RodadaNumeros }
  | { n: number; baralho: "cotidiano"; anteriores: Anteriores; rodada: RodadaCotidiano }
  | { n: number; baralho: "familia"; anteriores: Anteriores; rodada: RodadaFamiliaIngles<Pessoa> }
  | { n: number; baralho: "saudacoes"; anteriores: Anteriores; rodada: RodadaSaudacoes };

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
    case "familia": {
      const pessoa = passo.rodada.pessoas.find((p) => p.id === id);
      return pessoa?.nome?.trim() || "family";
    }
  }
}

/**
 * Qual `Blob` de festa tocar. No baralho `familia`, a voz da PRÓPRIA pessoa
 * reconhecida; nos outros três, a de qualquer familiar cadastrado que já
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

/** Chave no `localStorage` — "lembrar a última escolha" pedido no brief. */
const CHAVE_ESCOLHA_INGLES = "jogo-familia:ingles:escolha";

const ESCOLHAS_VALIDAS: ReadonlySet<string> = new Set<EscolhaIngles>([
  "misturado",
  "numeros",
  "cotidiano",
  "familia",
  "saudacoes",
]);

/**
 * Lê a última escolha salva neste aparelho. `null` = nunca escolheu, o
 * valor salvo não é mais um baralho válido, ou o `localStorage` está
 * bloqueado (aba anônima, quota cheia) — falha aberta: sem valor salvo, a
 * tela de escolha aparece, nunca quebra o jogo.
 */
function lerEscolhaSalva(): EscolhaIngles | null {
  try {
    const bruta = localStorage.getItem(CHAVE_ESCOLHA_INGLES);
    return bruta !== null && ESCOLHAS_VALIDAS.has(bruta) ? (bruta as EscolhaIngles) : null;
  } catch {
    return null;
  }
}

function salvarEscolha(escolha: EscolhaIngles): void {
  try {
    localStorage.setItem(CHAVE_ESCOLHA_INGLES, escolha);
  } catch {
    /* Sem storage a escolha desta sessão ainda funciona — só não fica lembrada. */
  }
}

/** Sempre `null` no servidor (não existe `localStorage`) — igual a nunca ter
 * escolhido, então o HTML do servidor é sempre a tela de escolha. */
function lerEscolhaSalvaServidor(): EscolhaIngles | null {
  return null;
}

/** Nada muda depois do primeiro snapshot — a assinatura é um no-op (mesmo
 * padrão de `useSemente`). */
function assinarEscolhaSalva(): () => void {
  return () => {};
}

/**
 * A última escolha lembrada, com hidratação segura.
 *
 * Por que `useSyncExternalStore` (mesmo padrão de `useSemente`, ver o
 * porquê lá) e NÃO um `useState(() => lerEscolhaSalva())` direto: esta
 * chamada roda durante a PRÓPRIA hidratação de `JogoIngles` (a troca de
 * semente que remonta o componente só acontece DEPOIS), então um
 * `localStorage.getItem` lido direto no inicializador do `useState`
 * divergiria do HTML do servidor (que nunca tem `localStorage`) sempre que
 * já existisse uma escolha salva — hydration mismatch de verdade (confirmado
 * no overlay de erro do Next.js ao testar com uma escolha lembrada).
 * `useSyncExternalStore` usa `getServerSnapshot` (`null`) durante a
 * hidratação — igual ao servidor, sem mismatch — e troca para o valor real
 * do cliente logo depois, automaticamente.
 */
function useEscolhaLembrada(): EscolhaIngles | null {
  return useSyncExternalStore(assinarEscolhaSalva, lerEscolhaSalva, lerEscolhaSalvaServidor);
}

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
  const lembrada = useEscolhaLembrada();
  const [sobreposta, setSobreposta] = useState<EscolhaIngles | null | undefined>(undefined);
  const escolha = sobreposta !== undefined ? sobreposta : lembrada;

  return (
    <>
      {escolha === null ? (
        <TelaEscolhaExercicio
          elenco={elenco}
          aoEscolher={(nova) => {
            salvarEscolha(nova);
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
      reforcos: REFORCOS_INGLES,
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
  const aoRecompensar = useCallback(
    (estadoFinal: EstadoRodada) => {
      dificuldade.current = registrarRodada(dificuldade.current, { quaseLas: estadoFinal.quaseLas });
      // Figurinha da palavra aprendida. Sem banco (aba anônima, quota cheia)
      // o jogo continua igual — recompensa é bônus, não requisito.
      void addFigurinha(idFigurinha("ingles", idPalavraDoPasso(passo)), "ingles").catch(() => {});
      // Fim da sessão só no fim da rodada: o tempo pode ter acabado no meio
      // dela, mas a comemoração da criança nunca é cortada.
      if (encerrarSessao()) return;
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
    },
    [encerrarSessao, passo, semente, escolha, elencoRef],
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

  return (
    <>
      <Palco pergunta={estado.pergunta} fase={estado.fase} aoRepetir={repetir} falando={falando} feedback={feedback}>
        {estado.alternativas.map((id) => {
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
          cortaria a tentativa ou a festa no meio (regra do brief). Canto
          inferior direito: longe do voltar (inferior esquerdo, 88px) e do
          `<AvisoVoz>` (empilhado sobre o voltar). */}
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

interface OpcaoEscolha {
  readonly id: EscolhaIngles;
  readonly rotulo: string;
  readonly cor: string;
  readonly icone: React.ReactNode;
}

/** Tamanho comum dos desenhos das opções — absoluto (não `%`), porque
 * `<Personagem>`/`<Bicho>`/`<Saudacao>` aplicam `tamanho` como estilo
 * inline (vence qualquer CSS), e um valor em `%` dentro de um cartão flex
 * sem altura definida (`.card-modo`) resolveria de forma imprevisível. Uma
 * fração fixa de `--toque-card` (150–320px) escala do mesmo jeito que os
 * próprios cartões. */
const TAMANHO_ICONE_ESCOLHA = "clamp(90px, 18vmin, 190px)";
const TAMANHO_ICONE_COMPOSTO = "clamp(28px, 7vmin, 60px)";

const OPCAO_MISTURADO: OpcaoEscolha = {
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
      <Bicho qual="gato" tamanho={TAMANHO_ICONE_COMPOSTO} className={estilos.iconeQuadrado} />
      <Saudacao qual="hello" tamanho={TAMANHO_ICONE_COMPOSTO} className={estilos.iconeQuadrado} />
      <ObjetoMar forma="estrela" cor="var(--color-areia)" className={estilos.pontoMisturado} />
    </span>
  ),
};

const OPCAO_NUMEROS: OpcaoEscolha = {
  id: "numeros",
  rotulo: "Números",
  cor: "var(--color-agua)",
  icone: (
    // Contagem visual — no espírito do modo Contar: nunca um numeral escrito.
    <span className={estilos.iconeContagem} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <ObjetoMar key={i} forma="peixe" cor="var(--color-mar-900)" className={estilos.pontoIcone} />
      ))}
    </span>
  ),
};

const OPCAO_PALAVRAS: OpcaoEscolha = {
  id: "cotidiano",
  rotulo: "Palavras",
  cor: "var(--color-alga)",
  icone: (
    // O baralho `cotidiano` sorteia OU um bicho OU uma forma (ver
    // `ConteudoAlternativa`) — o cartão mostra os dois juntos.
    <span className={estilos.iconeDupla} aria-hidden="true">
      <Bicho qual="cachorro" tamanho={TAMANHO_ICONE_COMPOSTO} className={estilos.iconeQuadrado} />
      <ObjetoMar forma="concha" cor="var(--color-areia)" className={estilos.pontoIcone} />
    </span>
  ),
};

const OPCAO_SAUDACOES: OpcaoEscolha = {
  id: "saudacoes",
  rotulo: "Saudações",
  cor: "var(--color-areia)",
  icone: <Saudacao qual="hello" tamanho={TAMANHO_ICONE_ESCOLHA} className={estilos.iconeQuadrado} />,
};

/** Só chamada quando `podeFamilia` é `true` — sempre acha um representante. */
function opcaoFamilia(representante: Pessoa): OpcaoEscolha {
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
 * A tela de entrada de `/jogo/ingles`: cinco cartões grandes, mesmo padrão
 * visual da home (`.tela`/`.grade-modos`/`.card-modo` de `globals.css`) — a
 * criança reconhece pelo DESENHO, o texto é reforço para o adulto.
 *
 * "Família" só entra na lista quando o elenco dá para jogar (edge case
 * obrigatório do brief): sem isso a criança escolheria um cartão que não
 * gera rodada nenhuma. Enquanto o cadastro ainda carrega (`elenco === null`,
 * poucos milissegundos), a tela fica só com o fundo — mesmo padrão de
 * `useIdsAtivos` na home — para o cartão não "pipocar" um instante depois.
 */
function TelaEscolhaExercicio({
  elenco,
  aoEscolher,
}: {
  elenco: readonly Pessoa[] | null;
  aoEscolher: (escolha: EscolhaIngles) => void;
}) {
  if (elenco === null) {
    return (
      <main className="tela" aria-busy="true">
        <h1 className="so-leitor">Inglês — escolha a brincadeira</h1>
        <BotaoVoltar />
      </main>
    );
  }

  const jogaveis = palavrasFamiliaJogaveis(elenco);
  const representante = jogaveis.length > 0 ? (elenco.find((p) => jogaveis.some((j) => j.papel === p.papel)) ?? null) : null;

  const opcoes: OpcaoEscolha[] = [
    OPCAO_MISTURADO,
    OPCAO_NUMEROS,
    OPCAO_PALAVRAS,
    ...(representante ? [opcaoFamilia(representante)] : []),
    OPCAO_SAUDACOES,
  ];

  return (
    <main className="tela">
      <h1 className="so-leitor">Inglês — escolha a brincadeira</h1>
      <ul className="grade-modos">
        {opcoes.map((op) => (
          <li key={op.id}>
            <button
              type="button"
              className="card-modo"
              style={{ "--cor": op.cor } as React.CSSProperties}
              aria-label={op.rotulo}
              onClick={() => aoEscolher(op.id)}
              data-teste={`ingles-escolher-${op.id}`}
            >
              {op.icone}
              {/* Reforço para o adulto — a criança navega pelo desenho. */}
              <span aria-hidden="true">{op.rotulo}</span>
            </button>
          </li>
        ))}
      </ul>
      <BotaoVoltar />
    </main>
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
 * animação própria do `<Personagem>` (pulo/careta); os outros três reaproveitam
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

  // saudacoes
  return (
    <span className={classeAnimada}>
      <Saudacao qual={id as IdSaudacao} />
    </span>
  );
}
