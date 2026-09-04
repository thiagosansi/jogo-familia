-- ============================================================================
-- CONSERTO: ninguém conseguia subir foto nem voz.
--
-- As policies do bucket `jogo-familia` checavam o dono com um `select` direto em
-- `jogo_familia.familias`. Só que policy de storage roda como o INVOCADOR
-- (`authenticated`), e a migration inicial fez, de propósito,
-- `revoke all on schema/tables in jogo_familia from anon, authenticated`.
-- Resultado: todo upload morria com `permission denied for table familias`.
--
-- A correção mantém o desenho intacto (só o dono escreve) e usa o mesmo
-- mecanismo do resto da API: uma função `SECURITY DEFINER` em `public`, com
-- `search_path` travado. Ela recebe TEXT — o primeiro segmento do caminho — e
-- não uuid: um caminho torto não pode virar erro de cast, tem que virar
-- "não pode".
-- ============================================================================

create or replace function public.jogo_familia_e_minha(p_familia text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from jogo_familia.familias f
    where f.id::text = p_familia and f.dono = (select auth.uid())
  );
$$;

revoke execute on function public.jogo_familia_e_minha(text) from public, anon;
grant execute on function public.jogo_familia_e_minha(text) to authenticated;

drop policy if exists "jogo-familia: dono envia midia" on storage.objects;
drop policy if exists "jogo-familia: dono substitui midia" on storage.objects;
drop policy if exists "jogo-familia: dono apaga midia" on storage.objects;

create policy "jogo-familia: dono envia midia"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'jogo-familia'
    and public.jogo_familia_e_minha((storage.foldername(name))[1])
  );

create policy "jogo-familia: dono substitui midia"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'jogo-familia'
    and public.jogo_familia_e_minha((storage.foldername(name))[1])
  );

create policy "jogo-familia: dono apaga midia"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'jogo-familia'
    and public.jogo_familia_e_minha((storage.foldername(name))[1])
  );
