"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import estilos from "./GravadorVoz.module.css";

/** Corta gravações esquecidas: ninguém precisa de 10 minutos de "mamãe". */
const LIMITE_MS = 8000;

/**
 * Ordem de preferência de contêiner. Chrome/Android entregam `audio/webm`
 * (Opus); Safari (iPad, que é o alvo real) só aceita `audio/mp4`. `isTypeSupported`
 * é a única fonte confiável — sniffar o user agent erra em iPad no modo desktop.
 */
const CANDIDATOS = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

/** Primeiro contêiner suportado, ou `undefined` para deixar o browser escolher. */
export function melhorMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return CANDIDATOS.find((m) => MediaRecorder.isTypeSupported?.(m));
}

interface Props {
  rotulo: string;
  dica: string;
  valor: Blob | null;
  onChange: (voz: Blob | null) => void;
  /** Identificador estável para os testes e para o `id` do botão. */
  nome: string;
}

/**
 * Gravador de uma frase curta, via `MediaRecorder`.
 *
 * Regra de ouro: voz é opcional. Microfone negado, indisponível ou bloqueado
 * por política não pode travar o cadastro — o jogo cai para `SpeechSynthesis`
 * em pt-BR e a família continua funcionando. Por isso todo caminho de erro
 * termina num aviso amigável, nunca num `throw` que sobe para a tela.
 */
export function GravadorVoz({ rotulo, dica, valor, onChange, nome }: Props) {
  const [gravando, setGravando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tocando, setTocando] = useState(false);

  const gravadorRef = useRef<MediaRecorder | null>(null);
  const trilhaRef = useRef<MediaStream | null>(null);
  const relogioRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // URL de prévia derivada do Blob — em `useMemo`, não em estado: assim ela
  // existe já no primeiro render e o efeito só cuida de revogar. Revogar é
  // obrigatório: sem isso cada regravação vaza um blob na memória do tablet.
  const url = useMemo(() => (valor ? URL.createObjectURL(valor) : null), [valor]);
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  /** Solta o microfone. Sem isto o indicador de gravação fica aceso no iOS. */
  const soltarMicrofone = () => {
    trilhaRef.current?.getTracks().forEach((t) => t.stop());
    trilhaRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (relogioRef.current) clearTimeout(relogioRef.current);
      if (gravadorRef.current?.state === "recording") gravadorRef.current.stop();
      soltarMicrofone();
      audioRef.current?.pause();
    };
  }, []);

  const parar = () => {
    if (relogioRef.current) clearTimeout(relogioRef.current);
    relogioRef.current = null;
    if (gravadorRef.current?.state === "recording") gravadorRef.current.stop();
  };

  const gravar = async () => {
    setAviso(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setAviso("Este navegador não grava áudio. Dá para salvar sem voz — o jogo fala o nome sozinho.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // NotAllowedError, NotFoundError, contexto inseguro... todos dão no mesmo
      // para o adulto: siga sem voz.
      setAviso("Sem acesso ao microfone. Pode salvar sem voz — o jogo fala o nome sozinho.");
      return;
    }
    trilhaRef.current = stream;

    const mime = melhorMime();
    let gravador: MediaRecorder;
    try {
      gravador = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      // Alguns Safari recusam o mimeType mesmo dizendo suportar: cai no padrão.
      gravador = new MediaRecorder(stream);
    }
    gravadorRef.current = gravador;

    const pedacos: BlobPart[] = [];
    gravador.ondataavailable = (e) => {
      if (e.data.size > 0) pedacos.push(e.data);
    };
    gravador.onstop = () => {
      soltarMicrofone();
      setGravando(false);
      const tipo = gravador.mimeType || mime || "audio/webm";
      const blob = new Blob(pedacos, { type: tipo });
      if (blob.size > 0) onChange(blob);
      else setAviso("A gravação saiu vazia. Tente de novo.");
    };

    gravador.start();
    setGravando(true);
    relogioRef.current = setTimeout(parar, LIMITE_MS);
  };

  const ouvir = () => {
    if (!url) return;
    audioRef.current?.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    setTocando(true);
    audio.onended = () => setTocando(false);
    audio.onerror = () => setTocando(false);
    // Chamado dentro do clique: o iOS aceita o play sem gesto adicional.
    void audio.play().catch(() => setTocando(false));
  };

  return (
    <fieldset className={estilos.caixa}>
      <legend className={estilos.titulo}>{rotulo}</legend>
      <p className={estilos.dica}>{dica}</p>

      <div className={estilos.botoes}>
        {gravando ? (
          <button
            type="button"
            className={`${estilos.botao} ${estilos.gravando}`}
            data-teste={`voz-parar-${nome}`}
            onClick={parar}
          >
            <span className={estilos.quadrado} aria-hidden="true" />
            Parar
          </button>
        ) : (
          <button
            type="button"
            className={estilos.botao}
            data-teste={`voz-gravar-${nome}`}
            onClick={gravar}
          >
            <span className={estilos.bolinha} aria-hidden="true" />
            {valor ? "Regravar" : "Gravar"}
          </button>
        )}

        {valor && !gravando && (
          <>
            <button
              type="button"
              className={estilos.botao}
              data-teste={`voz-ouvir-${nome}`}
              onClick={ouvir}
              disabled={!url}
            >
              {tocando ? "Tocando…" : "Ouvir"}
            </button>
            <button
              type="button"
              className={estilos.botao}
              data-teste={`voz-apagar-${nome}`}
              onClick={() => {
                audioRef.current?.pause();
                setTocando(false);
                onChange(null);
              }}
            >
              Apagar
            </button>
          </>
        )}
      </div>

      <output className={estilos.estado} aria-live="polite" data-teste={`voz-estado-${nome}`}>
        {gravando
          ? "Gravando… fale agora."
          : valor
            ? `Voz gravada (${Math.max(1, Math.round(valor.size / 1024))} KB)`
            : "Sem voz gravada."}
      </output>

      {aviso && (
        <p className={estilos.aviso} role="status" data-teste={`voz-aviso-${nome}`}>
          {aviso}
        </p>
      )}
    </fieldset>
  );
}
