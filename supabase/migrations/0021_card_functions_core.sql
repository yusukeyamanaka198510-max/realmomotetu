-- カード機能: 共通ヘルパー + 移動処理の共通化

-- ===================== fn_shortest_hops: 2駅間の最短ホップ数(BFS) =====================

create or replace function fn_shortest_hops(p_from uuid, p_to uuid, p_event_id uuid, p_max_depth int default 60)
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_depth int;
begin
  if p_from = p_to then
    return 0;
  end if;
  with recursive bfs(sid, depth) as (
    select p_from, 0
    union all
    select nxt.other, b.depth + 1
    from bfs b
    join lateral (
      select case when ed.station_a_id = b.sid then ed.station_b_id else ed.station_a_id end as other
      from edges ed
      where ed.event_id = p_event_id and (ed.station_a_id = b.sid or ed.station_b_id = b.sid)
    ) nxt on true
    where b.depth < p_max_depth and not exists (select 1 from bfs b2 where b2.sid = nxt.other)
  )
  select min(depth) into v_depth from bfs where sid = p_to;
  return v_depth;
end;
$$;

-- ===================== fn_stations_within: 1〜p_max_depth ホップ以内で到達可能な駅(自駅を除く) =====================

create or replace function fn_stations_within(p_from uuid, p_event_id uuid, p_max_depth int)
returns table(station_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with recursive bfs(sid, depth) as (
    select p_from, 0
    union all
    select nxt.other, b.depth + 1
    from bfs b
    join lateral (
      select case when ed.station_a_id = b.sid then ed.station_b_id else ed.station_a_id end as other
      from edges ed
      where ed.event_id = p_event_id and (ed.station_a_id = b.sid or ed.station_b_id = b.sid)
    ) nxt on true
    where b.depth < p_max_depth and not exists (select 1 from bfs b2 where b2.sid = nxt.other)
  )
  select distinct sid from bfs where depth > 0;
end;
$$;

-- ===================== fn_draw_weighted_card: レアリティ加重抽選 =====================

create or replace function fn_draw_weighted_card(p_event_id uuid, p_station_id uuid default null, p_exclude_card_ids uuid[] default array[]::uuid[])
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pool_exists boolean;
  v_card_id uuid;
begin
  select exists(select 1 from station_card_pool where station_id = p_station_id and is_active) into v_pool_exists;

  with candidates as (
    select c.id, c.rarity
    from cards c
    where c.enabled
      and c.id <> all (p_exclude_card_ids)
      and (
        not v_pool_exists or p_station_id is null
        or exists (select 1 from station_card_pool scp where scp.station_id = p_station_id and scp.card_id = c.id and scp.is_active)
      )
  ),
  weighted as (
    select cd.id, coalesce(w.weight, 0) as weight
    from candidates cd
    left join card_rarity_weights w on w.event_id = p_event_id and w.rarity = cd.rarity
  )
  select id into v_card_id
  from weighted
  where weight > 0
  order by random() * weight desc
  limit 1;

  return v_card_id;
end;
$$;

-- ===================== fn_grant_card: チームへカードを付与(上限考慮) =====================

create or replace function fn_grant_card(p_team_id uuid, p_card_id uuid, p_qty int default 1)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_max int;
  v_current int;
  v_add int;
begin
  if p_card_id is null or p_qty <= 0 then
    return;
  end if;
  select max_quantity into v_max from cards where id = p_card_id;

  insert into team_cards (team_id, card_id, quantity, acquired_at)
    values (p_team_id, p_card_id, 0, now())
    on conflict (team_id, card_id) do nothing;

  select quantity into v_current from team_cards where team_id = p_team_id and card_id = p_card_id for update;
  v_add := p_qty;
  if v_max is not null and v_current + v_add > v_max then
    v_add := greatest(v_max - v_current, 0);
  end if;
  if v_add > 0 then
    update team_cards set quantity = quantity + v_add, acquired_at = now()
      where team_id = p_team_id and card_id = p_card_id;
  end if;
end;
$$;

-- ===================== fn_finalize_movement: 移動確定処理の共通化(通常サイコロ/カード共通) =====================
-- reachable(到達可能駅の配列)を渡すと turn/dice_rolls/reachable_stations_snapshot を作り、
-- DESTINATION_SELECTIONへ遷移する。reachableが1件のみならクライアントはそのまま選択確定するだけでよい。

create or replace function fn_finalize_movement(
  p_team_id uuid, p_reachable uuid[], p_dice_count int, p_individual_results int[],
  p_total int, p_used_card_id uuid, p_used_relaxed boolean default false
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_current_station uuid;
  v_last_turn_number int;
  v_turn_id uuid;
  v_dice_roll_id uuid;
  v_station uuid;
begin
  select current_station_id into v_current_station from team_state where team_id = p_team_id;
  select coalesce(max(turn_number), 0) into v_last_turn_number from turns where team_id = p_team_id;

  insert into turns (team_id, turn_number, previous_station_id, status)
    values (p_team_id, v_last_turn_number + 1, v_current_station, 'IN_PROGRESS')
    returning id into v_turn_id;

  insert into dice_rolls (team_id, turn_id, idempotency_key, dice_count, individual_results, total, used_card_id, rolled_at, created_by)
    values (p_team_id, v_turn_id, gen_random_uuid(), p_dice_count, p_individual_results, p_total, p_used_card_id, now(), auth.uid())
    returning id into v_dice_roll_id;

  foreach v_station in array coalesce(p_reachable, array[]::uuid[]) loop
    insert into reachable_stations_snapshot (dice_roll_id, station_id, used_relaxed_revisit_rule)
      values (v_dice_roll_id, v_station, p_used_relaxed);
  end loop;

  update team_state
    set state = 'DESTINATION_SELECTION', current_turn_id = v_turn_id, version = version + 1
    where team_id = p_team_id;

  return v_dice_roll_id;
end;
$$;

-- ===================== fn_roll_dice 再定義: 牛歩/絶好調の効果を反映 =====================

create or replace function fn_roll_dice(p_dice_count int default 1)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_current_station uuid;
  v_results int[] := array[]::int[];
  v_total int := 0;
  v_roll int;
  v_reachable uuid[];
  v_used_relaxed boolean := false;
  v_effective_dice_count int := p_dice_count;
  i int;
  v_slow_walk_id uuid;
  v_hot_streak record;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;
  if p_dice_count < 1 or p_dice_count > 6 then
    raise exception 'invalid dice_count';
  end if;

  select ts.state, ts.event_id, ts.current_station_id
    into v_state, v_event_id, v_current_station
    from team_state ts where ts.team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);
  if v_state <> 'DICE_READY' then
    raise exception 'invalid state: %', v_state;
  end if;

  if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_UNTIL_MISSION_SUCCESS' and consumed_at is null) then
    raise exception 'blocked: must succeed a mission at this station first (足止めカード)';
  end if;

  -- 牛歩カード: 次回移動を1駅固定にする(最優先・他の効果より優先)
  select id into v_slow_walk_id from card_active_effects
    where team_id = v_team_id and effect_type = 'FORCED_FIXED_MOVE_1' and consumed_at is null
    order by created_at limit 1 for update;

  if v_slow_walk_id is not null then
    update card_active_effects set consumed_at = now() where id = v_slow_walk_id;
    v_total := 1;
    v_effective_dice_count := 0;
    v_results := array[]::int[];
  else
    -- 絶好調カード: 通常サイコロ1個のリクエストであれば2個に引き上げる
    select * into v_hot_streak from card_active_effects
      where team_id = v_team_id and effect_type = 'HOT_STREAK' and consumed_at is null and remaining_uses > 0
      order by created_at limit 1 for update;

    if v_hot_streak.id is not null and p_dice_count = 1 then
      v_effective_dice_count := coalesce((v_hot_streak.payload->>'dice_count')::int, 2);
      update card_active_effects
        set remaining_uses = remaining_uses - 1,
            consumed_at = case when remaining_uses - 1 <= 0 then now() else null end
        where id = v_hot_streak.id;
    end if;

    for i in 1..v_effective_dice_count loop
      v_roll := 1 + floor(random() * 6)::int;
      v_results := v_results || v_roll;
      v_total := v_total + v_roll;
    end loop;
  end if;

  -- サイコロ封印カードは「移動系カードの使用」のみを禁じるものなので通常サイコロでは解除しない(次回移動系カード使用時に解除)

  select array_agg(station_id) into v_reachable
    from fn_reachable_stations(v_current_station, v_event_id, v_total, false);

  if v_reachable is null or array_length(v_reachable, 1) is null then
    v_used_relaxed := true;
    select array_agg(station_id) into v_reachable
      from fn_reachable_stations(v_current_station, v_event_id, v_total, true);
  end if;

  return fn_finalize_movement(v_team_id, v_reachable, v_effective_dice_count, v_results, v_total, null, v_used_relaxed);
end;
$$;

grant execute on function fn_shortest_hops(uuid, uuid, uuid, int) to authenticated;
grant execute on function fn_stations_within(uuid, uuid, int) to authenticated;
