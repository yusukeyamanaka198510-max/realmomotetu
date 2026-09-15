-- 0118のユニークインデックス作成が、既に存在する二重購入データ(ボタン連打による
-- 同一物件の複数所有)により失敗した。まず既存の重複を解消してから、改めて
-- インデックスを作成する。
--
-- 同一property_idで「未決済(not settled)」な所有が複数ある場合、一番古い
-- (created_atが最小の)ものだけを正規の所有として残し、それ以外は
-- settled=trueにして「二重購入分の返金」を行う(購入額をコインとして払い戻す)。

do $$
declare
  v_dup record;
begin
  for v_dup in
    select tpp.id, tpp.team_id, tpp.price_paid
    from team_property_purchases tpp
    where not tpp.settled
      and tpp.id <> (
        select tpp2.id from team_property_purchases tpp2
        where tpp2.property_id = tpp.property_id and not tpp2.settled
        order by tpp2.created_at asc, tpp2.id asc
        limit 1
      )
  loop
    update team_property_purchases set settled = true, settled_at = now() where id = v_dup.id;

    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      select ts.event_id, v_dup.team_id, v_dup.price_paid, 'ADMIN_ADJUSTMENT', gen_random_uuid(),
        'システム不具合による物件の二重購入分を返金', null
      from team_state ts where ts.team_id = v_dup.team_id;

    update team_state set coin_balance_cache = coin_balance_cache + v_dup.price_paid where team_id = v_dup.team_id;
  end loop;
end $$;

create unique index if not exists team_property_purchases_active_owner_idx
  on team_property_purchases (property_id)
  where not settled;
