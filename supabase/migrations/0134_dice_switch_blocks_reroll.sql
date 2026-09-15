-- 0133の「カードに切り替える」機能について、以下2点の指摘を受けて設計を見直す。
--   1) 出目が確定表示された後では「見てから選べる」ことになり、切り替える意味がない。
--      → ボタンは出目がまだ見えていない「振っている最中(止める前)」にのみ出す。
--   2) 切り替えた後にもう一度サイコロを振れてしまうと、実質的な振り直しになってしまう。
--      → 切り替えたら、カードを1枚使い終えるまでサイコロを振れないようにする
--        (team_state.dice_switch_pending フラグで制御する)。

alter table team_state add column if not exists dice_switch_pending boolean not null default false;

-- fn_team_cancel_dice_for_card: 切り替え時にdice_switch_pendingを立てる。
create or replace function fn_team_cancel_dice_for_card()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_turn_id uuid;
  v_dice_roll_id uuid;
  v_used_card_id uuid;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select ts.state, ts.event_id, ts.current_turn_id into v_state, v_event_id, v_turn_id
    from team_state ts where ts.team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);

  if v_state <> 'DESTINATION_SELECTION' then
    raise exception 'invalid state: %', v_state;
  end if;

  select id, used_card_id into v_dice_roll_id, v_used_card_id from dice_rolls
    where turn_id = v_turn_id and is_valid order by rolled_at desc limit 1;

  if v_dice_roll_id is null then
    raise exception 'no active dice roll to cancel';
  end if;
  if v_used_card_id is not null then
    raise exception 'cannot cancel a card-based movement';
  end if;

  update dice_rolls
    set is_valid = false, invalidated_at = now(), invalidation_reason = '本人がカード使用に切り替えるためキャンセル'
    where id = v_dice_roll_id;

  update turns set status = 'ABORTED' where id = v_turn_id;
  update team_state
    set state = 'DICE_READY', current_turn_id = null, dice_switch_pending = true, version = version + 1
    where team_id = v_team_id;

  insert into audit_log (event_id, team_id, action_type, before_value)
    values (v_event_id, v_team_id, 'DICE_CANCELLED_FOR_CARD_SELF', jsonb_build_object('dice_roll_id', v_dice_roll_id));
end;
$$;

grant execute on function fn_team_cancel_dice_for_card() to authenticated;

-- fn_roll_dice: dice_switch_pendingが立っている間はサイコロを振れないようにする。
create or replace function fn_roll_dice(p_dice_count int default 1)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_current_station uuid;
  v_dice_switch_pending boolean;
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

  select ts.state, ts.event_id, ts.current_station_id, ts.dice_switch_pending
    into v_state, v_event_id, v_current_station, v_dice_switch_pending
    from team_state ts where ts.team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);
  if v_state <> 'DICE_READY' then
    raise exception 'invalid state: %', v_state;
  end if;
  if v_dice_switch_pending then
    raise exception 'blocked: must use a card instead of rolling again (出目を見る前にカードへ切り替え済み)';
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

grant execute on function fn_roll_dice(int) to authenticated;

