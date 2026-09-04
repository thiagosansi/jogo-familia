/**
 * Testes da sincronia do progresso — a parte que precisa provar duas coisas:
 *
 *  1. **não duplica figurinha**, nem mesclando com a nuvem nem reenviando o
 *     que foi ganho offline;
 *  2. **nunca lança**: sem rede, sem família ou sem nuvem configurada, o jogo
 *     segue e o envio fica pendente para depois.
 *
 * Roda em Node com `fake-indexeddb` (como `db.test.ts`) e com `fetch`/
 * `localStorage` dublês. As variáveis de ambiente são definidas ANTES do
 * `import()` de `nuvem.ts` de propósito: elas são lidas no topo do módulo, e
 * aqui a gente quer justamente o cenário "com nuvem configurada" — o oposto do
 * que `nuvem.test.ts` cobre.
 */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";

// ------------------------------------------------------------- dublês

const armazem = new Map<string, string>();
const localStorageFalso = {
  getItem: (k: string) => armazem.get(k) ?? null,
  setItem: (k: string, v: string) => void armazem.set(k, String(v)),
  removeItem: (k: string) => void armazem.delete(k),
  clear: () => armazem.clear(),
  key: (i: number) => [...armazem.keys()][i] ?? null,
  get length() {
    return armazem.size;
  },
};
(globalThis as unknown as { localStorage: typeof localStorageFalso }).localStorage =
  localStorageFalso;

interface Chamada {
  url: string;
  corpo: { p_familia?: string; p_figurinhas?: unknown; p_por_eixo?: unknown };
}
const chamadas: Chamada[] = [];
let redeOk = true;

(globalThis as unknown as { fetch: unknown }).fetch = async (
  url: string | URL,
  init?: { body?: string },
) => {
  chamadas.push({ url: String(url), corpo: JSON.parse(init?.body ?? "{}") });
  if (!redeOk) throw new TypeError("Failed to fetch");
  return { ok: true, json: async () => null } as unknown as Response;
};

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_teste";

const { addFigurinha, getProgresso, registrarQuaseLa, setConfig } = await import("./db.ts");
const {
  _esquecerFamilia,
  adotarFamilia,
  ehUuid,
  enviarProgressoAgora,
  familiaDaNuvem,
  mesclarProgresso,
  normalizarProgressoNuvem,
  temProgressoPendente,
} = await import("./sincronia.ts");

const FAMILIA = "11111111-2222-3333-4444-555555555555";

function ultimoEnvio(): Chamada | undefined {
  return [...chamadas].reverse().find((c) => c.url.includes("jogo_progresso_salvar"));
}

// ------------------------------------------------------------- puros

test("uuid da família é a credencial — link torto não passa", () => {
  assert.equal(ehUuid(FAMILIA), true);
  assert.equal(ehUuid("nao-e-uuid"), false);
  assert.equal(ehUuid(""), false);
  assert.equal(ehUuid(null), false);
  assert.equal(ehUuid(undefined), false);
});

test("mesclar não duplica figurinha e não desloca as antigas", () => {
  const local = {
    id: "unico",
    figurinhas: [
      { id: "cor-azul", eixo: "cores" as const, conquistadaEm: 200 },
      { id: "familia-1", eixo: "familia" as const, conquistadaEm: 300 },
    ],
    porEixo: {
      familia: { acertos: 3, erros: 1 },
      cores: { acertos: 1, erros: 0 },
      contar: { acertos: 0, erros: 0 },
      animais: { acertos: 0, erros: 0 },
      ingles: { acertos: 0, erros: 0 },
      letras: { acertos: 0, erros: 0 },
      memoria: { acertos: 0, erros: 0 },
    },
    atualizadoEm: 300,
  };
  const remoto = normalizarProgressoNuvem({
    figurinhas: [
      // a MESMA figurinha que já está aqui (não pode virar duas)
      { id: "cor-azul", eixo: "cores", conquistadaEm: 100 },
      // e uma que o outro aparelho ganhou
      { id: "animal-gato", eixo: "animais", conquistadaEm: 150 },
    ],
    porEixo: { familia: { acertos: 2, erros: 5 }, animais: { acertos: 1, erros: 0 } },
  });

  const junto = mesclarProgresso(local, remoto);

  assert.deepEqual(
    junto.figurinhas.map((f) => f.id),
    ["cor-azul", "animal-gato", "familia-1"],
    "união por id, em ordem de conquista",
  );
  assert.equal(junto.figurinhas.filter((f) => f.id === "cor-azul").length, 1);
  // Máximo, nunca soma: reenviar não pode inflar o relatório dos pais.
  assert.deepEqual(junto.porEixo.familia, { acertos: 3, erros: 5 });
  assert.deepEqual(junto.porEixo.animais, { acertos: 1, erros: 0 });
  assert.deepEqual(junto.porEixo.cores, { acertos: 1, erros: 0 });
});

