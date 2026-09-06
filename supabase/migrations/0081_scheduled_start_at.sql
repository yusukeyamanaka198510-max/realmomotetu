-- 開始前画面に「何時から開始するか」を表示するための、本部が設定する予定開始時刻。
-- 実際の開始(events.start_at)とは別物: こちらはイベント開始前に参加者へアナウンスする
-- 「予定」の時刻で、本部がいつでも変更できる。

alter table events add column if not exists scheduled_start_at timestamptz;

create or replace function fn_admin_set_scheduled_start_at(p_scheduled_start_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  update events set scheduled_start_at = p_scheduled_start_at where id = v_staff_event_id;
end;
$$;

grant execute on function fn_admin_set_scheduled_start_at(timestamptz) to authenticated;
