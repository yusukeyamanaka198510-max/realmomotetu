-- 重大バグ修正: fn_admin_start_eventはイベントをRUNNINGにし初期資金を付与するだけで、
-- 各チームのteam_state.stateをWAITINGからDICE_READYへ遷移させる処理がどこにも
-- 存在しなかった。このため実際の本番フローでイベントを開始しても、全チームが
-- WAITINGのまま固まり、サイコロを振るボタンが一切表示されない状態になっていた
-- (これまでの動作確認はテストスクリプトで直接state上書きしていたため気づかなかった)。

create or replace function fn_admin_start_event(p_time_limit_minutes int default null, p_end_at timestamptz default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_status event_status;
  v_dest uuid;
  v_end_at timestamptz;
  v_minutes int;
  v_initial_funding bigint := 50000000;
  v_team record;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  select status into v_status from events where id = v_staff_event_id for update;
  -- 初期資金の付与を伴うため、二重クリック等でSCHEDULED以外から再度呼ばれても
  -- 二重付与しないようにガードする(以前は無条件に上書きしていた)。
  if v_status <> 'SCHEDULED' then
    raise exception 'event is not scheduled (current status: %)', v_status;
  end if;

  if p_end_at is not null then
    if p_end_at <= now() then raise exception 'end_at must be in the future'; end if;
    v_end_at := p_end_at;
    v_minutes := ceil(extract(epoch from (p_end_at - now())) / 60)::int;
  else
    v_minutes := coalesce(p_time_limit_minutes, 240);
    v_end_at := now() + make_interval(mins => v_minutes);
  end if;

  v_dest := fn_pick_next_destination(v_staff_event_id);

  update events
    set status = 'RUNNING', start_at = now(), time_limit_minutes = v_minutes,
        end_at = v_end_at,
        active_destination_station_id = coalesce(active_destination_station_id, v_dest)
    where id = v_staff_event_id;

  for v_team in select id from teams where event_id = v_staff_event_id loop
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_staff_event_id, v_team.id, v_initial_funding, 'ADMIN_ADJUSTMENT', gen_random_uuid(), '初期資金', auth.uid());
    update team_state
      set coin_balance_cache = coin_balance_cache + v_initial_funding,
          state = 'DICE_READY',
          version = version + 1
      where team_id = v_team.id and state = 'WAITING';
  end loop;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'EVENT_START',
      jsonb_build_object('time_limit_minutes', v_minutes, 'end_at', v_end_at, 'first_destination', v_dest, 'initial_funding', v_initial_funding));
end;
$$;

grant execute on function fn_admin_start_event(int, timestamptz) to authenticated;
