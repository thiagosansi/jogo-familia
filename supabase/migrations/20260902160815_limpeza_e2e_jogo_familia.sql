-- ============================================================================
-- Limpeza dos dados criados pela verificação ponta-a-ponta da sincronização
-- (contas descartáveis + as famílias que elas criaram). Fica versionada porque
-- foi aplicada no projeto; num banco novo é no-op.
-- ============================================================================

delete from jogo_familia.familias
where dono in (
  select id from auth.users where email like 'teste.jogo.familia.%@mailinator.com'
);

delete from auth.users where email like 'teste.jogo.familia.%@mailinator.com';

-- Apaga também os registros anteriores desta mesma limpeza, para o histórico
-- de migrations não encher de linhas iguais.
delete from supabase_migrations.schema_migrations where name = 'limpeza_e2e_jogo_familia';
