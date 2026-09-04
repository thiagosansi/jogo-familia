/**
 * <Saudacao> — os quatro desenhos de "saudações e cortesia" do modo de
 * inglês (`hello`, `bye bye`, `thank you`, `please`). ARTE ORIGINAL, SVG
 * inline (nada de emoji: emoji muda de traço em cada sistema operacional, e
 * aqui o traço precisa ser sempre o mesmo).
 *
 *   <Saudacao qual="hello" />
 *   <Saudacao qual="please" cor="var(--color-agua)" tamanho="120px" />
 *
 * DIFERENTE de <ObjetoMar>/<Bicho>: aqui o rótulo acessível SEMPRE vem do
 * `<BotaoAlternativa>` que envolve o desenho — por isso não existe prop
 * `rotulo` e o `<svg>` é `aria-hidden` incondicional.
 *
 * O PROBLEMA QUE ESTE COMPONENTE RESOLVE: "hello" e "bye bye" são as duas,
 * literalmente, uma mão acenando — se o desenho fosse só a mão, a criança de
 * 3 anos (que não lê) não tem como escolher a certa. A saída é dar a cada
 * saudação uma CENA com silhueta própria, não só uma cor diferente:
 *   - hello:     mão acenando + SOL nascendo (círculo com raios)
 *   - bye bye:   mão acenando + LUA minguante + estrelas
 *   - thank you: coração oferecido sobre duas mãos em concha
 *   - please:    duas mãos unidas em prece, dedos afunilando pra ponta no
 *                topo — só a silhueta das mãos, sem carinha (uma cabeça em
 *                cima das mãos lia como bicho, não como o gesto de pedir)
 * Sol×lua e coração×mãos-unidas são silhuetas que se distinguem em preto e
 * branco, sem depender de cor — é o requisito de acessibilidade do jogo
 * (mesma regra do daltonismo que rege `<ObjetoMar>`).
 *
 * COMO A COR ENTRA: cada saudação tem uma cor-tema (token de `globals.css`),
 * usada só no elemento principal via `currentColor`; os detalhes (raios,
 * estrelas, brilho) vêm do CSS Module com `color-mix(... currentColor ...)`,
 * igual ao padrão de `<ObjetoMar>` — nunca `fill="var(--x)"` direto num
 * presentation attribute, porque isso não resolve custom property.
 */

import estilos from "./saudacoes.module.css";

export type IdSaudacao = "hello" | "byeBye" | "thankYou" | "please";

export interface SaudacaoProps {
  qual: IdSaudacao;
  /** Qualquer cor CSS (idealmente um token de `globals.css`). */
  cor?: string;
  /** Tamanho do quadro (qualquer valor CSS). Padrão: 100% do container. */
  tamanho?: string;
  className?: string;
}

/**
 * Cor-tema padrão por saudação — sempre um token, nunca hex solto. Os quatro
 * tokens escolhidos (areia/água/coral/alga) são os mais claros da paleta:
 * o fundo do jogo é o mar escuro (`--color-mar-900/800`), e um tom escuro
 * como `--color-mar-500` quase some contra ele (confirmado visualmente com
 * filtro grayscale — ver DoD).
 */
const COR_PADRAO: Record<IdSaudacao, string> = {
  hello: "var(--color-areia)",
  byeBye: "var(--color-agua)",
  thankYou: "var(--color-coral)",
  please: "var(--color-alga)",
};

export function Saudacao({ qual, cor, tamanho, className }: SaudacaoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={[estilos.saudacao, className].filter(Boolean).join(" ")}
      style={{
        color: cor ?? COR_PADRAO[qual],
        inlineSize: tamanho ?? "100%",
        blockSize: tamanho ? "auto" : "100%",
      }}
      focusable="false"
      aria-hidden
    >
      <g className={estilos.contorno}>{DESENHOS[qual]()}</g>
    </svg>
  );
}

/**
 * Mão acenando, reutilizada por `hello` e `byeBye` de propósito: a distinção
 * entre as duas NÃO pode estar na mão (senão vira "duas mãos acenando"), tem
 * que estar na cena ao redor (sol × lua). `espelhar` vira a mão de lado.
 */
function MaoAcenando({ cx, espelhar = false }: { cx: number; espelhar?: boolean }) {
  const s = espelhar ? -1 : 1;
  return (
    <g transform={`translate(${cx} 40) scale(${s} 1)`} fill="currentColor">
      {/* punho + palma */}
      <path d="M-11 34 L-13 6 Q-13 -4 -2 -4 L10 -4 Q19 -4 19 6 L19 30 Q19 36 12 36 L-4 36 Z" strokeLinejoin="round" />
      {/* dedos, abertos em leque (aceno animado) */}
      <g strokeLinecap="round" strokeLinejoin="round">
        <path d="M-9 -3 Q-15 -20 -7 -23 Q-1 -20 -3 -2" />
        <path d="M0 -4 Q-2 -24 6 -25 Q13 -22 8 -3" />
        <path d="M9 -3 Q10 -22 18 -21 Q24 -17 15 -2" />
        <path d="M17 2 Q22 -12 29 -8 Q33 -3 21 8" />
      </g>
    </g>
  );
}

/** Círculo com raios triangulares — sol nascendo, cena de `hello`. */
function Sol() {
  return (
    <g>
      <g className={estilos.detalhe} strokeLinecap="round" strokeWidth="6">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((graus) => (
          <line
            key={graus}
            x1="0"
            y1="-24"
            x2="0"
            y2="-33"
            transform={`rotate(${graus})`}
          />
        ))}
      </g>
      <circle r="18" fill="currentColor" />
    </g>
  );
}

