-- 本部管理画面から、アクションログの任意の項目を選んで全チームへ即時アナウンスできるようにする。
create or replace function fn_admin_broadcast_announcement(p_message text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team record;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if p_message is null or trim(p_message) = '' then raise exception 'message is required'; end if;

  for v_team in select id from teams where event_id = v_staff_event_id loop
    perform fn_notify_team(v_staff_event_id, v_team.id, format('📢本部アナウンス: %s', p_message));
  end loop;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'ADMIN_ANNOUNCEMENT', jsonb_build_object('message', p_message));
end;
$$;

grant execute on function fn_admin_broadcast_announcement(text) to authenticated;
