-- O Supabase tem `alter default privileges ... grant execute on functions to anon`,
-- então toda função nova em `public` nasce executável pelo anônimo. As funções de
-- cadastro já barram por dentro (checam auth.uid() e o dono), mas defesa em
-- profundidade: o anônimo não deve nem conseguir chamar.
revoke execute on function public.jogo_familia_criar(text) from anon;
revoke execute on function public.jogo_familias_do_dono() from anon;
revoke execute on function public.jogo_personagem_salvar(uuid, text, text, uuid, text, text, text, integer) from anon;
revoke execute on function public.jogo_personagem_remover(uuid) from anon;
