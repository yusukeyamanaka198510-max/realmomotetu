-- 乗っ取りカード(PROPERTY_TAKEOVER)使用時、対象物件の選択肢が常に空になっていたバグを修正。
--
-- team/page.tsxはteam_property_purchasesを直接.neq("team_id", ...)で参加者クライアント
-- (RLS適用)から取得していたが、team_property_purchases_selectのRLSポリシーは
-- 「team_id = auth_team_id() (自チーム) または本部」しか許可しておらず、他チームの
-- 未精算物件は参加者からは一切見えない。そのため乗っ取り先の選択肢が常に0件になっていた。
--
-- fn_get_other_teams_status()と同じ方式(security definerで自イベント内のみに絞って公開)
-- で、他チームの未精算物件一覧を返す専用RPCを追加する。

create or replace function fn_list_takeover_targets()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_rows jsonb;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select event_id into v_event_id from team_state where team_id = v_team_id;

  select jsonb_agg(jsonb_build_object(
      'purchase_id', tpp.id,
      'team_id', tpp.team_id,
      'team_name', t.team_name,
      'property_name', sp.name,
      'price_paid', tpp.price_paid
    ) order by t.team_number)
    into v_rows
  from team_property_purchases tpp
  join teams t on t.id = tpp.team_id
  join station_properties sp on sp.id = tpp.property_id
  where t.event_id = v_event_id and tpp.team_id <> v_team_id and tpp.settled = false;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

grant execute on function fn_list_takeover_targets() to authenticated;
