-- 本番モード: 予約した日時になったら本部の手動操作なしで自動的にイベントを開始できるようにする。
-- (終了は既存のend_atの経過判定で参加者画面が自動的に「終了」表示になる仕組みが既にあるため、
--  開始側だけ同様の自動化を追加する)

alter table events add column if not exists auto_start_enabled boolean not null default false;
alter table events add column if not exists auto_start_time_limit_minutes int;
alter table events add column if not exists auto_start_end_at timestamptz;

-- 旧シグネチャ(開始予定時刻のみ設定)は新しいものに置き換える。
drop function if exists fn_admin_set_scheduled_start_at(timestamptz);

-- fn_admin_start_eventの本体部分を切り出し、手動開始(fn_admin_start_event)と
-- 自動開始(fn_maybe_auto_start_event)の両方から共通で呼べるようにする。
-- 呼び出し元が既にevents行をロック・認可済みである前提の内部関数。
create or replace function fn_start_event_core(p_event_id uuid, p_time_limit_minutes int, p_end_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dest uuid;
  v_end_at timestamptz;
  v_minutes int;
  v_initial_funding bigint := 50000000;
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

  update events
    set status = 'RUNNING', start_at = now(), time_limit_minutes = v_minutes,
        end_at = v_end_at,
        active_destination_station_id = coalesce(active_destination_station_id, v_dest)
    where id = p_event_id;

  for v_team in select id from teams where event_id = p_event_id loop
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (p_event_id, v_team.id, v_initial_funding, 'ADMIN_ADJUSTMENT', gen_random_uuid(), '初期資金', auth.uid());
    update team_state
      set coin_balance_cache = coin_balance_cache + v_initial_funding,
          state = 'DICE_READY',
          version = version + 1
      where team_id = v_team.id and state = 'WAITING';
  end loop;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (p_event_id, auth.uid(), 'EVENT_START',
      jsonb_build_object('time_limit_minutes', v_minutes, 'end_at', v_end_at, 'first_destination', v_dest, 'initial_funding', v_initial_funding));
end;
$$;

revoke execute on function fn_start_event_core(uuid, int, timestamptz) from public;

create or replace function fn_admin_start_event(p_time_limit_minutes int default null, p_end_at timestamptz default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_status event_status;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  select status into v_status from events where id = v_staff_event_id for update;
  if v_status <> 'SCHEDULED' then
    raise exception 'event is not scheduled (current status: %)', v_status;
  end if;

  perform fn_start_event_core(v_staff_event_id, p_time_limit_minutes, p_end_at);
end;
$$;

grant execute on function fn_admin_start_event(int, timestamptz) to authenticated;

-- 開始予定日時(参加者へのアナウンス用)に加え、自動開始の有効/無効と、
-- 自動開始時に使う終了設定(固定日時 or 分数)をまとめて保存する。
create or replace function fn_admin_schedule_start(
  p_scheduled_start_at timestamptz,
  p_auto_start_enabled boolean default false,
  p_time_limit_minutes int default null,
  p_end_at timestamptz default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if p_auto_start_enabled and p_scheduled_start_at is null then
    raise exception 'auto start requires scheduled_start_at';
  end if;
  if p_auto_start_enabled and p_end_at is not null and p_end_at <= p_scheduled_start_at then
    raise exception 'end_at must be after scheduled_start_at';
  end if;

  update events
    set scheduled_start_at = p_scheduled_start_at,
        auto_start_enabled = p_auto_start_enabled,
        auto_start_time_limit_minutes = p_time_limit_minutes,
        auto_start_end_at = p_end_at
    where id = v_staff_event_id;
end;
$$;

grant execute on function fn_admin_schedule_start(timestamptz, boolean, int, timestamptz) to authenticated;

-- 誰か(参加者・本部いずれか)がアクセスするたびに軽く呼ばれ、予約開始時刻を過ぎていれば自動的に開始する。
-- fn_maybe_run_dividend_settlementと同じポーリングの仕組みに相乗りする想定。
create or replace function fn_maybe_auto_start_event()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
  v_status event_status;
  v_auto_start_enabled boolean;
  v_scheduled_start_at timestamptz;
  v_time_limit_minutes int;
  v_end_at timestamptz;
begin
  if v_team_id is not null then
    select event_id into v_event_id from team_state where team_id = v_team_id;
  elsif v_staff_event_id is not null then
    v_event_id := v_staff_event_id;
  else
    raise exception 'not authenticated';
  end if;

  select status, auto_start_enabled, scheduled_start_at, auto_start_time_limit_minutes, auto_start_end_at
    into v_status, v_auto_start_enabled, v_scheduled_start_at, v_time_limit_minutes, v_end_at
    from events where id = v_event_id for update;

  if v_status <> 'SCHEDULED' or not v_auto_start_enabled or v_scheduled_start_at is null then
    return;
  end if;
  if now() < v_scheduled_start_at then
    return;
  end if;

  perform fn_start_event_core(v_event_id, v_time_limit_minutes, v_end_at);
end;
$$;

grant execute on function fn_maybe_auto_start_event() to authenticated;
