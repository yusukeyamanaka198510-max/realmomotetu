-- ミッションを易度1種類(EASY)のみに統一し、選択ステップを廃止。
-- ミッション成功後は固定額を即時付与するのではなく、MISSION_REWARD_CHOICE状態へ遷移し、
-- 参加者が「カード」か「コイン」かを選んでから新規fn_claim_mission_rewardで確定させる。

-- 到着時にその駅のEASYミッションを1件だけ選ぶ(既存の「同じミッションを繰り返さない」配慮は維持)。
create or replace function fn_pick_easy_mission(p_team_id uuid, p_station_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_mission uuid;
begin
  select id into v_mission from station_missions
    where station_id = p_station_id and difficulty = 'EASY' and is_active
      and id <> all (
        select selected_mission_id from team_mission_attempts
        where team_id = p_team_id and selected_mission_id is not null
      )
    order by created_at limit 1;

  if v_mission is null then
    select id into v_mission from station_missions
      where station_id = p_station_id and difficulty = 'EASY' and is_active
      order by created_at limit 1;
  end if;

  if v_mission is null then
    raise exception 'この駅(id=%)にはEASYミッションが登録されていません。管理画面から登録してください。', p_station_id;
  end if;

  return v_mission;
end;
$$;

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
  v_mission_id uuid;
  v_next_dest uuid;
  v_visit_count int;
  v_repeat_threshold int;
  v_repeat_reward bigint;
  v_has_properties boolean;
  v_next_state team_game_state;
  v_forced_mission boolean;
  v_cleared_station_name text;
  v_team_name text;
  v_next_station_name text;
  v_other_team record;
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

    select name into v_cleared_station_name from stations where id = v_station_id;
    select team_name into v_team_name from teams where id = v_team_id;
    select name into v_next_station_name from stations where id = v_next_dest;

    for v_other_team in select id from teams where event_id = v_event_id loop
      perform fn_notify_team(
        v_event_id, v_other_team.id,
        case when v_other_team.id = v_team_id then
          format('🏁 ゴール到達!「%s」で+%s円を獲得しました。次のゴールは「%s」です。',
            v_cleared_station_name, v_bonus, coalesce(v_next_station_name, '未定'))
        else
          format('🏁 %sが「%s」に到達しゴールボーナスを獲得しました。次のゴールは「%s」です。',
            v_team_name, v_cleared_station_name, coalesce(v_next_station_name, '未定'))
        end
      );
    end loop;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
      values (v_event_id, auth.uid(), v_team_id, 'DESTINATION_BONUS',
        jsonb_build_object('station_id', v_station_id), jsonb_build_object('bonus', v_bonus, 'next_destination', v_next_dest));
  end if;

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

  -- EASYミッション1件を自動アサインし、選択ステップ無しで直接MISSION_ACTIVEへ進める。
  v_mission_id := fn_pick_easy_mission(v_team_id, v_station_id);
  insert into team_mission_attempts (team_id, turn_id, station_id, offered_mission_ids, selected_mission_id, locked_at, attempt_number, status)
    values (v_team_id, v_turn_id, v_station_id, array[v_mission_id], v_mission_id, now(), 1, 'AWAITING_PHOTO');

  update team_state set state = 'MISSION_ACTIVE', version = version + 1 where team_id = v_team_id;
  update review_queue set status = 'RESOLVED'
    where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL' and ref_id = p_arrival_submission_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value)
    values (v_event_id, auth.uid(), v_team_id, 'ARRIVAL_APPROVE', jsonb_build_object('arrival_submission_id', p_arrival_submission_id));
end;
$$;

-- ミッション成功時: 固定額の即時付与をやめ、MISSION_REWARD_CHOICEへ遷移するだけにする。
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
  v_failure_penalty int;
  v_new_attempt_id uuid;
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

  select coalesce(failure_penalty, 5000000) into v_failure_penalty
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

  -- SUCCESS: 足止めカード解除だけ行い、報酬確定はfn_claim_mission_rewardに委ねる。
  update card_active_effects set consumed_at = now()
    where team_id = v_team_id and effect_type = 'BLOCK_UNTIL_MISSION_SUCCESS' and consumed_at is null;

  update team_mission_attempts
    set status = 'SUCCESS', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_attempt_id;

  update team_state
    set current_station_id = v_station_id,
        state = 'MISSION_REWARD_CHOICE',
        version = version + 1
    where team_id = v_team_id;

  update turns set status = 'COMPLETED', completed_at = now() where id = v_turn_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value)
    values (v_event_id, auth.uid(), v_team_id, 'MISSION_SUCCESS', jsonb_build_object('attempt_id', p_attempt_id));
