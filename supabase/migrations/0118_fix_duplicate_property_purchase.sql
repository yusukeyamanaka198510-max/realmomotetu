-- fn_purchase_property に「既に(自チーム含め)誰かが所有中(settled=false)の物件は
-- 購入できない」チェックが無く、同じ物件を何度でも購入できてしまうバグを修正する。
--
-- 1. DBレベルでも二重所有を防ぐため、「未決済(settled=false)の所有は物件ごとに1件まで」
--    という部分ユニークインデックスを追加する(同時購入のレースコンディション対策)。
-- 2. fn_purchase_property内で事前チェックし、分かりやすいエラーメッセージを返す。

create unique index if not exists team_property_purchases_active_owner_idx
  on team_property_purchases (property_id)
  where not settled;

create or replace function fn_purchase_property(p_property_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_current_station uuid;
  v_property_station uuid;
  v_price bigint;
  v_yield bigint;
  v_balance bigint;
  v_existing_owner uuid;
begin
  if v_team_id is null then raise exception 'participant only'; end if;

  select ts.state, ts.event_id, ts.current_station_id, ts.coin_balance_cache
    into v_state, v_event_id, v_current_station, v_balance
    from team_state ts where ts.team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);
  if v_state <> 'PROPERTY_PURCHASE' then
    raise exception 'invalid state: %', v_state;
  end if;

  select station_id, price, yield_amount into v_property_station, v_price, v_yield
    from station_properties where id = p_property_id and is_active;
  if v_property_station is null then
    raise exception 'property not found';
  end if;
  if v_property_station <> v_current_station then
    raise exception 'this property is not available at your current station';
  end if;
  if v_balance < v_price then
    raise exception 'insufficient coin balance';
  end if;

  -- 既に(自チーム含め)誰かが未決済で所有していないか確認(同時購入対策でロックも取る)
  select team_id into v_existing_owner
    from team_property_purchases
    where property_id = p_property_id and not settled
    for update;
  if v_existing_owner is not null then
    raise exception 'this property is already owned by another team';
  end if;

  insert into team_property_purchases (team_id, property_id, price_paid, yield_amount, idempotency_key)
    values (v_team_id, p_property_id, v_price, v_yield, gen_random_uuid());

  insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
    values (v_event_id, v_team_id, -v_price, 'PROPERTY_PURCHASE', gen_random_uuid(), null, auth.uid());
  update team_state set coin_balance_cache = coin_balance_cache - v_price where team_id = v_team_id;
end;
$$;

-- ===================== fn_get_owned_property_ids =====================
-- team_property_purchasesは自チーム分しかRLSで見えないため、「今誰かが所有中の物件」を
-- 参加者の購入画面から除外できるよう、property_idだけを返す軽量RPCを用意する。

create or replace function fn_get_owned_property_ids()
returns table(property_id uuid)
language sql stable security definer set search_path = public as $$
  select tpp.property_id
  from team_property_purchases tpp
  join teams t on t.id = tpp.team_id
  where not tpp.settled and t.event_id = current_event_id();
$$;

grant execute on function fn_get_owned_property_ids() to authenticated;
