"use client";

/**
 * <Sincronia> — liga o espelho do progresso na nuvem. Não desenha nada.
 *
 * Fica no layout porque a criança troca de mini-jogo o tempo todo e o envio
 * precisa sobreviver a isso (o timer de agrupamento e a bandeira de pendência
 * moram no módulo, não na tela). É um efeito só, sem estado e sem render.
 *
 * Sem `NEXT_PUBLIC_SUPABASE_*` ou sem família adotada, `iniciarSincroniaDeProgresso`
 * devolve um desligamento vazio e nada acontece — o jogo segue 100% local.
 */

import { useEffect } from "react";
import { iniciarSincroniaDeProgresso } from "@/lib/sincronia";

export function Sincronia() {
  useEffect(() => iniciarSincroniaDeProgresso(), []);
  return null;
}
