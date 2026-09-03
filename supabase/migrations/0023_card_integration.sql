-- カード機能: 既存フローとの統合(ミッション報酬倍率/おすそわけ/カード抽選/物件決算2倍/足止め解除)
-- + 管理者用カード操作 + ボーナスミッションRPC

-- ===================== fn_review_mission 再定義 =====================

create or replace function fn_review_mission(p_attempt_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_event_id uuid;
  v_mission_id uuid;
  v_station_id uuid;
  v_turn_id uuid;
  v_attempt_number int;
  v_difficulty mission_difficulty;
  v_success_reward int;
  v_failure_penalty int;
  v_mission_success_count int;
  v_bonus_interval int;
  v_bonus_multiplier numeric;
  v_amount bigint;
  v_ttype coin_transaction_type;
  v_new_attempt_id uuid;
  v_card_id uuid;
  v_has_properties boolean;
  v_next_state team_game_state;
  v_card_mult_id uuid;
  v_card_mult numeric;
  v_final_mult numeric;
  v_share record;
  v_share_amount bigint;
begin
  if v_staff_event_id is null then
    raise exception 'staff only';
  end if;
  if p_decision not in ('SUCCESS', 'FAILURE') then
    raise exception 'invalid decision';
  end if;

  select a.team_id, t.event_id, a.selected_mission_id, a.station_id, a.turn_id, a.attempt_number
    into v_team_id, v_event_id, v_mission_id, v_station_id, v_turn_id, v_attempt_number
    from team_mission_attempts a
    join teams t on t.id = a.team_id
    where a.id = p_attempt_id;

  if v_event_id is null or v_event_id is distinct from v_staff_event_id then
    raise exception 'not found or not your event';
  end if;

  update review_queue
    set status = 'CLAIMED', claimed_by = auth.uid(), claimed_at = now()
    where event_id = v_event_id and team_id = v_team_id and type = 'MISSION'
      and ref_id = p_attempt_id and status = 'OPEN';
  if not found then
    raise exception 'already handled by another staff member';
  end if;

  perform 1 from team_state where team_id = v_team_id for update;

  select difficulty,
      coalesce(success_reward, case difficulty when 'EASY' then 10000000 when 'NORMAL' then 20000000 when 'HARD' then 30000000 end),
      coalesce(failure_penalty, case difficulty when 'EASY' then 5000000 when 'NORMAL' then 10000000 when 'HARD' then 15000000 end)
    into v_difficulty, v_success_reward, v_failure_penalty
    from station_missions where id = v_mission_id;

  update review_queue set status = 'RESOLVED'
    where event_id = v_event_id and team_id = v_team_id and type = 'MISSION' and ref_id = p_attempt_id;

  if p_decision = 'FAILURE' then
    update team_mission_attempts
      set status = 'FAILURE', reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_attempt_id;

    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, related_mission_attempt_id, related_turn_id, reason, created_by)
      values (v_event_id, v_team_id, -v_failure_penalty, 'MISSION_FAILURE', gen_random_uuid(), p_attempt_id, v_turn_id, p_reason, auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache - v_failure_penalty where team_id = v_team_id;

    insert into team_mission_attempts (team_id, turn_id, station_id, offered_mission_ids, selected_mission_id, locked_at, attempt_number, status)
      values (v_team_id, v_turn_id, v_station_id, array[v_mission_id], v_mission_id, now(), v_attempt_number + 1, 'AWAITING_PHOTO')
      returning id into v_new_attempt_id;

    update team_state set state = 'MISSION_ACTIVE', version = version + 1 where team_id = v_team_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value, reason)
      values (v_event_id, auth.uid(), v_team_id, 'MISSION_FAILURE',
        jsonb_build_object('attempt_id', p_attempt_id),
        jsonb_build_object('penalty', v_failure_penalty, 'new_attempt_id', v_new_attempt_id), p_reason);
    return;
  end if;

  -- SUCCESS
  select mission_success_count into v_mission_success_count from team_state where team_id = v_team_id;
  select mission_bonus_interval, mission_bonus_multiplier into v_bonus_interval, v_bonus_multiplier
    from events where id = v_event_id;

  v_mission_success_count := v_mission_success_count + 1;

  -- ミッション倍増カード: 5回ごとボーナスと重複する場合はより高い倍率のみ適用
  select id, coalesce((payload->>'multiplier')::numeric, 1) into v_card_mult_id, v_card_mult
    from card_active_effects
    where team_id = v_team_id and effect_type = 'MISSION_REWARD_MULTIPLIER' and consumed_at is null
    order by created_at limit 1 for update;

  if v_card_mult_id is not null then
    update card_active_effects set consumed_at = now() where id = v_card_mult_id;
  end if;

  if v_bonus_interval > 0 and v_mission_success_count % v_bonus_interval = 0 then
    v_final_mult := greatest(coalesce(v_card_mult, 1), v_bonus_multiplier);
  else
    v_final_mult := coalesce(v_card_mult, 1);
  end if;

  if v_final_mult > 1 then
    v_amount := round(v_success_reward * v_final_mult);
    v_ttype := case when v_card_mult is not null and v_card_mult >= coalesce(v_bonus_multiplier, 1) then 'CARD_EFFECT' else 'MISSION_5X_BONUS' end;
  else
    v_amount := v_success_reward;
    v_ttype := 'MISSION_SUCCESS';
  end if;

  update team_mission_attempts
    set status = 'SUCCESS', reviewed_by = auth.uid(), reviewed_at = now(), is_bonus_applied = (v_final_mult > 1)
    where id = p_attempt_id;

  insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, related_mission_attempt_id, related_turn_id, reason, created_by)
    values (v_event_id, v_team_id, v_amount, v_ttype, gen_random_uuid(), p_attempt_id, v_turn_id, p_reason, auth.uid());

  -- おすそわけカード: 対象チームに獲得ポイントの一部を分配(自チームは減らない)
  select id, (payload->>'target_team_id')::uuid as target_team_id, coalesce((payload->>'percent')::int, 50) as pct
    into v_share
    from card_active_effects
    where team_id = v_team_id and effect_type = 'SHARE_NEXT_MISSION_REWARD' and consumed_at is null
    order by created_at limit 1 for update;

  if v_share.id is not null then
    update card_active_effects set consumed_at = now() where id = v_share.id;
    v_share_amount := round(v_amount * v_share.pct / 100.0);
    if v_share_amount > 0 and v_share.target_team_id is not null then
      insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
        values (v_event_id, v_share.target_team_id, v_share_amount, 'CARD_EFFECT', gen_random_uuid(), 'おすそわけカードで分配', auth.uid());
      update team_state set coin_balance_cache = coin_balance_cache + v_share_amount where team_id = v_share.target_team_id;
      perform fn_notify_team(v_event_id, v_share.target_team_id, format('おすそわけカードで%s円を受け取りました。', v_share_amount));
    end if;
  end if;

  -- 足止めカード解除
  update card_active_effects set consumed_at = now()
    where team_id = v_team_id and effect_type = 'BLOCK_UNTIL_MISSION_SUCCESS' and consumed_at is null;

  -- カード自動取得(その駅のプールからレアリティ加重抽選)
  v_card_id := fn_draw_weighted_card(v_event_id, v_station_id);
  if v_card_id is not null then
    perform fn_grant_card(v_team_id, v_card_id, 1);
  end if;

  select exists(select 1 from station_properties where station_id = v_station_id and is_active) into v_has_properties;
  v_next_state := case when v_has_properties then 'PROPERTY_PURCHASE' else 'DICE_READY' end;

  update team_state
    set coin_balance_cache = coin_balance_cache + v_amount,
        mission_success_count = v_mission_success_count,
        current_station_id = v_station_id,
        state = v_next_state,
        current_turn_id = case when v_next_state = 'DICE_READY' then null else current_turn_id end,
        version = version + 1
    where team_id = v_team_id;

  update turns set status = 'COMPLETED', completed_at = now() where id = v_turn_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
    values (v_event_id, auth.uid(), v_team_id, 'MISSION_SUCCESS',
      jsonb_build_object('attempt_id', p_attempt_id), jsonb_build_object('amount', v_amount, 'type', v_ttype, 'card_id', v_card_id));
