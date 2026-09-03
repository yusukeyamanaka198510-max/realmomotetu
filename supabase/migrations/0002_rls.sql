-- RLS方針:
--   participant: 自チームの行のみ SELECT 可。書込は原則不可(ゲームロジックはPhase2以降でRPC(SECURITY DEFINER, postgres所有=BYPASSRLS)経由のみ許可)
--   staff: 自イベント内は全チームSELECT可。書込はRPC経由のみ
--   マスタ系(stations/lines/edges/destination_queue/station_missions)は同一event参加者なら誰でもSELECT可(ゲーム進行に必要な情報のため)

-- ===================== ヘルパー関数 =====================

create or replace function auth_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from teams where auth_user_id = auth.uid();
$$;

create or replace function auth_team_event_id() returns uuid
language sql stable security definer set search_path = public as $$
  select event_id from teams where auth_user_id = auth.uid();
$$;

create or replace function auth_staff_event_id() returns uuid
language sql stable security definer set search_path = public as $$
  select event_id from staff_users where id = auth.uid();
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_users where id = auth.uid());
$$;

create or replace function current_event_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(auth_staff_event_id(), auth_team_event_id());
$$;

-- ===================== RLS有効化 =====================

alter table events enable row level security;
alter table staff_users enable row level security;
alter table teams enable row level security;
alter table lines enable row level security;
alter table stations enable row level security;
alter table station_lines enable row level security;
alter table edges enable row level security;
alter table destination_queue enable row level security;
alter table station_missions enable row level security;
alter table team_state enable row level security;
alter table turns enable row level security;
alter table dice_rolls enable row level security;
alter table reachable_stations_snapshot enable row level security;
alter table destination_selections enable row level security;
alter table arrival_submissions enable row level security;
alter table arrival_photos enable row level security;
alter table team_mission_attempts enable row level security;
alter table mission_photos enable row level security;
alter table coin_ledger enable row level security;
alter table audit_log enable row level security;
alter table review_queue enable row level security;

-- ===================== events =====================
create policy events_select on events for select
  using (id = current_event_id());

-- ===================== staff_users =====================
create policy staff_users_select on staff_users for select
  using (event_id = auth_staff_event_id());

-- ===================== teams =====================
create policy teams_select_self on teams for select
  using (auth_user_id = auth.uid() or event_id = auth_staff_event_id());

-- ===================== マスタ系(stations/lines/edges/destination_queue/station_missions) =====================
create policy lines_select on lines for select using (event_id = current_event_id());
create policy stations_select on stations for select using (event_id = current_event_id());
create policy station_lines_select on station_lines for select
  using (exists (select 1 from stations s where s.id = station_lines.station_id and s.event_id = current_event_id()));
create policy edges_select on edges for select using (event_id = current_event_id());
create policy destination_queue_select on destination_queue for select using (event_id = current_event_id());
create policy station_missions_select on station_missions for select
  using (exists (select 1 from stations s where s.id = station_missions.station_id and s.event_id = current_event_id()));

-- ===================== チーム進行データ(自チーム or staff) =====================
create policy team_state_select on team_state for select
  using (team_id = auth_team_id() or event_id = auth_staff_event_id());

create policy turns_select on turns for select
  using (team_id = auth_team_id() or exists (
    select 1 from teams t where t.id = turns.team_id and t.event_id = auth_staff_event_id()
  ));

create policy dice_rolls_select on dice_rolls for select
  using (team_id = auth_team_id() or exists (
    select 1 from teams t where t.id = dice_rolls.team_id and t.event_id = auth_staff_event_id()
  ));

create policy reachable_stations_snapshot_select on reachable_stations_snapshot for select
  using (exists (
    select 1 from dice_rolls d join teams t on t.id = d.team_id
    where d.id = reachable_stations_snapshot.dice_roll_id
      and (t.auth_user_id = auth.uid() or t.event_id = auth_staff_event_id())
  ));

create policy destination_selections_select on destination_selections for select
  using (team_id = auth_team_id() or exists (
    select 1 from teams t where t.id = destination_selections.team_id and t.event_id = auth_staff_event_id()
  ));

create policy arrival_submissions_select on arrival_submissions for select
  using (team_id = auth_team_id() or exists (
    select 1 from teams t where t.id = arrival_submissions.team_id and t.event_id = auth_staff_event_id()
  ));

create policy arrival_photos_select on arrival_photos for select
  using (exists (
    select 1 from arrival_submissions a join teams t on t.id = a.team_id
    where a.id = arrival_photos.arrival_submission_id
      and (t.auth_user_id = auth.uid() or t.event_id = auth_staff_event_id())
  ));

create policy team_mission_attempts_select on team_mission_attempts for select
  using (team_id = auth_team_id() or exists (
    select 1 from teams t where t.id = team_mission_attempts.team_id and t.event_id = auth_staff_event_id()
  ));

create policy mission_photos_select on mission_photos for select
  using (exists (
    select 1 from team_mission_attempts m join teams t on t.id = m.team_id
    where m.id = mission_photos.mission_attempt_id
      and (t.auth_user_id = auth.uid() or t.event_id = auth_staff_event_id())
  ));

create policy coin_ledger_select on coin_ledger for select
  using (team_id = auth_team_id() or event_id = auth_staff_event_id());

-- ===================== staff専用(参加者は不可視) =====================
create policy audit_log_select on audit_log for select
  using (event_id = auth_staff_event_id());

create policy review_queue_select on review_queue for select
  using (event_id = auth_staff_event_id());

-- 注意: INSERT/UPDATE/DELETE 用のポリシーは意図的に作成しない。
-- ゲーム状態を変更する書込は Phase 2 以降で作成する SECURITY DEFINER の RPC 関数
-- (postgresロール所有 = BYPASSRLS) 経由のみで行い、クライアントからの直接書込は
-- authenticated/anon ロールには権限が無いため常に拒否される。
revoke insert, update, delete on all tables in schema public from authenticated, anon;
