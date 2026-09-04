/**
 * SINCRONIA DO PROGRESSO — o álbum da criança espelhado na nuvem, sem nunca
 * atrapalhar a brincadeira.
 * =============================================================================
 *
 * REGRA DE OURO: **local primeiro, rede depois.** `addFigurinha` já gravou no
 * IndexedDB quando este módulo fica sabendo; daqui para a frente é tudo
 * otimista e em segundo plano. Nenhuma rodada espera rede, nenhuma falha de
 * envio aparece na tela — a criança não pode ver a nuvem existindo.
 *
 * POR QUE NÃO DUPLICA FIGURINHA — idempotência em duas camadas:
 *  1. `addFigurinha` não repete um id que já está no álbum (camada local);
 *  2. `jogo_progresso_salvar` é um `insert ... on conflict do update` que
 *     SUBSTITUI a linha inteira pelo retrato local. Reenviar dez vezes o que
 *     foi ganho offline dá exatamente o mesmo resultado de enviar uma vez.
 *
 * Por isso a fila de envio é um BOOLEANO ("tem coisa nova para mandar"), e não
 * uma lista de eventos: o que sobe é sempre o retrato inteiro e atual do
 * progresso. Um evento perdido não perde nada; um evento repetido não soma
 * nada.
 *
 * O CUIDADO INVERSO: substituir a linha significa que um aparelho poderia
 * apagar da nuvem o que outro conquistou. Por isso a adoção da família
 * (`adotarFamilia`, chamada em `/entrar`) MESCLA o que está na nuvem com o que
 * está no aparelho ANTES do primeiro envio. Depois disso o aparelho da criança
 * é a fonte da verdade daquela família.
 *
 * Fluxo completo:
 *
 *   /entrar?familia=<uuid> --> adotarFamilia() --> config.familiaNuvemId
 *                                             --> mescla progresso da nuvem
 *   jogo --> addFigurinha --> aoMudarProgresso --> agenda envio (2,5 s)
 *   sem rede --> marca pendente --> volta a rede ('online') --> envia tudo
 */
import { aoMudarProgresso, getConfig, getProgresso, gravarProgresso, setConfig } from "./db.ts";
import { carregarFamilia, enviarProgresso, nuvemConfigurada } from "./nuvem.ts";
import type { AcertosEixo, Eixo, Figurinha, Progresso } from "./tipos.ts";

/** Espera antes de mandar: junta a rajada de figurinhas de uma sessão. */
export const ESPERA_ENVIO_MS = 2_500;

/** Bandeira "tem progresso não enviado". Sobrevive a reload; some com o app. */
const CHAVE_PENDENTE = "jogo-familia:progresso-pendente";

// ------------------------------------------------------------------ uuid

/** O uuid da família é a credencial. Qualquer outra coisa é link torto. */
export function ehUuid(valor: string | null | undefined): valor is string {
  return (
    typeof valor === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor.trim())
  );
}

// --------------------------------------------------------------- mesclagem

/** O que a RPC devolve dentro de `progresso` (jsonb, então cru até provar). */
export interface ProgressoNuvem {
  figurinhas?: unknown;
  porEixo?: unknown;
}

function ehFigurinha(v: unknown): v is Figurinha {
  const f = v as Figurinha | null;
  return Boolean(f && typeof f.id === "string" && typeof f.eixo === "string");
}

/**
 * Normaliza o jsonb da nuvem. Nada aqui pode lançar: um progresso torto na
 * nuvem tem que virar "progresso vazio", nunca uma exceção no meio do jogo.
 */
export function normalizarProgressoNuvem(bruto: ProgressoNuvem | null | undefined): {
  figurinhas: Figurinha[];
  porEixo: Record<string, AcertosEixo>;
} {
  const figurinhas = Array.isArray(bruto?.figurinhas)
    ? bruto.figurinhas.filter(ehFigurinha).map((f) => ({
        id: f.id,
        eixo: f.eixo,
        conquistadaEm: typeof f.conquistadaEm === "number" ? f.conquistadaEm : 0,
      }))
    : [];

  const porEixo: Record<string, AcertosEixo> = {};
  const cru = bruto?.porEixo;
  if (cru && typeof cru === "object" && !Array.isArray(cru)) {
    for (const [eixo, valor] of Object.entries(cru as Record<string, unknown>)) {
      const v = valor as Partial<AcertosEixo> | null;
      porEixo[eixo] = {
        acertos: typeof v?.acertos === "number" ? v.acertos : 0,
        erros: typeof v?.erros === "number" ? v.erros : 0,
      };
    }
  }
  return { figurinhas, porEixo };
}

