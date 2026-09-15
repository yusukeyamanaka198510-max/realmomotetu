-- リハーサルリセットで、チーム名・代表者名が元に戻らなかった
-- (リハーサル中に参加者が変更した名前が本番までそのまま残ってしまう)。
-- team_nameを「チーム{team_number}」、representative_nameをnullに戻す処理を追加する。

create or replace function fn_admin_rehearsal_reset()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_start_station_id uuid;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  select start_station_id into v_start_station_id from events where id = v_staff_event_id;

  update team_state set current_turn_id = null where event_id = v_staff_event_id;

  delete from coin_ledger where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from card_usage_log where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_mission_attempts where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_bonus_mission_attempts where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_property_purchases where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_cards where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from card_active_effects where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from card_notifications where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_start_checkins where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from turns where team_id in (select id from teams where event_id = v_staff_event_id);

  delete from review_queue where event_id = v_staff_event_id;
  delete from destination_queue where event_id = v_staff_event_id;
  delete from audit_log where event_id = v_staff_event_id;
  delete from leaderboard_snapshots where event_id = v_staff_event_id;

  -- リハーサル中に参加者が自己申告で変更したチーム名・代表者名も、
  -- 本番前にはデフォルトへ戻したい、という要望のためリセット対象に追加する。
  update teams set team_name = 'チーム' || team_number::text, representative_name = null
  where event_id = v_staff_event_id;

  update team_state set
    state = 'WAITING',
    current_station_id = v_start_station_id,
    selected_start_station_id = null,
    current_turn_id = null,
    mission_success_count = 0,
    is_paused = false,
    paused_from_state = null,
    reroll_allowed = false,
    coin_balance_cache = 0,
    has_bombii = false,
    pending_money_god_bonus = false,
    arrival_count = 0,
    card_use_count = 0
  where event_id = v_staff_event_id;

  update events set
    status = 'SCHEDULED',
    start_at = null,
    end_at = null,
    time_limit_minutes = null,
    scheduled_start_at = null,
    auto_start_enabled = false,
    auto_start_time_limit_minutes = null,
    auto_start_end_at = null,
    last_dividend_run_at = null,
    active_destination_station_id = null,
    normal_arrival_count = 0,
    money_god_awarded = false,
    last_lucky_hourly_run_at = null,
    leaderboard_snapshot_interval_minutes = 0,
    last_leaderboard_snapshot_at = null
  where id = v_staff_event_id;
end;
$$;

