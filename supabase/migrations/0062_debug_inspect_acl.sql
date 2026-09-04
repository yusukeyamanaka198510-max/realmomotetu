create or replace function fn_debug_inspect_function(p_name text)
returns table(signature text, acl text[])
language sql security definer set search_path = public as $$
  select p.oid::regprocedure::text, p.proacl::text[]
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = p_name;
$$;
grant execute on function fn_debug_inspect_function(text) to authenticated;

create or replace function fn_debug_default_acl()
returns table(defaclrole text, defaclnamespace text, defaclobjtype text, defaclacl text[])
language sql security definer set search_path = public as $$
  select r.rolname, n.nspname, d.defaclobjtype::text, d.defaclacl::text[]
  from pg_default_acl d
  join pg_roles r on r.oid = d.defaclrole
  left join pg_namespace n on n.oid = d.defaclnamespace;
$$;
grant execute on function fn_debug_default_acl() to authenticated;