end;
$$;

-- 参加者がミッション成功後、カードかコインかを選んで報酬を確定させる。
create or replace function fn_claim_mission_reward(p_choice text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_station_id uuid;
  v_mission_success_count int;
  v_bonus_interval int;
  v_bonus_multiplier numeric;
  v_card_mult_id uuid;
  v_card_mult numeric;
  v_final_mult numeric;
  v_base_amount bigint;
  v_amount bigint;
  v_ttype coin_transaction_type;
  v_share record;
  v_share_amount bigint;
  v_card_id uuid;
  v_card_name text;
  v_card_rarity text;
  v_has_properties boolean;
  v_next_state team_game_state;
  v_result jsonb;
  v_coin_options bigint[] := array[10000000, 15000000, 20000000, 25000000, 30000000];
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;
  if p_choice not in ('CARD', 'COIN') then
    raise exception 'invalid choice';
  end if;

  select state, event_id, current_station_id, mission_success_count
    into v_state, v_event_id, v_station_id, v_mission_success_count
    from team_state where team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);

  if v_state <> 'MISSION_REWARD_CHOICE' then
    raise exception 'invalid state: %', v_state;
  end if;

  v_mission_success_count := v_mission_success_count + 1;

  if p_choice = 'COIN' then
    v_base_amount := v_coin_options[1 + floor(random() * array_length(v_coin_options, 1))::int];

    select mission_bonus_interval, mission_bonus_multiplier into v_bonus_interval, v_bonus_multiplier
      from events where id = v_event_id;

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
      v_amount := round(v_base_amount * v_final_mult);
      v_ttype := case when v_card_mult is not null and v_card_mult >= coalesce(v_bonus_multiplier, 1) then 'CARD_EFFECT' else 'MISSION_5X_BONUS' end;
    else
      v_amount := v_base_amount;
      v_ttype := 'MISSION_SUCCESS';
    end if;

    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_event_id, v_team_id, v_amount, v_ttype, gen_random_uuid(), 'ミッション報酬(コイン)', auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache + v_amount where team_id = v_team_id;

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

    v_result := jsonb_build_object('type', 'COIN', 'amount', v_amount);
  else
    v_card_id := fn_draw_weighted_card(v_event_id, v_station_id);
    if v_card_id is null then
      raise exception 'no card available';
    end if;
    perform fn_grant_card(v_team_id, v_card_id, 1);
    select name, rarity into v_card_name, v_card_rarity from cards where id = v_card_id;
    perform fn_notify_team(v_event_id, v_team_id, format('🎴CARD:%s:%s', v_card_name, v_card_rarity));
    v_result := jsonb_build_object('type', 'CARD', 'card_name', v_card_name, 'card_rarity', v_card_rarity);
  end if;

  select exists(select 1 from station_properties where station_id = v_station_id and is_active) into v_has_properties;
  v_next_state := case when v_has_properties then 'PROPERTY_PURCHASE' else 'DICE_READY' end;

  update team_state
    set mission_success_count = v_mission_success_count,
        state = v_next_state,
        current_turn_id = case when v_next_state = 'DICE_READY' then null else current_turn_id end,
        version = version + 1
    where team_id = v_team_id;

  insert into audit_log (event_id, team_id, action_type, after_value)
    values (v_event_id, v_team_id, 'MISSION_REWARD_CLAIM', v_result);

  return v_result;
end;
$$;

grant execute on function fn_claim_mission_reward(text) to authenticated;
