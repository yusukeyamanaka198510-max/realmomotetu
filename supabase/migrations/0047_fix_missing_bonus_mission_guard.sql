-- 0032でfn_select_mission/fn_finish_property_purchaseの`fn_assert_event_active`漏れを
-- 修正したのと同じ抜けが、後発のfn_submit_bonus_mission_photosにも存在していた
-- (参加者が本部の一時停止・強制終了後にボーナスミッション写真を提出できてしまう)。
-- 同じ姉妹関数のfn_submit_mission_photos(0008)と同じ位置にガードを追加する。
--
-- 対になるfn_review_bonus_mission(本部側の判定操作)は、既存のfn_review_mission/
-- fn_review_arrivalと同じく意図的にガード無し(本部は一時停止・終了後もキューを
-- 処理しきれる必要があるため)。今回はそちらには手を入れない。

create or replace function fn_submit_bonus_mission_photos(p_bonus_attempt_id uuid, p_photo_paths text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_attempt_team_id uuid;
  v_status mission_attempt_status;
  v_path text;
begin
  if v_team_id is null then raise exception 'participant only'; end if;

  select ts.event_id, a.team_id, a.status into v_event_id, v_attempt_team_id, v_status
    from team_state ts
    join team_bonus_mission_attempts a on a.id = p_bonus_attempt_id
    where ts.team_id = v_team_id for update of ts;

  perform fn_assert_event_active(v_event_id);

  if v_attempt_team_id is null or v_attempt_team_id <> v_team_id then raise exception 'not your bonus mission attempt'; end if;
  if v_status = 'PENDING_REVIEW' then return; end if;
  if v_status <> 'AWAITING_PHOTO' then raise exception 'invalid status'; end if;
  if array_length(p_photo_paths, 1) is null or array_length(p_photo_paths, 1) > 3 then
    raise exception 'photo count must be 1-3';
  end if;

  foreach v_path in array p_photo_paths loop
    if split_part(v_path, '/', 1) <> v_event_id::text or split_part(v_path, '/', 2) <> v_team_id::text then
      raise exception 'invalid photo path: %', v_path;
    end if;
  end loop;

  insert into bonus_mission_photos (bonus_attempt_id, storage_path)
    select p_bonus_attempt_id, unnest(p_photo_paths);

  update team_bonus_mission_attempts set status = 'PENDING_REVIEW' where id = p_bonus_attempt_id;

  insert into review_queue (event_id, team_id, type, ref_id)
    values (v_event_id, v_team_id, 'BONUS_MISSION', p_bonus_attempt_id);
end;
$$;
