-- イベント開始時、各チームに「最初の目的地」「初期資金付与」の通知を送る
-- (参加者画面ではこれをきっかけに順番にモーダル演出を出す)。

create or replace function fn_start_event_core(p_event_id uuid, p_time_limit_minutes int, p_end_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dest uuid;
  v_dest_name text;
  v_end_at timestamptz;
  v_minutes int;
  v_initial_funding bigint := 50000000;
  v_default_start_station_id uuid;
  v_team record;
begin
  if p_end_at is not null then
    if p_end_at <= now() then raise exception 'end_at must be in the future'; end if;
    v_end_at := p_end_at;
    v_minutes := ceil(extract(epoch from (p_end_at - now())) / 60)::int;
  else
    v_minutes := coalesce(p_time_limit_minutes, 240);
    v_end_at := now() + make_interval(mins => v_minutes);
  end if;

  v_dest := fn_pick_next_destination(p_event_id);
  if v_dest is not null then
    select name into v_dest_name from stations where id = v_dest;
  end if;
  select start_station_id into v_default_start_station_id from events where id = p_event_id;

  update events
    set status = 'RUNNING', start_at = now(), time_limit_minutes = v_minutes,
        end_at = v_end_at,
        active_destination_station_id = coalesce(active_destination_station_id, v_dest)
    where id = p_event_id;

  for v_team in select team_id as id, selected_start_station_id from team_state where event_id = p_event_id loop
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (p_event_id, v_team.id, v_initial_funding, 'ADMIN_ADJUSTMENT', gen_random_uuid(), '初期資金', auth.uid());
    update team_state
      set coin_balance_cache = coin_balance_cache + v_initial_funding,
          current_station_id = coalesce(v_team.selected_start_station_id, v_default_start_station_id, current_station_id),
          state = 'START_CHECKIN',
          version = version + 1
      where team_id = v_team.id and state = 'WAITING';

    if v_dest_name is not null then
      perform fn_notify_team(p_event_id, v_team.id, format('🏁 最初の目的地が「%s」に設定されました', v_dest_name));
    end if;
    perform fn_notify_team(p_event_id, v_team.id,
      format('💰 初期資金として、全チームに%s円が付与されました!', to_char(v_initial_funding, 'FM999,999,999,999')));
  end loop;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (p_event_id, auth.uid(), 'EVENT_START',
      jsonb_build_object('time_limit_minutes', v_minutes, 'end_at', v_end_at, 'first_destination', v_dest, 'initial_funding', v_initial_funding));
end;
$$;
