-- 参加者自身がログイン後にチーム名を変更できるようにする(初期値は「チーム1」等の仮名)。
-- 変更結果は他チーム・本部からも見える既存のteams.team_nameをそのまま更新するため、
-- 表示箇所(順位表の自チーム表示、現在地マップの自チーム表示、本部ダッシュボード等)は
-- 追加対応なしでそのまま反映される。fn_admin_rename_team(本部用)と対になる参加者用関数。

create or replace function fn_team_rename_self(p_team_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_before text;
  v_after text := trim(p_team_name);
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;
  if v_after is null or length(v_after) = 0 then
    raise exception 'team name is required';
  end if;
  if length(v_after) > 30 then
    raise exception 'team name is too long';
  end if;

  select team_name into v_before from teams where id = v_team_id;

  update teams set team_name = v_after where id = v_team_id;

  insert into audit_log (event_id, team_id, action_type, before_value, after_value)
    select event_id, v_team_id, 'TEAM_SELF_RENAME', jsonb_build_object('name', v_before), jsonb_build_object('name', v_after)
    from teams where id = v_team_id;
end;
$$;

grant execute on function fn_team_rename_self(text) to authenticated;
