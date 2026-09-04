"use client";

/**
 * <Despedida> — o ritual de fim de sessão.
 *
 * Quando o tempo combinado acaba (ver `@/game/sessao`), quem encerra NÃO é um
 * aviso, um cadeado ou uma tela preta: é um personagem acenando e dizendo
 * "Tchau! Até amanhã!". Aos 3 anos isso é a diferença entre entregar o tablet
 * e um choro de dez minutos — o fim vira parte da brincadeira, não uma punição.
 *
 * DECISÕES
 * --------
 * 1. **Não corta o que está tocando.** A fala entra na fila com prioridade
 *    `normal` (nunca `alta`): a comemoração da última rodada termina, e só
 *    então o tchau sai. O componente também só volta para a home DEPOIS que a
 *    fila esvazia — com um piso de tempo, para o aceno aparecer mesmo num
 *    aparelho mudo, e um teto, para nunca ficar preso se o áudio falhar.
 * 2. **Sem botão.** Não há "continuar mesmo assim": a saída é automática. Quem
 *    libera mais tempo é o adulto, atrás do portão (`/pais/progresso`).
 * 3. **Cobre a tela inteira** (`position: fixed`) para a criança não continuar
 *    tocando no jogo por baixo enquanto o personagem se despede.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Personagem } from "@/components/Personagem";
import { filaDeFala } from "@/game/fala";
import estilos from "./Despedida.module.css";

/** Chave da fala — identidade lógica, para reconhecer o fim dela na fila. */
const CHAVE = "sessao:despedida";
const FRASE = "Tchau! Até amanhã!";

/** Piso: o aceno precisa aparecer inteiro, mesmo sem áudio nenhum. */
const MIN_MS = 2800;
/** Teto: áudio travado (iOS sem desbloqueio, TTS ausente) não prende a criança. */
const MAX_MS = 9000;
/** Respiro depois que a voz termina, antes de voltar para a home. */
const RESPIRO_MS = 900;

export function Despedida({ frase = FRASE }: { frase?: string }) {
  const router = useRouter();
  const [entrou, setEntrou] = useState(false);

  useEffect(() => {
    // Um frame depois: a transição de entrada precisa de um estado inicial
    // pintado para animar a partir dele.
    const quadro = requestAnimationFrame(() => setEntrou(true));
    const inicio = Date.now();
    let saindo = false;
    // Todo timer criado aqui é cancelado no cleanup: um `router.replace` depois
    // do unmount jogaria a criança para a home no meio de outra tela.
    const timers: ReturnType<typeof setTimeout>[] = [];
    const agendar = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));

    const sair = () => {
      if (saindo) return;
      saindo = true;
      agendar(() => router.replace("/"), Math.max(0, MIN_MS - (Date.now() - inicio)));
    };

    // `normal`: entra ATRÁS do que estiver tocando. Nunca `alta` — cortar a
    // comemoração da criança para dizer tchau é exatamente o que não fazer.
    filaDeFala.falar({ chave: CHAVE, texto: frase, prioridade: "normal" });

    let jaFalou = false;
    const parar = filaDeFala.assinar(({ falando, chave }) => {
      if (chave === CHAVE) jaFalou = true;
      // Silêncio depois do nosso tchau = pode ir embora.
      if (jaFalou && !falando) agendar(sair, RESPIRO_MS);
    });

    agendar(sair, MAX_MS);

    return () => {
      cancelAnimationFrame(quadro);
      parar();
      for (const t of timers) clearTimeout(t);
      filaDeFala.cancelar();
    };
  }, [router, frase]);

  return (
    <div className={estilos.cortina} data-entrou={entrou} data-teste="despedida" role="alertdialog" aria-label={frase}>
      <div className={estilos.aceno}>
        <Personagem
          mascote="polvo"
          animacao="pulo"
          seguirFala
          tamanho="clamp(140px, 34vmin, 320px)"
          corAro="var(--color-areia)"
          rotulo="polvo se despedindo"
        />
      </div>
      {/* Reforço para o adulto e para leitor de tela — a criança OUVE o tchau. */}
      <p className={estilos.frase}>{frase}</p>
      <p className={estilos.rodape}>A brincadeira de hoje acabou.</p>
    </div>
  );
}
