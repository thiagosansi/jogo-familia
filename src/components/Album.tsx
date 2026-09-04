"use client";

/**
 * <Album> — as figurinhas conquistadas, coladas no vidro do aquário.
 * =============================================================================
 *
 * É o fecho do laço de motivação do jogo, e ele é DELIBERADAMENTE sem número:
 * a criança de 3 anos não lê "12/20". O que ela entende é o aquário dela
 * enchendo — cada rodada concluída cola mais um bichinho no vidro, e o
 * bichinho continua lá amanhã.
 *
 * DECISÕES
 * --------
 * 1. **Nada é redesenhado.** As figurinhas reaproveitam a arte que já existe:
 *    `<ObjetoMar>` (cores), `<Bicho>` (animais) e `<Personagem>` (as fotos da
 *    família). `@/game/recompensa` traduz o id gravado no banco em desenho.
 * 2. **Figurinha nova não cobre as antigas.** A ordem é a de conquista e cada
 *    índice tem o seu slot (`slotFigurinha`) — quem chega entra num lugar
 *    vazio. Como o slot depende do índice, e não de sorteio, o álbum reabre
 *    IDÊNTICO depois de um reload.
 * 3. **No aquário elas não recebem toque** (`pointer-events: none`): o modo
 *    livre é para cutucar os moradores, e uma figurinha por cima roubaria o
 *    toque da criança. O rótulo acessível continua lá para leitor de tela.
 * 4. **Falha em silêncio.** Sem banco (aba anônima, quota), o álbum some e o
 *    aquário continua funcionando — recompensa é bônus, nunca requisito.
 */

import { useEffect, useMemo, useState } from "react";
import { Bicho } from "@/components/bichos/Bicho";
import { ObjetoMar } from "@/components/objetos/ObjetoMar";
import { Personagem } from "@/components/Personagem";
import {
  desenhoDaFigurinha,
  eixoDaFigurinha,
  nomeDaFigurinha,
  ordenarFigurinhas,
  slotFigurinha,
  type DesenhoFigurinha,
} from "@/game/recompensa";
import { getProgresso, listarPersonagens } from "@/lib/db";
import type { Eixo, Figurinha, Personagem as Pessoa } from "@/lib/tipos";
import estilos from "./Album.module.css";

export interface DadosAlbum {
  figurinhas: Figurinha[];
  /** id do personagem → registro (nome + foto), para o eixo família. */
  pessoas: Map<string, Pessoa>;
  /** `null` enquanto carrega — deixe a tela sem álbum, nunca com "carregando". */
  carregando: boolean;
}

/**
 * Lê figurinhas + família do IndexedDB. Exportado porque o relatório dos pais
 * usa os mesmos dados sem renderizar o aquário.
 */
export function useAlbum(ativo: boolean = true): DadosAlbum {
  const [figurinhas, setFigurinhas] = useState<Figurinha[]>([]);
  const [pessoas, setPessoas] = useState<Map<string, Pessoa>>(() => new Map());
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    // `ativo: false` = quem chamou já tem os dados (o relatório lê uma vez e
    // passa para os quatro cartões). Evita quatro leituras do IndexedDB.
    if (!ativo) return;
    let vivo = true;
    void Promise.all([getProgresso(), listarPersonagens().catch(() => [] as Pessoa[])])
      .then(([progresso, elenco]) => {
        if (!vivo) return;
        setFigurinhas(ordenarFigurinhas(progresso.figurinhas));
        setPessoas(new Map(elenco.map((p) => [p.id, p])));
      })
      .catch(() => {})
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [ativo]);

  return { figurinhas, pessoas, carregando };
}

export interface AlbumProps {
  /**
   * `aquario`: coladas no vidro, espalhadas na moldura do tanque, sem toque.
   * `grade`: fileira compacta — é a forma usada no relatório do adulto.
   */
  variante?: "aquario" | "grade";
  /** Só as figurinhas deste eixo (o relatório mostra um eixo por cartão). */
  eixo?: Eixo;
  /** Dados já carregados (evita reler o banco quando a tela já leu). */
  dados?: DadosAlbum;
  className?: string;
}

