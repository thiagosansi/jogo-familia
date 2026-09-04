"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CropperCircular } from "@/components/CropperCircular";
import { GravadorVoz } from "@/components/GravadorVoz";
import { DURACAO_CONFIRMA_MS, PortaoPais, useSegurar } from "@/components/PortaoPais";
import { PAPEIS, listarPersonagens, removerPersonagem, salvarPersonagem } from "@/lib/db";
import {
  type ItemImportacao,
  type Plano,
  deFile,
  importarPasta,
  planejarImportacao,
  suportaPastaInteira,
} from "@/lib/importarPasta";
import {
  type Adulto,
  type FamiliaNuvem,
  adultoAtual,
  criarConta,
  criarFamilia,
  entrar,
  familiaSelecionada,
  linkDoJogo,
  listarFamilias,
  nuvemConfigurada,
  podeSubir,
  sair,
  setFamiliaSelecionada,
  sincronizar,
} from "@/lib/nuvem";
import {
  PacoteInvalidoError,
  exportarPacote,
  importarPacote,
  nomeArquivoPacote,
} from "@/lib/pacote";
import type { Papel, Personagem } from "@/lib/tipos";
import estilos from "./pais.module.css";

/**
 * Painel dos pais.
 *
 * É por aqui que o conteúdo do jogo entra: as fotos e as vozes reais da família,
 * e também as figuras que o adulto queira usar como personagem. Nada disso vive
 * no repositório nem no deploy — por privacidade e para manter arte de terceiros
 * fora do código. O preço é que o conteúdo mora só neste aparelho, e a saída
 * para isso é o Pacote da Família (exportar/importar), no fim da página.
 *
 * A rota inteira fica atrás de um hold de 3 segundos (`PortaoPais`).
 */
export default function PaisPage() {
  const [liberado, setLiberado] = useState(false);
  const abrir = useCallback(() => setLiberado(true), []);
  if (!liberado) return <PortaoPais onAbrir={abrir} />;
  return <Painel />;
}

const ROTULO_PAPEL: Record<Papel, string> = {
  mae: "Mãe",
  pai: "Pai",
  irmao: "Irmão / Irmã",
  parente: "Parente",
  mascote: "Personagem / mascote",
};

interface Rascunho {
  id?: string;
  criadoEm?: number;
  nome: string;
  papel: Papel;
  fotoRecorte: Blob | null;
  vozNome: Blob | null;
  vozFesta: Blob | null;
}

const RASCUNHO_VAZIO: Rascunho = {
  nome: "",
  papel: "mae",
  fotoRecorte: null,
  vozNome: null,
  vozFesta: null,
};

