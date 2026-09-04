"use client";

/**
 * /pais/progresso — o relatório para o adulto.
 * =============================================================================
 *
 * POR QUE ATRÁS DO PORTÃO: esta tela mostra os ROSTOS da família (as figurinhas
 * do eixo "quem é quem" são as fotos cadastradas) e conta como a criança está
 * indo. Nada disso é para a criança ver, e nada disso pode ficar a um toque de
 * distância na home. Mesma trava do painel: `<PortaoPais>`, hold de 3 segundos
 * — uma criança de 3 anos toca e solta, não sustenta pressão.
 *
 * POR QUE SEM GRÁFICO: quem lê isto é um pai cansado, no celular, em trinta
 * segundos. Frase pronta ("reconheceu a mamãe em 8 de 10 vezes") responde a
 * pergunta que ele tem. Barra e pizza dariam mais trabalho de ler e diriam
 * menos — e um gráfico exigiria biblioteca, que exigiria bundle, num app que
 * precisa abrir offline num tablet velho.
 *
 * NÚMERO AQUI PODE. O que não pode é número na tela da CRIANÇA: ela não lê, e
 * placar transforma brincadeira em prova. Aqui do lado do adulto, "8 de 10" é
 * exatamente a informação útil.
 *
 * ZERO REDE: tudo sai do IndexedDB do próprio aparelho. Esta tela não manda
 * nada para lugar nenhum — não há analytics, não há upload, não há telemetria.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Album, useAlbum } from "@/components/Album";
import { PortaoPais } from "@/components/PortaoPais";
import {
  NOME_DO_EIXO,
  TOTAL_DO_EIXO,
  eixoDaFigurinha,
  nomeDaFigurinha,
} from "@/game/recompensa";
import { faltaMs, lerSessao, limiteEmMs, reiniciarSessao } from "@/game/sessao";
import { EIXOS, getConfig, getProgresso } from "@/lib/db";
import type { Config, Eixo, Progresso } from "@/lib/tipos";
import estilos from "./progresso.module.css";

export default function PaginaProgresso() {
  const [liberado, setLiberado] = useState(false);
  const abrir = useCallback(() => setLiberado(true), []);
  // Enquanto o hold não completa, NADA do relatório é montado — nem a leitura
  // do banco acontece. O portão não é um `display: none` por cima do conteúdo.
  if (!liberado) return <PortaoPais onAbrir={abrir} />;
  return <Relatorio />;
}

// ------------------------------------------------------------------ leitura

interface Dados {
  progresso: Progresso;
  config: Config;
}

function Relatorio() {
  const [dados, setDados] = useState<Dados | null>(null);
  const album = useAlbum();
  const [recado, setRecado] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void Promise.all([getProgresso(), getConfig()])
      .then(([progresso, config]) => {
        if (vivo) setDados({ progresso, config });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const liberarSessao = useCallback(() => {
    reiniciarSessao();
    setRecado("Pronto: o tempo recomeçou agora.");
  }, []);

  if (!dados) return <main className="tela" aria-busy="true" />;

  const { progresso, config } = dados;
  const nomes = new Map([...album.pessoas].map(([id, p]) => [id, p.nome]));
  const total = progresso.figurinhas.length;

  return (
    <main className={`tela ${estilos.tela}`}>
      <header className={estilos.cabecalho}>
        <h1 className="titulo">Como está indo</h1>
        <p className={estilos.assinatura}>
          Tudo o que está aqui foi calculado neste aparelho e não sai dele.
        </p>
      </header>

      {total === 0 ? (
        <p className={estilos.vazio} data-teste="progresso-vazio">
          Ainda não há nada para contar — assim que a criança brincar, as
          figurinhas dela aparecem aqui.
        </p>
      ) : (
        <ul className={estilos.eixos} data-teste="progresso-eixos">
          {EIXOS.map((eixo) => (
            <CartaoEixo
              key={eixo}
              eixo={eixo}
              progresso={progresso}
              album={album}
              nomes={nomes}
            />
          ))}
        </ul>
      )}

      <Tempo config={config} aoLiberar={liberarSessao} recado={recado} />

      <p className={estilos.rodape}>
        Última brincadeira: {quando(progresso.atualizadoEm)}.
      </p>

      <Link className={estilos.voltar} href="/pais">
        Voltar ao painel
      </Link>
    </main>
  );
}

// ------------------------------------------------------------------- cartões

function CartaoEixo({
  eixo,
  progresso,
  album,
  nomes,
}: {
  eixo: Eixo;
  progresso: Progresso;
  album: ReturnType<typeof useAlbum>;
  nomes: Map<string, string>;
}) {
  const placar = progresso.porEixo[eixo] ?? { acertos: 0, erros: 0 };
  const conquistadas = progresso.figurinhas.filter(
    (f) => (eixoDaFigurinha(f.id) ?? f.eixo) === eixo,
  );

  if (conquistadas.length === 0 && placar.acertos === 0) return null;

  return (
    <li className={estilos.cartao} data-teste={`eixo-${eixo}`}>
      <h2 className={estilos.tituloEixo}>{NOME_DO_EIXO[eixo]}</h2>
      <p className={estilos.frase}>{fraseDoEixo(eixo, placar, conquistadas.length)}</p>
      {eixo === "familia" && conquistadas.length > 0 ? (
        <p className={estilos.detalhe}>
          Reconheceu: {listar(conquistadas.map((f) => nomeDaFigurinha(f.id, nomes)))}.
        </p>
      ) : null}
      <Album variante="grade" eixo={eixo} dados={album} />
    </li>
  );
}

/**
 * A frase do cartão. Linguagem de conversa, não de painel: "acertou de
 * primeira quase sempre" diz mais para o adulto do que "taxa de acerto 87%".
 * O denominador é `acertos + erros` = tentativas, e `erros` é o `quaseLa`
 * (toque na alternativa errada) — no jogo não existe derrota.
 */