export function Album({ variante = "aquario", eixo, dados, className }: AlbumProps) {
  const proprios = useAlbum(dados === undefined);
  const { figurinhas, pessoas } = dados ?? proprios;

  const nomes = useMemo(
    () => new Map([...pessoas].map(([id, p]) => [id, p.nome])),
    [pessoas],
  );

  const lista = useMemo(
    () =>
      eixo
        ? figurinhas.filter((f) => (eixoDaFigurinha(f.id) ?? f.eixo) === eixo)
        : figurinhas,
    [figurinhas, eixo],
  );

  if (lista.length === 0) return null;

  if (variante === "grade") {
    return (
      <ul className={[estilos.grade, className].filter(Boolean).join(" ")}>
        {lista.map((f) => (
          <li key={f.id} className={estilos.itemGrade}>
            <span className={estilos.figurinha} title={nomeDaFigurinha(f.id, nomes)}>
              <DesenhoDe id={f.id} pessoas={pessoas} nomes={nomes} />
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div
      className={[estilos.vidro, className].filter(Boolean).join(" ")}
      // Decoração colada no vidro: não intercepta o toque nos moradores.
      role="list"
      aria-label="Figurinhas do aquário"
      data-teste="album"
    >
      {lista.map((f, i) => {
        const slot = slotFigurinha(i);
        const nova = i === lista.length - 1;
        return (
          <span
            key={f.id}
            role="listitem"
            aria-label={nomeDaFigurinha(f.id, nomes)}
            data-teste={`figurinha-${f.id}`}
            className={[estilos.colada, nova ? estilos.colando : ""].filter(Boolean).join(" ")}
            style={
              {
                insetInlineStart: `${slot.x}%`,
                insetBlockStart: `${slot.y}%`,
                "--giro": `${slot.giro}deg`,
              } as React.CSSProperties
            }
          >
            <span className={estilos.figurinha}>
              <DesenhoDe id={f.id} pessoas={pessoas} nomes={nomes} />
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ desenhos

function DesenhoDe({
  id,
  pessoas,
  nomes,
}: {
  id: string;
  pessoas: Map<string, Pessoa>;
  nomes: Map<string, string>;
}) {
  const desenho = desenhoDaFigurinha(id);
  return <Traco desenho={desenho} pessoas={pessoas} rotulo={nomeDaFigurinha(id, nomes)} />;
}

function Traco({
  desenho,
  pessoas,
  rotulo,
}: {
  desenho: DesenhoFigurinha;
  pessoas: Map<string, Pessoa>;
  rotulo: string;
}) {
  switch (desenho.tipo) {
    case "objeto":
      return <ObjetoMar forma={desenho.forma} cor={desenho.cor} />;

    case "cardume":
      // A quantidade É o desenho: a criança vê três peixinhos, não o "3".
      return (
        <span className={estilos.cardume} aria-hidden="true">
          {Array.from({ length: desenho.quantidade }, (_, i) => (
            <ObjetoMar key={i} forma={desenho.forma} cor={desenho.cor} giro={(i % 2) * 12 - 6} />
          ))}
        </span>
      );

    case "bicho":
      return <Bicho qual={desenho.qual} />;

    case "pessoa": {
      const pessoa = pessoas.get(desenho.personagemId);
      // Familiar apagado do painel depois de virar figurinha: cai no mascote,
      // nunca num quadrado quebrado.
      return (
        <Personagem
          foto={pessoa?.fotoRecorte ?? null}
          nome={pessoa?.nome}
          rotulo={rotulo}
          tamanho="100%"
          animacao="idle"
        />
      );
    }

    case "mascote":
      return <Personagem mascote={desenho.qual} rotulo={rotulo} tamanho="100%" animacao="idle" />;
  }
}
