-- ============================================================================
-- API do jogo. Só estas funções ficam em `public` (prefixo `jogo_` para não se
-- misturar com o lista-compras). Todas com search_path travado.
-- ============================================================================

-- ---------------------------------------------------------------- LEITURA
-- Carrega a família inteira para jogar. Anônima de propósito: a criança abre
-- o link e joga. A credencial é o próprio uuid (122 bits — não se adivinha).
create or replace function public.jogo_familia_carregar(p_familia uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'familia', jsonb_build_object('id', f.id, 'nome', f.nome),
    'personagens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'nome', p.nome,
        'papel', p.papel,
        'fotoCaminho', p.foto_caminho,
        'vozNomeCaminho', p.voz_nome_caminho,
        'vozFestaCaminho', p.voz_festa_caminho
      ) order by p.ordem, p.criado_em)
      from jogo_familia.personagens p
      where p.familia_id = f.id
    ), '[]'::jsonb),
    'progresso', coalesce((
      select jsonb_build_object('figurinhas', g.figurinhas, 'porEixo', g.por_eixo)
      from jogo_familia.progresso g where g.familia_id = f.id
    ), jsonb_build_object('figurinhas', '[]'::jsonb, 'porEixo', '{}'::jsonb))
  )
  from jogo_familia.familias f
  where f.id = p_familia;
$$;

-- Famílias do adulto logado (tela de escolha na área dos pais).
create or replace function public.jogo_familias_do_dono()
returns table (id uuid, nome text, criado_em timestamptz, personagens bigint)
language sql
security definer
set search_path = ''
stable
as $$
  select f.id, f.nome, f.criado_em,
         (select count(*) from jogo_familia.personagens p where p.familia_id = f.id)
  from jogo_familia.familias f
  where f.dono = (select auth.uid())
  order by f.criado_em;
$$;

-- ---------------------------------------------------------------- ESCRITA
create or replace function public.jogo_familia_criar(p_nome text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_dono uuid := (select auth.uid());
begin
  if v_dono is null then
    raise exception 'Precisa estar logado para criar uma família.' using errcode = '42501';
  end if;
  insert into jogo_familia.familias (nome, dono) values (p_nome, v_dono) returning id into v_id;
  insert into jogo_familia.progresso (familia_id) values (v_id);
  return v_id;
end;
$$;

-- Cria ou atualiza um familiar. `p_id` nulo cria; preenchido atualiza.
create or replace function public.jogo_personagem_salvar(
  p_familia uuid,
  p_nome text,
  p_papel text,
  p_id uuid default null,
  p_foto_caminho text default null,
  p_voz_nome_caminho text default null,
  p_voz_festa_caminho text default null,
  p_ordem integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from jogo_familia.familias f
    where f.id = p_familia and f.dono = (select auth.uid())
  ) then
    raise exception 'Família inexistente ou não é sua.' using errcode = '42501';
  end if;

  if p_id is null then
    insert into jogo_familia.personagens
      (familia_id, nome, papel, foto_caminho, voz_nome_caminho, voz_festa_caminho, ordem)
    values
      (p_familia, p_nome, p_papel, p_foto_caminho, p_voz_nome_caminho, p_voz_festa_caminho, p_ordem)
    returning id into v_id;
  else
    update jogo_familia.personagens p set
      nome = p_nome,
      papel = p_papel,
      -- caminho nulo mantém a mídia atual (troca só o que foi enviado de novo)
      foto_caminho = coalesce(p_foto_caminho, p.foto_caminho),
      voz_nome_caminho = coalesce(p_voz_nome_caminho, p.voz_nome_caminho),
      voz_festa_caminho = coalesce(p_voz_festa_caminho, p.voz_festa_caminho),
      ordem = p_ordem,
      atualizado_em = now()
    where p.id = p_id and p.familia_id = p_familia
    returning p.id into v_id;

    if v_id is null then
      raise exception 'Personagem não encontrado nessa família.' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.jogo_personagem_remover(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from jogo_familia.personagens p
  using jogo_familia.familias f
  where p.id = p_id and p.familia_id = f.id and f.dono = (select auth.uid());
  if not found then
    raise exception 'Personagem inexistente ou não é seu.' using errcode = '42501';
  end if;
end;
$$;

-- Progresso é salvo pelo aparelho da criança (sem login), por isso é anônimo.
-- Só sobrescreve o progresso de uma família que existe.
create or replace function public.jogo_progresso_salvar(
  p_familia uuid,
  p_figurinhas jsonb,
  p_por_eixo jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from jogo_familia.familias f where f.id = p_familia) then
    raise exception 'Família inexistente.' using errcode = 'P0002';
  end if;
  insert into jogo_familia.progresso (familia_id, figurinhas, por_eixo, atualizado_em)
  values (p_familia, coalesce(p_figurinhas, '[]'::jsonb), coalesce(p_por_eixo, '{}'::jsonb), now())
  on conflict (familia_id) do update
    set figurinhas = excluded.figurinhas,
        por_eixo = excluded.por_eixo,
        atualizado_em = now();
end;
$$;

-- --------------------------------------------------------------- permissões
revoke execute on function public.jogo_familia_carregar(uuid) from public;
revoke execute on function public.jogo_familias_do_dono() from public;
revoke execute on function public.jogo_familia_criar(text) from public;
revoke execute on function public.jogo_personagem_salvar(uuid, text, text, uuid, text, text, text, integer) from public;
revoke execute on function public.jogo_personagem_remover(uuid) from public;
revoke execute on function public.jogo_progresso_salvar(uuid, jsonb, jsonb) from public;

-- A criança (anon) só lê a família pelo uuid e grava progresso.
grant execute on function public.jogo_familia_carregar(uuid) to anon, authenticated;
grant execute on function public.jogo_progresso_salvar(uuid, jsonb, jsonb) to anon, authenticated;

-- Cadastro é coisa de adulto logado.
grant execute on function public.jogo_familias_do_dono() to authenticated;
grant execute on function public.jogo_familia_criar(text) to authenticated;
grant execute on function public.jogo_personagem_salvar(uuid, text, text, uuid, text, text, text, integer) to authenticated;
grant execute on function public.jogo_personagem_remover(uuid) to authenticated;
