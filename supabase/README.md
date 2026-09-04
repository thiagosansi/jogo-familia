# Backend do Jogo da Família (Supabase)

O jogo divide o **mesmo projeto Supabase do lista-compras**
(`<project-ref>`), mas num **schema separado**: `jogo_familia`.
Nada aqui toca as tabelas do lista-compras — a única coisa que aparece no
schema `public` são as funções com prefixo `jogo_`, que são a API (seis da
aplicação, mais `jogo_familia_e_minha`, usada só pelas policies do bucket).

## Por que assim

O jogo não tem login: a criança abre um link e joga. Então:

- **o `id` da família (uuid v4) é a credencial** — quem tem o link, joga.
  São 122 bits de aleatoriedade; não se adivinha por tentativa;
- **as tabelas têm RLS ligado e ZERO policies**: ninguém fala com elas pela
  API, nem anônimo nem logado. Todo acesso passa pelas funções
  `SECURITY DEFINER` abaixo, que validam quem pode o quê;
- **cadastrar é coisa de adulto logado** (as mesmas contas do lista-compras);
  **jogar é anônimo**.

O linter do Supabase acusa `rls_enabled_no_policy` nas três tabelas e
`anon_security_definer_function_executable` em duas funções: **é proposital**,
é exatamente o desenho acima.

## Tabelas (`jogo_familia`)

| Tabela | O que guarda |
|---|---|
| `familias` | Um "álbum" do jogo. `id` secreto (vai na URL), `dono` → `auth.users` |
| `personagens` | Nome, papel (`mae`/`pai`/`irmao`/`parente`/`mascote`) e os CAMINHOS da foto e das vozes no storage |
| `progresso` | Figurinhas e acertos por eixo. Espelho na nuvem do que o IndexedDB já guarda offline |

Apagar a família leva personagens e progresso junto (`on delete cascade`).

## API (funções em `public`)

| Função | Quem chama | Para quê |
|---|---|---|
| `jogo_familia_carregar(p_familia uuid)` | **anon** + logado | Carrega família + personagens + progresso. É o que o jogo chama ao abrir |
| `jogo_progresso_salvar(p_familia, p_figurinhas, p_por_eixo)` | **anon** + logado | O aparelho da criança salva o progresso |
| `jogo_familias_do_dono()` | logado | Lista as famílias do adulto (tela da área dos pais) |
| `jogo_familia_criar(p_nome text)` | logado | Cria a família (dono = `auth.uid()`) |
| `jogo_personagem_salvar(p_familia, p_nome, p_papel, p_id?, p_foto_caminho?, p_voz_nome_caminho?, p_voz_festa_caminho?, p_ordem?)` | logado + dono | Cria (`p_id` nulo) ou atualiza. Caminho nulo mantém a mídia atual |
| `jogo_personagem_remover(p_id uuid)` | logado + dono | Remove um familiar |

O painel dos pais fala com isto por `@supabase/supabase-js` (precisa de sessão
e de upload no Storage). O caminho anônimo — a criança abrindo o link — usa
`fetch` cru, sem carregar o SDK. São DUAS chamadas anônimas: `..._carregar` ao
abrir o link (`src/app/entrar/page.tsx`) e `..._progresso_salvar` em segundo
plano enquanto ela joga (`src/lib/sincronia.ts`, sempre depois de gravar no
IndexedDB — a rodada nunca espera a rede). `jogo_progresso_salvar` SUBSTITUI a
linha inteira pelo retrato local, e é essa propriedade que deixa o reenvio do
que foi ganho offline ser repetível sem duplicar figurinha:

```ts
const r = await fetch(`${URL}/rest/v1/rpc/jogo_familia_carregar`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: CHAVE, Authorization: `Bearer ${CHAVE}` },
  body: JSON.stringify({ p_familia: idDaFamilia }),
});
```

## Storage

Bucket próprio: **`jogo-familia`** (5 MB por arquivo; jpeg/png/webp e
webm/mpeg/mp4/ogg).

Caminho: `<familia_id>/<personagem_id>/<foto.jpg | voz-nome.webm | voz-festa.webm>`

O bucket é `public` para o jogo montar a URL direto — o `<Personagem>` aceita
URL além de `Blob`:

```
${URL}/storage/v1/object/public/jogo-familia/<caminho>
```

**`anon` não tem policy de SELECT**, então ninguém consegue *listar* os arquivos
pela API: só chega na mídia quem já conhece os dois uuids. É o modelo de "link
não listado". Enviar/substituir/apagar exige adulto logado e dono da família — e
o dono (só ele, só nas pastas dele) também lista, porque substituir um arquivo é
`insert ... on conflict do update` e o Postgres exige SELECT para isso.

> As policies checam o dono por `public.jogo_familia_e_minha(<primeiro segmento
> do caminho>)`, uma função `SECURITY DEFINER`. Não dá para consultar
> `jogo_familia.familias` direto de dentro da policy: policy roda como o
> invocador, e `authenticated` não tem permissão nenhuma naquele schema (era
> exatamente isso que fazia todo upload falhar com `permission denied for table
> familias` — ver migrations `...160101` e `...160254`).

> Como são foto e voz de criança, vale manter o deploy protegido (Vercel
> Deployment Protection) enquanto o jogo não for para o público.

## Variáveis de ambiente (`.env.local`)

Mesmos nomes do lista-compras:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sua-chave-publicável-do-supabase>
```

(Chave publicável — pode ir para o bundle do cliente. O que **nunca** pode
aparecer no cliente é a `service_role`.)

## Migrations

Os arquivos em `migrations/` são exatamente o que já está aplicado no projeto,
com o mesmo nome e a mesma versão. Estão aqui para o schema ficar versionado
junto do jogo.

As quatro primeiras (`20260902153029`, `...153106`, `...153126`, `...153255`)
são o desenho original. As duas seguintes (`...160101`, `...160254`) consertam
as policies do bucket, que na forma original impediam qualquer upload. A
última (`...160815`) só apaga os dados da verificação ponta-a-ponta.
