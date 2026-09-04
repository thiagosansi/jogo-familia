"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { filtrarPorIdsAtivos, getConfig } from "@/lib/db";

/**
 * Home do jogo.
 *
 * Regra de UX: a criança de 3 anos NÃO lê. A navegação inteira funciona por
 * ilustração + cor + posição fixa. O texto abaixo de cada desenho é reforço
 * para o adulto e para leitores de tela — remova o texto e a tela continua
 * navegável. Todos os alvos respeitam --toque-min (88px) via .card-modo /
 * .botao-pais em globals.css.
 *
 * MODOS: quais cards aparecem depende de `Config.modosAtivos` (IndexedDB,
 * lido em `useIdsAtivos` abaixo). Cada modo tem um `id` estável — o
 * casamento com `modosAtivos` é por esse id, nunca pelo texto do rótulo, que
 * é só reforço visual e pode mudar sem afetar a config salva. A leitura é
 * assíncrona e client-only, e a home NUNCA fica vazia: erro ao ler a config
 * ou filtro sem nenhum sobrevivente mostram todos os modos (ver
 * `filtrarPorIdsAtivos` em `src/lib/db.ts`). Por isso a página é client
 * component: precisa da fronteira de "use client" pra rodar o IndexedDB, e
 * evita a piscada de mostrar a grade inteira e trocar depois — enquanto a
 * config não chega, a tela fica só com o fundo (ver `useIdsAtivos`).
 */

type Modo = {
  id: string;
  href: string;
  rotulo: string;
  cor: string;
  icone: React.ReactNode;
};

