create or replace function fn_debug_timeout_test2()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_before text;
  v_after text;
begin
  v_before := current_setting('statement_timeout');
  set local statement_timeout = 1000;
  v_after := current_setting('statement_timeout');
  perform pg_sleep(5);
  return jsonb_build_object('before', v_before, 'after', v_after, 'result', 'completed without cancellation');
exception when query_canceled then
  return jsonb_build_object('before', v_before, 'after', v_after, 'result', 'caught query_canceled');
end;
$$;
