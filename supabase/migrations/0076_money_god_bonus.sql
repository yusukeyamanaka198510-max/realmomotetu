-- 変更7: お金の神様(累計5回到達ボーナス、一度きり)
-- 「目的地到着(ゴールではない、各チーム個別のサイコロ目的地)」の累計が全チーム合算で5回に
-- 達した、その5回目を踏んだチームに、次のミッション成功時、コインスロットと同じ方式で
-- 追加ボーナスを1回だけ付与する。

alter table events add column if not exists normal_arrival_count int not null default 0;
alter table events add column if not exists money_god_awarded boolean not null default false;
alter table team_state add column if not exists pending_money_god_bonus boolean not null default false;

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
  v_bombii_already boolean;
  v_bombii_team_id uuid;
  v_bombii_max_dist int := -1;
  v_bombii_dist int;
  v_bombii_team_name text;
  v_is_goal_arrival boolean := false;
  v_normal_arrival_count int;
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
    v_is_goal_arrival := true;

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

    -- ボンビー付与判定: 既に誰かが持っていなければ、到着された(古い)ゴール駅から
    -- 一番遠い場所にいるチームに憑く。
    select exists(select 1 from team_state where event_id = v_event_id and has_bombii) into v_bombii_already;
    if not v_bombii_already then
      for v_other_team in select team_id, current_station_id from team_state where event_id = v_event_id and current_station_id is not null and team_id <> v_team_id loop
        v_bombii_dist := fn_shortest_hops(v_station_id, v_other_team.current_station_id, v_event_id);
        if v_bombii_dist > v_bombii_max_dist then
          v_bombii_max_dist := v_bombii_dist;
          v_bombii_team_id := v_other_team.team_id;
        end if;
      end loop;

      if v_bombii_team_id is not null then
        update team_state set has_bombii = true where team_id = v_bombii_team_id;
        select team_name into v_bombii_team_name from teams where id = v_bombii_team_id;

        for v_other_team in select id from teams where event_id = v_event_id loop
          perform fn_notify_team(
            v_event_id, v_other_team.id,
            format('😈ボンビーが「%s」に取り憑きました!(理由: ゴール「%s」から一番遠い場所にいたため)',
              v_bombii_team_name, v_cleared_station_name)
          );
        end loop;

        insert into audit_log (event_id, staff_id, team_id, action_type, after_value)
          values (v_event_id, null, v_bombii_team_id, 'BOMBII_ASSIGNED',
            jsonb_build_object('from_station', v_station_id, 'distance', v_bombii_max_dist));
      end if;
    end if;

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

  -- お金の神様: ゴールではない通常到着が全チーム合算で累計5回に達した、その5回目のチームに
  -- 「次のミッション成功時ボーナス」フラグを立てる(一度きり)。
  if not v_is_goal_arrival then
    update events set normal_arrival_count = normal_arrival_count + 1
      where id = v_event_id and not money_god_awarded
      returning normal_arrival_count into v_normal_arrival_count;

    if v_normal_arrival_count = 5 then
      update events set money_god_awarded = true where id = v_event_id;
      update team_state set pending_money_god_bonus = true where team_id = v_team_id;
      perform fn_notify_team(v_event_id, v_team_id, '💰お金の神様が降臨しました!次のミッション成功時に特別ボーナスがあります。');

      insert into audit_log (event_id, staff_id, team_id, action_type, after_value)
        values (v_event_id, auth.uid(), v_team_id, 'MONEY_GOD_TRIGGERED', jsonb_build_object('station_id', v_station_id));
    end if;
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

-- ===================== fn_claim_mission_reward: お金の神様ボーナスを追加 =====================
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
  v_has_bombii boolean;
  v_bombii_info jsonb;
  v_balance bigint;
  v_pct int;
  v_loss bigint;
  v_purchase_id uuid;
  v_purchase_price bigint;
  v_pending_money_god boolean;
  v_money_god_amount bigint;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;
  if p_choice not in ('CARD', 'COIN') then
    raise exception 'invalid choice';
  end if;

  select state, event_id, current_station_id, mission_success_count, has_bombii, pending_money_god_bonus
    into v_state, v_event_id, v_station_id, v_mission_success_count, v_has_bombii, v_pending_money_god
    from team_state where team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);

  if v_state <> 'MISSION_REWARD_CHOICE' then
    raise exception 'invalid state: %', v_state;
  end if;

  -- ボンビーの悪さ: 保有中は毎回、報酬付与の前にA(現金の一部償却)かB(不動産の強制安売り)のどちらかが発生する
  if v_has_bombii then
    if random() < 0.5 then
      select id, price_paid into v_purchase_id, v_purchase_price from team_property_purchases
        where team_id = v_team_id and settled = false order by random() limit 1 for update;
    end if;

    if v_purchase_id is not null then
      update team_property_purchases set settled = true, settled_at = now() where id = v_purchase_id;
      insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
        values (v_event_id, v_team_id, floor(v_purchase_price / 2), 'CARD_EFFECT', gen_random_uuid(), 'ボンビーの悪さ(不動産強制安売り)', null);
      update team_state set coin_balance_cache = coin_balance_cache + floor(v_purchase_price / 2) where team_id = v_team_id;
      v_bombii_info := jsonb_build_object('type', 'PROPERTY_SOLD', 'amount', floor(v_purchase_price / 2));
    else
      select coin_balance_cache into v_balance from team_state where team_id = v_team_id;
      v_pct := (array[10, 20, 30, 40])[1 + floor(random() * 4)::int];
      v_loss := floor(greatest(v_balance, 0) * v_pct / 100.0);
      if v_loss > 0 then
        insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
          values (v_event_id, v_team_id, -v_loss, 'CARD_EFFECT', gen_random_uuid(), 'ボンビーの悪さ(現金償却)', null);
        update team_state set coin_balance_cache = coin_balance_cache - v_loss where team_id = v_team_id;
      end if;
      v_bombii_info := jsonb_build_object('type', 'CASH_LOST', 'amount', v_loss, 'percent', v_pct);
    end if;
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

  if v_bombii_info is not null then
    v_result := v_result || jsonb_build_object('bombii', v_bombii_info);
  end if;

  -- お金の神様ボーナス: 通常報酬に加え、同じコインスロット方式で追加ボーナスを1回だけ付与する
  if v_pending_money_god then
    v_money_god_amount := v_coin_options[1 + floor(random() * array_length(v_coin_options, 1))::int];
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_event_id, v_team_id, v_money_god_amount, 'CARD_EFFECT', gen_random_uuid(), 'お金の神様ボーナス', auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache + v_money_god_amount, pending_money_god_bonus = false where team_id = v_team_id;
    v_result := v_result || jsonb_build_object('money_god_bonus', v_money_god_amount);
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