function fraseDoEixo(
  eixo: Eixo,
  placar: { acertos: number; erros: number },
  conquistadas: number,
): string {
  const tentativas = placar.acertos + placar.erros;
  const alvo = TOTAL_DO_EIXO[eixo];

  const colecao =
    alvo === null
      ? `Já ganhou ${figurinhas(conquistadas)}.`
      : `Já ganhou ${conquistadas} das ${alvo} figurinhas deste jogo.`;

  if (tentativas === 0) return colecao;

  const uma = placar.acertos === 1;
  const rodadas = uma ? "1 rodada" : `${placar.acertos} rodadas`;
  if (placar.erros === 0) {
    return `Acertou de primeira ${uma ? "na" : "nas"} ${rodadas} que jogou. ${colecao}`;
  }
  return `Acertou ${rodadas} em ${tentativas} tentativas — nas outras, tentou de novo e chegou lá. ${colecao}`;
}

function figurinhas(n: number): string {
  return n === 1 ? "1 figurinha" : `${n} figurinhas`;
}

/** "a mamãe, o papai e a Bia" — lista humana, com "e" no fim. */
function listar(itens: readonly string[]): string {
  const unicos = [...new Set(itens)];
  if (unicos.length <= 1) return unicos[0] ?? "";
  return `${unicos.slice(0, -1).join(", ")} e ${unicos[unicos.length - 1]}`;
}

/** "hoje às 15h20" / "ontem às 9h05" / "12/03 às 18h40". */
function quando(epoch: number, agora: number = Date.now()): string {
  const d = new Date(epoch);
  const hora = `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;
  const dia = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const diff = Math.round((dia(agora) - dia(epoch)) / 86_400_000);
  if (diff === 0) return `hoje às ${hora}`;
  if (diff === 1) return `ontem às ${hora}`;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} às ${hora}`;
}

// --------------------------------------------------------------------- tempo

/**
 * Estado da sessão de hoje + o botão que devolve tempo.
 *
 * Por que ele mora AQUI e não numa tela da criança: se "mais um tempinho"
 * estivesse a um toque de distância, o limite não seria limite. Atrás do hold
 * de 3 segundos, quem libera é o adulto — de propósito.
 */
function Tempo({
  config,
  aoLiberar,
  recado,
}: {
  config: Config;
  aoLiberar: () => void;
  recado: string | null;
}) {
  const limite = limiteEmMs(config.limiteSessaoMin);
  // `lerSessao` (e não `sessaoAtual`): abrir o relatório não pode ligar o
  // relógio da criança.
  const sessao = lerSessao();
  const falta = sessao ? faltaMs(sessao, limite) : null;

  const estado =
    limite === null
      ? "" // frase já cobre "limite desligado" — nada a completar aqui.
      : sessao === null
        ? "Nenhuma sessão aberta agora — o relógio começa quando a criança entrar num jogo."
        : sessao.encerradaEm !== null
          ? "A brincadeira de hoje já se encerrou com a despedida."
          : falta !== null && falta <= 0
            ? "O tempo acabou — o personagem se despede assim que a rodada atual terminar."
            : `Faltam cerca de ${Math.ceil((falta ?? 0) / 60_000)} min desta sessão.`;

  return (
    <section className={estilos.tempo} data-teste="sessao">
      <h2 className={estilos.tituloEixo}>Tempo de brincadeira</h2>
      <p className={estilos.frase}>
        {limite === null
          ? "Limite de tempo desligado (ajustável no painel)."
          : `Limite de ${config.limiteSessaoMin} min por sessão (ajustável no painel). ${estado}`}
      </p>
      <p className={estilos.detalhe}>
        Quando o tempo acaba, o jogo espera a rodada terminar e um personagem se
        despede — a criança não vê relógio nenhum.
      </p>
      <button type="button" className={estilos.botao} onClick={aoLiberar} data-teste="liberar-sessao">
        Liberar mais um tempinho
      </button>
      {recado ? (
        <output className={estilos.recado} aria-live="polite">
          {recado}
        </output>
      ) : null}
    </section>
  );
}
