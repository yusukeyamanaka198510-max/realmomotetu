-- events.card_acquisition_enabled が用意されていたのに、実際のカード付与処理(fn_review_mission)で
-- 一度もチェックされていなかったため、設定してもカード付与を止められない不整合を修正する。

create or replace function fn_admin_set_card_acquisition_enabled(p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  update events set card_acquisition_enabled = p_enabled where id = v_staff_event_id;
end;
$$;
grant execute on function fn_admin_set_card_acquisition_enabled(boolean) to authenticated;

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
  v_card_acquisition_enabled boolean;
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

  -- カード自動取得(その駅のプールからレアリティ加重抽選。管理画面でオフにされていればスキップ)
  select card_acquisition_enabled into v_card_acquisition_enabled from events where id = v_event_id;
  if coalesce(v_card_acquisition_enabled, true) then
    v_card_id := fn_draw_weighted_card(v_event_id, v_station_id);
    if v_card_id is not null then
      perform fn_grant_card(v_team_id, v_card_id, 1);
    end if;
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
