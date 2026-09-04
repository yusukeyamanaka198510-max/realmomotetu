create or replace function fn_debug_inspect_function(p_name text)
returns table(signature text, acl text[])
language sql security definer set search_path = public as $$
  select p.oid::regprocedure::text, p.proacl::text[]
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = p_name;
$$;
grant execute on function fn_debug_inspect_function(text) to authenticated;