end;
$$;

-- ===================== fn_review_arrival 再定義: 足止めカードで一律ボーナスをスキップ可能に =====================

create or replace function fn_review_arrival(p_arrival_submission_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_station_id uuid;
  v_turn_id uuid;
  v_event_id uuid;
  v_bonus bigint;
  v_offered uuid[];
  v_next_dest uuid;
  v_visit_count int;
  v_repeat_threshold int;
  v_repeat_reward bigint;
  v_has_properties boolean;
  v_next_state team_game_state;
  v_forced_mission boolean;
begin
  if v_staff_event_id is null then
    raise exception 'staff only';
  end if;
  if p_decision not in ('APPROVE', 'REJECT') then
    raise exception 'invalid decision';
  end if;

  select a.team_id, a.station_id, a.turn_id, t.event_id
    into v_team_id, v_station_id, v_turn_id, v_event_id
    from arrival_submissions a
    join teams t on t.id = a.team_id
    where a.id = p_arrival_submission_id;

  if v_event_id is null or v_event_id is distinct from v_staff_event_id then
    raise exception 'not found or not your event';
  end if;

  update review_queue
    set status = 'CLAIMED', claimed_by = auth.uid(), claimed_at = now()
    where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL'
      and ref_id = p_arrival_submission_id and status = 'OPEN';
  if not found then
    raise exception 'already handled by another staff member';
  end if;

  perform 1 from team_state where team_id = v_team_id for update;

  if p_decision = 'REJECT' then
    update arrival_submissions
      set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = p_reason
      where id = p_arrival_submission_id;
    update team_state set state = 'ARRIVAL_SUBMISSION', version = version + 1 where team_id = v_team_id;
    update review_queue set status = 'RESOLVED'
      where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL' and ref_id = p_arrival_submission_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, reason)
      values (v_event_id, auth.uid(), v_team_id, 'ARRIVAL_REJECT',
        jsonb_build_object('arrival_submission_id', p_arrival_submission_id), p_reason);
    return;
  end if;

  -- APPROVE
  update arrival_submissions
    set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_arrival_submission_id;

  select active_destination_station_id, default_destination_bonus_amount
    into v_next_dest, v_bonus
    from events where id = v_event_id for update;

  if v_next_dest is not null and v_next_dest = v_station_id then
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_event_id, v_team_id, v_bonus, 'DESTINATION_BONUS', gen_random_uuid(), '最終目的地到達ボーナス', auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache + v_bonus where team_id = v_team_id;

    insert into destination_queue (event_id, station_id, sequence_order, bonus_coin_amount, status, cleared_by_team_id, cleared_at)
      values (
        v_event_id, v_station_id,
        coalesce((select max(sequence_order) from destination_queue where event_id = v_event_id), 0) + 1,
        v_bonus, 'CLEARED', v_team_id, now()
      );

    v_next_dest := fn_pick_next_destination(v_event_id, v_station_id);
    update events set active_destination_station_id = v_next_dest where id = v_event_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
      values (v_event_id, auth.uid(), v_team_id, 'DESTINATION_BONUS',
        jsonb_build_object('station_id', v_station_id), jsonb_build_object('bonus', v_bonus, 'next_destination', v_next_dest));
  end if;

  -- 足止めカードが有効な場合は一律ボーナスを使わせず、必ずミッションを行わせる
  select exists(select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_UNTIL_MISSION_SUCCESS' and consumed_at is null)
    into v_forced_mission;

  select count(*) into v_visit_count
    from arrival_submissions
    where team_id = v_team_id and station_id = v_station_id and status = 'APPROVED';

  select repeat_visit_threshold, repeat_visit_flat_reward_amount into v_repeat_threshold, v_repeat_reward
    from events where id = v_event_id;

  if v_visit_count >= v_repeat_threshold and not v_forced_mission then
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, related_turn_id, reason, created_by)
      values (v_event_id, v_team_id, v_repeat_reward, 'REPEAT_VISIT_BONUS', gen_random_uuid(), v_turn_id,
        format('同一駅%s回目到着の一律ボーナス', v_visit_count), auth.uid());

    select exists(select 1 from station_properties where station_id = v_station_id and is_active) into v_has_properties;
    v_next_state := case when v_has_properties then 'PROPERTY_PURCHASE' else 'DICE_READY' end;

    update team_state
      set coin_balance_cache = coin_balance_cache + v_repeat_reward,
          current_station_id = v_station_id,
          state = v_next_state,
          current_turn_id = case when v_next_state = 'DICE_READY' then null else current_turn_id end,
          version = version + 1
      where team_id = v_team_id;

    update turns set status = 'COMPLETED', completed_at = now() where id = v_turn_id;

    update review_queue set status = 'RESOLVED'
      where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL' and ref_id = p_arrival_submission_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
      values (v_event_id, auth.uid(), v_team_id, 'ARRIVAL_APPROVE',
        jsonb_build_object('arrival_submission_id', p_arrival_submission_id),
        jsonb_build_object('repeat_visit_count', v_visit_count, 'flat_reward', v_repeat_reward));
    return;
  end if;

  v_offered := fn_generate_offered_missions(v_team_id, v_station_id);
  insert into team_mission_attempts (team_id, turn_id, station_id, offered_mission_ids, attempt_number, status)
    values (v_team_id, v_turn_id, v_station_id, v_offered, 1, 'OFFERED');

  update team_state set state = 'MISSION_SELECTION', version = version + 1 where team_id = v_team_id;
  update review_queue set status = 'RESOLVED'
    where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL' and ref_id = p_arrival_submission_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value)
    values (v_event_id, auth.uid(), v_team_id, 'ARRIVAL_APPROVE', jsonb_build_object('arrival_submission_id', p_arrival_submission_id));
end;
$$;

-- ===================== fn_admin_force_end_event 再定義: 収益2倍カード反映 + 残カード償却ログ =====================

create or replace function fn_admin_force_end_event(p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_purchase record;
  v_team record;
  v_yield_mult numeric;
  v_payout bigint;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  for v_purchase in
    select tpp.id, tpp.team_id, tpp.price_paid, tpp.yield_amount
      from team_property_purchases tpp
      join teams t on t.id = tpp.team_id
      where t.event_id = v_staff_event_id and tpp.settled = false
  loop
    select case when exists(
      select 1 from card_active_effects where team_id = v_purchase.team_id and effect_type = 'PROPERTY_YIELD_X2' and consumed_at is null
    ) then 2 else 1 end into v_yield_mult;

    v_payout := v_purchase.price_paid + v_purchase.yield_amount * v_yield_mult;

    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_staff_event_id, v_purchase.team_id, v_payout,
        'PROPERTY_PAYOUT', gen_random_uuid(), '物件精算(購入代金+利回り)', auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache + v_payout
      where team_id = v_purchase.team_id;
    update team_property_purchases set settled = true, settled_at = now() where id = v_purchase.id;
  end loop;

  update card_active_effects set consumed_at = now()
    where event_id = v_staff_event_id and effect_type = 'PROPERTY_YIELD_X2' and consumed_at is null;

  -- 残カードは全て価値0として償却する(ログのみ、コインには一切加算しない)
  for v_team in
    select tc.team_id, sum(tc.quantity) as total_qty
      from team_cards tc join teams t on t.id = tc.team_id
      where t.event_id = v_staff_event_id and tc.quantity > 0
      group by tc.team_id
  loop
    insert into audit_log (event_id, team_id, action_type, before_value)
      values (v_staff_event_id, v_team.team_id, 'CARDS_WRITTEN_OFF', jsonb_build_object('remaining_quantity', v_team.total_qty));
  end loop;

  update events set status = 'FORCE_ENDED', end_at = least(coalesce(end_at, now()), now()) where id = v_staff_event_id;

  insert into audit_log (event_id, staff_id, action_type, reason)
    values (v_staff_event_id, auth.uid(), 'EVENT_FORCE_END', p_reason);
end;
$$;

-- ===================== 管理者用カード操作 =====================

create or replace function fn_admin_grant_card(p_team_id uuid, p_card_code text, p_qty int default 1)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_event uuid;
  v_card_id uuid;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  select event_id into v_team_event from teams where id = p_team_id;
  if v_team_event is distinct from v_staff_event_id then raise exception 'not your event'; end if;
  select id into v_card_id from cards where card_code = p_card_code;
  if v_card_id is null then raise exception 'card not found'; end if;

  perform fn_grant_card(p_team_id, v_card_id, p_qty);

  insert into audit_log (event_id, staff_id, team_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), p_team_id, 'ADMIN_CARD_GRANT', jsonb_build_object('card_code', p_card_code, 'qty', p_qty));
end;
$$;

create or replace function fn_admin_revoke_card(p_team_id uuid, p_card_code text, p_qty int default 1)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_event uuid;
  v_card_id uuid;
  v_qty int;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  select event_id into v_team_event from teams where id = p_team_id;
  if v_team_event is distinct from v_staff_event_id then raise exception 'not your event'; end if;
  select id into v_card_id from cards where card_code = p_card_code;
  if v_card_id is null then raise exception 'card not found'; end if;

  select quantity into v_qty from team_cards where team_id = p_team_id and card_id = v_card_id for update;
  update team_cards set quantity = greatest(coalesce(v_qty, 0) - p_qty, 0) where team_id = p_team_id and card_id = v_card_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), p_team_id, 'ADMIN_CARD_REVOKE', jsonb_build_object('card_code', p_card_code, 'qty', p_qty));