const MODOS: Modo[] = [
  {
    id: "familia",
    href: "/jogo/familia",
    rotulo: "Família",
    cor: "var(--color-coral)",
    icone: (
      <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <g fill="#2b1006">
          <circle cx="34" cy="28" r="17" />
          <path d="M8 92a26 26 0 0 1 52 0z" />
          <circle cx="86" cy="30" r="15" />
          <path d="M63 92a23 23 0 0 1 46 0z" />
          <circle cx="60" cy="52" r="12" />
          <path d="M41 92a19 19 0 0 1 38 0z" />
        </g>
      </svg>
    ),
  },
  {
    id: "cores",
    href: "/jogo/cores",
    rotulo: "Cores",
    cor: "var(--color-areia)",
    icone: (
      <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <circle cx="44" cy="36" r="28" fill="#e63946" />
        <circle cx="76" cy="36" r="28" fill="#1c7fb8" opacity="0.9" />
        <circle cx="60" cy="64" r="28" fill="#2fbf71" opacity="0.9" />
      </svg>
    ),
  },
  {
    id: "contar",
    href: "/jogo/contar",
    rotulo: "Contar",
    cor: "var(--color-agua)",
    icone: (
      <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <g fill="#2b1006">
          <circle cx="24" cy="72" r="16" />
          <circle cx="60" cy="60" r="16" />
          <circle cx="60" cy="24" r="16" />
          <circle cx="96" cy="72" r="16" />
          <circle cx="96" cy="40" r="16" />
          <circle cx="96" cy="8" r="8" />
        </g>
      </svg>
    ),
  },
  {
    id: "numeros",
    href: "/jogo/numeros",
    rotulo: "Números",
    // Roxo anêmona: cor NOVA na paleta (ver `--color-anemona` em
    // globals.css). Todas as cores claras já eram cartão de algum modo, e as
    // escuras que sobravam (`--color-mar-700` e abaixo) apagavam o rótulo e o
    // desenho, que `.card-modo` escreve em `--color-tinta`. Roxo também não
    // repete tom com nenhum vizinho — Contar (`--color-agua`) de um lado,
    // Animais (`--color-alga`) do outro.
    cor: "var(--color-anemona)",
    icone: (
      // Ábaco: contas enfiadas em três varetas. Escolhido em vez de um
      // algarismo porque a home é navegada por DESENHO — a criança não lê, e
      // o "7" que este modo ensina é o conteúdo de dentro da rodada, não o
      // rótulo da porta. Também não repete o desenho do cartão "Contar"
      // (bolinhas em escada), que é o modo vizinho.
      <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <g fill="#2b1006">
          <rect x="6" y="6" width="12" height="84" rx="6" />
          <rect x="102" y="6" width="12" height="84" rx="6" />
          <rect x="14" y="20" width="92" height="8" rx="4" />
          <rect x="14" y="44" width="92" height="8" rx="4" />
          <rect x="14" y="68" width="92" height="8" rx="4" />
        </g>
        <g fill="#ffd166">
          <circle cx="34" cy="24" r="11" />
          <circle cx="58" cy="24" r="11" />
        </g>
        <g fill="#ff7a5c">
          <circle cx="34" cy="48" r="11" />
          <circle cx="58" cy="48" r="11" />
          <circle cx="82" cy="48" r="11" />
        </g>
        <g fill="#3ddad7">
          <circle cx="34" cy="72" r="11" />
        </g>
      </svg>
    ),
  },
  {
    id: "animais",
    href: "/jogo/animais",
    rotulo: "Animais",
    cor: "var(--color-alga)",
    icone: (
      <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <path
          d="M60 6c22 0 36 16 36 36v14c0 6-10 6-10 0v-6c0-5-8-5-8 0v10c0 6-10 6-10 0V50c0-5-8-5-8 0v10c0 6-10 6-10 0v-8c0-5-8-5-8 0v6c0 6-10 6-10 0V42C32 22 38 6 60 6z"
          fill="#2b1006"
        />
        <circle cx="47" cy="36" r="7" fill="#fdf6e3" />
        <circle cx="73" cy="36" r="7" fill="#fdf6e3" />
        <circle cx="48" cy="38" r="3.5" fill="#2b1006" />
        <circle cx="74" cy="38" r="3.5" fill="#2b1006" />
      </svg>
    ),
  },
  {
    id: "aquario",
    href: "/jogo/aquario",
    rotulo: "Aquário",
    cor: "var(--color-mar-500)",
    icone: (
      <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <rect x="8" y="10" width="104" height="78" rx="16" fill="#0e4d7a" />
        <rect
          x="8"
          y="10"
          width="104"
          height="78"
          rx="16"
          fill="none"
          stroke="#2b1006"
          strokeWidth="7"
        />
        <ellipse cx="54" cy="50" rx="22" ry="15" fill="#ff7a5c" />
        <path d="M76 50l16-12v24z" fill="#ff7a5c" />
        <circle cx="44" cy="46" r="3.5" fill="#2b1006" />
        <circle cx="88" cy="26" r="5" fill="#ffd166" />
        <circle cx="30" cy="72" r="6" fill="#ffd166" />
      </svg>
    ),
  },
  {
    id: "letras",
    href: "/jogo/letras",
    rotulo: "Letras",
    // Laranja tangerina: cor nova na paleta (mesma justificativa do
    // coral-escuro do Inglês, logo abaixo). O card nasceu lilás, com o mesmo
    // hex do roxo anêmona já usado por Números/Memória — duas cores iguais
    // com nomes diferentes. Trocado por um matiz inédito na paleta, que não
    // repete tom com os vizinhos na grade (Animais em `--color-alga`,
    // Aquário em `--color-mar-500`) nem com o roxo dos outros cards.
    cor: "var(--color-tangerina)",
    icone: (
      // Blocos de alfabeto (brinquedo reconhecível mesmo sem ler): dois
      // cubos com um glifo grande cada — "A" e "B" — a criança que ainda não
      // lê reconhece a FORMA do brinquedo; o glifo é reforço para quem já
      // está aprendendo a letra (o mesmo espírito do `<Album>`: a letra É o
      // desenho no modo "Letras", não um numeral proibido).
      <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <rect x="10" y="20" width="52" height="52" rx="10" fill="#fdf6e3" stroke="#2b1006" strokeWidth="6" transform="rotate(-6 36 46)" />
        <text x="36" y="46" transform="rotate(-6 36 46)" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-sans)" fontWeight="800" fontSize="34" fill="#2b1006">
          A
        </text>
        <rect x="58" y="26" width="52" height="52" rx="10" fill="#ffd166" stroke="#2b1006" strokeWidth="6" transform="rotate(7 84 52)" />
        <text x="84" y="52" transform="rotate(7 84 52)" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-sans)" fontWeight="800" fontSize="34" fill="#2b1006">
          B
        </text>
      </svg>
    ),
  },
  {
    id: "ingles",
    href: "/jogo/ingles",
    rotulo: "Inglês",
    // Coral-escuro: mais fechado que o coral da Família — precisava de uma
    // cor nova na paleta para não repetir tom com nenhum card vizinho.
    cor: "var(--color-coral-escuro)",
    icone: (
      // Papagaio: bicho que "repete a palavra que ouve" — a metáfora mais
      // concreta para "aqui a gente fala outro idioma" sem depender de
      // texto (a criança não lê, então nada de "ABC" ou bandeira, que ela
      // não reconheceria como "idioma diferente").
      <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <g fill="#2b1006">
          <ellipse cx="55" cy="55" rx="30" ry="25" />
          <circle cx="88" cy="30" r="18" />
        </g>
        <path d="M100 24 L118 30 L100 38 Z" fill="#ffd166" />
        <circle cx="92" cy="26" r="5" fill="#fdf6e3" />
        <circle cx="93" cy="27" r="2.5" fill="#2b1006" />
        <ellipse cx="30" cy="60" rx="22" ry="10" fill="#2fbf71" transform="rotate(-25 30 60)" />
        <ellipse cx="35" cy="78" rx="20" ry="9" fill="#3ddad7" transform="rotate(35 35 78)" />
      </svg>
    ),
  },
];

