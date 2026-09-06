-- CARD報酬選択時、クライアント側がRPCの戻り値から直接スロット演出を出すようになったため、
-- 冗長になっていたcard_notifications経由の通知(古いCardSlotOverlay用)を削除する。
-- これを残すと、新しい演出(RPC結果ベース)と古い演出(通知ベース)が二重に表示されてしまう。
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