/**
 * Lua minguante + estrelas — cena de `byeBye`, contraste direto com o sol.
 *
 * A lua é o elemento que DISTINGUE `byeBye` de `hello` (a mão é a mesma nas
 * duas cenas) — por isso o crescente usa `currentColor` cheio, igual ao sol,
 * nunca uma cor "de detalhe" escurecida. O crescente é dois arcos que
 * compartilham as mesmas duas pontas (topo/base): o arco externo é um
 * semicírculo raso raio 20 (a curva funda), o interno é um arco de raio 32
 * bem mais achatado — a área ENTRE os dois arcos é a foice. Bug da versão
 * anterior: o arco interno tinha raio 15.5, MENOR que a metade da corda (20)
 * — geometricamente inválido, o SVG corrige forçando os dois raios a ficarem
 * quase iguais, e a foice degenerava numa lasca fina, mais fina que a
 * `stroke-width` do contorno (4 unidades): o contorno escuro comia a lua
 * inteira, sobrando só um traço apagado. Com raio interno > metade da corda,
 * a foice fica genuinamente grossa (~13 unidades no meio), sobrando bastante
 * `currentColor` por dentro do contorno.
 */
function Lua() {
  return (
    <g>
      <path
        d="M0 -20 A20 20 0 1 0 0 20 A32 32 0 0 1 0 -20 Z"
        fill="currentColor"
        strokeLinejoin="round"
      />
      {/* estrelas: aqui sim são detalhe de verdade — a lua sozinha já lê como
          lua, as estrelas só decoram, então podem usar a cor escurecida. */}
      <g className={estilos.detalheCheio}>
        <path d="M-30 -12 l2.6 5.4 5.4 2.6 -5.4 2.6 -2.6 5.4 -2.6 -5.4 -5.4 -2.6 5.4 -2.6 Z" />
        <path d="M-8 -28 l1.8 3.6 3.6 1.8 -3.6 1.8 -1.8 3.6 -1.8 -3.6 -3.6 -1.8 3.6 -1.8 Z" />
      </g>
    </g>
  );
}

/** Coração oferecido sobre duas mãos em concha — cena de `thankYou`. */
function Coracao() {
  return (
    <g>
      {/* mãos em concha, embaixo */}
      <g fill="currentColor" className={estilos.maosBase}>
        <path d="M14 66 Q4 60 6 46 Q8 36 20 38 L40 44 Q46 48 44 58 Q42 68 30 68 Z" />
        <path d="M86 66 Q96 60 94 46 Q92 36 80 38 L60 44 Q54 48 56 58 Q58 68 70 68 Z" />
      </g>
      {/* coração */}
      <path
        d="M50 62 C24 42 30 14 48 20 C50 21 50 24 50 26 C50 24 50 21 52 20 C70 14 76 42 50 62 Z"
        fill="currentColor"
        strokeLinejoin="round"
      />
      <path
        d="M40 26 Q44 22 48 26"
        className={estilos.brilhoTraco}
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}

/**
 * Uma das duas mãos unidas de `please`: dedos afunilando pra um bico no topo
 * (a curva que fecha em ponta em vez de um retângulo de topo reto — é o que
 * lê como "dedos juntos apontando pra cima", não como bastão nem como
 * membro genérico de bicho) + polegar saindo pro lado de fora, o detalhe que
 * faz a forma ler como MÃO. Duas linhas finas (cor de detalhe, puramente
 * decorativas) sugerem a separação dos dedos sem virar dedos individuais
 * ilegíveis no alvo mínimo de 88px.
 */
function MaoRezando({ espelhar = false }: { espelhar?: boolean }) {
  const s = espelhar ? -1 : 1;
  return (
    <g transform={`scale(${s} 1)`} fill="currentColor" strokeLinejoin="round">
      <path d="M9 0 C4 0 1 6 1 16 L1 48 Q1 58 10 58 Q19 58 19 48 L19 16 C19 6 14 0 9 0 Z" />
      <ellipse cx="21" cy="40" rx="7.5" ry="5.5" transform="rotate(-20 21 40)" />
      <g className={estilos.detalhe} fill="none" strokeWidth="2" strokeLinecap="round">
        <path d="M7 8 L7 34" />
        <path d="M13 8 L13 34" />
      </g>
    </g>
  );
}

/**
 * Duas mãos unidas em prece, dedos pra cima e punhos pra baixo (o OPOSTO do
 * coração de `thankYou`, que tem a ponta embaixo) — SEM carinha. A versão
 * anterior coroava as mãos com uma cabecinha (círculo + dois olhos grandes),
 * e numa tela de 3 anos isso lê como cabeça+olhos de um bicho, com as mãos
 * virando corpo/pernas por baixo — o rosto dominava a silhueta e brigava com
 * o gesto. Tirando a carinha, a silhueta fechada e simétrica das duas mãos
 * (afuniladas, ponta pra cima) passa a ser o quadro inteiro: sozinha, sem
 * rótulo, lê como "mãos pedindo". Cena de `please`.
 */
function MaosUnidas() {
  return (
    <g transform="translate(50 19)">
      <MaoRezando />
      <MaoRezando espelhar />
      {/* costura central: onde as duas mãos se encostam */}
      <rect x="-1.5" y="10" width="3" height="46" className={estilos.detalheCheio} />
    </g>
  );
}

/** Um desenho por saudação. Record garante que todo `IdSaudacao` tem arte. */
const DESENHOS: Record<IdSaudacao, () => React.ReactNode> = {
  hello: () => (
    <>
      <g transform="translate(38 44)">
        <Sol />
      </g>
      <MaoAcenando cx={64} />
    </>
  ),
  byeBye: () => (
    <>
      <g transform="translate(62 44)">
        <Lua />
      </g>
      <MaoAcenando cx={36} espelhar />
    </>
  ),
  thankYou: () => <Coracao />,
  please: () => <MaosUnidas />,
};
