-- Phase 7: 駅・路線・接続・ミッションを本部が管理画面から編集できるようにする。
-- これらはゲーム進行のロック(排他制御)が不要なマスタデータのため、RPC経由ではなく
-- RLSポリシーで「staffかつ自イベントのみ」書込可とし、直接テーブル操作を許可する。

grant insert, update, delete on lines, stations, station_lines, edges, station_missions, destination_queue to authenticated;

create policy lines_staff_write on lines for all to authenticated
  using (event_id = auth_staff_event_id()) with check (event_id = auth_staff_event_id());

create policy stations_staff_write on stations for all to authenticated
  using (event_id = auth_staff_event_id()) with check (event_id = auth_staff_event_id());

create policy station_lines_staff_write on station_lines for all to authenticated
  using (exists (select 1 from stations s where s.id = station_lines.station_id and s.event_id = auth_staff_event_id()))
  with check (exists (select 1 from stations s where s.id = station_lines.station_id and s.event_id = auth_staff_event_id()));

create policy edges_staff_write on edges for all to authenticated
  using (event_id = auth_staff_event_id()) with check (event_id = auth_staff_event_id());

create policy station_missions_staff_write on station_missions for all to authenticated
  using (exists (select 1 from stations s where s.id = station_missions.station_id and s.event_id = auth_staff_event_id()))
  with check (exists (select 1 from stations s where s.id = station_missions.station_id and s.event_id = auth_staff_event_id()));

-- destination_queueは既にfn_admin_add_destination経由で書込可能だが、削除/編集も管理画面から
-- 行えるようRLSでも許可しておく(SELECTポリシーは既存のものを流用)。
create policy destination_queue_staff_write on destination_queue for all to authenticated
  using (event_id = auth_staff_event_id()) with check (event_id = auth_staff_event_id());
