-- ゲーム開始時に全チームへ初期資金5000万円を付与する。
-- あわせて、0014/0008で作られた古い1引数版のオーバーロードが未削除のまま残っており、
-- p_end_atを省略して呼ぶとPostgRESTが候補を一意に決められずエラーになる潜在バグを解消する
-- (実際のクライアントは常に両方の引数を渡しているため本番影響は無かったが、掃除しておく)。
drop function if exists fn_admin_start_event(int);

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
    update team_state set coin_balance_cache = coin_balance_cache + v_initial_funding where team_id = v_team.id;
  end loop;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'EVENT_START',
      jsonb_build_object('time_limit_minutes', v_minutes, 'end_at', v_end_at, 'first_destination', v_dest, 'initial_funding', v_initial_funding));
end;
$$;
