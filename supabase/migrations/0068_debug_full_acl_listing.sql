create or replace function fn_debug_list_all_function_acls()
returns table(fn_name text, signature text, callable_by_authenticated boolean, callable_by_anon boolean)
language sql security definer set search_path = public as $$
  select
    p.proname,
    p.oid::regprocedure::text,
    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    has_function_privilege('anon', p.oid, 'EXECUTE')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'fn_%'
  order by p.proname;
$$;
grant execute on function fn_debug_list_all_function_acls() to authenticated;
