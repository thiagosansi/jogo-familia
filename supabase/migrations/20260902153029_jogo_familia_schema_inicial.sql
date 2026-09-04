-- ============================================================================
-- Jogo da Família (fundo do mar) — schema isolado dentro do projeto Supabase
-- do lista-compras. NADA aqui toca o schema `public` do lista-compras: as
-- tabelas moram em `jogo_familia` e a API entra por funções `public.jogo_*`.
--
-- Modelo de acesso (o jogo NÃO tem login — a criança abre um link):
--   - o id da família (uuid v4) é a credencial: quem tem o link, joga;
--   - LEITURA para jogar: anônima, só via RPC, exigindo o uuid da família;
--   - ESCRITA (cadastrar familiar, trocar foto/voz): só `authenticated`, e só
--     o dono da família (mesmas contas do lista-compras);
--   - as tabelas têm RLS ligado e ZERO policies: ninguém acessa direto pela
--     API, só pelas funções SECURITY DEFINER da migration seguinte.
-- ============================================================================

create schema if not exists jogo_familia;

-- Uma família = um "álbum" do jogo. O id é secreto (vai na URL do jogo).
create table jogo_familia.familias (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 1 and 60),
  dono uuid not null references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);
create index familias_dono_idx on jogo_familia.familias (dono);

-- Cada familiar: foto recortada + vozes. Só CAMINHOS do storage aqui.
create table jogo_familia.personagens (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references jogo_familia.familias (id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 40),
  papel text not null check (papel in ('mae', 'pai', 'irmao', 'parente', 'mascote')),
  foto_caminho text,
  voz_nome_caminho text,
  voz_festa_caminho text,
  ordem integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index personagens_familia_idx on jogo_familia.personagens (familia_id, ordem);

-- Progresso do jogo (figurinhas + acertos por eixo). Um registro por família.
-- O IndexedDB continua sendo a fonte offline; isto é o espelho na nuvem.
create table jogo_familia.progresso (
  familia_id uuid primary key references jogo_familia.familias (id) on delete cascade,
  figurinhas jsonb not null default '[]'::jsonb,
  por_eixo jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- RLS ligado e sem policy nenhuma: acesso só pelas funções SECURITY DEFINER.
alter table jogo_familia.familias enable row level security;
alter table jogo_familia.personagens enable row level security;
alter table jogo_familia.progresso enable row level security;

-- O schema não é exposto no PostgREST; ninguém fala com ele direto.
revoke all on schema jogo_familia from anon, authenticated;
revoke all on all tables in schema jogo_familia from anon, authenticated;
