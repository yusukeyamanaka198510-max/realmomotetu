-- 変更6: ボンビー機能
-- ・ゴール到達時、その時点で「目的地として選択している駅」がゴールから一番遠いチームに憑く
--   (常に0〜1チームのみ)。到着された(古い)ゴール駅を距離の基準にする。
-- ・ボンビー保持中はミッション成功のたびに「悪さ」(現金の一部償却 or 不動産の強制安売り)が発生。
-- ・悪さの直後、サイコロで4-6が出れば他チームへなすりつけられる(なすりつけカードでも可)。

alter table team_state add column if not exists has_bombii boolean not null default false;

-- ===================== fn_review_arrival: ゴール到達時にボンビー付与判定を追加 =====================
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

    -- ボンビー付与判定: 既に誰かが持っていなければ、到着された(古い)ゴール駅から
    -- 一番遠い場所にいるチームに憑く。
    select exists(select 1 from team_state where event_id = v_event_id and has_bombii) into v_bombii_already;
    if not v_bombii_already then
      for v_other_team in select team_id, current_station_id from team_state where event_id = v_event_id and current_station_id is not null loop
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

-- ===================== fn_claim_mission_reward: ボンビー保持中の「悪さ」を追加 =====================
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
  v_purchase record;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;
  if p_choice not in ('CARD', 'COIN') then
    raise exception 'invalid choice';
  end if;

  select state, event_id, current_station_id, mission_success_count, has_bombii
    into v_state, v_event_id, v_station_id, v_mission_success_count, v_has_bombii
    from team_state where team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);

  if v_state <> 'MISSION_REWARD_CHOICE' then
    raise exception 'invalid state: %', v_state;
  end if;

  -- ボンビーの悪さ: 保有中は毎回、報酬付与の前にA(現金の一部償却)かB(不動産の強制安売り)のどちらかが発生する
  if v_has_bombii then
    if random() < 0.5 then
      select id into v_purchase from team_property_purchases
        where team_id = v_team_id and settled = false order by random() limit 1 for update;
    end if;

    if v_purchase.id is not null then
      update team_property_purchases set settled = true, settled_at = now() where id = v_purchase.id;
      insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
        values (v_event_id, v_team_id, floor(v_purchase.price_paid / 2), 'CARD_EFFECT', gen_random_uuid(), 'ボンビーの悪さ(不動産強制安売り)', null);
      update team_state set coin_balance_cache = coin_balance_cache + floor(v_purchase.price_paid / 2) where team_id = v_team_id;
      v_bombii_info := jsonb_build_object('type', 'PROPERTY_SOLD', 'amount', floor(v_purchase.price_paid / 2));
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

-- ===================== 撃退チャレンジ: サイコロで4-6ならなすりつけ先をスロットで決定 =====================
create or replace function fn_bombii_escape_roll()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_has_bombii boolean;
  v_roll int;
  v_new_holder uuid;
  v_new_holder_name text;
  v_result jsonb;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select event_id, has_bombii into v_event_id, v_has_bombii from team_state where team_id = v_team_id for update;
  perform fn_assert_event_active(v_event_id);

  if not v_has_bombii then
    raise exception 'this team does not have bombii';
  end if;

  v_roll := 1 + floor(random() * 6)::int;

  if v_roll >= 4 then
    select id into v_new_holder from teams
      where event_id = v_event_id and id <> v_team_id order by random() limit 1;
    if v_new_holder is not null then
      update team_state set has_bombii = false where team_id = v_team_id;
      update team_state set has_bombii = true where team_id = v_new_holder;
      select team_name into v_new_holder_name from teams where id = v_new_holder;

      perform fn_notify_team(v_event_id, v_new_holder, format('😈ボンビー撃退チャレンジでなすりつけられました!(サイコロ:%s)', v_roll));
      perform fn_notify_team(v_event_id, v_team_id, format('🎲サイコロ%sで撃退成功!ボンビーを「%s」になすりつけました。', v_roll, v_new_holder_name));

      insert into audit_log (event_id, team_id, action_type, after_value)
        values (v_event_id, v_team_id, 'BOMBII_ESCAPE_SUCCESS', jsonb_build_object('roll', v_roll, 'new_holder', v_new_holder));
    end if;
    v_result := jsonb_build_object('roll', v_roll, 'escaped', v_new_holder is not null, 'new_holder_team_name', v_new_holder_name);
  else
    v_result := jsonb_build_object('roll', v_roll, 'escaped', false);
    insert into audit_log (event_id, team_id, action_type, after_value)
      values (v_event_id, v_team_id, 'BOMBII_ESCAPE_FAILURE', jsonb_build_object('roll', v_roll));
  end if;

  return v_result;
end;
$$;

grant execute on function fn_bombii_escape_roll() to authenticated;

-- ===================== なすりつけカード =====================
insert into cards (card_code, name, category, rarity, description, effect_type, use_timing, target_type, usable_conditions, exchangeable)
values (
  'BOMBII_TRANSFER', 'なすりつけカード', 'OBSTRUCTION', 'RARE',
  '自チームがボンビーに取り憑かれている時のみ使用可能。使用すると即座に対象チームへボンビーを移す。',
  'BOMBII_TRANSFER', 'ANYTIME', 'OTHER_TEAM',
  jsonb_build_object('requires_bombii', true), false
)
on conflict (card_code) do nothing;

-- ===================== fn_use_card: BOMBII_TRANSFER分岐を追加 =====================
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
  v_has_bombii boolean;
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

  select state, current_station_id, has_bombii into v_state, v_current_station, v_has_bombii from team_state where team_id = v_team_id;

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
      select id into v_dest from stations where event_id = v_event_id order by random() limit 1;
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
        values (v_event_id, p_target_team_id, 'BLOCK_UNTIL_MISSION_SUCCESS', v_card.id, null);
      v_message := format('%sを使用しました。', v_card.name);
      perform fn_notify_team(v_event_id, p_target_team_id, format('%sで、ミッション成功するまで移動できなくなりました。', v_card.name));
    end if;

  when 'PUSH_BACK_SAME_STATION_TEAMS' then
    declare v_other record; v_dest uuid; v_dist int; begin
      for v_other in select id, current_station_id from team_state where event_id = v_event_id and current_station_id = v_current_station and team_id <> v_team_id loop
        select id into v_dest from stations where event_id = v_event_id order by random() limit 1;
        update team_state set current_station_id = v_dest where team_id = v_other.id;
        perform fn_notify_team(v_event_id, v_other.id, format('%sで、別の駅へ押し戻されました。', v_card.name));
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
