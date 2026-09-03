-- 本番運用向け: チーム名の直前差し替え、イベント名編集、固定終了日時でのイベント開始をサポートする。

create or replace function fn_admin_rename_team(p_team_id uuid, p_team_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_event uuid;
  v_before text;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if p_team_name is null or length(trim(p_team_name)) = 0 then raise exception 'team name is required'; end if;

  select event_id, team_name into v_team_event, v_before from teams where id = p_team_id;
  if v_team_event is distinct from v_staff_event_id then raise exception 'not your event'; end if;

  update teams set team_name = trim(p_team_name) where id = p_team_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
    values (v_staff_event_id, auth.uid(), p_team_id, 'ADMIN_RENAME_TEAM', jsonb_build_object('name', v_before), jsonb_build_object('name', p_team_name));
end;
$$;

create or replace function fn_admin_update_event_name(p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'event name is required'; end if;
  update events set name = trim(p_name) where id = v_staff_event_id;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'ADMIN_UPDATE_EVENT_NAME', jsonb_build_object('name', p_name));
end;
$$;

-- fn_admin_start_event: 固定の終了日時(p_end_at)を指定して開始できるようにする。
-- p_end_at指定時はp_time_limit_minutesは無視し、現在時刻からp_end_atまでの分数を逆算してtime_limit_minutesに記録する。
create or replace function fn_admin_start_event(p_time_limit_minutes int default null, p_end_at timestamptz default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_dest uuid;
  v_end_at timestamptz;
  v_minutes int;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  if p_end_at is not null then
    if p_end_at <= now() then raise exception 'end_at must be in the future'; end if;
    v_end_at := p_end_at;
    v_minutes := ceil(extract(epoch from (p_end_at - now())) / 60)::int;
  else
    v_minutes := coalesce(p_time_limit_minutes, 240);
    v_end_at := now() + make_interval(mins => v_minutes);
  end if;

  v_dest := fn_pick_next_destination(v_staff_event_id);

  update events
    set status = 'RUNNING', start_at = now(), time_limit_minutes = v_minutes,
        end_at = v_end_at,
        active_destination_station_id = coalesce(active_destination_station_id, v_dest)
    where id = v_staff_event_id;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'EVENT_START', jsonb_build_object('time_limit_minutes', v_minutes, 'end_at', v_end_at, 'first_destination', v_dest));
end;
$$;

grant execute on function fn_admin_rename_team(uuid, text) to authenticated;
grant execute on function fn_admin_update_event_name(text) to authenticated;