test("mesclar duas vezes dá o mesmo resultado (idempotente)", () => {
  const local = {
    id: "unico",
    figurinhas: [{ id: "contar-3", eixo: "contar" as const, conquistadaEm: 10 }],
    porEixo: {
      familia: { acertos: 0, erros: 0 },
      cores: { acertos: 0, erros: 0 },
      contar: { acertos: 1, erros: 0 },
      animais: { acertos: 0, erros: 0 },
      ingles: { acertos: 0, erros: 0 },
      letras: { acertos: 0, erros: 0 },
      memoria: { acertos: 0, erros: 0 },
    },
    atualizadoEm: 10,
  };
  const remoto = normalizarProgressoNuvem({
    figurinhas: [{ id: "contar-3", eixo: "contar", conquistadaEm: 10 }],
    porEixo: { contar: { acertos: 1, erros: 0 } },
  });
  const uma = mesclarProgresso(local, remoto);
  const duas = mesclarProgresso(uma, remoto);
  assert.deepEqual(duas.figurinhas, uma.figurinhas);
  assert.deepEqual(duas.porEixo, uma.porEixo);
});

test("progresso torto na nuvem vira progresso vazio, nunca exceção", () => {
  assert.deepEqual(normalizarProgressoNuvem(null), { figurinhas: [], porEixo: {} });
  assert.deepEqual(normalizarProgressoNuvem({ figurinhas: "oi", porEixo: 7 }), {
    figurinhas: [],
    porEixo: {},
  });
  const salvo = normalizarProgressoNuvem({
    figurinhas: [{ id: "cor-azul", eixo: "cores" }, null, 3, { semId: true }],
    porEixo: { cores: {} },
  });
  assert.equal(salvo.figurinhas.length, 1);
  assert.equal(salvo.figurinhas[0].conquistadaEm, 0);
  assert.deepEqual(salvo.porEixo.cores, { acertos: 0, erros: 0 });
});

// ------------------------------------------------------ envio otimista

test("sem família adotada o envio não acontece (jogo local puro)", async () => {
  _esquecerFamilia();
  chamadas.length = 0;
  await addFigurinha("cor-azul", "cores");
  assert.equal(await enviarProgressoAgora(), "sem-nuvem");
  assert.equal(ultimoEnvio(), undefined, "nada pode ir para a rede sem família");
});

test("o que a criança ganha offline chega ao backend depois, sem duplicar", async () => {
  await setConfig({ familiaNuvemId: FAMILIA });
  _esquecerFamilia();
  assert.equal(await familiaDaNuvem(), FAMILIA);

  // --- sem rede: a criança joga, o progresso grava local e o envio falha
  redeOk = false;
  chamadas.length = 0;
  await addFigurinha("familia-mae", "familia");
  await addFigurinha("familia-mae", "familia"); // reconquistou a mesma
  await registrarQuaseLa("familia");
  assert.equal(await enviarProgressoAgora(), "adiado");
  assert.equal(temProgressoPendente(), true, "ficou pendente para quando a rede voltar");

  const local = await getProgresso();
  assert.equal(
    local.figurinhas.filter((f) => f.id === "familia-mae").length,
    1,
    "camada 1 da idempotência: o álbum local não repete id",
  );

  // --- a rede volta: manda o retrato inteiro de uma vez só
  redeOk = true;
  assert.equal(await enviarProgressoAgora(), "enviado");
  assert.equal(temProgressoPendente(), false);

  const envio = ultimoEnvio();
  assert.ok(envio, "o progresso subiu quando a rede voltou");
  assert.equal(envio.corpo.p_familia, FAMILIA);
  const enviadas = envio.corpo.p_figurinhas as { id: string }[];
  assert.equal(enviadas.filter((f) => f.id === "familia-mae").length, 1);

  // --- reenviar de novo não muda nada (camada 2: a RPC substitui a linha)
  const antes = JSON.stringify(envio.corpo);
  assert.equal(await enviarProgressoAgora(), "enviado");
  assert.equal(JSON.stringify(ultimoEnvio()?.corpo), antes);
});

test("falha de rede nunca vaza para quem chamou", async () => {
  redeOk = false;
  await assert.doesNotReject(() => enviarProgressoAgora());
  assert.equal(await enviarProgressoAgora(), "adiado");
  redeOk = true;
});

// ------------------------------------------------------------- adoção

test("adotar a família mescla o álbum da nuvem em vez de apagar o daqui", async () => {
  redeOk = true;
  chamadas.length = 0;
  const antes = await getProgresso();
  assert.ok(antes.figurinhas.length > 0, "este aparelho já tinha figurinhas");

  await adotarFamilia(FAMILIA, {
    figurinhas: [{ id: "animal-gato", eixo: "animais", conquistadaEm: 1 }],
    porEixo: { animais: { acertos: 1, erros: 0 } },
  });

  const depois = await getProgresso();
  for (const f of antes.figurinhas) {
    assert.ok(
      depois.figurinhas.some((g) => g.id === f.id),
      `sincronizar não pode apagar dado local (${f.id})`,
    );
  }
  assert.ok(depois.figurinhas.some((f) => f.id === "animal-gato"), "o que veio da nuvem entrou");
  assert.equal(await familiaDaNuvem(), FAMILIA, "o uuid ficou guardado na config");

  // O primeiro envio pós-adoção leva a UNIÃO — é o que impede um aparelho novo
  // de zerar na nuvem o que o outro conquistou.
  await enviarProgressoAgora();
  const enviadas = (ultimoEnvio()?.corpo.p_figurinhas ?? []) as { id: string }[];
  assert.ok(enviadas.some((f) => f.id === "animal-gato"));
  assert.equal(enviadas.length, depois.figurinhas.length);
});
