"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { baixarParaAparelho, nuvemConfigurada } from "@/lib/nuvem";
import { adotarFamilia, ehUuid, familiaDaNuvem } from "@/lib/sincronia";
import { listarPersonagens } from "@/lib/db";
import estilos from "./entrar.module.css";

/**
 * A ponta do link que o adulto manda para o tablet.
 *
 * `/entrar?familia=<uuid>` baixa a família da nuvem para o IndexedDB DESTE
 * aparelho e sai da frente. Não há login: o uuid da família é a credencial (é
 * o desenho do backend — ver `supabase/README.md`), porque quem abre isto é uma
 * criança de dois anos com o tablet na mão.
 *
 * ESTA TELA NÃO TEM ERRO. Quem abre um link é criança, e "Não consegui falar
 * com a nuvem" não significa nada para ela. Então TODO caminho ruim — link sem
 * uuid, uuid torto, família que não existe, tablet sem rede e sem cache —
 * termina em silêncio no modo local:
 *
 *   já tem familiares no aparelho  -> home ("/"), o jogo de sempre
 *   não tem ninguém                -> "/jogo/familia", que é o CONVITE AO
 *                                     ADULTO que já existe (não inventamos
 *                                     outra tela de aviso)
 *
 * OFFLINE COM CACHE: se este aparelho já é desta família (o uuid está na
 * `config`) e já tem gente no IndexedDB, nem tentamos a rede — vai direto para
 * "pronto". É o segundo dia de uso do tablet no carro, sem sinal.
 *
 * O `?familia=` é lido de `window.location` dentro de um efeito, e não com
 * `useSearchParams`, para a rota continuar pré-renderizada sem Suspense.
 */
export default function EntrarPage() {
  const router = useRouter();
  const [fase, setFase] = useState<"lendo" | "baixando" | "pronto">("lendo");
  const [andamento, setAndamento] = useState<{ feitos: number; total: number } | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);
  // StrictMode monta o efeito duas vezes em dev; o download é idempotente, mas
  // não há por que baixar tudo de novo.
  const jaRodou = useRef(false);

  /** Saída silenciosa para o jogo local. Nunca mostra motivo — ver o topo. */
  const caiParaLocal = useCallback(async () => {
    let temGente = false;
    try {
      temGente = (await listarPersonagens()).length > 0;
    } catch {
      temGente = false;
    }
    router.replace(temGente ? "/" : "/jogo/familia");
  }, [router]);

  const entrar = useCallback(async () => {
    // 1) O uuid vem do link; se o link não trouxer, vale o que este aparelho
    //    já guardou na config (item 5 do brief: não depender do parâmetro).
    const daUrl = new URLSearchParams(window.location.search).get("familia");
    const id = ehUuid(daUrl) ? daUrl.trim() : await familiaDaNuvem();
    if (!ehUuid(id) || !nuvemConfigurada()) {
      await caiParaLocal();
      return;
    }

    // 2) Este aparelho já é desta família e tem elenco? Então há cache.
    let temCache = false;
    try {
      const [lembrada, elenco] = await Promise.all([familiaDaNuvem(), listarPersonagens()]);
      temCache = lembrada === id && elenco.length > 0;
    } catch {
      temCache = false;
    }

    const semRede = typeof navigator !== "undefined" && navigator.onLine === false;
    if (temCache && semRede) {
      // Offline com cache: a família já mora aqui, é só jogar.
      setResumo("A família já está neste aparelho.");
      setFase("pronto");
      return;
    }

    setFase("baixando");
    setAndamento({ feitos: 0, total: 0 });
    try {
      const r = await baixarParaAparelho(id, {
        aoProgredir: (feitos, total) => setAndamento({ feitos, total }),
      });
      // Guarda o uuid na config e MESCLA o álbum da nuvem com o daqui, antes
      // de qualquer envio — assim este aparelho não zera o que o outro ganhou.
      await adotarFamilia(id, r.progresso);

      const partes: string[] = [];
      if (r.importados > 0) partes.push(`${r.importados} chegaram`);
      if (r.atualizados > 0) partes.push(`${r.atualizados} atualizados`);
      if (r.falhas.length > 0) partes.push(`${r.falhas.length} não vieram`);
      if (partes.length === 0 && !temCache) {
        // Família vazia na nuvem e nada aqui: o adulto precisa cadastrar.
        await caiParaLocal();
        return;
      }
      setResumo(partes.length > 0 ? partes.join(", ") + "." : "A família já está neste aparelho.");
      setFase("pronto");
    } catch {
      // Rede caiu, família apagada, link velho: se dá para jogar, joga.
      if (temCache) {
        setResumo("A família já está neste aparelho.");
        setFase("pronto");
        return;
      }
      await caiParaLocal();
    }
  }, [caiParaLocal]);

  useEffect(() => {
    if (jaRodou.current) return;
    jaRodou.current = true;
    // O setState mora no `.then` (e não no corpo do efeito) para não disparar
    // render em cascata — mesmo padrão do painel dos pais.
    void Promise.resolve().then(entrar);
  }, [entrar]);

  return (
    <main className={`tela ${estilos.tela}`}>
      <h1 className="titulo">Trazendo a família</h1>

      {fase === "lendo" && <p className={estilos.texto}>Um instante…</p>}

      {fase === "baixando" && (
        <p className={estilos.texto} role="status" data-teste="entrar-andamento">
          {andamento && andamento.total > 0
            ? `Baixando ${andamento.feitos} de ${andamento.total}…`
            : "Procurando a família…"}
        </p>
      )}

      {fase === "pronto" && (
        <>
          <p className={estilos.texto} role="status" data-teste="entrar-pronto">
            Pronto! {resumo}
          </p>
          <p className={estilos.texto}>
            Daqui para a frente o jogo funciona sem internet. Os personagens de desenho
            não vêm pela nuvem — se quiser, importe as imagens na área dos pais.
          </p>
          <div className={estilos.acoes}>
            <Link href="/" className={`${estilos.botao} ${estilos.botaoPrimario}`}>
              Começar a jogar
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