/**
 * Junta o progresso deste aparelho com o que está na nuvem.
 *
 *  - figurinhas: UNIÃO por id, ficando com a conquista mais antiga. Ninguém
 *    perde figurinha e ninguém ganha duas da mesma — e como o álbum ordena por
 *    `conquistadaEm`, a figurinha antiga que voltou da nuvem cai no lugar dela,
 *    sem empurrar as outras.
 *  - placar por eixo: MÁXIMO de cada contador. Os contadores só crescem, então
 *    o máximo é o merge que nunca conta a mesma rodada duas vezes (somar
 *    duplicaria tudo a cada reenvio).
 *
 * Função pura — é ela que carrega a garantia de "não duplica" nos testes.
 */
export function mesclarProgresso(
  local: Progresso,
  remoto: { figurinhas: Figurinha[]; porEixo: Record<string, AcertosEixo> },
): Progresso {
  const porId = new Map<string, Figurinha>();
  for (const f of [...local.figurinhas, ...remoto.figurinhas]) {
    const atual = porId.get(f.id);
    if (!atual) porId.set(f.id, f);
    else if (f.conquistadaEm > 0 && (atual.conquistadaEm === 0 || f.conquistadaEm < atual.conquistadaEm)) {
      porId.set(f.id, f);
    }
  }
  const figurinhas = [...porId.values()].sort((a, b) => a.conquistadaEm - b.conquistadaEm);

  const porEixo = { ...local.porEixo };
  for (const [eixo, placar] of Object.entries(remoto.porEixo)) {
    const meu = porEixo[eixo as Eixo];
    porEixo[eixo as Eixo] = {
      acertos: Math.max(meu?.acertos ?? 0, placar.acertos),
      erros: Math.max(meu?.erros ?? 0, placar.erros),
    };
  }

  return { ...local, figurinhas, porEixo, atualizadoEm: Math.max(local.atualizadoEm, Date.now()) };
}

/** Mudou alguma coisa de verdade? Evita gravação (e envio) à toa. */
function diferente(a: Progresso, b: Progresso): boolean {
  if (a.figurinhas.length !== b.figurinhas.length) return true;
  const ids = new Set(a.figurinhas.map((f) => f.id));
  if (b.figurinhas.some((f) => !ids.has(f.id))) return true;
  for (const eixo of new Set([...Object.keys(a.porEixo), ...Object.keys(b.porEixo)])) {
    const x = a.porEixo[eixo as Eixo];
    const y = b.porEixo[eixo as Eixo];
    if ((x?.acertos ?? 0) !== (y?.acertos ?? 0)) return true;
    if ((x?.erros ?? 0) !== (y?.erros ?? 0)) return true;
  }
  return false;
}

// -------------------------------------------------- qual família é esta

let familiaMemo: string | null | undefined;

/**
 * O uuid da família guardado NA CONFIG (IndexedDB), não na URL: depois da
 * primeira vez o aparelho sabe sozinho de quem é o progresso, e o link não
 * precisa ser reaberto nunca mais.
 */
export async function familiaDaNuvem(): Promise<string | null> {
  if (familiaMemo !== undefined) return familiaMemo;
  try {
    const c = await getConfig();
    familiaMemo = ehUuid(c.familiaNuvemId) ? c.familiaNuvemId : null;
  } catch {
    familiaMemo = null;
  }
  return familiaMemo;
}

export async function lembrarFamiliaDaNuvem(familiaId: string): Promise<void> {
  if (!ehUuid(familiaId)) return;
  familiaMemo = familiaId;
  try {
    await setConfig({ familiaNuvemId: familiaId });
  } catch {
    // Sem config gravada o envio ainda funciona nesta navegação (memo).
  }
}

/** Só para teste: esquece o memo de família. */
export function _esquecerFamilia(): void {
  familiaMemo = undefined;
}

// ------------------------------------------------------------- pendência

function marcarPendente(): void {
  try {
    localStorage.setItem(CHAVE_PENDENTE, "1");
  } catch {
    /* modo privado: o envio desta navegação ainda acontece */
  }
}

function limparPendente(): void {
  try {
    localStorage.removeItem(CHAVE_PENDENTE);
  } catch {
    /* idem */
  }
}

