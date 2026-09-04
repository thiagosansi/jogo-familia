# Créditos e licenças dos sons — modo Animais

**Estado atual: nenhum arquivo de áudio de terceiros é embarcado neste jogo.**

Todos os sons dos animais são gerados no próprio aparelho por síntese de voz
(`SpeechSynthesis`, locale `pt-BR`), enfileirados pela `FilaDeFala`
(`src/game/fala.ts`). Não há download de áudio, não há biblioteca comercial e
não há arquivo de licença desconhecida em `public/sons/`.

Por que TTS em vez de gravações: o brief da task exige som **CC0 / domínio
público com licença declarada** ou TTS. Não foi possível obter, dentro desta
task e sem acesso a download externo, arquivos com licença livre
**comprovada** (a maior parte dos bancos de "free sounds" exige atribuição ou
tem procedência incerta). Embarcar áudio de licença duvidosa é explicitamente
proibido pelo brief, então a saída escolhida foi a permitida e mais segura:
**TTS para todos os sons**. A voz sintetizada é local, funciona offline (o
jogo é PWA) e não custa bytes no precache.

## Tabela de sons

A coluna "Origem" é a fonte de verdade legal. `src/game/modos/animais.test.ts`
verifica que esta tabela e o campo `som: FonteSom` de cada animal em
`src/game/modos/animais.ts` continuam batendo — se alguém adicionar um arquivo
sem declarar licença aqui, o teste quebra.

| Animal   | Som falado  | Arquivo embarcado | Origem                                       | Licença                                                                            |
| -------- | ----------- | ----------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| vaca     | "Muuu"      | nenhum (TTS)      | Gerado em tempo real pelo próprio dispositivo | Sem arquivo de áudio embarcado — voz sintetizada no aparelho (SpeechSynthesis pt-BR) |
| cachorro | "Au au"     | nenhum (TTS)      | Gerado em tempo real pelo próprio dispositivo | Sem arquivo de áudio embarcado — voz sintetizada no aparelho (SpeechSynthesis pt-BR) |
| gato     | "Miau"      | nenhum (TTS)      | Gerado em tempo real pelo próprio dispositivo | Sem arquivo de áudio embarcado — voz sintetizada no aparelho (SpeechSynthesis pt-BR) |
| pato     | "Quá quá"   | nenhum (TTS)      | Gerado em tempo real pelo próprio dispositivo | Sem arquivo de áudio embarcado — voz sintetizada no aparelho (SpeechSynthesis pt-BR) |
| galo     | "Cocoricó"  | nenhum (TTS)      | Gerado em tempo real pelo próprio dispositivo | Sem arquivo de áudio embarcado — voz sintetizada no aparelho (SpeechSynthesis pt-BR) |
| ovelha   | "Méé"       | nenhum (TTS)      | Gerado em tempo real pelo próprio dispositivo | Sem arquivo de áudio embarcado — voz sintetizada no aparelho (SpeechSynthesis pt-BR) |

## Como acrescentar um arquivo de áudio no futuro

1. O arquivo tem que ser **CC0 1.0** ou **domínio público comprovado** (link da
   página da licença, não "achei no Google"). Nada de CC-BY, CC-BY-SA, "free
   for personal use" ou banco comercial.
2. Coloque o arquivo em `public/sons/` (ex.: `public/sons/vaca.wav`).
3. Troque o campo `som` do animal em `src/game/modos/animais.ts`:

   ```ts
   som: {
     tipo: "arquivo",
     arquivo: "/sons/vaca.wav",
     licenca: "CC0 1.0 Universal (domínio público)",
     origem: "https://exemplo.org/pagina-do-arquivo",
   }
   ```

4. Acrescente a linha correspondente na tabela acima com a MESMA licença e
   origem (o teste compara os dois).
5. Nada mais precisa mudar: `precarregarSons()` baixa, decodifica e
   **normaliza o volume** (mesmo pico para todos os arquivos, com headroom) e
   entrega o Blob pronto para a `FilaDeFala`, que continua tocando um som por
   vez.
