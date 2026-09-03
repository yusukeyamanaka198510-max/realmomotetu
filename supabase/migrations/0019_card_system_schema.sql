-- カード機能 本実装: スキーマ再設計
-- Phase 8で作った station_cards(駅ごとの名前だけのカード)/team_cards(1枚1行) は
-- 実データが入っていない(テストスクリプトの一時データのみ)ため、正式なカードカタログ設計に置き換える。

drop table if exists team_cards cascade;
drop table if exists station_cards cascade;

-- ===================== カードカタログ(全チーム共通のマスタ) =====================

create table cards (
  id uuid primary key default gen_random_uuid(),
  card_code text not null unique,
  name text not null,
  category text not null check (category in ('MOVEMENT', 'OBSTRUCTION', 'DEFENSE', 'MISSION', 'PROPERTY', 'SPECIAL')),
  rarity text not null check (rarity in ('NORMAL', 'RARE', 'SUPER_RARE')),
  description text not null,
  effect_type text not null,
  effect_value jsonb not null default '{}',
  use_timing text not null,
  target_type text not null default 'NONE' check (target_type in ('NONE', 'OTHER_TEAM', 'SELF')),
  usable_conditions jsonb not null default '{}',
  max_quantity int,
  purchase_price bigint,
  exchangeable boolean not null default true,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- レアリティ別の出現比率(イベントごとに管理画面から変更可能)
create table card_rarity_weights (
  event_id uuid not null references events (id) on delete cascade,
  rarity text not null check (rarity in ('NORMAL', 'RARE', 'SUPER_RARE')),
  weight int not null check (weight >= 0),
  primary key (event_id, rarity)
);

-- 駅ごとのカード出現プール(どの駅でどのカードが手に入りうるか)。空なら全カードが対象。
create table station_card_pool (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations (id) on delete cascade,
  card_id uuid not null references cards (id) on delete cascade,
  is_active boolean not null default true,
  unique (station_id, card_id)
);
create index station_card_pool_station_idx on station_card_pool (station_id);

-- ===================== チーム所持カード(数量管理) =====================

create table team_cards (
  team_id uuid not null references teams (id) on delete cascade,
  card_id uuid not null references cards (id),
  quantity int not null default 0 check (quantity >= 0),
  acquired_at timestamptz not null default now(),
  primary key (team_id, card_id)
);

-- ===================== 使用履歴 =====================

create table card_usage_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  card_id uuid not null references cards (id),
  target_team_id uuid references teams (id),
  idempotency_key uuid not null unique,
  turn_id uuid references turns (id),
  result text not null,
  effect_detail jsonb not null default '{}',
  used_at timestamptz not null default now()
);
create index card_usage_log_team_idx on card_usage_log (team_id);
create index card_usage_log_event_idx on card_usage_log (event_id);

-- ===================== 効果の有効期限管理(次回移動まで、次回ミッションまで等) =====================

create table card_active_effects (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  effect_type text not null,
  source_card_id uuid references cards (id),
  source_team_id uuid references teams (id),
  remaining_uses int not null default 1,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);
create index card_active_effects_lookup_idx on card_active_effects (team_id, effect_type) where consumed_at is null;

-- ===================== ボーナスミッション(通常ミッションとは別管理) =====================

create table team_bonus_mission_attempts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  turn_id uuid not null references turns (id) on delete cascade,
  station_id uuid not null references stations (id),
  mission_id uuid not null references station_missions (id),
  status mission_attempt_status not null default 'AWAITING_PHOTO',
  reward bigint not null,
  reviewed_by uuid references staff_users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table bonus_mission_photos (
  id uuid primary key default gen_random_uuid(),
  bonus_attempt_id uuid not null references team_bonus_mission_attempts (id) on delete cascade,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

-- ===================== 通知 =====================

create table card_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  message text not null,
  related_usage_id uuid references card_usage_log (id),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index card_notifications_team_idx on card_notifications (team_id, created_at desc);

-- ===================== RLS =====================

alter table cards enable row level security;
alter table card_rarity_weights enable row level security;
alter table station_card_pool enable row level security;
alter table team_cards enable row level security;
alter table card_usage_log enable row level security;
alter table card_active_effects enable row level security;
alter table team_bonus_mission_attempts enable row level security;
alter table bonus_mission_photos enable row level security;
alter table card_notifications enable row level security;

grant select on cards, card_rarity_weights, station_card_pool to authenticated;
grant insert, update, delete on cards, card_rarity_weights, station_card_pool to authenticated;
grant select on team_cards, card_usage_log, card_active_effects, card_notifications to authenticated;
grant select, insert on team_bonus_mission_attempts, bonus_mission_photos to authenticated;

create policy cards_select_all on cards for select using (true);
create policy cards_staff_write on cards for all to authenticated
  using (auth_staff_event_id() is not null) with check (auth_staff_event_id() is not null);

create policy card_rarity_weights_select on card_rarity_weights for select
  using (event_id = current_event_id());
create policy card_rarity_weights_staff_write on card_rarity_weights for all to authenticated
  using (event_id = auth_staff_event_id()) with check (event_id = auth_staff_event_id());

create policy station_card_pool_select on station_card_pool for select
  using (exists (select 1 from stations s where s.id = station_card_pool.station_id and s.event_id = current_event_id()));
create policy station_card_pool_staff_write on station_card_pool for all to authenticated
  using (exists (select 1 from stations s where s.id = station_card_pool.station_id and s.event_id = auth_staff_event_id()))
  with check (exists (select 1 from stations s where s.id = station_card_pool.station_id and s.event_id = auth_staff_event_id()));

create policy team_cards_select on team_cards for select
  using (team_id = auth_team_id() or exists (select 1 from teams t where t.id = team_cards.team_id and t.event_id = auth_staff_event_id()));

create policy card_usage_log_select on card_usage_log for select
  using (team_id = auth_team_id() or target_team_id = auth_team_id() or event_id = auth_staff_event_id());

create policy card_active_effects_select on card_active_effects for select
  using (team_id = auth_team_id() or event_id = auth_staff_event_id());

create policy team_bonus_mission_attempts_select on team_bonus_mission_attempts for select
  using (team_id = auth_team_id() or exists (select 1 from teams t where t.id = team_bonus_mission_attempts.team_id and t.event_id = auth_staff_event_id()));
create policy team_bonus_mission_attempts_insert on team_bonus_mission_attempts for insert to authenticated
  with check (team_id = auth_team_id());

create policy bonus_mission_photos_select on bonus_mission_photos for select
  using (exists (select 1 from team_bonus_mission_attempts a where a.id = bonus_mission_photos.bonus_attempt_id
    and (a.team_id = auth_team_id() or exists (select 1 from teams t where t.id = a.team_id and t.event_id = auth_staff_event_id()))));
create policy bonus_mission_photos_insert on bonus_mission_photos for insert to authenticated
  with check (exists (select 1 from team_bonus_mission_attempts a where a.id = bonus_mission_photos.bonus_attempt_id and a.team_id = auth_team_id()));

create policy card_notifications_select on card_notifications for select
  using (team_id = auth_team_id() or event_id = auth_staff_event_id());

alter publication supabase_realtime add table team_cards;
alter publication supabase_realtime add table card_usage_log;
alter publication supabase_realtime add table card_active_effects;
alter publication supabase_realtime add table card_notifications;
alter publication supabase_realtime add table team_bonus_mission_attempts;

-- ===================== events にカード関連設定を追加 =====================

alter table events add column card_acquisition_enabled boolean not null default true;
