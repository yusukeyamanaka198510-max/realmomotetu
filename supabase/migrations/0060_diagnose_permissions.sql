create or replace function fn_debug_check_privilege(p_func_signature text)
returns boolean
language sql security definer set search_path = public as $$
  select has_function_privilege('authenticated', p_func_signature, 'EXECUTE');
$$;
grant execute on function fn_debug_check_privilege(text) to authenticated;
