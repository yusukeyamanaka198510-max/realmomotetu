-- fn_maybe_run_dividend_settlement / fn_maybe_run_lucky_hourly_bonus / fn_maybe_take_leaderboard_snapshot は
-- いずれも「前回実行日時(last_*_run_at)がnullなら『無限に未実行』とみなして即実行する」という
-- 同一のバグを抱えていた。last_*_run_atはゲーム開始時・リハーサルリセット時に必ずnullへ戻される
-- (0108/0113/0132/0134参照)ため、ゲーム開始直後の最初のポーリングで
--   ・配当が即座に発生する(ログイン時に配当アナウンスが流れる)
--   ・ラッキーボーナスが即座に発生する
--   ・順位表スナップショットが即座に記録される
-- という意図しない動作を引き起こしていた。
--
-- 修正方針: last_*_run_atがnullの場合は「即実行」ではなく「今を起点として計測を開始する」
-- (nowをセットして今回は何もせず終了)。これにより、開始直後は必ず1間隔ぶん待ってから
-- 初回実行されるようになる(時刻指定モードの配当は「今日既に過ぎた時刻があれば実行する」という
-- 別の意図的な挙動のため、こちらは変更しない)。

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
    if v_last_run is null then
      -- ゲーム開始直後(前回実行日時が未設定)は、今を起点として計測を開始するだけにし、
      -- ここでは実行しない(即座に配当が発生してしまうのを防ぐ)。
      update events set last_dividend_run_at = now() where id = v_event_id;
      return;
    end if;
    if now() - v_last_run < make_interval(mins => v_interval_minutes) then
      return;
    end if;
  end if;

  perform fn_run_dividend_settlement_internal(v_event_id);
end;
$$;

create or replace function fn_maybe_run_lucky_hourly_bonus()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
  v_status event_status;
  v_last_run timestamptz;
  v_row record;
  v_amounts bigint[] := array[30000000, 20000000, 10000000];
  v_labels text[] := array['最下位', '下から2番目', '下から3番目'];
begin
  if v_team_id is not null then
    select event_id into v_event_id from team_state where team_id = v_team_id;
  elsif v_staff_event_id is not null then
    v_event_id := v_staff_event_id;
  else
    return;
  end if;
  if v_event_id is null then
    return;
  end if;

  select status, last_lucky_hourly_run_at into v_status, v_last_run from events where id = v_event_id for update;
  if v_status <> 'RUNNING' then
    return;
  end if;
  if v_last_run is null then
    -- ゲーム開始直後は今を起点として計測を開始するだけにし、ここでは実行しない。
    update events set last_lucky_hourly_run_at = now() where id = v_event_id;
    return;
  end if;
  if now() - v_last_run < interval '60 minutes' then
    return;
  end if;

  update events set last_lucky_hourly_run_at = now() where id = v_event_id;

  for v_row in
    select team_id, dense_rank() over (order by coin_balance_cache asc) as rnk
    from team_state where event_id = v_event_id
  loop
    if v_row.rnk between 1 and 3 then
      perform fn_grant_lucky_bonus(
        v_row.team_id, v_event_id, v_amounts[v_row.rnk],
        format('順位ボーナス(%s)', v_labels[v_row.rnk]),
        format('🍀ラッキーボーナス!%sのあなたに、運営からささやかなプレゼントだよ!まだまだあきらめずに頑張ってね!+%s円',
          v_labels[v_row.rnk], to_char(v_amounts[v_row.rnk], 'FM999,999,999'))
      );
    end if;
  end loop;
end;
$$;

create or replace function fn_maybe_take_leaderboard_snapshot()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
  v_interval_minutes int;
  v_last_run timestamptz;
begin
  if v_team_id is not null then
    select event_id into v_event_id from team_state where team_id = v_team_id;
  elsif v_staff_event_id is not null then
    v_event_id := v_staff_event_id;
  else
    return;
  end if;
  if v_event_id is null then
    return;
  end if;

  select leaderboard_snapshot_interval_minutes, last_leaderboard_snapshot_at
    into v_interval_minutes, v_last_run
    from events where id = v_event_id for update;

  if v_interval_minutes <= 0 then
    return;
  end if;
  if v_last_run is null then
    -- ゲーム開始直後は今を起点として計測を開始するだけにし、ここでは記録しない。
    update events set last_leaderboard_snapshot_at = now() where id = v_event_id;
    return;
  end if;
  if now() - v_last_run < make_interval(mins => v_interval_minutes) then
    return;
  end if;

  perform fn_take_leaderboard_snapshot_core(v_event_id, '自動記録');
  update events set last_leaderboard_snapshot_at = now() where id = v_event_id;
end;
$$;
