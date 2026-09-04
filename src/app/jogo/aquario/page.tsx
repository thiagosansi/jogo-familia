import { redirect } from "next/navigation";

/**
 * O card da home aponta para `/jogo/aquario` (junto dos mini-jogos), mas o
 * aquário NÃO é um mini-jogo: não tem rodada, engine nem objetivo. Ele mora em
 * `/aquario`, e esta rota só existe para o link da home continuar válido.
 */
export default function AquarioNoJogo() {
  redirect("/aquario");
}
