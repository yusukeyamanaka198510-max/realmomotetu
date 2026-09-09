-- アクションログの「アナウンス済み」状態が本部のブラウザのその場限りの状態だったため、
-- ページ再読み込みで忘れてしまい、同じ内容を誤って再送しかねなかった。
-- 元データ(coin_ledger / card_usage_log)にannounced_atを持たせ、DB側で永続化する。
alter table coin_ledger add column if not exists announced_at timestamptz;
alter table card_usage_log add column if not exists announced_at timestamptz;

-- create or replaceは引数リストが違うと別関数として追加されてしまうため、旧シグネチャを明示的に削除する。
drop function if exists fn_admin_broadcast_announcement(text);

create or replace function fn_admin_broadcast_announcement(
  p_message text,
  p_source_table text default null,
  p_source_id uuid default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team record;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if p_message is null or trim(p_message) = '' then raise exception 'message is required'; end if;

  for v_team in select id from teams where event_id = v_staff_event_id loop
    perform fn_notify_team(v_staff_event_id, v_team.id, format('📢本部アナウンス: %s', p_message));
  end loop;

  if p_source_table = 'coin_ledger' and p_source_id is not null then
    update coin_ledger set announced_at = now() where id = p_source_id and event_id = v_staff_event_id;
  elsif p_source_table = 'card_usage_log' and p_source_id is not null then
    update card_usage_log set announced_at = now() where id = p_source_id and event_id = v_staff_event_id;
  end if;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'ADMIN_ANNOUNCEMENT', jsonb_build_object('message', p_message));
end;
$$;

grant execute on function fn_admin_broadcast_announcement(text, text, uuid) to authenticated;
