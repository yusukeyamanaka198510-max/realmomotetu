-- カードの対象チーム選択UIのため、同一イベント内であれば他チームの所持カード数・
-- 未精算の物件購入(乗っ取りカードの対象選択用)を閲覧できるようにする。
-- (RLSは同一コマンドに対する複数ポリシーをORで評価するため、既存ポリシーに追加する形になる)

create policy team_cards_select_event on team_cards for select
  using (exists (select 1 from teams t where t.id = team_cards.team_id and t.event_id = current_event_id()));

create policy team_property_purchases_select_event on team_property_purchases for select
  using (exists (select 1 from teams t where t.id = team_property_purchases.team_id and t.event_id = current_event_id()));
