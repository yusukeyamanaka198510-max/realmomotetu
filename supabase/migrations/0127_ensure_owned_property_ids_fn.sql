-- 0118で作成したはずの fn_get_owned_property_ids が、当時は未適用だった疑いが強い
-- (二重購入バグが実際に発生していたことから、0118自体がまだ本番に反映されていなかったと
-- 推測される)。この関数が無いと、参加者画面の「他チームが購入済みの物件を除外する」処理が
-- 静かに空振りし、既に他チームの物件がボタンとして表示され続け、押した瞬間に
-- fn_purchase_property側のチェックで赤文字エラーになる、という不具合につながっていた。
-- create or replace なので、既に存在していても無害に再適用できる。

create or replace function fn_get_owned_property_ids()
returns table(property_id uuid)
language sql stable security definer set search_path = public as $$
  select tpp.property_id
  from team_property_purchases tpp
  join teams t on t.id = tpp.team_id
  where not tpp.settled and t.event_id = current_event_id();
$$;

grant execute on function fn_get_owned_property_ids() to authenticated;
