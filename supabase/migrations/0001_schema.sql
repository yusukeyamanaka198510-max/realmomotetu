-- リアル桃鉄 v1 スキーマ (Phase 1)
-- 命名規則: snake_case / 主キーは uuid default gen_random_uuid()

create extension if not exists "pgcrypto";

-- ===================== ENUM =====================

create type staff_role as enum ('ADMIN', 'STAFF');

create type event_status as enum ('SCHEDULED', 'RUNNING', 'FORCE_ENDED', 'ENDED');

create type mission_difficulty as enum ('EASY', 'NORMAL', 'HARD');

create type team_game_state as enum (
  'WAITING',
  'DICE_READY',
  'ROLLING',
  'DESTINATION_SELECTION',
  'TRAVELING',
  'ARRIVAL_SUBMISSION',
  'ARRIVAL_REVIEW',
  'MISSION_SELECTION',
  'MISSION_ACTIVE',
  'MISSION_REVIEW',
  'PAUSED',
  'FINISHED'
);

create type turn_status as enum ('IN_PROGRESS', 'COMPLETED', 'ABORTED');

create type arrival_status as enum ('PENDING', 'APPROVED', 'REJECTED');

create type mission_attempt_status as enum ('AWAITING_PHOTO', 'PENDING_REVIEW', 'SUCCESS', 'FAILURE');

create type coin_transaction_type as enum (
  'MISSION_SUCCESS',
  'MISSION_FAILURE',
  'MISSION_5X_BONUS',
  'DESTINATION_BONUS',
  'LATE_PENALTY',
  'ADMIN_ADJUSTMENT'
);

create type destination_status as enum ('PENDING', 'ACTIVE', 'CLEARED');

create type review_queue_type as enum ('ARRIVAL', 'MISSION');
create type review_queue_status as enum ('OPEN', 'CLAIMED', 'RESOLVED');

-- ===================== イベント / 権限 =====================

create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status event_status not null default 'SCHEDULED',
  start_at timestamptz,
  end_at timestamptz,
  time_limit_minutes int,
  start_station_id uuid,               -- 後でFK追加(stations作成後)
  default_destination_bonus_amount bigint not null default 3000,
  mission_bonus_interval int not null default 5,
  mission_bonus_multiplier numeric not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff_users (
  id uuid primary key references auth.users (id) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  display_name text not null,
  role staff_role not null default 'STAFF',
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  team_number int not null,
  team_name text not null,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, team_number)
);

-- ===================== 路線・駅 =====================