export function temProgressoPendente(): boolean {
  try {
    return localStorage.getItem(CHAVE_PENDENTE) === "1";
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------- envio

export type ResultadoEnvio = "enviado" | "adiado" | "sem-nuvem" | "nada-a-fazer";

let enviando: Promise<ResultadoEnvio> | null = null;

/**
 * Manda o retrato atual do progresso. NUNCA lança: falha vira "adiado" com a
 * bandeira de pendência ligada, e o próximo `online` (ou a próxima abertura do
 * app) tenta de novo com o retrato já atualizado.
 */
export async function enviarProgressoAgora(): Promise<ResultadoEnvio> {
  enviando ??= (async () => {
    try {
      if (!nuvemConfigurada()) return "sem-nuvem";
      const familia = await familiaDaNuvem();
      if (!familia) return "sem-nuvem";
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        marcarPendente();
        return "adiado";
      }
      const p = await getProgresso();
      await enviarProgresso(familia, p.figurinhas, p.porEixo);
      limparPendente();
      return "enviado";
    } catch {
      // Rede caiu, RPC recusou, família apagada: nada disso é problema da
      // criança. Fica pendente e tenta depois.
      marcarPendente();
      return "adiado";
    } finally {
      enviando = null;
    }
  })();
  return enviando;
}

// ------------------------------------------------------------- adoção

/**
 * Este aparelho passa a pertencer a esta família: grava o uuid na config e
 * MESCLA o progresso que veio da nuvem com o que já havia aqui.
 *
 * A mescla vem antes do primeiro envio de propósito — é o que impede um
 * aparelho recém-chegado de zerar na nuvem o álbum conquistado no outro.
 */
export async function adotarFamilia(
  familiaId: string,
  remoto?: ProgressoNuvem | null,
): Promise<void> {
  if (!ehUuid(familiaId)) return;
  await lembrarFamiliaDaNuvem(familiaId);
  try {
    const local = await getProgresso();
    const mesclado = mesclarProgresso(local, normalizarProgressoNuvem(remoto));
    if (diferente(local, mesclado)) await gravarProgresso(mesclado);
  } catch {
    // Progresso é bônus: não pode impedir a família de chegar ao aparelho.
  }
  marcarPendente();
  void enviarProgressoAgora();
}

/**
 * Puxa da nuvem só o progresso desta família e mescla no aparelho. Usado
 * quando o app abre já adotado — o álbum volta a ficar igual nos dois
 * aparelhos sem a criança precisar reabrir o link.
 */
export async function puxarProgressoDaNuvem(): Promise<void> {
  if (!nuvemConfigurada()) return;
  const familia = await familiaDaNuvem();
  if (!familia) return;
  try {
    const dados = await carregarFamilia(familia);
    if (!dados) return;
    const local = await getProgresso();
    const mesclado = mesclarProgresso(local, normalizarProgressoNuvem(dados.progresso));
    if (diferente(local, mesclado)) {
      await gravarProgresso(mesclado);
      marcarPendente();
      void enviarProgressoAgora();
    }
  } catch {
    // Offline na abertura é o caso normal do tablet. Segue o jogo.
  }
}

// ------------------------------------------------------------- ciclo de vida

/**
 * Liga o espelho: escuta o progresso, agenda envios e reage a voltar a rede.
 * Chamado uma vez pelo `<Sincronia>` no layout. Devolve o desligamento.
 */
export function iniciarSincroniaDeProgresso(): () => void {
  if (typeof window === "undefined" || !nuvemConfigurada()) return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  const agendar = () => {
    // A bandeira sobe JÁ: se o app fechar antes do timer, o envio acontece na
    // próxima abertura em vez de se perder.
    marcarPendente();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void enviarProgressoAgora();
    }, ESPERA_ENVIO_MS);
  };

  const agora = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    void enviarProgressoAgora();
  };

  const aoVoltarRede = () => {
    if (temProgressoPendente()) agora();
  };
  const aoEsconder = () => {
    if (document.visibilityState === "hidden" && temProgressoPendente()) agora();
  };

  const desassinar = aoMudarProgresso(agendar);
  window.addEventListener("online", aoVoltarRede);
  document.addEventListener("visibilitychange", aoEsconder);

  // Abertura do app: manda o que ficou de ontem e traz o que o outro aparelho
  // conquistou. As duas coisas em segundo plano, sem segurar nenhuma tela.
  if (temProgressoPendente()) void enviarProgressoAgora();
  void puxarProgressoDaNuvem();

  return () => {
    if (timer) clearTimeout(timer);
    desassinar();
    window.removeEventListener("online", aoVoltarRede);
    document.removeEventListener("visibilitychange", aoEsconder);
  };
}
