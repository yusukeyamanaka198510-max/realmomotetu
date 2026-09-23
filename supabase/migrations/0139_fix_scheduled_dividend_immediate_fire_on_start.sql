-- 0135で「定期配当が開始直後に即発生する」バグを間隔(分)モードのみ修正したが、
-- 時刻指定モード(dividend_scheduled_times)には同じ穴が残っていた。
--
-- 時刻指定モードは「last_dividend_run_atがnullなら、今日既に過ぎた指定時刻があれば
-- 即実行する」という判定のままだったため、例えば配当時刻に13:00を指定していると、
-- ゲーム開始(またはリハーサルリセット)が13:00以降であれば、開始直後の最初のポーリングで
-- 「13:00をまだ迎えていない」という前回実行記録がないことを理由に即座に配当が発生し、
-- 開始した瞬間に配当モーダルが表示されてしまっていた。
--
-- 修正: last_dividend_run_atがnullの場合の「今を起点として計測を開始するだけで今回は
-- 実行しない」という扱いを、間隔モード・時刻指定モードの分岐より前に共通化する。
-- これにより、時刻指定モードの「日中に取りこぼした指定時刻を後から拾う」という
-- 意図した挙動(last_dividend_run_atがnullでない場合)はそのまま維持される。

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

  if v_last_run is null then
    -- ゲーム開始直後・リハーサルリセット直後(前回実行日時が未設定)は、間隔モード・
    -- 時刻指定モードのどちらでも「今を起点として計測を開始する」だけにし、ここでは
    -- 実行しない(開始した瞬間に配当が発生してしまうのを防ぐ)。
    update events set last_dividend_run_at = now() where id = v_event_id;
    return;
  end if;

  if v_scheduled_times is not null and array_length(v_scheduled_times, 1) > 0 then
    -- 時刻指定モード: 今日(日本時間)の指定時刻のうち、既に過ぎていて、かつ前回実行より
    -- 後のものがあれば実行する(その日のうち一番遅い該当時刻のみ、多重実行はしない)。
    v_today := (now() at time zone 'Asia/Tokyo')::date;
    v_best_target := null;
    foreach v_t in array v_scheduled_times loop
      v_target := ((v_today::text || ' ' || v_t)::timestamp) at time zone 'Asia/Tokyo';
      if v_target <= now() and v_target > v_last_run then
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
    if now() - v_last_run < make_interval(mins => v_interval_minutes) then
      return;
    end if;
  end if;

  perform fn_run_dividend_settlement_internal(v_event_id);
end;
$$;
