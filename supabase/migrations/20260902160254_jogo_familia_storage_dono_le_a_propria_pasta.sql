-- ============================================================================
-- CONSERTO (parte 2): reenviar o mesmo personagem não substituía a mídia.
--
-- Substituir um arquivo é UPSERT no storage, e upsert em Postgres é
-- `insert ... on conflict do update` — que EXIGE policy de SELECT para enxergar
-- a linha em conflito. Sem ela, toda substituição de foto/voz morria com
-- "new row violates row-level security policy".
--
-- Isto NÃO abre o modelo de link não listado: continua não existindo SELECT
-- para `anon`, então ninguém lista o bucket pela API. Quem passa a poder listar
-- é só o ADULTO LOGADO, e só dentro das pastas das famílias que são dele.
-- ============================================================================

create policy "jogo-familia: dono le a propria pasta"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'jogo-familia'
    and public.jogo_familia_e_minha((storage.foldername(name))[1])
  );
