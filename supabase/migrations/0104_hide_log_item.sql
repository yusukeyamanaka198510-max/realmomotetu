-- アクションログの項目削除ボタン。coin_ledger/card_usage_logは金銭・監査の実データなので
-- 物理削除はせず、一覧表示から外すだけの論理削除(hidden_from_log_at)にする。
alter table coin_ledger add column if not exists hidden_from_log_at timestamptz;
alter table card_usage_log add column if not exists hidden_from_log_at timestamptz;

create or replace function fn_admin_hide_log_item(p_source_table text, p_source_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  if p_source_table = 'coin_ledger' then
    update coin_ledger set hidden_from_log_at = now() where id = p_source_id and event_id = v_staff_event_id;
  elsif p_source_table = 'card_usage_log' then
    update card_usage_log set hidden_from_log_at = now() where id = p_source_id and event_id = v_staff_event_id;
  else
    raise exception 'invalid source_table: %', p_source_table;
  end if;
end;
$$;
grant execute on function fn_admin_hide_log_item(text, uuid) to authenticated;
