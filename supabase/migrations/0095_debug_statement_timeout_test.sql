-- 一時的な調査用関数。SET LOCAL statement_timeoutが実際に効くかを検証する。
-- 検証後、後続のマイグレーションで削除する。
create or replace function fn_debug_timeout_test()
returns text
language plpgsql security definer set search_path = public as $$
begin
  set local statement_timeout = '1s';
  perform pg_sleep(5);
  return 'completed without cancellation';
exception when query_canceled then
  return 'caught query_canceled as expected';
end;
$$;
