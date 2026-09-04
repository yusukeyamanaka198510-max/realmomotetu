-- チームの識別名を「チーム名」だけでなく「チーム名+代表者氏名」にする。
-- 代表者氏名は新カラムとして追加し、既存のteam_name関連の仕組み(表示・RLS・監査ログ)は
-- そのまま維持したうえで、代表者氏名だけ追加で編集・表示できるようにする。

alter table teams add column if not exists representative_name text;

drop function if exists fn_team_rename_self(text);

create or replace function fn_team_rename_self(p_team_name text, p_representative_name text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_before_name text;
  v_before_rep text;
  v_after_name text := trim(p_team_name);
  v_after_rep text := nullif(trim(coalesce(p_representative_name, '')), '');
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;
  if v_after_name is null or length(v_after_name) = 0 then
    raise exception 'team name is required';
  end if;
  if length(v_after_name) > 30 then
    raise exception 'team name is too long';
  end if;
  if v_after_rep is not null and length(v_after_rep) > 30 then
    raise exception 'representative name is too long';
  end if;

  select team_name, representative_name into v_before_name, v_before_rep from teams where id = v_team_id;

  update teams set team_name = v_after_name, representative_name = v_after_rep where id = v_team_id;

  insert into audit_log (event_id, team_id, action_type, before_value, after_value)
    select event_id, v_team_id, 'TEAM_SELF_RENAME',
      jsonb_build_object('name', v_before_name, 'representative_name', v_before_rep),
      jsonb_build_object('name', v_after_name, 'representative_name', v_after_rep)
    from teams where id = v_team_id;
end;
$$;

grant execute on function fn_team_rename_self(text, text) to authenticated;
