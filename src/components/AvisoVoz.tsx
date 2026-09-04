"use client";

/**
 * Quando o `speechSynthesis` do navegador trava (watchdog em `game/fala.ts`,
 * `assinarSaudeDaVoz`), o jogo simplesmente fica mudo — para uma criança de
 * 3 anos isso não é um problema que ela resolve sozinha, e sem aviso nenhum
 * o adulto também não descobre o motivo. A única correção real é fechar e
 * abrir o navegador de novo (reinicia o `speechSynthesis`), então o aviso
 * já entrega essa instrução em vez de um erro genérico.
 *
 * Dirigido ao adulto, não à criança: fica pequeno, no canto, e pode ser
 * dispensado. Mas "dispensado" não é "resolvido" — se o adulto fechar e a
 * voz continuar travada, o aviso não deve reaparecer sozinho (senão vira
 * spam a cada poucos segundos); já se a voz voltar e travar de novo depois,
 * é um problema novo e o aviso deve reaparecer. Por isso o dismiss é
 * resetado a cada notificação do watchdog, não só na primeira.
 *
 * Client-only e com estado inicial "disponível": o watchdog só existe no
 * browser, então isto nunca deve tentar renderizar o aviso no servidor.
 */

import { useEffect, useState } from "react";
import { assinarSaudeDaVoz } from "@/game/fala";
import styles from "./AvisoVoz.module.css";

export function AvisoVoz() {
  const [indisponivel, setIndisponivel] = useState(false);
  const [dispensado, setDispensado] = useState(false);

  useEffect(() => {
    return assinarSaudeDaVoz((novoIndisponivel) => {
      setIndisponivel(novoIndisponivel);
      // Toda notificação é uma mudança de estado (o watchdog só chama de
      // novo quando o valor muda) — resetar aqui garante tanto o "reaparece
      // se travar de novo" quanto zera o dismiss quando a voz se recupera.
      setDispensado(false);
    });
  }, []);

  if (!indisponivel || dispensado) return null;

  return (
    <div className={styles.aviso} role="status" aria-live="polite">
      <p className={styles.texto}>A voz do navegador travou. Feche e abra o navegador para o som voltar.</p>
      <button
        type="button"
        className={styles.fechar}
        aria-label="Dispensar aviso"
        onClick={() => setDispensado(true)}
      >
        ✕
      </button>
    </div>
  );
}