end;
$$;

create or replace function fn_admin_clear_card_effect(p_effect_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_effect_event uuid;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  select event_id into v_effect_event from card_active_effects where id = p_effect_id;
  if v_effect_event is distinct from v_staff_event_id then raise exception 'not your event'; end if;
  update card_active_effects set consumed_at = now() where id = p_effect_id and consumed_at is null;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'ADMIN_CARD_EFFECT_CLEAR', jsonb_build_object('effect_id', p_effect_id));
end;
$$;

create or replace function fn_admin_set_rarity_weight(p_rarity text, p_weight int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if p_rarity not in ('NORMAL', 'RARE', 'SUPER_RARE') then raise exception 'invalid rarity'; end if;
  insert into card_rarity_weights (event_id, rarity, weight) values (v_staff_event_id, p_rarity, p_weight)
    on conflict (event_id, rarity) do update set weight = excluded.weight;
end;
$$;

-- ===================== ボーナスミッション =====================

create or replace function fn_submit_bonus_mission_photos(p_bonus_attempt_id uuid, p_photo_paths text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_attempt_team_id uuid;
  v_status mission_attempt_status;
  v_path text;
begin
  if v_team_id is null then raise exception 'participant only'; end if;

  select ts.event_id, a.team_id, a.status into v_event_id, v_attempt_team_id, v_status
    from team_state ts
    join team_bonus_mission_attempts a on a.id = p_bonus_attempt_id
    where ts.team_id = v_team_id for update of ts;

  if v_attempt_team_id is null or v_attempt_team_id <> v_team_id then raise exception 'not your bonus mission attempt'; end if;
  if v_status = 'PENDING_REVIEW' then return; end if;
  if v_status <> 'AWAITING_PHOTO' then raise exception 'invalid status'; end if;
  if array_length(p_photo_paths, 1) is null or array_length(p_photo_paths, 1) > 3 then
    raise exception 'photo count must be 1-3';
  end if;

  foreach v_path in array p_photo_paths loop
    if split_part(v_path, '/', 1) <> v_event_id::text or split_part(v_path, '/', 2) <> v_team_id::text then
      raise exception 'invalid photo path: %', v_path;
    end if;
  end loop;

  insert into bonus_mission_photos (bonus_attempt_id, storage_path)
    select p_bonus_attempt_id, unnest(p_photo_paths);

  update team_bonus_mission_attempts set status = 'PENDING_REVIEW' where id = p_bonus_attempt_id;

  insert into review_queue (event_id, team_id, type, ref_id)
    values (v_event_id, v_team_id, 'BONUS_MISSION', p_bonus_attempt_id);
end;
$$;

create or replace function fn_review_bonus_mission(p_bonus_attempt_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_event_id uuid;
  v_reward bigint;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if p_decision not in ('SUCCESS', 'FAILURE') then raise exception 'invalid decision'; end if;

  select a.team_id, t.event_id, a.reward into v_team_id, v_event_id, v_reward
    from team_bonus_mission_attempts a join teams t on t.id = a.team_id
    where a.id = p_bonus_attempt_id;

  if v_event_id is null or v_event_id is distinct from v_staff_event_id then raise exception 'not found or not your event'; end if;

  update review_queue set status = 'CLAIMED', claimed_by = auth.uid(), claimed_at = now()
    where event_id = v_event_id and team_id = v_team_id and type = 'BONUS_MISSION' and ref_id = p_bonus_attempt_id and status = 'OPEN';
  if not found then raise exception 'already handled by another staff member'; end if;

  perform 1 from team_state where team_id = v_team_id for update;

  update team_bonus_mission_attempts
    set status = p_decision::mission_attempt_status, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_bonus_attempt_id;

  update review_queue set status = 'RESOLVED'
    where event_id = v_event_id and team_id = v_team_id and type = 'BONUS_MISSION' and ref_id = p_bonus_attempt_id;

  if p_decision = 'SUCCESS' then
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_event_id, v_team_id, v_reward, 'CARD_EFFECT', gen_random_uuid(), 'ボーナスミッション成功', auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache + v_reward where team_id = v_team_id;
  end if;

  insert into audit_log (event_id, staff_id, team_id, action_type, after_value, reason)
    values (v_event_id, auth.uid(), v_team_id, 'BONUS_MISSION_REVIEW', jsonb_build_object('decision', p_decision, 'reward', v_reward), p_reason);
end;
$$;

grant execute on function fn_admin_grant_card(uuid, text, int) to authenticated;
grant execute on function fn_admin_revoke_card(uuid, text, int) to authenticated;
grant execute on function fn_admin_clear_card_effect(uuid) to authenticated;
grant execute on function fn_admin_set_rarity_weight(text, int) to authenticated;
grant execute on function fn_submit_bonus_mission_photos(uuid, text[]) to authenticated;
grant execute on function fn_review_bonus_mission(uuid, text, text) to authenticated;