-- fn_use_card: カードを1枚使い終えたらdice_switch_pendingを解除する。
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
  v_current_turn_id uuid;
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
  v_has_bombii boolean;
  v_new_card_use_count int;
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
  if v_card.category = 'OBSTRUCTION' and p_target_team_id is not null and v_card.effect_type <> 'BOMBII_TRANSFER' then
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

  select state, current_station_id, current_turn_id, has_bombii
    into v_state, v_current_station, v_current_turn_id, v_has_bombii
    from team_state where team_id = v_team_id;

  -- 1ターン1枚まで: 今のturn(current_turn_id、まだ一度も移動していなければnull)に対して
  -- 既に成功したカード使用ログがあれば、種類を問わずブロックする。
  if exists (
    select 1 from card_usage_log
    where team_id = v_team_id and turn_id is not distinct from v_current_turn_id
  ) then
    raise exception 'blocked: only one card can be used per turn';
  end if;

  if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_NEXT_CARD_USE' and consumed_at is null) then
    raise exception 'blocked: card use disabled this turn (冬眠カード)';
  end if;

  if v_card.effect_type = 'BOMBII_TRANSFER' and not v_has_bombii then
    raise exception 'blocked: this card can only be used while cursed by bombii';
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

  when 'BOMBII_TRANSFER' then
    update team_state set has_bombii = false where team_id = v_team_id;
    update team_state set has_bombii = true where team_id = p_target_team_id;
    v_message := format('%sを使用し、ボンビーを対象チームになすりつけました。', v_card.name);
    perform fn_notify_team(v_event_id, p_target_team_id, format('😈%sで、ボンビーをなすりつけられました!', v_card.name));

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
      if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'HOT_STREAK' and consumed_at is null) then
        v_n := greatest(v_n, 2);
        update card_active_effects set remaining_uses = remaining_uses - 1
          where id = (select id from card_active_effects where team_id = v_team_id and effect_type = 'HOT_STREAK' and consumed_at is null order by created_at limit 1);
        update card_active_effects set consumed_at = now() where team_id = v_team_id and effect_type = 'HOT_STREAK' and remaining_uses <= 0 and consumed_at is null;
      end if;
      for i in 1..v_n loop
        v_roll := 1 + floor(random() * 6)::int;
        v_results := v_results || v_roll;
        v_total := v_total + v_roll;
      end loop;
      select array_agg(station_id) into v_reachable
        from fn_reachable_stations(v_current_station, v_event_id, v_total, false);
      if v_reachable is null or array_length(v_reachable, 1) = 0 then
        v_relaxed := true;
        select array_agg(station_id) into v_reachable
          from fn_reachable_stations(v_current_station, v_event_id, v_total, true);
      end if;
      perform fn_finalize_movement(v_team_id, v_reachable, v_n, v_results, v_total, v_card.id, v_relaxed);
      v_detail := jsonb_build_object('dice_count', v_n, 'results', v_results, 'total', v_total);
      v_message := format('%sを使用し、サイコロ%s個(合計%s)を振りました。', v_card.name, v_n, v_total);
    end;

  when 'MOVEMENT_CHOSEN_DIE' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    if exists (select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null) then
      raise exception 'blocked: movement cards disabled this turn (サイコロ封印カード)';
    end if;
    update card_active_effects set consumed_at = now()
      where team_id = v_team_id and effect_type = 'BLOCK_NEXT_MOVEMENT_CARD' and consumed_at is null;
    declare
      v_chosen int := (p_payload->>'chosen_value')::int;
      v_reachable uuid[]; v_relaxed boolean := false;
    begin
      if v_chosen is null or v_chosen < 1 or v_chosen > 6 then
        raise exception 'chosen_value must be between 1 and 6';
      end if;
      select array_agg(station_id) into v_reachable from fn_reachable_stations(v_current_station, v_event_id, v_chosen, false);
      if v_reachable is null or array_length(v_reachable, 1) = 0 then
        v_relaxed := true;
        select array_agg(station_id) into v_reachable from fn_reachable_stations(v_current_station, v_event_id, v_chosen, true);
      end if;
      perform fn_finalize_movement(v_team_id, v_reachable, 1, array[v_chosen], v_chosen, v_card.id, v_relaxed);
      v_detail := jsonb_build_object('chosen_value', v_chosen);
      v_message := format('%sを使用し、出目%sを選択しました。', v_card.name, v_chosen);
    end;

  when 'MOVEMENT_FIXED' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    declare
      v_steps int := (v_card.effect_value->>'steps')::int;
      v_reachable uuid[]; v_relaxed boolean := false;
    begin
      select array_agg(station_id) into v_reachable
        from fn_reachable_stations(v_current_station, v_event_id, v_steps, false);
      if v_reachable is null or array_length(v_reachable, 1) = 0 then
        v_relaxed := true;
        select array_agg(station_id) into v_reachable
          from fn_reachable_stations(v_current_station, v_event_id, v_steps, true);
      end if;
      perform fn_finalize_movement(v_team_id, v_reachable, 0, array[]::int[], v_steps, v_card.id, v_relaxed);
      v_message := format('%sを使用し、%sマス移動します。', v_card.name, v_steps);
    end;

  when 'MOVEMENT_UPTO' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    declare
      v_max int := (v_card.effect_value->>'max_steps')::int;
      v_reachable uuid[];
    begin
      select array_agg(station_id) into v_reachable
        from fn_stations_within(v_current_station, v_event_id, v_max);
      perform fn_finalize_movement(v_team_id, v_reachable, 0, array[]::int[], v_max, v_card.id, false);
      v_message := format('%sを使用しました。最大%sマスまで好きな駅へ移動できます。', v_card.name, v_max);
    end;

  when 'MOVEMENT_RANDOM_JUMP' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    declare v_dest uuid; begin
      -- 孤立駅(有効な接続を1本も持たない駅)へ飛ばないよう、接続のある駅からのみ抽選する。
      select s.id into v_dest from stations s
        where s.event_id = v_event_id
          and exists (
            select 1 from edges e
            where e.event_id = s.event_id and e.is_active and (e.station_a_id = s.id or e.station_b_id = s.id)
          )
        order by random() limit 1;
      if v_dest is null then
        raise exception 'no connected station available for random jump';
      end if;
      perform fn_finalize_movement(v_team_id, array[v_dest], 0, array[]::int[], 0, v_card.id, true);
      v_message := format('%sを使用し、ランダムな駅へワープしました。', v_card.name);
    end;

  when 'MOVEMENT_DIRECT_TO_DEST' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    declare v_dest uuid; begin
      select active_destination_station_id into v_dest from events where id = v_event_id;
      perform fn_finalize_movement(v_team_id, array[v_dest], 0, array[]::int[], 0, v_card.id, true);
      v_message := format('%sを使用し、目的地へ直接移動しました。', v_card.name);
    end;

  when 'MOVEMENT_TELEPORT_TO_TEAM' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    if p_target_team_id is null then raise exception 'target_team_id is required'; end if;
    perform fn_finalize_movement(v_team_id, array[v_target_station], 0, array[]::int[], 0, v_card.id, true);
    v_message := format('%sを使用し、対象チームの場所へワープしました。', v_card.name);

  when 'MOVEMENT_TO_OWNED_PROPERTY' then
    if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;
    declare v_dest uuid; v_dist int; begin
      select station_id into v_dest from team_property_purchases tpp
        join station_properties sp on sp.id = tpp.property_id
        where tpp.team_id = v_team_id and tpp.settled = false order by random() limit 1;
      if v_dest is null then raise exception 'no owned property'; end if;
      v_dist := fn_shortest_hops(v_current_station, v_dest, v_event_id);
      perform fn_finalize_movement(v_team_id, array[v_dest], 0, array[]::int[], v_dist, v_card.id, true);
      v_message := format('%sを使用し、自チームの物件がある駅へ移動しました。', v_card.name);
    end;

  when 'SWAP_LOCATION' then
    if p_target_team_id is null then raise exception 'target_team_id is required'; end if;
    declare v_my_station uuid := v_current_station; begin
      update team_state set current_station_id = v_target_station where team_id = v_team_id;
      update team_state set current_station_id = v_my_station where team_id = p_target_team_id;
      v_message := format('%sを使用し、対象チームと場所を入れ替えました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sで場所を入れ替えられました。', v_card.name));
    end;

  when 'FORCE_NEXT_MOVE_FIXED_1' then
    if p_target_team_id is null then raise exception 'target_team_id is required'; end if;
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      insert into card_active_effects (event_id, team_id, effect_type, source_card_id, remaining_uses)
        values (v_event_id, p_target_team_id, 'FORCE_NEXT_MOVE_FIXED_1', v_card.id, 1);
      v_message := format('%sを使用しました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sで次回移動が1マスに固定されました。', v_card.name));
    end if;

  when 'BLOCK_NEXT_MOVEMENT_CARD' then
    if p_target_team_id is null then raise exception 'target_team_id is required'; end if;
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      insert into card_active_effects (event_id, team_id, effect_type, source_card_id, remaining_uses)
        values (v_event_id, p_target_team_id, 'BLOCK_NEXT_MOVEMENT_CARD', v_card.id, 1);
      v_message := format('%sを使用しました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sで移動カードが封印されました。', v_card.name));
    end if;

  when 'BLOCK_UNTIL_MISSION_SUCCESS' then
    if p_target_team_id is null then raise exception 'target_team_id is required'; end if;
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      insert into card_active_effects (event_id, team_id, effect_type, source_card_id, remaining_uses)
        values (v_event_id, p_target_team_id, 'BLOCK_UNTIL_MISSION_SUCCESS', v_card.id, 1);
      v_message := format('%sを使用しました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sで、ミッション成功するまで移動できなくなりました。', v_card.name));
    end if;

  when 'PUSH_BACK_SAME_STATION_TEAMS' then
    declare v_other record; v_dest uuid; v_dist int; begin
      for v_other in select id, current_station_id from team_state where event_id = v_event_id and current_station_id = v_current_station and team_id <> v_team_id loop
        -- 孤立駅(有効な接続を1本も持たない駅)へ押し戻さないよう、接続のある駅からのみ抽選する。
        select s.id into v_dest from stations s
          where s.event_id = v_event_id
            and exists (
              select 1 from edges e
              where e.event_id = s.event_id and e.is_active and (e.station_a_id = s.id or e.station_b_id = s.id)
            )
          order by random() limit 1;
        if v_dest is not null then
          update team_state set current_station_id = v_dest where team_id = v_other.id;
          perform fn_notify_team(v_event_id, v_other.id, format('%sで、別の駅へ押し戻されました。', v_card.name));
        end if;
      end loop;
      v_message := format('%sを使用しました。', v_card.name);
    end;

  when 'BLOCK_NEXT_CARD_USE' then
    if p_target_team_id is null then raise exception 'target_team_id is required'; end if;
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      insert into card_active_effects (event_id, team_id, effect_type, source_card_id, remaining_uses)
        values (v_event_id, p_target_team_id, 'BLOCK_NEXT_CARD_USE', v_card.id, 1);
      v_message := format('%sを使用しました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sでカード使用が封印されました。', v_card.name));
    end if;

  when 'STEAL_RANDOM_CARD' then
    if p_target_team_id is null then raise exception 'target_team_id is required'; end if;
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      declare v_stolen record; begin
        select tc.card_id, c.name into v_stolen from team_cards tc join cards c on c.id = tc.card_id
          where tc.team_id = p_target_team_id and tc.quantity > 0 and tc.card_id <> v_card.id order by random() limit 1 for update;
        if v_stolen.card_id is not null then
          update team_cards set quantity = quantity - 1 where team_id = p_target_team_id and card_id = v_stolen.card_id;
          perform fn_grant_card(v_team_id, v_stolen.card_id, 1);
          v_detail := jsonb_build_object('stolen_card', v_stolen.name);
          v_message := format('%sを使用し、「%s」を奪いました。', v_card.name, v_stolen.name);
          perform fn_notify_team(v_event_id, p_target_team_id, format('%sで「%s」を奪われました。', v_card.name, v_stolen.name));
        else
          v_message := format('%sを使用しましたが、対象は奪えるカードを持っていませんでした。', v_card.name);
        end if;
      end;
    end if;

  when 'DESTROY_RANDOM_CARD' then
    if p_target_team_id is null then raise exception 'target_team_id is required'; end if;
    v_barrier_used := fn_try_consume_barrier(p_target_team_id);
    if v_barrier_used then
      v_result := 'BLOCKED_BY_BARRIER';
      v_message := format('%sはカードバリアで防がれました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sをカードバリアで防ぎました。', v_card.name));
    else
      declare v_destroyed record; begin
        select tc.card_id, c.name into v_destroyed from team_cards tc join cards c on c.id = tc.card_id
          where tc.team_id = p_target_team_id and tc.quantity > 0 order by random() limit 1 for update;
        if v_destroyed.card_id is not null then
          update team_cards set quantity = quantity - 1 where team_id = p_target_team_id and card_id = v_destroyed.card_id;
          v_detail := jsonb_build_object('destroyed_card', v_destroyed.name);
          v_message := format('%sを使用し、「%s」を破壊しました。', v_card.name, v_destroyed.name);
        else
          v_message := format('%sを使用しましたが、対象は破壊できるカードを持っていませんでした。', v_card.name);
        end if;
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
      v_message := format('%sを使用し、次の目的地を再抽選しました。', v_card.name);
    end;

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

  when 'SHARE_NEXT_MISSION_REWARD' then
    if p_target_team_id is null then raise exception 'target_team_id is required'; end if;
    insert into card_active_effects (event_id, team_id, effect_type, source_card_id, remaining_uses, payload)
      values (v_event_id, v_team_id, 'SHARE_NEXT_MISSION_REWARD', v_card.id, 1,
        jsonb_build_object('target_team_id', p_target_team_id, 'percent', coalesce((v_card.effect_value->>'percent')::int, 50)));
    v_message := format('%sを使用しました。次のミッション報酬の一部を対象チームにも分配します。', v_card.name);
    perform fn_notify_team(v_event_id, p_target_team_id, 'おすそわけカードの対象に指定されました。');

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

  -- 「出目を見る前にカードへ切り替えた」チームは、カードを1枚使い終えるまで
  -- サイコロを振れないよう制限していた。ここでそのブロックを解除する。
  update team_state set dice_switch_pending = false where team_id = v_team_id;

  update team_cards set quantity = quantity - 1 where team_id = v_team_id and card_id = v_card.id;

  insert into card_usage_log (event_id, team_id, card_id, target_team_id, idempotency_key, turn_id, result, effect_detail)
    values (v_event_id, v_team_id, v_card.id, p_target_team_id, p_idempotency_key,
      (select current_turn_id from team_state where team_id = v_team_id), v_result, v_detail || jsonb_build_object('message', v_message));

  insert into audit_log (event_id, team_id, action_type, after_value)
    values (v_event_id, v_team_id, 'CARD_USE', jsonb_build_object('card_code', p_card_code, 'target_team_id', p_target_team_id, 'result', v_result, 'detail', v_detail));

  -- ラッキーチャンス②: カード使用の累計回数が10/20/30回に達したら一度きりのボーナス。
  update team_state set card_use_count = card_use_count + 1 where team_id = v_team_id
    returning card_use_count into v_new_card_use_count;
  if v_new_card_use_count in (10, 20, 30) then
    perform fn_grant_lucky_bonus(
      v_team_id, v_event_id, 30000000,
      format('カード使用%s回達成ラッキーボーナス', v_new_card_use_count),
      format('🍀ラッキーボーナス!運よく累計%s回目のカード使用となったあなたのチームに、運営からささやかなプレゼントだよ!優勝目指して頑張ろう!+30,000,000円', v_new_card_use_count)
    );
  end if;

  return jsonb_build_object('result', v_result, 'message', v_message, 'detail', v_detail);
end;
$$;

-- fn_admin_rehearsal_reset: dice_switch_pendingもリセット対象に追加。
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
    card_use_count = 0,
    dice_switch_pending = false
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
