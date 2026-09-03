-- Phase 2: 到着フロー(TRAVELING → ARRIVAL_SUBMISSION → ARRIVAL_REVIEW → MISSION_SELECTION)
-- 到着写真は Storage(evidence-photos) に保存する。パス規約: {event_id}/{team_id}/arrival/{idempotency_key}/{n}-{filename}

alter table arrival_submissions add column idempotency_key uuid unique;

-- ===================== Storage =====================

insert into storage.buckets (id, name, public)
values ('evidence-photos', 'evidence-photos', false)
on conflict (id) do nothing;

create policy "team upload own photos" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidence-photos'
    and (storage.foldername(name))[1] = auth_team_event_id()::text
    and (storage.foldername(name))[2] = auth_team_id()::text
  );

create policy "read own team or staff photos" on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence-photos'
    and (
      ((storage.foldername(name))[1] = auth_team_event_id()::text and (storage.foldername(name))[2] = auth_team_id()::text)
      or (storage.foldername(name))[1] = auth_staff_event_id()::text
    )
  );

-- ===================== fn_start_arrival =====================
-- TRAVELING → ARRIVAL_SUBMISSION。二重タップは同一状態への遷移として無害化(冪等)。

create or replace function fn_start_arrival() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_state team_game_state;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select state into v_state from team_state where team_id = v_team_id for update;

  if v_state = 'ARRIVAL_SUBMISSION' then
    return;
  end if;
  if v_state <> 'TRAVELING' then
    raise exception 'invalid state: %', v_state;
  end if;

  update team_state set state = 'ARRIVAL_SUBMISSION', version = version + 1 where team_id = v_team_id;
end;
$$;

-- ===================== fn_submit_arrival =====================
-- ARRIVAL_SUBMISSION → ARRIVAL_REVIEW。写真1〜3枚必須。idempotency_keyで二重送信を無害化。

create or replace function fn_submit_arrival(p_photo_paths text[], p_idempotency_key uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_turn_id uuid;
  v_station_id uuid;
  v_id uuid;
  v_path text;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select id into v_id from arrival_submissions where idempotency_key = p_idempotency_key;
  if v_id is not null then
    return v_id;
  end if;

  select ts.state, ts.event_id, ts.current_turn_id, t.next_station_id
    into v_state, v_event_id, v_turn_id, v_station_id
    from team_state ts
    join turns t on t.id = ts.current_turn_id
    where ts.team_id = v_team_id
    for update of ts;

  if v_state <> 'ARRIVAL_SUBMISSION' then
    raise exception 'invalid state: %', v_state;
  end if;
  if v_turn_id is null or v_station_id is null then
    raise exception 'no active turn/destination';
  end if;
  if array_length(p_photo_paths, 1) is null or array_length(p_photo_paths, 1) < 1 or array_length(p_photo_paths, 1) > 3 then
    raise exception 'photo count must be 1-3';
  end if;

  foreach v_path in array p_photo_paths loop
    if split_part(v_path, '/', 1) <> v_event_id::text or split_part(v_path, '/', 2) <> v_team_id::text then
      raise exception 'invalid photo path: %', v_path;
    end if;
  end loop;

  insert into arrival_submissions (team_id, turn_id, station_id, status, idempotency_key)
    values (v_team_id, v_turn_id, v_station_id, 'PENDING', p_idempotency_key)
    returning id into v_id;

  insert into arrival_photos (arrival_submission_id, storage_path)
    select v_id, unnest(p_photo_paths);

  insert into review_queue (event_id, team_id, type, ref_id)
    values (v_event_id, v_team_id, 'ARRIVAL', v_id);

  update team_state set state = 'ARRIVAL_REVIEW', version = version + 1 where team_id = v_team_id;

  return v_id;
end;
$$;

-- ===================== fn_review_arrival =====================
-- 本部の承認/却下。承認時は目的地ボーナス判定・ローテーションを同一トランザクションで実行。
-- review_queueのCAS(status='OPEN'のときのみ更新)で二重承認を防止する。

create or replace function fn_review_arrival(p_arrival_submission_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_station_id uuid;
  v_event_id uuid;
  v_dest_id uuid;
  v_bonus bigint;
begin
  if v_staff_event_id is null then
    raise exception 'staff only';
  end if;
  if p_decision not in ('APPROVE', 'REJECT') then
    raise exception 'invalid decision';
  end if;

  select a.team_id, a.station_id, t.event_id
    into v_team_id, v_station_id, v_event_id
    from arrival_submissions a
    join teams t on t.id = a.team_id
    where a.id = p_arrival_submission_id;

  if v_event_id is null or v_event_id is distinct from v_staff_event_id then
    raise exception 'not found or not your event';
  end if;

  update review_queue
    set status = 'CLAIMED', claimed_by = auth.uid(), claimed_at = now()
    where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL'
      and ref_id = p_arrival_submission_id and status = 'OPEN';
  if not found then
    raise exception 'already handled by another staff member';
  end if;

  perform 1 from team_state where team_id = v_team_id for update;

  if p_decision = 'REJECT' then
    update arrival_submissions
      set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = p_reason
      where id = p_arrival_submission_id;
    update team_state set state = 'ARRIVAL_SUBMISSION', version = version + 1 where team_id = v_team_id;
    update review_queue set status = 'RESOLVED'
      where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL' and ref_id = p_arrival_submission_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, reason)
      values (v_event_id, auth.uid(), v_team_id, 'ARRIVAL_REJECT',
        jsonb_build_object('arrival_submission_id', p_arrival_submission_id), p_reason);
    return;
  end if;

  -- APPROVE
  update arrival_submissions
    set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_arrival_submission_id;

  select id, coalesce(bonus_coin_amount, (select default_destination_bonus_amount from events where id = v_event_id))
    into v_dest_id, v_bonus
    from destination_queue
    where event_id = v_event_id and status = 'ACTIVE' and station_id = v_station_id
    for update;

  if v_dest_id is not null then
    update destination_queue
      set status = 'CLEARED', cleared_by_team_id = v_team_id, cleared_at = now()
      where id = v_dest_id;

    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_event_id, v_team_id, v_bonus, 'DESTINATION_BONUS', gen_random_uuid(), '最終目的地到達ボーナス', auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache + v_bonus where team_id = v_team_id;

    update destination_queue
      set status = 'ACTIVE'
      where event_id = v_event_id and status = 'PENDING'
        and sequence_order = (
          select min(sequence_order) from destination_queue
          where event_id = v_event_id and status = 'PENDING'
        );

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
      values (v_event_id, auth.uid(), v_team_id, 'DESTINATION_BONUS',
        jsonb_build_object('destination_id', v_dest_id), jsonb_build_object('bonus', v_bonus));
  end if;

  update team_state set state = 'MISSION_SELECTION', version = version + 1 where team_id = v_team_id;
  update review_queue set status = 'RESOLVED'
    where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL' and ref_id = p_arrival_submission_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value)
    values (v_event_id, auth.uid(), v_team_id, 'ARRIVAL_APPROVE', jsonb_build_object('arrival_submission_id', p_arrival_submission_id));
end;
$$;

grant execute on function fn_start_arrival() to authenticated;
grant execute on function fn_submit_arrival(text[], uuid) to authenticated;
grant execute on function fn_review_arrival(uuid, text, text) to authenticated;
