-- ============================================================================
-- Storage das fotos e vozes. Bucket próprio, separado do lista-compras.
--
-- Caminho: <familia_id>/<personagem_id>/<foto.jpg | voz-nome.webm | voz-festa.webm>
--
-- O bucket é `public` para o jogo montar a URL da foto direto (o <Personagem>
-- já aceita URL), mas NÃO existe policy de SELECT: ninguém consegue LISTAR os
-- arquivos pela API. Ou seja, só chega na mídia quem já conhece os dois uuids
-- (família + personagem) — mesmo modelo de um link não listado.
-- Escrever/apagar exige adulto logado e dono da família.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'jogo-familia',
  'jogo-familia',
  true,
  5242880, -- 5 MB: foto já passa por redimensionarImagem() antes de subir
  array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg']
)
on conflict (id) do nothing;

create policy "jogo-familia: dono envia midia"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'jogo-familia'
    and exists (
      select 1 from jogo_familia.familias f
      where f.id::text = (storage.foldername(name))[1]
        and f.dono = (select auth.uid())
    )
  );

create policy "jogo-familia: dono substitui midia"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'jogo-familia'
    and exists (
      select 1 from jogo_familia.familias f
      where f.id::text = (storage.foldername(name))[1]
        and f.dono = (select auth.uid())
    )
  );

create policy "jogo-familia: dono apaga midia"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'jogo-familia'
    and exists (
      select 1 from jogo_familia.familias f
      where f.id::text = (storage.foldername(name))[1]
        and f.dono = (select auth.uid())
    )
  );
