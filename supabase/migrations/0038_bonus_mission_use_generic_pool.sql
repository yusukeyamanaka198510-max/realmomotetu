-- fn_use_card再定義: ボーナスミッションカードを汎用チャレンジプール(0037)から選ぶよう修正。
-- (それ以外のロジックは0028時点のものをそのまま踏襲)

create or replace function fn_use_card(
  p_idempotency_key uuid,
  p_card_code text,
  p_target_team_id uuid default null,
  p_payload jsonb default '{}'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_current_station uuid;
  v_card record;
  v_qty int;
  v_existing_log record;
  v_result text := 'SUCCESS';
  v_detail jsonb := '{}';
  v_message text := '';
  v_target_state team_game_state;
  v_target_station uuid;
  v_target_event uuid;
  v_barrier_used boolean;
  v_lock_first uuid;
  v_lock_second uuid;
  v_cooldown_seconds int;
  v_last_used timestamptz;
  v_wait_remaining int;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select ts.event_id into v_event_id from team_state ts where ts.team_id = v_team_id;
  perform fn_assert_event_active(v_event_id);

  -- 冪等性: 同じidempotency_keyの再送は結果をそのまま返す
  select * into v_existing_log from card_usage_log where idempotency_key = p_idempotency_key;
  if v_existing_log.id is not null then
    return jsonb_build_object('result', v_existing_log.result, 'detail', v_existing_log.effect_detail, 'replayed', true);
  end if;

  select * into v_card from cards where card_code = p_card_code and enabled;
  if v_card.id is null then
    raise exception 'card not found or disabled: %', p_card_code;
  end if;

  if p_target_team_id is not null and p_target_team_id = v_team_id then
    raise exception 'cannot target your own team';
  end if;
  if v_card.target_type = 'OTHER_TEAM' and p_target_team_id is null then
    raise exception 'target_team_id is required for this card';
  end if;

  -- デッドロック回避のため team_id 昇順でロック。
  -- v_team_id(自チーム)のロックを必ず含むため、同じチームからの同時多重リクエストは
  -- ここで直列化される(後続のクールタイム判定がTOCTOU競合を起こさないようにするため、
  -- クールタイム判定はこのロック取得の"後"に行う)。
  if p_target_team_id is not null then
    if v_team_id < p_target_team_id then
      v_lock_first := v_team_id; v_lock_second := p_target_team_id;
    else
      v_lock_first := p_target_team_id; v_lock_second := v_team_id;
    end if;
    perform 1 from team_state where team_id = v_lock_first for update;
    perform 1 from team_state where team_id = v_lock_second for update;
  else
    perform 1 from team_state where team_id = v_team_id for update;
  end if;

  -- 妨害カードのクールタイム: 同一チームから同じ対象チームへ連続使用させない
  if v_card.category = 'OBSTRUCTION' and p_target_team_id is not null then
    select obstruction_cooldown_seconds into v_cooldown_seconds from events where id = v_event_id;
    if v_cooldown_seconds > 0 then
      select max(cul.used_at) into v_last_used
        from card_usage_log cul
        join cards c2 on c2.id = cul.card_id
        where cul.team_id = v_team_id and cul.target_team_id = p_target_team_id
          and c2.category = 'OBSTRUCTION' and cul.result <> 'BLOCKED_BY_BARRIER';
      if v_last_used is not null and v_last_used + make_interval(secs => v_cooldown_seconds) > now() then
        v_wait_remaining := ceil(extract(epoch from (v_last_used + make_interval(secs => v_cooldown_seconds) - now())))::int;
        raise exception 'cooldown: this team was targeted recently, wait % more seconds', v_wait_remaining;
      end if;
    end if;
  end if;

  select state, current_station_id into v_state, v_current_station from team_state where team_id = v_team_id;

  if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_NEXT_CARD_USE' and consumed_at is null) then
    raise exception 'blocked: card use disabled this turn (冬眠カード)';
  end if;

  if p_target_team_id is not null then
    select state, current_station_id, event_id into v_target_state, v_target_station, v_target_event
      from team_state where team_id = p_target_team_id;
    if v_target_event is distinct from v_event_id then
      raise exception 'target team not in your event';
    end if;
  end if;

  select quantity into v_qty from team_cards where team_id = v_team_id and card_id = v_card.id for update;
  if coalesce(v_qty, 0) < 1 then
    raise exception 'card not owned';
  end if;

  -- ===================== 効果分岐 =====================
  case v_card.effect_type

  when 'MOVEMENT_DICE' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null) then
      raise exception 'blocked: movement cards disabled this turn (サイコロ封印カード)';
    end if;
    update card_active_effects set consumed_at = now()
      where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null;
    declare
      v_n int := (v_card.effect_value->>'dice_count')::int;
      v_results int[] := array[]::int[];
      v_total int := 0; v_roll int; i int;
      v_reachable uuid[]; v_relaxed boolean := false;
    begin
      for i in 1..v_n loop
        v_roll := 1 + floor(random() * 6)::int;
        v_results := v_results || v_roll; v_total := v_total + v_roll;
      end loop;
      select array_agg(station_id) into v_reachable from fn_reachable_stations(v_current_station, v_event_id, v_total, false);
      if v_reachable is null then
        v_relaxed := true;
        select array_agg(station_id) into v_reachable from fn_reachable_stations(v_current_station, v_event_id, v_total, true);
      end if;
      perform fn_finalize_movement(v_team_id, v_reachable, v_n, v_results, v_total, v_card.id, v_relaxed);
      v_detail := jsonb_build_object('dice_count', v_n, 'results', v_results, 'total', v_total);
      v_message := format('%sを使用し、サイコロ%s個で合計%sになりました。', v_card.name, v_n, v_total);
    end;

  when 'MOVEMENT_FIXED' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null) then
      raise exception 'blocked: movement cards disabled this turn (サイコロ封印カード)';
    end if;
    update card_active_effects set consumed_at = now()
      where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null;
    declare
      v_steps int := (v_card.effect_value->>'steps')::int;
      v_reachable uuid[]; v_relaxed boolean := false;
    begin
      select array_agg(station_id) into v_reachable from fn_reachable_stations(v_current_station, v_event_id, v_steps, false);
      if v_reachable is null then
        v_relaxed := true;
        select array_agg(station_id) into v_reachable from fn_reachable_stations(v_current_station, v_event_id, v_steps, true);
      end if;
      perform fn_finalize_movement(v_team_id, v_reachable, 0, array[]::int[], v_steps, v_card.id, v_relaxed);
      v_detail := jsonb_build_object('steps', v_steps);
      v_message := format('%sを使用し、必ず%s駅進みます。', v_card.name, v_steps);
    end;

  when 'MOVEMENT_UPTO' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null) then
      raise exception 'blocked: movement cards disabled this turn (サイコロ封印カード)';
    end if;
    update card_active_effects set consumed_at = now()
      where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null;
    declare
      v_max int := (v_card.effect_value->>'max_steps')::int;
      v_reachable uuid[];
    begin
      select array_agg(station_id) into v_reachable from fn_stations_within(v_current_station, v_event_id, v_max);
      perform fn_finalize_movement(v_team_id, v_reachable, 0, array[]::int[], v_max, v_card.id, false);
      v_detail := jsonb_build_object('max_steps', v_max);
      v_message := format('%sを使用し、最大%s駅先まで移動先を選べます。', v_card.name, v_max);
    end;

  when 'MOVEMENT_RANDOM_JUMP' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null) then
      raise exception 'blocked: movement cards disabled this turn (サイコロ封印カード)';
    end if;
    update card_active_effects set consumed_at = now()
      where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null;
    declare
      v_dest uuid;
    begin
      select id into v_dest from stations
        where event_id = v_event_id and id <> v_current_station
        order by random() limit 1;
      if v_dest is null then raise exception 'no destination available'; end if;
      perform fn_finalize_movement(v_team_id, array[v_dest], 0, array[]::int[], 0, v_card.id, true);
      v_detail := jsonb_build_object('destination_station_id', v_dest);
      select name into v_message from stations where id = v_dest;
      v_message := format('%sを使用し、「%s」への移動が確定しました。', v_card.name, v_message);
    end;

  when 'MOVEMENT_DIRECT_TO_DEST' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null) then
      raise exception 'blocked: movement cards disabled this turn (サイコロ封印カード)';
    end if;
    declare
      v_dest uuid; v_dist int;
      v_min int := coalesce((v_card.effect_value->>'min_distance')::int, 1);
      v_max int := coalesce((v_card.effect_value->>'max_distance')::int, 5);
    begin
      select active_destination_station_id into v_dest from events where id = v_event_id;
      if v_dest is null then raise exception 'no active destination set'; end if;
      v_dist := fn_shortest_hops(v_current_station, v_dest, v_event_id);
      if v_dist is null or v_dist < v_min or v_dist > v_max then
        raise exception 'destination too far or unreachable (distance=%)', v_dist;
      end if;
      update card_active_effects set consumed_at = now()
        where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null;
      perform fn_finalize_movement(v_team_id, array[v_dest], 0, array[]::int[], v_dist, v_card.id, true);
      v_detail := jsonb_build_object('destination_station_id', v_dest, 'distance', v_dist);
      v_message := format('%sを使用し、目的地への移動が確定しました。', v_card.name);
    end;

  when 'MOVEMENT_TELEPORT_TO_TEAM' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null) then
      raise exception 'blocked: movement cards disabled this turn (サイコロ封印カード)';
    end if;
    if v_target_station is null then raise exception 'target team has no current station'; end if;
    update card_active_effects set consumed_at = now()
      where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null;
    perform fn_finalize_movement(v_team_id, array[v_target_station], 0, array[]::int[], 0, v_card.id, true);
    v_detail := jsonb_build_object('destination_station_id', v_target_station);
    v_message := format('%sを使用し、対象チームの駅への移動が確定しました。', v_card.name);

  when 'MOVEMENT_TO_OWNED_PROPERTY' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null) then
      raise exception 'blocked: movement cards disabled this turn (サイコロ封印カード)';
    end if;
    declare
      v_dest uuid;
    begin
      select sp.station_id into v_dest
        from team_property_purchases tpp join station_properties sp on sp.id = tpp.property_id
        where tpp.team_id = v_team_id
        order by random() limit 1;
      if v_dest is null then raise exception 'no owned property'; end if;
      update card_active_effects set consumed_at = now()
        where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null;
      perform fn_finalize_movement(v_team_id, array[v_dest], 0, array[]::int[], 0, v_card.id, true);
      v_detail := jsonb_build_object('destination_station_id', v_dest);
      v_message := format('%sを使用し、所有物件のある駅への移動が確定しました。', v_card.name);
    end;

  when 'SWAP_LOCATION' then
    if v_target_state <> 'DICE_READY' or v_state <> 'DICE_READY' then
      raise exception 'both teams must be idle (DICE_READY) to swap locations';
    end if;
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      update team_state set current_station_id = v_target_station where team_id = v_team_id;
      update team_state set current_station_id = v_current_station where team_id = p_target_team_id;
      v_message := format('%sを使用し、対象チームと現在地を交換しました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sを使用され、現在地が交換されました。', v_card.name));
    end if;

  when 'FORCE_NEXT_MOVE_FIXED_1' then
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      insert into card_active_effects (event_id, team_id, effect_type, source_card_id, source_team_id, remaining_uses)
        values (v_event_id, p_target_team_id, 'FORCED_FIXED_MOVE_1', v_card.id, v_team_id, 1);
      v_message := format('%sを使用しました。対象チームの次回移動は1駅固定になります。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, '牛歩カードを使用されました。次回の移動は1駅になります。');
    end if;

  when 'BLOCK_NEXT_MOVEMENT_CARD' then
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      insert into card_active_effects (event_id, team_id, effect_type, source_card_id, source_team_id, remaining_uses)
        values (v_event_id, p_target_team_id, 'BLOCK_NEXT_MOVEMENT_CARD', v_card.id, v_team_id, 1);
      v_message := format('%sを使用しました。対象チームは次回移動系カードを使用できません。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, 'サイコロ封印カードを使用されました。次回は通常サイコロのみで移動します。');
    end if;

  when 'BLOCK_UNTIL_MISSION_SUCCESS' then
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      insert into card_active_effects (event_id, team_id, effect_type, source_card_id, source_team_id, remaining_uses)
        values (v_event_id, p_target_team_id, 'BLOCK_UNTIL_MISSION_SUCCESS', v_card.id, v_team_id, 1);
      v_message := format('%sを使用しました。対象チームはミッション成功まで次の移動を開始できません。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, '足止めカードを使用されました。ミッションを1つ成功させるまで移動できません。');
    end if;

  when 'PUSH_BACK_SAME_STATION_TEAMS' then
    declare
      v_other record;
      v_pushed jsonb := '[]'::jsonb;
      v_dest uuid; v_far_candidates uuid[]; v_pick uuid; v_steps int;
    begin
      select active_destination_station_id into v_dest from events where id = v_event_id;
      for v_other in
        select ts.team_id, ts.current_station_id from team_state ts
          where ts.event_id = v_event_id and ts.team_id <> v_team_id
            and ts.current_station_id = v_current_station and ts.state = 'DICE_READY'
        for update
      loop
        if fn_try_consume_barrier(v_other.team_id) then
          v_pushed := v_pushed || jsonb_build_object('team_id', v_other.team_id, 'blocked_by_barrier', true);
          perform fn_notify_team(v_event_id, v_other.team_id, format('%sをカードバリアで防ぎました。', v_card.name));
          continue;
        end if;
        v_steps := 1 + floor(random() * 3)::int;
        v_far_candidates := null;
        if v_dest is not null then
          select array_agg(s.station_id) into v_far_candidates
            from fn_reachable_stations(v_other.current_station_id, v_event_id, v_steps, true) s
            where fn_shortest_hops(s.station_id, v_dest, v_event_id) >= fn_shortest_hops(v_other.current_station_id, v_dest, v_event_id);
        end if;
        if v_far_candidates is null or array_length(v_far_candidates, 1) is null then
          select array_agg(station_id) into v_far_candidates from fn_reachable_stations(v_other.current_station_id, v_event_id, v_steps, true);
        end if;
        if v_far_candidates is not null and array_length(v_far_candidates, 1) > 0 then
          v_pick := v_far_candidates[1 + floor(random() * array_length(v_far_candidates, 1))::int];
          update team_state set current_station_id = v_pick where team_id = v_other.team_id;
          v_pushed := v_pushed || jsonb_build_object('team_id', v_other.team_id, 'moved_to', v_pick, 'steps', v_steps);
          perform fn_notify_team(v_event_id, v_other.team_id, format('オナラカードで%s駅、目的地から遠ざけられました。', v_steps));
        end if;
      end loop;
      v_detail := jsonb_build_object('pushed', v_pushed);
      v_message := format('%sを使用しました。', v_card.name);
    end;

  when 'BLOCK_NEXT_CARD_USE' then
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      insert into card_active_effects (event_id, team_id, effect_type, source_card_id, source_team_id, remaining_uses)
        values (v_event_id, p_target_team_id, 'BLOCK_NEXT_CARD_USE', v_card.id, v_team_id, 1);
      v_message := format('%sを使用しました。対象チームは次回カードを使用できません。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, '冬眠カードを使用されました。次回はカードを使用できません。');
    end if;

  when 'STEAL_RANDOM_CARD' then
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      declare v_stolen_card record; begin
        select tc.card_id, c.name into v_stolen_card from team_cards tc join cards c on c.id = tc.card_id
          where tc.team_id = p_target_team_id and tc.quantity > 0 order by random() limit 1 for update;
        if v_stolen_card.card_id is null then
          raise exception 'target team has no cards to steal';
        end if;
        update team_cards set quantity = quantity - 1 where team_id = p_target_team_id and card_id = v_stolen_card.card_id;
        perform fn_grant_card(v_team_id, v_stolen_card.card_id, 1);
        v_detail := jsonb_build_object('stolen_card_name', v_stolen_card.name);
        v_message := format('%sを使用しました。対象チームから「%s」を獲得しました。', v_card.name, v_stolen_card.name);
        perform fn_notify_team(v_event_id, p_target_team_id, format('刀狩りカードで「%s」を奪われました。', v_stolen_card.name));
      end;
    end if;

  when 'DESTROY_RANDOM_CARD' then
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      declare v_destroyed record; begin
        select tc.card_id, c.name into v_destroyed from team_cards tc join cards c on c.id = tc.card_id
          where tc.team_id = p_target_team_id and tc.quantity > 0 order by random() limit 1 for update;
        if v_destroyed.card_id is null then
          raise exception 'target team has no cards to destroy';
        end if;
        update team_cards set quantity = quantity - 1 where team_id = p_target_team_id and card_id = v_destroyed.card_id;
        v_detail := jsonb_build_object('destroyed_card_name', v_destroyed.name);
        v_message := format('%sを使用しました。対象チームの「%s」を破壊しました。', v_card.name, v_destroyed.name);
        perform fn_notify_team(v_event_id, p_target_team_id, format('豪速球カードで「%s」を破壊されました。', v_destroyed.name));
      end;
    end if;

  when 'STEAL_COIN_PERCENT' then
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      declare v_target_balance bigint; v_amount bigint; v_pct int := coalesce((v_card.effect_value->>'percent')::int, 20); begin
        select coin_balance_cache into v_target_balance from team_state where team_id = p_target_team_id;
        v_amount := floor(greatest(v_target_balance, 0) * v_pct / 100.0);
        if v_amount > 0 then
          insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
            values (v_event_id, p_target_team_id, -v_amount, 'CARD_EFFECT', gen_random_uuid(), '強奪カードで奪われた', auth.uid());
          insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
            values (v_event_id, v_team_id, v_amount, 'CARD_EFFECT', gen_random_uuid(), '強奪カードで獲得', auth.uid());
          update team_state set coin_balance_cache = coin_balance_cache - v_amount where team_id = p_target_team_id;
          update team_state set coin_balance_cache = coin_balance_cache + v_amount where team_id = v_team_id;
        end if;
        v_detail := jsonb_build_object('amount', v_amount);
        v_message := format('%sを使用し、%s円を獲得しました。', v_card.name, v_amount);
        perform fn_notify_team(v_event_id, p_target_team_id, format('強奪カードで%s円奪われました。', v_amount));
      end;
    end if;

  when 'MISSION_REWARD_MULTIPLIER' then
    if v_state not in ('MISSION_SELECTION', 'MISSION_ACTIVE') then raise exception 'invalid state: %', v_state; end if;
    insert into card_active_effects (event_id, team_id, effect_type, source_card_id, remaining_uses, payload)
      values (v_event_id, v_team_id, 'MISSION_REWARD_MULTIPLIER', v_card.id, 1, v_card.effect_value);
    v_message := format('%sを使用しました。今回のミッション報酬が2倍になります。', v_card.name);

  when 'MISSION_RESELECT_AFTER_FAILURE' then
    declare v_attempt record; v_new_offered uuid[]; begin
      if v_state <> 'MISSION_ACTIVE' then raise exception 'invalid state: %', v_state; end if;
      select * into v_attempt from team_mission_attempts
        where team_id = v_team_id order by created_at desc limit 1 for update;
      if v_attempt.id is null or v_attempt.attempt_number <= 1 or v_attempt.status <> 'AWAITING_PHOTO' then
        raise exception 'no failed mission to reselect';
      end if;
      if exists (select 1 from card_usage_log where team_id = v_team_id and card_id = v_card.id and turn_id = v_attempt.turn_id) then
        raise exception 'already used this card at this station';
      end if;
      v_new_offered := fn_generate_offered_missions(v_team_id, v_attempt.station_id);
      update team_mission_attempts
        set offered_mission_ids = v_new_offered, selected_mission_id = null, locked_at = null, status = 'OFFERED'
        where id = v_attempt.id;
      update team_state set state = 'MISSION_SELECTION', version = version + 1 where team_id = v_team_id;
      v_message := format('%sを使用しました。別のミッションを選び直せます。', v_card.name);
    end;

  when 'MISSION_REROLL_OFFERED' then
    declare v_attempt record; v_new_offered uuid[]; begin
      if v_state <> 'MISSION_SELECTION' then raise exception 'invalid state: %', v_state; end if;
      select * into v_attempt from team_mission_attempts
        where team_id = v_team_id order by created_at desc limit 1 for update;
      if v_attempt.id is null or v_attempt.locked_at is not null then
        raise exception 'mission already locked in';
      end if;
      v_new_offered := fn_generate_offered_missions(v_team_id, v_attempt.station_id);
      update team_mission_attempts set offered_mission_ids = v_new_offered where id = v_attempt.id;
      v_message := format('%sを使用しました。ミッションを再抽選しました。', v_card.name);
    end;

  when 'GRANT_BONUS_MISSION' then
    declare v_attempt record; v_template record; begin
      if v_state not in ('MISSION_SELECTION', 'MISSION_ACTIVE') then raise exception 'invalid state: %', v_state; end if;
      select * into v_attempt from team_mission_attempts where team_id = v_team_id order by created_at desc limit 1;
      if v_attempt.id is null then raise exception 'no active mission attempt'; end if;
      if exists (select 1 from team_bonus_mission_attempts where team_id = v_team_id and turn_id = v_attempt.turn_id) then
        raise exception 'bonus mission already granted this turn';
      end if;
      -- 駅固有ランドマークに依存しない汎用チャレンジから選ぶ(通常ミッションと内容が重複しないようにするため)
      select * into v_template from bonus_mission_templates where is_active order by random() limit 1;
      if v_template.id is null then raise exception 'no bonus mission template available'; end if;
      insert into team_bonus_mission_attempts (team_id, turn_id, station_id, title, description, reward)
        values (v_team_id, v_attempt.turn_id, v_attempt.station_id, v_template.title, v_template.description, v_template.reward);
      v_detail := jsonb_build_object('bonus_mission_title', v_template.title, 'reward', v_template.reward);
      v_message := format('%sを使用しました。ボーナスミッション「%s」が追加されました。', v_card.name, v_template.title);
    end;

  when 'PROPERTY_YIELD_X2' then
    insert into card_active_effects (event_id, team_id, effect_type, source_card_id, remaining_uses)
      values (v_event_id, v_team_id, 'PROPERTY_YIELD_X2', v_card.id, 1);
    v_message := format('%sを使用しました。次回決算時、物件収益が2倍になります。', v_card.name);

  when 'PROPERTY_HALF_PRICE' then
    declare v_property_id uuid := (p_payload->>'property_id')::uuid; v_price bigint; v_yield bigint; v_pstation uuid; v_balance bigint; begin
      if v_state <> 'PROPERTY_PURCHASE' then raise exception 'invalid state: %', v_state; end if;
      if v_property_id is null then raise exception 'property_id is required'; end if;
      select station_id, price, yield_amount into v_pstation, v_price, v_yield from station_properties where id = v_property_id and is_active;
      if v_pstation is null or v_pstation <> v_current_station then raise exception 'property not available here'; end if;
      v_price := floor(v_price / 2);
      select coin_balance_cache into v_balance from team_state where team_id = v_team_id;
      if v_balance < v_price then raise exception 'insufficient coin balance'; end if;
      insert into team_property_purchases (team_id, property_id, price_paid, yield_amount, idempotency_key)
        values (v_team_id, v_property_id, v_price, v_yield, gen_random_uuid());
      insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
        values (v_event_id, v_team_id, -v_price, 'PROPERTY_PURCHASE', gen_random_uuid(), '半額カード使用', auth.uid());
      update team_state set coin_balance_cache = coin_balance_cache - v_price where team_id = v_team_id;
      v_detail := jsonb_build_object('property_id', v_property_id, 'price_paid', v_price);
      v_message := format('%sを使用し、半額(%s円)で購入しました。', v_card.name, v_price);
    end;

  when 'PROPERTY_TAKEOVER' then
    declare v_purchase_id uuid := (p_payload->>'purchase_id')::uuid; v_purchase record; v_balance bigint; begin
      select * into v_purchase from team_property_purchases where id = v_purchase_id and team_id = p_target_team_id and settled = false for update;
      if v_purchase.id is null then raise exception 'target property purchase not found'; end if;
      v_barrier_used := fn_try_consume_barrier(p_target_team_id);
      if v_barrier_used then
        v_result := 'BLOCKED_BY_BARRIER';
        v_message := format('%sはカードバリアで防がれました。', v_card.name);
        perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
      else
        select coin_balance_cache into v_balance from team_state where team_id = v_team_id;
        if v_balance < v_purchase.price_paid then raise exception 'insufficient coin balance'; end if;
        insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
          values (v_event_id, v_team_id, -v_purchase.price_paid, 'PROPERTY_PURCHASE', gen_random_uuid(), '乗っ取りカード使用', auth.uid());
        update team_state set coin_balance_cache = coin_balance_cache - v_purchase.price_paid where team_id = v_team_id;
        update team_property_purchases set team_id = v_team_id where id = v_purchase_id;
        v_detail := jsonb_build_object('purchase_id', v_purchase_id, 'price_paid', v_purchase.price_paid);
        v_message := format('%sを使用し、物件の所有権を獲得しました。', v_card.name);
        perform fn_notify_team(v_event_id, p_target_team_id, '乗っ取りカードで所有物件を奪われました。');
      end if;
    end;

  when 'TRADE_RANDOM_CARD' then
    declare v_mine record; v_theirs record; begin
      select tc.card_id, c.name into v_mine from team_cards tc join cards c on c.id = tc.card_id
        where tc.team_id = v_team_id and tc.quantity > 0 and tc.card_id <> v_card.id order by random() limit 1 for update;
      select tc.card_id, c.name into v_theirs from team_cards tc join cards c on c.id = tc.card_id
        where tc.team_id = p_target_team_id and tc.quantity > 0 order by random() limit 1 for update;
      if v_mine.card_id is null or v_theirs.card_id is null then
        raise exception 'both teams must hold at least one other card to trade';
      end if;
      update team_cards set quantity = quantity - 1 where team_id = v_team_id and card_id = v_mine.card_id;
      update team_cards set quantity = quantity - 1 where team_id = p_target_team_id and card_id = v_theirs.card_id;
      perform fn_grant_card(v_team_id, v_theirs.card_id, 1);
      perform fn_grant_card(p_target_team_id, v_mine.card_id, 1);
      v_detail := jsonb_build_object('gave', v_mine.name, 'received', v_theirs.name);
      v_message := format('%sを使用し、「%s」と「%s」を交換しました。', v_card.name, v_mine.name, v_theirs.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('カード交換カードで「%s」と交換されました。', v_theirs.name));
    end;

  when 'DESTINATION_REROLL' then
    declare v_prev uuid; v_next uuid; begin
      select active_destination_station_id into v_prev from events where id = v_event_id for update;
      v_next := fn_pick_next_destination(v_event_id, v_prev);
      update events set active_destination_station_id = v_next where id = v_event_id;
      v_detail := jsonb_build_object('previous', v_prev, 'next', v_next);
      v_message := format('%sを使用し、目的地を再抽選しました。', v_card.name);
    end;

  when 'DESTINATION_PREDICT' then
    declare v_dest uuid; v_candidates uuid[]; v_names text[]; begin
      select active_destination_station_id into v_dest from events where id = v_event_id;
      select array_agg(id) into v_candidates from (
        select id from stations
          where event_id = v_event_id and is_destination_candidate and id is distinct from v_dest
          order by random() limit 3
      ) x;
      select array_agg(name) into v_names from stations where id = any (v_candidates);
      v_detail := jsonb_build_object('candidate_station_ids', v_candidates, 'candidate_names', v_names);
      v_message := format('%sを使用しました。次回目的地の候補(参考): %s', v_card.name, array_to_string(v_names, '、'));
    end;

  when 'DEBT_FORGIVE' then
    raise exception 'this card is currently disabled (no negative coin concept exists)';

  when 'SHARE_NEXT_MISSION_REWARD' then
    insert into card_active_effects (event_id, team_id, effect_type, source_card_id, remaining_uses, payload)
      values (v_event_id, v_team_id, 'SHARE_NEXT_MISSION_REWARD', v_card.id, 1,
        jsonb_build_object('target_team_id', p_target_team_id, 'percent', coalesce((v_card.effect_value->>'percent')::int, 50)));
    v_message := format('%sを使用しました。次のミッション報酬の一部を対象チームにも分配します。', v_card.name);
    perform fn_notify_team(v_event_id, p_target_team_id, 'おすそわけカードの対象に指定されました。');

  when 'LOTTERY' then
    declare v_amount bigint; begin
      select (t->>'amount')::bigint into v_amount
        from jsonb_array_elements(v_card.effect_value->'table') t
        order by random() * (t->>'weight')::numeric desc limit 1;
      insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
        values (v_event_id, v_team_id, v_amount, 'CARD_EFFECT', gen_random_uuid(), '宝くじカード', auth.uid());
      update team_state set coin_balance_cache = coin_balance_cache + v_amount where team_id = v_team_id;
      v_detail := jsonb_build_object('amount', v_amount);
      v_message := format('%sを使用し、%s円獲得しました。', v_card.name, v_amount);
    end;

  when 'DRAW_RANDOM_CARDS' then
    declare v_n int := coalesce((v_card.effect_value->>'count')::int, 2); i int; v_drawn uuid; v_names text[] := array[]::text[]; v_exclude uuid[]; begin
      select array_agg(id) into v_exclude from cards where card_code in ('CARD_STATION', 'VOUCHER');
      for i in 1..v_n loop
        v_drawn := fn_draw_weighted_card(v_event_id, null, v_exclude);
        if v_drawn is not null then
          perform fn_grant_card(v_team_id, v_drawn, 1);
          v_names := v_names || (select name from cards where id = v_drawn);
        end if;
      end loop;
      v_detail := jsonb_build_object('drawn', v_names);
      v_message := format('%sを使用し、%sを獲得しました。', v_card.name, array_to_string(v_names, '、'));
    end;

  when 'HOT_STREAK' then
    insert into card_active_effects (event_id, team_id, effect_type, source_card_id, remaining_uses, payload)
      values (v_event_id, v_team_id, 'HOT_STREAK', v_card.id, coalesce((v_card.effect_value->>'uses')::int, 3), v_card.effect_value);
    v_message := format('%sを使用しました。今後%s回の移動でサイコロ2個になります。', v_card.name, coalesce((v_card.effect_value->>'uses')::int, 3));

  when 'VOUCHER_EXCHANGE' then
    declare v_target_code text := p_payload->>'target_card_code'; v_target record; begin
      if v_target_code is null or v_target_code = 'VOUCHER' then raise exception 'invalid target card'; end if;
      select * into v_target from cards where card_code = v_target_code and enabled and exchangeable;
      if v_target.id is null then raise exception 'target card not exchangeable'; end if;
      perform fn_grant_card(v_team_id, v_target.id, 1);
      v_detail := jsonb_build_object('received_card', v_target.name);
      v_message := format('%sを使用し、「%s」と交換しました。', v_card.name, v_target.name);
    end;

  else
    raise exception 'unimplemented effect_type: %', v_card.effect_type;
  end case;

  update team_cards set quantity = quantity - 1 where team_id = v_team_id and card_id = v_card.id;

  insert into card_usage_log (event_id, team_id, card_id, target_team_id, idempotency_key, turn_id, result, effect_detail)
    values (v_event_id, v_team_id, v_card.id, p_target_team_id, p_idempotency_key,
      (select current_turn_id from team_state where team_id = v_team_id), v_result, v_detail || jsonb_build_object('message', v_message));

  insert into audit_log (event_id, team_id, action_type, after_value)
    values (v_event_id, v_team_id, 'CARD_USE', jsonb_build_object('card_code', p_card_code, 'target_team_id', p_target_team_id, 'result', v_result, 'detail', v_detail));

  return jsonb_build_object('result', v_result, 'message', v_message, 'detail', v_detail);
end;
$$;

grant execute on function fn_use_card(uuid, text, uuid, jsonb) to authenticated;