create table lines (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table stations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table events
  add constraint events_start_station_fk foreign key (start_station_id) references stations (id);

create table station_lines (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations (id) on delete cascade,
  line_id uuid not null references lines (id) on delete cascade,
  unique (station_id, line_id)
);

create table edges (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  station_a_id uuid not null references stations (id) on delete cascade,
  station_b_id uuid not null references stations (id) on delete cascade,
  line_id uuid not null references lines (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (station_a_id <> station_b_id)
);
create index edges_station_a_idx on edges (station_a_id);
create index edges_station_b_idx on edges (station_b_id);

-- ===================== 最終目的地キュー =====================

create table destination_queue (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  station_id uuid not null references stations (id),
  sequence_order int not null,
  bonus_coin_amount bigint,             -- null なら events.default_destination_bonus_amount を使用
  status destination_status not null default 'PENDING',
  cleared_by_team_id uuid references teams (id),
  cleared_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, sequence_order)
);
create unique index destination_queue_one_active_idx
  on destination_queue (event_id)
  where status = 'ACTIVE';

-- ===================== ミッション(駅ごと9個: 各難易度3個) =====================

create table station_missions (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations (id) on delete cascade,
  difficulty mission_difficulty not null,
  title text not null,
  description text not null,
  success_reward int,     -- null なら難易度デフォルト(500/1000/2000)
  failure_penalty int,    -- null なら難易度デフォルト(250/500/1000)
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index station_missions_station_idx on station_missions (station_id);

-- ===================== チーム進行状態 =====================

create table team_state (
  team_id uuid primary key references teams (id) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  state team_game_state not null default 'WAITING',
  current_station_id uuid references stations (id),
  current_turn_id uuid,
  mission_success_count int not null default 0,
  is_paused boolean not null default false,
  reroll_allowed boolean not null default false,
  coin_balance_cache bigint not null default 0,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table turns (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  turn_number int not null,
  previous_station_id uuid references stations (id),
  next_station_id uuid references stations (id),
  status turn_status not null default 'IN_PROGRESS',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (team_id, turn_number)
);

alter table team_state
  add constraint team_state_current_turn_fk foreign key (current_turn_id) references turns (id);

-- ===================== サイコロ =====================

create table dice_rolls (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  turn_id uuid not null references turns (id) on delete cascade,
  idempotency_key uuid not null unique,
  dice_count int not null default 1,
  individual_results int[] not null,
  total int not null,
  used_card_id uuid,
  is_valid boolean not null default true,
  invalidated_at timestamptz,
  invalidated_by uuid references staff_users (id),
  invalidation_reason text,
  rolled_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id)
);

create table reachable_stations_snapshot (
  id uuid primary key default gen_random_uuid(),
  dice_roll_id uuid not null references dice_rolls (id) on delete cascade,
  station_id uuid not null references stations (id),
  used_relaxed_revisit_rule boolean not null default false
);

create table destination_selections (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  turn_id uuid not null references turns (id) on delete cascade,
  dice_roll_id uuid not null references dice_rolls (id),
  selected_station_id uuid not null references stations (id),
  idempotency_key uuid not null unique,
  confirmed_at timestamptz not null default now()
);

-- ===================== 到着 =====================

create table arrival_submissions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  turn_id uuid not null references turns (id) on delete cascade,
  station_id uuid not null references stations (id),
  status arrival_status not null default 'PENDING',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references staff_users (id),
  reviewed_at timestamptz,
  review_reason text
);

create table arrival_photos (
  id uuid primary key default gen_random_uuid(),
  arrival_submission_id uuid not null references arrival_submissions (id) on delete cascade,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

-- ===================== ミッション実行 =====================

create table team_mission_attempts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  turn_id uuid not null references turns (id) on delete cascade,
  station_id uuid not null references stations (id),
  offered_mission_ids uuid[] not null,
  selected_mission_id uuid references station_missions (id),
  locked_at timestamptz,
  attempt_number int not null default 1,
  status mission_attempt_status not null default 'AWAITING_PHOTO',
  is_bonus_applied boolean not null default false,
  reviewed_by uuid references staff_users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table mission_photos (
  id uuid primary key default gen_random_uuid(),
  mission_attempt_id uuid not null references team_mission_attempts (id) on delete cascade,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

-- ===================== コインLedger =====================

create table coin_ledger (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  amount bigint not null,
  transaction_type coin_transaction_type not null,
  related_mission_attempt_id uuid references team_mission_attempts (id),
  related_turn_id uuid references turns (id),
  idempotency_key uuid not null unique,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);
create index coin_ledger_team_idx on coin_ledger (team_id);

-- ===================== Audit Log (Append Only) =====================

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  staff_id uuid references staff_users (id),
  team_id uuid references teams (id),
  action_type text not null,
  before_value jsonb,
  after_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index audit_log_event_idx on audit_log (event_id);

-- ===================== 本部レビューキュー =====================

create table review_queue (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  type review_queue_type not null,
  ref_id uuid not null,
  status review_queue_status not null default 'OPEN',
  claimed_by uuid references staff_users (id),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index review_queue_open_idx on review_queue (event_id, status);

-- ===================== updated_at 自動更新 =====================

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger events_set_updated_at before update on events
  for each row execute function set_updated_at();
create trigger team_state_set_updated_at before update on team_state
  for each row execute function set_updated_at();
