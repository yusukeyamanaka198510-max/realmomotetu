-- 0124が「created_at」という存在しないカラムを参照していて失敗した
-- (team_property_purchasesの実際のカラム名は purchased_at)。同内容を
-- 正しいカラム名で再実行する。0124は失敗して何も適用されていないため、
-- 安全にそのまま同じ処理を行う。

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
        order by tpp2.purchased_at asc, tpp2.id asc
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
