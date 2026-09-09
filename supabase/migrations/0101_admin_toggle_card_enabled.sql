-- 本部が今回のイベントで使うカードを選べるように、cards.enabled(既存列)を
-- 管理画面から切り替えられるRPCを追加する。
create or replace function fn_admin_set_card_enabled(p_card_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  update cards set enabled = p_enabled, updated_at = now() where id = p_card_id;
end;
$$;
grant execute on function fn_admin_set_card_enabled(uuid, boolean) to authenticated;
