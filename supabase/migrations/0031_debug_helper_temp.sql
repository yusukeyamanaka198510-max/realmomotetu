-- 一時的なデバッグ用ヘルパー(本番運用に影響なし、レビュー後に削除予定)
create or replace function fn_debug_get_source(p_name text)
returns text
language sql security definer set search_path = public as $$
  select pg_get_functiondef(p_name::regproc);
$$;
grant execute on function fn_debug_get_source(text) to authenticated;