function Painel() {
  const [personagens, setPersonagens] = useState<Personagem[] | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [fotoBruta, setFotoBruta] = useState<Blob | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const entradaArquivo = useRef<HTMLInputElement | null>(null);
  const entradaPacote = useRef<HTMLInputElement | null>(null);

  // ---------------------------------------------------- importação de pasta
  const [plano, setPlano] = useState<Plano | null>(null);
  const [andamento, setAndamento] = useState<{ feitos: number; total: number } | null>(null);
  const entradaPasta = useRef<HTMLInputElement | null>(null);
  const entradaImagens = useRef<HTMLInputElement | null>(null);
  // `Painel` só monta depois do hold, ou seja, sempre no browser — dá para
  // medir o suporte já na primeira renderização, sem risco de hidratação.
  const [suportaPasta] = useState(suportaPastaInteira);

  const recarregar = useCallback(async () => {
    setPersonagens(await listarPersonagens());
  }, []);

  // Carga inicial. O setState mora no `.then` (e não no corpo do efeito) para
  // não disparar render em cascata — e `vivo` evita atualizar depois do unmount.
  useEffect(() => {
    let vivo = true;
    void listarPersonagens().then((lista) => {
      if (vivo) setPersonagens(lista);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const salvar = async () => {
    if (!rascunho?.fotoRecorte || !rascunho.nome.trim()) return;
    await salvarPersonagem({
      id: rascunho.id,
      criadoEm: rascunho.criadoEm,
      nome: rascunho.nome.trim(),
      papel: rascunho.papel,
      fotoRecorte: rascunho.fotoRecorte,
      vozNome: rascunho.vozNome,
      vozFesta: rascunho.vozFesta,
    });
    setRascunho(null);
    setRecado(null);
    await recarregar();
  };

  const excluir = async (p: Personagem) => {
    await removerPersonagem(p.id);
    if (rascunho?.id === p.id) setRascunho(null);
    await recarregar();
  };

  // ------------------------------------------------------- Pacote da Família
  const exportar = async () => {
    try {
      const blob = await exportarPacote();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = nomeArquivoPacote();
      document.body.append(link);
      link.click();
      link.remove();
      // Revogar na hora cancelaria o download em alguns browsers.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setRecado(`Pacote gerado com ${personagens?.length ?? 0} personagem(ns).`);
    } catch {
      setRecado("Não consegui gerar o pacote.");
    }
  };

  const importar = async (arquivo: File) => {
    try {
      const r = await importarPacote(arquivo);
      await recarregar();
      setRecado(
        r.ignorados > 0
          ? `${r.importados} importado(s), ${r.ignorados} já existia(m) — nada foi duplicado.`
          : `${r.importados} personagem(ns) importado(s).`,
      );
    } catch (e) {
      setRecado(
        e instanceof PacoteInvalidoError ? e.message : "Não consegui ler esse arquivo.",
      );
    } finally {
      // Permite reimportar o mesmo arquivo (o input não dispara change de novo).
      if (entradaPacote.current) entradaPacote.current.value = "";
    }
  };

  // ---------------------------------------------------- importação de pasta
  /** Monta a prévia. Só lê nomes e caminhos — nenhuma imagem é decodificada. */
  const planejar = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return;
    const novo = planejarImportacao([...arquivos].map(deFile), await listarPersonagens());
    setPlano(novo);
    setRecado(
      novo.itens.length === 0
        ? "Não encontrei nenhuma imagem nessa pasta."
        : `${novo.itens.length} imagem(ns) encontrada(s). Confira a lista antes de importar.`,
    );
  };

  const mudarItem = (id: string, mudanca: Partial<ItemImportacao>) =>
    setPlano((p) =>
      p
        ? { ...p, itens: p.itens.map((i) => (i.id === id ? { ...i, ...mudanca } : i)) }
        : p,
    );

  /** Atalho do caminho sem pastas (iOS): marcar a seleção inteira de uma vez. */
  const papelParaTodos = (papel: Papel) =>
    setPlano((p) => (p ? { ...p, itens: p.itens.map((i) => ({ ...i, papel })) } : p));

  const confirmarImportacao = async () => {
    const escolhidos = plano?.itens.filter((i) => i.selecionado) ?? [];
    if (escolhidos.length === 0) return;
    setAndamento({ feitos: 0, total: escolhidos.length });
    try {
      const r = await importarPasta(escolhidos, {
        aoProgredir: (feitos, total) => setAndamento({ feitos, total }),
      });
      await recarregar();
      setPlano(null);
      const partes = [`${r.importados} importado(s)`];
      if (r.ignorados > 0) partes.push(`${r.ignorados} já existia(m)`);
      if (r.falhas.length > 0) partes.push(`${r.falhas.length} não abriu(ram)`);
      setRecado(partes.join(", ") + ".");
    } catch {
      setRecado("Não consegui importar essas imagens.");
    } finally {
      setAndamento(null);
      // Escolher a MESMA pasta de novo tem que disparar change outra vez.
      if (entradaPasta.current) entradaPasta.current.value = "";
      if (entradaImagens.current) entradaImagens.current.value = "";
    }
  };

  return (
    <main className={`tela ${estilos.tela}`}>
      <header className={estilos.cabecalho}>
        <h1 className="titulo">Área dos pais</h1>
        <div className={estilos.acoes}>
          <Link href="/pais/progresso" className={estilos.voltar}>
            Ver progresso
          </Link>
          <Link href="/" className={estilos.voltar}>
            Voltar ao jogo
          </Link>
        </div>
      </header>

      {recado && (
        <p className={estilos.recado} role="status" data-teste="recado">
          {recado}
        </p>
      )}

      {/* -------------------------------------------------------- personagens */}
      <section className={estilos.secao}>
        <h2 className={estilos.subtitulo}>Família</h2>

        {personagens === null ? (
          <p className={estilos.vazio}>Carregando…</p>
        ) : personagens.length === 0 ? (
          <p className={estilos.vazio}>
            Ninguém cadastrado ainda. Comece pela mãe ou pelo pai: uma foto do rosto e a
            voz dizendo o próprio nome já bastam para o jogo funcionar.
          </p>
        ) : (
          <ul className={estilos.lista} data-teste="lista-personagens">
            {personagens.map((p) => (
              <Cartao
                key={p.id}
                personagem={p}
                onEditar={() =>
                  setRascunho({
                    id: p.id,
                    criadoEm: p.criadoEm,
                    nome: p.nome,
                    papel: p.papel,
                    fotoRecorte: p.fotoRecorte,
                    vozNome: p.vozNome,
                    vozFesta: p.vozFesta,
                  })
                }
                onExcluir={() => void excluir(p)}
              />
            ))}
          </ul>
        )}

        {!rascunho && (
          <button
            type="button"
            className={`${estilos.acao} ${estilos.acaoPrimaria}`}
            data-teste="novo-personagem"
            onClick={() => setRascunho({ ...RASCUNHO_VAZIO })}
          >
            + Adicionar pessoa
          </button>
        )}
      </section>

      {/* ------------------------------------------------------------- cadastro */}
      {rascunho && (
        <section className={estilos.secao} data-teste="form-personagem">
          <h2 className={estilos.subtitulo}>
            {rascunho.id ? "Editar" : "Nova pessoa"}
          </h2>

          {fotoBruta ? (
            <CropperCircular
              arquivo={fotoBruta}
              onPronto={(recorte) => {
                setRascunho((r) => (r ? { ...r, fotoRecorte: recorte } : r));
                setFotoBruta(null);
              }}
              onCancelar={() => setFotoBruta(null)}
            />
          ) : (
            <>
              <div className={estilos.linhaFoto}>
                <Miniatura blob={rascunho.fotoRecorte} nome={rascunho.nome} />
                <div>
                  <button
                    type="button"
                    className={estilos.acao}
                    data-teste="escolher-foto"
                    onClick={() => entradaArquivo.current?.click()}
                  >
                    {rascunho.fotoRecorte ? "Trocar foto" : "Escolher foto"}
                  </button>
                  <input
                    ref={entradaArquivo}
                    type="file"
                    accept="image/*"
                    className="so-leitor"
                    data-teste="input-foto"
                    onChange={(e) => {
                      const arquivo = e.target.files?.[0];
                      if (arquivo) setFotoBruta(arquivo);
                      e.target.value = "";
                    }}
                  />
                  <p className={estilos.ajuda}>
                    A foto é recortada num círculo e fica só neste aparelho.
                  </p>
                </div>
              </div>

              <label className={estilos.campo}>
                <span>Nome</span>
                <input
                  type="text"
                  value={rascunho.nome}
                  data-teste="input-nome"
                  placeholder="Mamãe"
                  autoComplete="off"
                  onChange={(e) =>
                    setRascunho((r) => (r ? { ...r, nome: e.target.value } : r))
                  }
                />
              </label>

              <fieldset className={estilos.papeis}>
                <legend>Quem é</legend>
                <div className={estilos.chips}>
                  {PAPEIS.map((papel) => (
                    <label key={papel} className={estilos.chip}>
                      <input
                        type="radio"
                        name="papel"
                        value={papel}
                        checked={rascunho.papel === papel}
                        onChange={() => setRascunho((r) => (r ? { ...r, papel } : r))}
                      />
                      <span>{ROTULO_PAPEL[papel]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <GravadorVoz
                nome="nome"
                rotulo="Voz do nome"
                dica='A própria pessoa dizendo como quer ser chamada: "mamãe", "vovó", "Bob Esponja".'
                valor={rascunho.vozNome}
                onChange={(voz) => setRascunho((r) => (r ? { ...r, vozNome: voz } : r))}
              />

              <GravadorVoz
                nome="festa"
                rotulo="Comemoração (opcional)"
                dica='O que essa pessoa fala quando a criança acerta: "isso! muito bem!".'
                valor={rascunho.vozFesta}
                onChange={(voz) => setRascunho((r) => (r ? { ...r, vozFesta: voz } : r))}
              />

              <div className={estilos.acoes}>
                <button
                  type="button"
                  className={estilos.acao}
                  onClick={() => setRascunho(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={`${estilos.acao} ${estilos.acaoPrimaria}`}
                  data-teste="salvar-personagem"
                  disabled={!rascunho.fotoRecorte || !rascunho.nome.trim()}
                  onClick={() => void salvar()}
                >
                  Salvar
                </button>
              </div>
              {!rascunho.fotoRecorte && (
                <p className={estilos.ajuda}>Falta a foto para poder salvar.</p>
              )}
            </>
          )}
        </section>
      )}

      {/* ------------------------------------------------- importar pasta */}
      <section className={estilos.secao}>
        <h2 className={estilos.subtitulo}>Importar imagens do aparelho</h2>
        <p className={estilos.ajuda}>
          {suportaPasta
            ? "Escolha uma pasta com as imagens (por exemplo a pasta imagens, com personagens e familia dentro). Elas são recortadas aqui mesmo e ficam só neste aparelho — nada é enviado para lugar nenhum."
            : "Escolha as imagens (dá para selecionar várias de uma vez). Elas são recortadas aqui mesmo e ficam só neste aparelho — nada é enviado para lugar nenhum."}
        </p>

        <div className={estilos.acoes}>
          <button
            type="button"
            className={estilos.acao}
            data-teste="escolher-pasta"
            onClick={() =>
              (suportaPasta ? entradaPasta : entradaImagens).current?.click()
            }
          >
            {suportaPasta ? "Escolher pasta" : "Escolher imagens"}
          </button>
        </div>

        {/* Dois inputs: o de pasta não existe no Safari do iOS, onde
            `webkitdirectory` é ignorado — lá o adulto seleciona os arquivos. */}
        <input
          ref={entradaPasta}
          type="file"
          multiple
          className="so-leitor"
          data-teste="input-pasta"
          // `webkitdirectory` não está na tipagem do React; é atributo de
          // presença, então o valor vazio já liga a seleção de pasta.
          {...({ webkitdirectory: "" } as Record<string, string>)}
          onChange={(e) => void planejar(e.target.files)}
        />
        <input
          ref={entradaImagens}
          type="file"
          multiple
          accept="image/*"
          className="so-leitor"
          data-teste="input-imagens"
          onChange={(e) => void planejar(e.target.files)}
        />

        {plano && (
          <div className={estilos.previa} data-teste="previa-importacao">
            <p className={estilos.ajuda}>
              {plano.itens.filter((i) => i.selecionado).length} de {plano.itens.length} serão
              importados
              {plano.descartados.length > 0 &&
                ` · ${plano.descartados.length} arquivo(s) fora (não são imagem)`}
            </p>

            {!suportaPasta && plano.itens.length > 0 && (
              <div className={estilos.acoes}>
                <button
                  type="button"
                  className={estilos.acao}
                  data-teste="todos-mascote"
                  onClick={() => papelParaTodos("mascote")}
                >
                  Marcar todos como personagem
                </button>
              </div>
            )}

            <ul className={estilos.listaPrevia}>
              {plano.itens.map((item) => (
                <li key={item.id} className={estilos.itemPrevia} data-teste="item-previa">
                  <input
                    type="checkbox"
                    className={estilos.marcador}
                    checked={item.selecionado}
                    aria-label={`Importar ${item.nome}`}
                    onChange={(e) => mudarItem(item.id, { selecionado: e.target.checked })}
                  />
                  <Miniatura blob={item.arquivo.blob} nome={item.nome} />
                  <div className={estilos.dados}>
                    <input
                      type="text"
                      className={estilos.nomePrevia}
                      value={item.nome}
                      aria-label={`Nome de ${item.arquivo.nome}`}
                      onChange={(e) => mudarItem(item.id, { nome: e.target.value })}
                    />
                    <select
                      className={estilos.papelPrevia}
                      value={item.papel}
                      aria-label={`Quem é ${item.nome}`}
                      onChange={(e) =>
                        mudarItem(item.id, { papel: e.target.value as Papel })
                      }
                    >
                      {PAPEIS.map((papel) => (
                        <option key={papel} value={papel}>
                          {ROTULO_PAPEL[papel]}
                        </option>
                      ))}
                    </select>
                    {item.situacao !== "novo" && (
                      <span className={estilos.papel} data-teste="selo-situacao">
                        {item.situacao === "existe"
                          ? "já está cadastrado"
                          : "repetido nesta seleção"}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className={estilos.acoes}>
              <button
                type="button"
                className={estilos.acao}
                onClick={() => setPlano(null)}
                disabled={andamento !== null}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={`${estilos.acao} ${estilos.acaoPrimaria}`}
                data-teste="confirmar-importacao"
                disabled={
                  andamento !== null || !plano.itens.some((i) => i.selecionado)
                }
                onClick={() => void confirmarImportacao()}
              >
                {andamento
                  ? `Importando ${andamento.feitos} de ${andamento.total}…`
                  : "Importar"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- nuvem */}
      <SecaoNuvem personagens={personagens} />

      {/* --------------------------------------------------------- pacote */}
      <section className={estilos.secao}>
        <h2 className={estilos.subtitulo}>Pacote da Família</h2>
        <p className={estilos.ajuda}>
          O pacote é um arquivo com tudo dentro — inclusive os personagens que não vão
          para a nuvem. Guarde-o para restaurar num aparelho novo, sem depender de conta
          nem de internet.
        </p>
        <div className={estilos.acoes}>
          <button
            type="button"
            className={estilos.acao}
            data-teste="exportar-pacote"
            onClick={() => void exportar()}
            disabled={!personagens?.length}
          >
            Exportar
          </button>
          <button
            type="button"
            className={estilos.acao}
            data-teste="importar-pacote"
            onClick={() => entradaPacote.current?.click()}
          >
            Importar
          </button>
          <input
            ref={entradaPacote}
            type="file"
            accept="application/json,.json"
            className="so-leitor"
            data-teste="input-pacote"
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) void importar(arquivo);
            }}
          />
        </div>
      </section>
    </main>
  );
}

// -------------------------------------------------------------------- nuvem

/**
 * Sincronização com a nuvem — a seção que resolve "a mãe cadastra no celular,
 * a criança joga no tablet".
 *
 * Três regras que moldam esta UI:
 *  1. sem variáveis de ambiente a seção INTEIRA some (o painel abre igual, e o
 *     jogo segue 100% local);
 *  2. mascote não sobe — arte de terceiros num bucket público seria
 *     redistribuição. A frase está na tela, não só no código;
 *  3. o uuid da família é a credencial: o link já é o suficiente para o tablet
 *     entrar, sem login nenhum.
 */
function SecaoNuvem({ personagens }: { personagens: Personagem[] | null }) {
  // Medido uma vez: `Painel` só monta depois do hold, sempre no browser.
  const [temNuvem] = useState(nuvemConfigurada);

  const [adulto, setAdulto] = useState<Adulto | null>(null);
  // Sem nuvem não há o que verificar — e a seção nem chega a ser renderizada.
  const [carregando, setCarregando] = useState(temNuvem);
  const [familias, setFamilias] = useState<FamiliaNuvem[]>([]);
  const [escolhida, setEscolhida] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [novaFamilia, setNovaFamilia] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [andamento, setAndamento] = useState<{ feitos: number; total: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregarFamilias = useCallback(async () => {
    const lista = await listarFamilias();
    setFamilias(lista);
    const lembrada = familiaSelecionada();
    const valida = lista.some((f) => f.id === lembrada) ? lembrada : (lista[0]?.id ?? null);
    setEscolhida(valida);
    if (valida) setFamiliaSelecionada(valida);
    return lista;
  }, []);

  // Sessão já existente neste aparelho (o SDK guarda no localStorage).
  useEffect(() => {
    if (!temNuvem) return;
    let vivo = true;
    void (async () => {
      const quem = await adultoAtual();
      if (!vivo) return;
      setAdulto(quem);
      if (quem) {
        try {
          await carregarFamilias();
        } catch {
          // Rede fora: o painel continua servindo para o cadastro local.
        }
      }
      if (vivo) setCarregando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [temNuvem, carregarFamilias]);

  if (!temNuvem) return null;

  const sobem = (personagens ?? []).filter((p) => podeSubir(p.papel));
  const mascotes = (personagens?.length ?? 0) - sobem.length;
  const link = escolhida ? linkDoJogo(escolhida) : "";

  /** Envolve as ações: um único lugar para travar botão e traduzir erro. */
  const executar = async (acao: () => Promise<void>) => {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await acao();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui falar com a nuvem.");
    } finally {
      setOcupado(false);
      setAndamento(null);
    }
  };

  const acessar = (novo: boolean) =>
    void executar(async () => {
      const quem = novo ? await criarConta(email, senha) : await entrar(email, senha);
      if (!quem) {
        setAviso("Conta criada. Confirme pelo email e volte aqui para entrar.");
        return;
      }
      setAdulto(quem);
      setSenha("");
      await carregarFamilias();
    });

  const sairDaConta = () =>
    void executar(async () => {
      await sair();
      setAdulto(null);
      setFamilias([]);
      setEscolhida(null);
    });

  const criar = () =>
    void executar(async () => {
      const id = await criarFamilia(novaFamilia);
      setNovaFamilia("");
      const lista = await carregarFamilias();
      if (lista.some((f) => f.id === id)) {
        setEscolhida(id);
        setFamiliaSelecionada(id);
      }
      setAviso("Família criada. Agora é só sincronizar.");
    });

  const enviar = () =>
    void executar(async () => {
      if (!escolhida) return;
      setAndamento({ feitos: 0, total: sobem.length });
      const r = await sincronizar(escolhida, personagens ?? [], {
        aoProgredir: (feitos, total) => setAndamento({ feitos, total }),
      });
      await carregarFamilias();
      const partes = [`${r.enviados} familiar(es) na nuvem`];
      if (r.mascotesPulados > 0) {
        partes.push(`${r.mascotesPulados} personagem(ns) não sobe(m) — ficam só aqui`);
      }
      if (r.falhas.length > 0) partes.push(`${r.falhas.length} falhou(ram)`);
      setAviso(partes.join(" · ") + ".");
      if (r.falhas.length > 0) {
        setErro(r.falhas.map((f) => `${f.nome}: ${f.motivo}`).join(" · "));
      } else if (r.avisos.length > 0) {
        setErro(r.avisos.join(" · "));
      }
    });

  const copiar = () =>
    void (async () => {
      try {
        await navigator.clipboard.writeText(link);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2500);
      } catch {
        setErro("Não consegui copiar. Selecione o link e copie na mão.");
      }
    })();

  return (
    <section className={estilos.secao} data-teste="secao-nuvem">
      <h2 className={estilos.subtitulo}>Jogar em outro aparelho</h2>
      <p className={estilos.ajuda}>
        Cadastre aqui e mande o link para o tablet da criança: lá o jogo baixa a família
        uma vez e volta a funcionar sem internet. Precisa de conta só aqui — a criança
        nunca faz login.
      </p>

      {carregando ? (
        <p className={estilos.vazio}>Verificando…</p>
      ) : !adulto ? (
        <>
          <label className={estilos.campo}>
            <span>Email</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              data-teste="nuvem-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className={estilos.campo}>
            <span>Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              data-teste="nuvem-senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </label>
          <div className={estilos.acoes}>
            <button
              type="button"
              className={`${estilos.acao} ${estilos.acaoPrimaria}`}
              data-teste="nuvem-entrar"
              disabled={ocupado || !email.trim() || senha.length < 6}
              onClick={() => acessar(false)}
            >
              Entrar
            </button>
            <button
              type="button"
              className={estilos.acao}
              data-teste="nuvem-criar-conta"
              disabled={ocupado || !email.trim() || senha.length < 6}
              onClick={() => acessar(true)}
            >
              Criar conta
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={estilos.linhaNuvem}>
            <span className={estilos.papel} data-teste="nuvem-adulto">
              {adulto.email}
            </span>
            <button
              type="button"
              className={estilos.acao}
              data-teste="nuvem-sair"
              disabled={ocupado}
              onClick={sairDaConta}
            >
              Sair
            </button>
          </div>

          {familias.length > 0 && (
            <label className={estilos.campo}>
              <span>Família</span>
              <select
                className={estilos.papelPrevia}
                data-teste="nuvem-familia"
                value={escolhida ?? ""}
                onChange={(e) => {
                  setEscolhida(e.target.value);
                  setFamiliaSelecionada(e.target.value);
                }}
              >
                {familias.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome} ({f.personagens})
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={estilos.linhaNuvem}>
            <input
              type="text"
              className={estilos.nomePrevia}
              placeholder="Nome da família"
              aria-label="Nome da nova família"
              data-teste="nuvem-nome-familia"
              value={novaFamilia}
              onChange={(e) => setNovaFamilia(e.target.value)}
            />
            <button
              type="button"
              className={estilos.acao}
              data-teste="nuvem-criar-familia"
              disabled={ocupado || !novaFamilia.trim()}
              onClick={criar}
            >
              Criar família
            </button>
          </div>

          {escolhida && (
            <>
              <div className={estilos.acoes}>
                <button
                  type="button"
                  className={`${estilos.acao} ${estilos.acaoPrimaria}`}
                  data-teste="nuvem-sincronizar"
                  disabled={ocupado || sobem.length === 0}
                  onClick={enviar}
                >
                  {andamento
                    ? `Enviando ${andamento.feitos} de ${andamento.total}…`
                    : "Sincronizar"}
                </button>
              </div>
              <p className={estilos.ajuda} data-teste="nuvem-regra-mascote">
                Sobem só os familiares de verdade ({sobem.length}).
                {mascotes > 0
                  ? ` Os ${mascotes} personagem(ns) do desenho ficam só neste aparelho: são`
                  : " Personagens de desenho ficam sempre só no aparelho: são"}{" "}
                arte de outra gente, e o que sobe fica acessível por link. No outro
                aparelho, importe-os pela pasta de imagens.
              </p>

              <label className={estilos.campo}>
                <span>Link para o tablet</span>
                <input
                  type="text"
                  readOnly
                  data-teste="nuvem-link"
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <div className={estilos.acoes}>
                <button
                  type="button"
                  className={estilos.acao}
                  data-teste="nuvem-copiar"
                  onClick={copiar}
                >
                  {copiado ? "Copiado!" : "Copiar link"}
                </button>
              </div>
              <p className={estilos.ajuda}>
                Quem tem este link abre a família — trate-o como uma senha.
              </p>
            </>
          )}
        </>
      )}

      {aviso && (
        <p className={estilos.recado} role="status" data-teste="nuvem-aviso">
          {aviso}
        </p>
      )}
      {erro && (
        <p className={estilos.erro} role="alert" data-teste="nuvem-erro">
          {erro}
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ pedaços

/** Prévia circular de um Blob de imagem, com a URL revogada no unmount. */
function Miniatura({ blob, nome }: { blob: Blob | null; nome: string }) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  if (!url) return <div className={estilos.miniaturaVazia} aria-hidden="true" />;
  // <img> comum: o Next/Image otimizaria uma URL de blob que só existe aqui.
  //
  // NÃO adicione `loading="lazy"` aqui: com StrictMode o efeito acima roda
  // montar/desmontar/montar, e a revogação da URL do meio chega ANTES de um
  // carregamento adiado — a miniatura fica quebrada. Com carregamento normal a
  // imagem já foi buscada quando a revogação acontece.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={estilos.miniatura} src={url} alt={nome ? `Foto de ${nome}` : "Foto"} />;
}

function Cartao({
  personagem,
  onEditar,
  onExcluir,
}: {
  personagem: Personagem;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  // Excluir também é hold: um toque solto não pode apagar a mãe do jogo.
  const { progresso, segurando, handlers } = useSegurar(DURACAO_CONFIRMA_MS, onExcluir);

  return (
    <li className={estilos.cartao}>
      <Miniatura blob={personagem.fotoRecorte} nome={personagem.nome} />
      <div className={estilos.dados}>
        <strong>{personagem.nome}</strong>
        <span className={estilos.papel}>{ROTULO_PAPEL[personagem.papel]}</span>
        <span className={estilos.papel}>
          {personagem.vozNome ? "com voz" : "sem voz (o jogo fala o nome)"}
        </span>
      </div>
      <div className={estilos.botoesCartao}>
        <button type="button" className={estilos.acao} onClick={onEditar}>
          Editar
        </button>
        <button
          type="button"
          className={`${estilos.acao} ${estilos.acaoPerigo}`}
          data-teste={`excluir-${personagem.id}`}
          aria-label={`Segure para excluir ${personagem.nome}`}
          style={{ "--progresso": progresso } as React.CSSProperties}
          {...handlers}
        >
          {segurando ? "Segure…" : "Excluir"}
        </button>
      </div>
    </li>
  );
}
