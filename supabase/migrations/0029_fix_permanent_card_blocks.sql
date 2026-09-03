-- 重大バグ修正: サイコロ封印カード(BLOCK_NEXT_MOVEMENT_CARD)と冬眠カード(BLOCK_NEXT_CARD_USE)が
-- 一度かかると解除されず永久に効果が続いてしまっていた。
--
-- サイコロ封印: 移動系カードのブランチは効果が有効な間必ず例外を投げて中断するため、
--   ブランチ内の「使用時に解除する」処理には到達できなかった。
-- 冬眠: そもそもどこにも解除処理が存在しなかった。
--
-- 正しい仕様は「次回の移動が完了したら解除される」なので、fn_roll_dice(通常サイコロでの移動)が
-- 成功した時点でどちらも解除する。

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

  -- サイコロ封印カード・冬眠カード: どちらも「次の移動が完了するまで」の効果なので、
  -- 通常サイコロでの移動(=このfn_roll_dice呼び出し)が成立した時点で解除する。
  update card_active_effects set consumed_at = now()
    where team_id = v_team_id and effect_type in ('BLOCK_NEXT_MOVEMENT_CARD', 'BLOCK_NEXT_CARD_USE') and consumed_at is null;

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