/**
 * Ids ativos vindos da config, prontos para `filtrarPorIdsAtivos`.
 *
 * `undefined` = ainda não sabemos (config não chegou) — o chamador NÃO deve
 * renderizar a grade nesse estado, senão mostra todos os modos e troca
 * assim que a config chegar (a piscada que este hook existe para evitar).
 * `null` = config não pôde ser lida (aba anônima, quota, storage bloqueado):
 * falha aberta, `filtrarPorIdsAtivos` trata `null` como "sem restrição".
 */
function useIdsAtivos(): string[] | null | undefined {
  const [idsAtivos, setIdsAtivos] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelado = false;
    getConfig()
      .then((config) => {
        if (!cancelado) setIdsAtivos(config.modosAtivos);
      })
      .catch(() => {
        if (!cancelado) setIdsAtivos(null);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  return idsAtivos;
}

export default function Home() {
  const idsAtivos = useIdsAtivos();

  // Config ainda não chegou: melhor a tela só com o fundo (mesmo padding e
  // classe `.tela` da grade final) do que mostrar todos os cards e trocar
  // por um subconjunto um instante depois — a criança não deve ver isso.
  if (idsAtivos === undefined) {
    return (
      <main className="tela" aria-busy="true">
        <h1 className="so-leitor">Fundo do Mar — escolha uma brincadeira</h1>
      </main>
    );
  }

  const modosVisiveis = filtrarPorIdsAtivos(MODOS, idsAtivos, (modo) => modo.id);

  return (
    <main className="tela">
      <h1 className="so-leitor">Fundo do Mar — escolha uma brincadeira</h1>

      <ul className="grade-modos">
        {modosVisiveis.map((modo) => (
          <li key={modo.href}>
            <Link
              href={modo.href}
              className="card-modo"
              style={{ "--cor": modo.cor } as React.CSSProperties}
              aria-label={modo.rotulo}
            >
              {modo.icone}
              {/* Reforço para o adulto — a criança navega pelo desenho. */}
              <span aria-hidden="true">{modo.rotulo}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Discreto e sem cor chamativa: é a porta do adulto, não da criança. */}
      <Link href="/pais" className="botao-pais" aria-label="Área dos pais">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
          <path d="M19.4 13a7.8 7.8 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3H9l-.3 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.8 7.8 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.8 1.7 1L9 21h6l.3-2.6c.6-.2 1.2-.6 1.7-1l2.4 1 2-3.4zM12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4z" />
        </svg>
      </Link>
    </main>
  );
}
