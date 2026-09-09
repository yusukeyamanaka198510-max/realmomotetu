-- 9/15リハーサル・当日までの試運転のたびに、都度スクリプトを実行させるのは
-- 運用上つらいため、本部画面から1クリックでできる「リハーサルリセット」を追加する。
-- 内容はscripts/reset-for-rehearsal.tsと同じ(チーム・スタッフのアカウント自体は
-- 残したまま、進行データだけを全て消してイベントをまっさらなSCHEDULED状態に戻す)。
create or replace function fn_admin_rehearsal_reset()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_start_station_id uuid;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  select current_station_id into v_start_station_id
    from team_state
    where event_id = v_staff_event_id and current_station_id is not null
    limit 1;

  update team_state set current_turn_id = null where event_id = v_staff_event_id;

  delete from team_mission_attempts where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_bonus_mission_attempts where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_property_purchases where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_cards where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from card_active_effects where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from card_notifications where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from card_usage_log where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from coin_ledger where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from turns where team_id in (select id from teams where event_id = v_staff_event_id);

  delete from review_queue where event_id = v_staff_event_id;
  delete from destination_queue where event_id = v_staff_event_id;
  delete from audit_log where event_id = v_staff_event_id;
  delete from leaderboard_snapshots where event_id = v_staff_event_id;

  update team_state set
    state = 'WAITING',
    current_station_id = v_start_station_id,
    current_turn_id = null,
    mission_success_count = 0,
    is_paused = false,
    paused_from_state = null,
    reroll_allowed = false,
    coin_balance_cache = 0,
    has_bombii = false,
    pending_money_god_bonus = false
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
    money_god_awarded = false
  where id = v_staff_event_id;
end;
$$;
grant execute on function fn_admin_rehearsal_reset() to authenticated;
