-- 妨害カード等で対象チームを選ぶ際、判断材料として他チームの現金資産額と
-- 現在駅が見えるようにする(なすりつけカードでの対象選択などを想定)。
-- team_stateへのRLSは自チーム/本部のみ閲覧可なので、順位表等と同様にsecurity definerで公開する。

create or replace function fn_get_other_teams_status()
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
      'team_id', t.id,
      'team_number', t.team_number,
      'team_name', t.team_name,
      'coin_balance_cache', ts.coin_balance_cache,
      'station_name', s.name
    ) order by t.team_number)
    into v_rows
  from teams t
  join team_state ts on ts.team_id = t.id
  left join stations s on s.id = ts.current_station_id
  where t.event_id = v_event_id and t.id <> v_team_id;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

grant execute on function fn_get_other_teams_status() to authenticated;
