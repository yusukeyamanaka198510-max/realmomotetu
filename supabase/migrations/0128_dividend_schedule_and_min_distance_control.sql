-- ⑦ 次ゴール候補が「直前のゴールから最低何マス離れているか」を決める
-- min_destination_distance_hops (デフォルト8)が、本部画面から一切変更できなかった。
-- 都営線・西武線を追加して路線網が密になった結果、「8マス」が到達する実際の範囲が
-- 広がり、候補15駅のうち互いに8マス以上離れている組み合わせがごく一部しかなくなり、
-- その狭い組み合わせだけでゴールが回り続けてしまっていた。本部から調整できるようにする。

create or replace function fn_admin_set_min_destination_distance(p_hops int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if p_hops < 0 then raise exception 'p_hops must be >= 0'; end if;
  update events set min_destination_distance_hops = p_hops where id = v_staff_event_id;
end;
$$;
grant execute on function fn_admin_set_min_destination_distance(int) to authenticated;

-- ⑥ 定期配当を「間隔(分)」ではなく「時刻を複数指定」でも実行できるようにする
-- (本番では毎時00分等、きりの良い時刻に実行したいという要望のため)。
-- dividend_scheduled_timesが1件以上設定されている場合はそちらを優先し、
-- 空の場合は従来通りdividend_interval_minutesベースの間隔実行にフォールバックする。

alter table events add column if not exists dividend_scheduled_times text[] not null default '{}';

create or replace function fn_admin_set_dividend_schedule(p_times text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_t text;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  foreach v_t in array coalesce(p_times, array[]::text[]) loop
    if v_t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'invalid time format (expected HH:MM): %', v_t;
    end if;
  end loop;
  update events set dividend_scheduled_times = (
    select coalesce(array_agg(distinct x order by x), array[]::text[]) from unnest(coalesce(p_times, array[]::text[])) x
  ) where id = v_staff_event_id;
end;
$$;
grant execute on function fn_admin_set_dividend_schedule(text[]) to authenticated;

create or replace function fn_maybe_run_dividend_settlement()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
  v_status event_status;
  v_interval_minutes int;
  v_last_run timestamptz;
  v_scheduled_times text[];
  v_t text;
  v_target timestamptz;
  v_best_target timestamptz;
  v_today date;
begin
  if v_team_id is not null then
    select event_id into v_event_id from team_state where team_id = v_team_id;
  elsif v_staff_event_id is not null then
    v_event_id := v_staff_event_id;
  else
    raise exception 'not authenticated';
  end if;

  select status, dividend_interval_minutes, last_dividend_run_at, dividend_scheduled_times
    into v_status, v_interval_minutes, v_last_run, v_scheduled_times
    from events where id = v_event_id for update;

  if v_status <> 'RUNNING' then
    return;
  end if;

  if v_scheduled_times is not null and array_length(v_scheduled_times, 1) > 0 then
    -- 時刻指定モード: 今日(日本時間)の指定時刻のうち、既に過ぎていて、かつ前回実行より
    -- 後のものがあれば実行する(その日のうち一番遅い該当時刻のみ、多重実行はしない)。
    v_today := (now() at time zone 'Asia/Tokyo')::date;
    v_best_target := null;
    foreach v_t in array v_scheduled_times loop
      v_target := ((v_today::text || ' ' || v_t)::timestamp) at time zone 'Asia/Tokyo';
      if v_target <= now() and (v_last_run is null or v_target > v_last_run) then
        if v_best_target is null or v_target > v_best_target then
          v_best_target := v_target;
        end if;
      end if;
    end loop;
    if v_best_target is null then
      return;
    end if;
  else
    -- 従来の間隔(分)モード
    if v_interval_minutes <= 0 then
      return;
    end if;
    if v_last_run is not null and now() - v_last_run < make_interval(mins => v_interval_minutes) then
      return;
    end if;
  end if;

  perform fn_run_dividend_settlement_internal(v_event_id);
end;
$$;
grant execute on function fn_maybe_run_dividend_settlement() to authenticated;
