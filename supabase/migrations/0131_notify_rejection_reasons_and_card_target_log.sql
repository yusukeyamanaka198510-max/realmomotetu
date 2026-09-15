-- ・到着報告/ミッションが本部に差し戻されても、その理由がチーム側に一切通知
--   されていなかった(DBには保存されるが、参加者画面には何も表示されない)。
--   fn_review_arrival(REJECT時)・fn_review_mission(FAILURE時)から
--   fn_notify_team で理由付きの通知を送るようにする。
-- ・振り返りログの「MISSION」項目にも却下(失敗)理由を追加する。
-- ・カードを使われた側(target_team_id)の振り返りログには、そのカード使用の
--   記録が一切残っていなかった。使われた側にも「CARD_USED_AGAINST」として
--   記録が残るようにする。

create or replace function fn_review_arrival(p_arrival_submission_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_station_id uuid;
  v_turn_id uuid;
  v_event_id uuid;
  v_bonus bigint;
  v_mission_id uuid;
  v_next_dest uuid;
  v_visit_count int;
  v_repeat_threshold int;
  v_repeat_reward bigint;
  v_has_properties boolean;
  v_next_state team_game_state;
  v_forced_mission boolean;
  v_cleared_station_name text;
  v_team_name text;
  v_next_station_name text;
  v_other_team record;
  v_bombii_already boolean;
  v_bombii_team_id uuid;
  v_bombii_max_dist int := -1;
  v_bombii_dist int;
  v_bombii_team_name text;
  v_is_goal_arrival boolean := false;
  v_normal_arrival_count int;
  v_new_arrival_count int;
begin
  if v_staff_event_id is null then
    raise exception 'staff only';
  end if;
  if p_decision not in ('APPROVE', 'REJECT') then
    raise exception 'invalid decision';
  end if;

  select a.team_id, a.station_id, a.turn_id, t.event_id
    into v_team_id, v_station_id, v_turn_id, v_event_id
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

    perform fn_notify_team(v_event_id, v_team_id,
      format('🙅到着報告が差し戻されました。理由: %s', coalesce(p_reason, '(理由未記入)')));
    return;
  end if;

  -- APPROVE
  update arrival_submissions
    set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_arrival_submission_id;

  select active_destination_station_id, default_destination_bonus_amount
    into v_next_dest, v_bonus
    from events where id = v_event_id for update;

  if v_next_dest is not null and v_next_dest = v_station_id then
    v_is_goal_arrival := true;

    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_event_id, v_team_id, v_bonus, 'DESTINATION_BONUS', gen_random_uuid(), '最終目的地到達ボーナス', auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache + v_bonus where team_id = v_team_id;

    insert into destination_queue (event_id, station_id, sequence_order, bonus_coin_amount, status, cleared_by_team_id, cleared_at)
      values (
        v_event_id, v_station_id,
        coalesce((select max(sequence_order) from destination_queue where event_id = v_event_id), 0) + 1,
        v_bonus, 'CLEARED', v_team_id, now()
      );

    v_next_dest := fn_pick_next_destination(v_event_id, v_station_id);
    update events set active_destination_station_id = v_next_dest where id = v_event_id;

    select name into v_cleared_station_name from stations where id = v_station_id;
    select team_name into v_team_name from teams where id = v_team_id;
    select name into v_next_station_name from stations where id = v_next_dest;

    -- ボンビー付与判定: 既に誰かが持っていなければ、到着された(古い)ゴール駅から
    -- 一番遠い場所にいるチームに憑く。
    select exists(select 1 from team_state where event_id = v_event_id and has_bombii) into v_bombii_already;
    if not v_bombii_already then
      for v_other_team in select team_id, current_station_id from team_state where event_id = v_event_id and current_station_id is not null and team_id <> v_team_id loop
        v_bombii_dist := fn_shortest_hops(v_station_id, v_other_team.current_station_id, v_event_id);
        if v_bombii_dist > v_bombii_max_dist then
          v_bombii_max_dist := v_bombii_dist;
          v_bombii_team_id := v_other_team.team_id;
        end if;
      end loop;

      if v_bombii_team_id is not null then
        update team_state set has_bombii = true where team_id = v_bombii_team_id;
        select team_name into v_bombii_team_name from teams where id = v_bombii_team_id;

        for v_other_team in select id from teams where event_id = v_event_id loop
          perform fn_notify_team(
            v_event_id, v_other_team.id,
            format('😈ボンビーが「%s」に取り憑きました!(理由: ゴール「%s」から一番遠い場所にいたため)',
              v_bombii_team_name, v_cleared_station_name)
          );
        end loop;

        insert into audit_log (event_id, staff_id, team_id, action_type, after_value)
          values (v_event_id, null, v_bombii_team_id, 'BOMBII_ASSIGNED',
            jsonb_build_object('from_station', v_station_id, 'distance', v_bombii_max_dist));
      end if;
    end if;

    for v_other_team in select id from teams where event_id = v_event_id loop
      perform fn_notify_team(
        v_event_id, v_other_team.id,
        case when v_other_team.id = v_team_id then
          format('🏁 ゴール到達!「%s」で+%s円を獲得しました。次のゴールは「%s」です。',
            v_cleared_station_name, v_bonus, coalesce(v_next_station_name, '未定'))
        else
          format('🏁 %sがゴールの「%s」に到着しました!次のゴールは「%s」です!',
            v_team_name, v_cleared_station_name, coalesce(v_next_station_name, '未定'))
        end
      );
    end loop;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
      values (v_event_id, auth.uid(), v_team_id, 'DESTINATION_BONUS',
        jsonb_build_object('station_id', v_station_id), jsonb_build_object('bonus', v_bonus, 'next_destination', v_next_dest));
  end if;

  -- お金の神様: ゴールではない通常到着が全チーム合算で累計5回に達した、その5回目のチームに
  -- 「次のミッション成功時ボーナス」フラグを立てる(一度きり)。
  if not v_is_goal_arrival then
    update events set normal_arrival_count = normal_arrival_count + 1
      where id = v_event_id and not money_god_awarded
      returning normal_arrival_count into v_normal_arrival_count;

    if v_normal_arrival_count = 5 then
      update events set money_god_awarded = true where id = v_event_id;
      update team_state set pending_money_god_bonus = true where team_id = v_team_id;
      perform fn_notify_team(v_event_id, v_team_id, '💰お金の神様が降臨しました!次のミッション成功時に特別ボーナスがあります。');

      insert into audit_log (event_id, staff_id, team_id, action_type, after_value)
        values (v_event_id, auth.uid(), v_team_id, 'MONEY_GOD_TRIGGERED', jsonb_build_object('station_id', v_station_id));
    end if;
  end if;

  -- ラッキーチャンス②: 到着(ゴール到達含む)の累計回数が10/20/30回に達したら一度きりのボーナス。
  update team_state set arrival_count = arrival_count + 1 where team_id = v_team_id
    returning arrival_count into v_new_arrival_count;
  if v_new_arrival_count in (10, 20, 30) then
    perform fn_grant_lucky_bonus(
      v_team_id, v_event_id, 30000000,
      format('到着%s回達成ラッキーボーナス', v_new_arrival_count),
      format('🍀ラッキーボーナス!運よく累計%s回目に到着したあなたのチームに、運営からささやかなプレゼントだよ!優勝目指して頑張ろう!+30,000,000円', v_new_arrival_count)
    );
  end if;

  select exists(select 1 from card_active_effects where team_id = v_team_id and effect_type = 'BLOCK_UNTIL_MISSION_SUCCESS' and consumed_at is null)
    into v_forced_mission;

  select count(*) into v_visit_count
    from arrival_submissions
    where team_id = v_team_id and station_id = v_station_id and status = 'APPROVED';

  select repeat_visit_threshold, repeat_visit_flat_reward_amount into v_repeat_threshold, v_repeat_reward
    from events where id = v_event_id;

  if v_visit_count >= v_repeat_threshold and not v_forced_mission then
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, related_turn_id, reason, created_by)
      values (v_event_id, v_team_id, v_repeat_reward, 'REPEAT_VISIT_BONUS', gen_random_uuid(), v_turn_id,
        format('同一駅%s回目到着の一律ボーナス', v_visit_count), auth.uid());

    select exists(select 1 from station_properties where station_id = v_station_id and is_active) into v_has_properties;
    v_next_state := case when v_has_properties then 'PROPERTY_PURCHASE' else 'DICE_READY' end;

    update team_state
      set coin_balance_cache = coin_balance_cache + v_repeat_reward,
          current_station_id = v_station_id,
          state = v_next_state,
          current_turn_id = case when v_next_state = 'DICE_READY' then null else current_turn_id end,
          version = version + 1
      where team_id = v_team_id;

    update turns set status = 'COMPLETED', completed_at = now() where id = v_turn_id;

    update review_queue set status = 'RESOLVED'
      where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL' and ref_id = p_arrival_submission_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
      values (v_event_id, auth.uid(), v_team_id, 'ARRIVAL_APPROVE',
        jsonb_build_object('arrival_submission_id', p_arrival_submission_id),
        jsonb_build_object('repeat_visit_count', v_visit_count, 'flat_reward', v_repeat_reward));
    return;
  end if;

  -- EASYミッション1件を自動アサインし、選択ステップ無しで直接MISSION_ACTIVEへ進める。
  v_mission_id := fn_pick_easy_mission(v_team_id, v_station_id);
  insert into team_mission_attempts (team_id, turn_id, station_id, offered_mission_ids, selected_mission_id, locked_at, attempt_number, status)
    values (v_team_id, v_turn_id, v_station_id, array[v_mission_id], v_mission_id, now(), 1, 'AWAITING_PHOTO');

  update team_state set state = 'MISSION_ACTIVE', version = version + 1 where team_id = v_team_id;
  update review_queue set status = 'RESOLVED'
    where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL' and ref_id = p_arrival_submission_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value)
    values (v_event_id, auth.uid(), v_team_id, 'ARRIVAL_APPROVE', jsonb_build_object('arrival_submission_id', p_arrival_submission_id));
end;
$$;


create or replace function fn_review_mission(p_attempt_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_event_id uuid;
  v_mission_id uuid;
  v_station_id uuid;
  v_turn_id uuid;
  v_attempt_number int;
  v_failure_penalty int;
  v_new_attempt_id uuid;
begin
  if v_staff_event_id is null then
    raise exception 'staff only';
  end if;
  if p_decision not in ('SUCCESS', 'FAILURE') then
    raise exception 'invalid decision';
  end if;

  select a.team_id, t.event_id, a.selected_mission_id, a.station_id, a.turn_id, a.attempt_number
    into v_team_id, v_event_id, v_mission_id, v_station_id, v_turn_id, v_attempt_number
    from team_mission_attempts a
    join teams t on t.id = a.team_id
    where a.id = p_attempt_id;

  if v_event_id is null or v_event_id is distinct from v_staff_event_id then
    raise exception 'not found or not your event';
  end if;

  update review_queue
    set status = 'CLAIMED', claimed_by = auth.uid(), claimed_at = now()
    where event_id = v_event_id and team_id = v_team_id and type = 'MISSION'
      and ref_id = p_attempt_id and status = 'OPEN';
  if not found then
    raise exception 'already handled by another staff member';
  end if;

  perform 1 from team_state where team_id = v_team_id for update;

  select coalesce(failure_penalty, 5000000) into v_failure_penalty
    from station_missions where id = v_mission_id;

  update review_queue set status = 'RESOLVED'
    where event_id = v_event_id and team_id = v_team_id and type = 'MISSION' and ref_id = p_attempt_id;

  if p_decision = 'FAILURE' then
    update team_mission_attempts
      set status = 'FAILURE', reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_attempt_id;

    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, related_mission_attempt_id, related_turn_id, reason, created_by)
      values (v_event_id, v_team_id, -v_failure_penalty, 'MISSION_FAILURE', gen_random_uuid(), p_attempt_id, v_turn_id, p_reason, auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache - v_failure_penalty where team_id = v_team_id;

    insert into team_mission_attempts (team_id, turn_id, station_id, offered_mission_ids, selected_mission_id, locked_at, attempt_number, status)
      values (v_team_id, v_turn_id, v_station_id, array[v_mission_id], v_mission_id, now(), v_attempt_number + 1, 'AWAITING_PHOTO')
      returning id into v_new_attempt_id;

    update team_state set state = 'MISSION_ACTIVE', version = version + 1 where team_id = v_team_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value, reason)
      values (v_event_id, auth.uid(), v_team_id, 'MISSION_FAILURE',
        jsonb_build_object('attempt_id', p_attempt_id),
        jsonb_build_object('penalty', v_failure_penalty, 'new_attempt_id', v_new_attempt_id), p_reason);

    perform fn_notify_team(v_event_id, v_team_id,
      format('💦ミッション失敗と判定されました。理由: %s', coalesce(p_reason, '(理由未記入)')));
    return;
  end if;

  -- SUCCESS: 足止めカード解除だけ行い、報酬確定はfn_claim_mission_rewardに委ねる。
  update card_active_effects set consumed_at = now()
    where team_id = v_team_id and effect_type = 'BLOCK_UNTIL_MISSION_SUCCESS' and consumed_at is null;

  update team_mission_attempts
    set status = 'SUCCESS', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_attempt_id;

  update team_state
    set current_station_id = v_station_id,
        state = 'MISSION_REWARD_CHOICE',
        version = version + 1
    where team_id = v_team_id;

  update turns set status = 'COMPLETED', completed_at = now() where id = v_turn_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value)
    values (v_event_id, auth.uid(), v_team_id, 'MISSION_SUCCESS', jsonb_build_object('attempt_id', p_attempt_id));
end;
$$;


create or replace function fn_retrospective_timeline()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := auth_staff_event_id();
  v_teams jsonb;
  v_events jsonb;
begin
  if v_event_id is null then
    raise exception 'staff only';
  end if;

  select jsonb_agg(jsonb_build_object(
      'team_id', ranked.id,
      'team_number', ranked.team_number,
      'team_name', ranked.team_name,
      'representative_name', ranked.representative_name,
      'rank', ranked.rnk,
      'coin_balance', ranked.coin_balance_cache,
      'total_assets', ranked.total_assets
    ) order by ranked.rnk)
    into v_teams
  from (
    select t.id, t.team_number, t.team_name, t.representative_name, ts.coin_balance_cache,
      ts.coin_balance_cache + coalesce(pp.total, 0) as total_assets,
      rank() over (order by ts.coin_balance_cache + coalesce(pp.total, 0) desc) as rnk
    from team_state ts
    join teams t on t.id = ts.team_id
    left join (
      select team_id, sum(price_paid) as total
      from team_property_purchases
      where not settled
      group by team_id
    ) pp on pp.team_id = ts.team_id
    where ts.event_id = v_event_id
  ) ranked;

  with combined as (
    -- 到着報告(承認済みのみ。各ターンの到着そのものが「出来事」の単位)
    select a.team_id, a.reviewed_at as at, 'ARRIVAL'::text as kind,
      jsonb_build_object('station_name', s.name) as detail,
      coalesce((select array_agg(ap.storage_path order by ap.uploaded_at)
                from arrival_photos ap where ap.arrival_submission_id = a.id), array[]::text[]) as photos
    from arrival_submissions a
    join teams tm on tm.id = a.team_id
    left join stations s on s.id = a.station_id
    where tm.event_id = v_event_id and a.status = 'APPROVED' and a.reviewed_at is not null

    union all
    -- ミッション(成功/失敗が確定したもののみ)
    select ma.team_id, ma.reviewed_at, 'MISSION',
      jsonb_build_object(
        'title', sm.title, 'description', sm.description, 'difficulty', sm.difficulty, 'result', ma.status,
        'reward', (select coalesce(sum(cl.amount), 0) from coin_ledger cl where cl.related_mission_attempt_id = ma.id),
        'reason', (select cl2.reason from coin_ledger cl2
                   where cl2.related_mission_attempt_id = ma.id and cl2.transaction_type = 'MISSION_FAILURE' limit 1)
      ),
      coalesce((select array_agg(mp.storage_path order by mp.uploaded_at)
                from mission_photos mp where mp.mission_attempt_id = ma.id), array[]::text[])
    from team_mission_attempts ma
    join teams tm2 on tm2.id = ma.team_id
    left join station_missions sm on sm.id = ma.selected_mission_id
    where tm2.event_id = v_event_id and ma.status in ('SUCCESS', 'FAILURE') and ma.reviewed_at is not null

    union all
    -- ボーナスミッション(成功/失敗が確定したもののみ)
    select ba.team_id, ba.reviewed_at, 'BONUS_MISSION',
      jsonb_build_object('title', ba.title, 'description', ba.description, 'result', ba.status, 'reward', ba.reward),
      coalesce((select array_agg(bp.storage_path order by bp.uploaded_at)
                from bonus_mission_photos bp where bp.bonus_attempt_id = ba.id), array[]::text[])
    from team_bonus_mission_attempts ba
    join teams tm3 on tm3.id = ba.team_id
    where tm3.event_id = v_event_id and ba.status in ('SUCCESS', 'FAILURE') and ba.reviewed_at is not null

    union all
    -- 最終目的地(ゴール)到達
    select dq.cleared_by_team_id, dq.cleared_at, 'DESTINATION_CLEAR',
      jsonb_build_object('station_name', s2.name, 'bonus', coalesce(dq.bonus_coin_amount, ev.default_destination_bonus_amount)),
      array[]::text[]
    from destination_queue dq
    join events ev on ev.id = dq.event_id
    left join stations s2 on s2.id = dq.station_id
    where dq.event_id = v_event_id and dq.status = 'CLEARED' and dq.cleared_by_team_id is not null

    union all
    -- カード使用(本部が一覧から除外したものは除く)
    select cul.team_id, cul.used_at, 'CARD_USE',
      jsonb_build_object(
        'card_name', c.name, 'result', cul.result, 'detail', cul.effect_detail,
        'target_team_name', tt.team_name
      ),
      array[]::text[]
    from card_usage_log cul
    join teams tm4 on tm4.id = cul.team_id
    join cards c on c.id = cul.card_id
    left join teams tt on tt.id = cul.target_team_id
    where tm4.event_id = v_event_id and cul.hidden_from_log_at is null

    union all
    -- カード使用(使われた側視点。対象チームのログにも「使われた」記録として残す)
    select cul.target_team_id, cul.used_at, 'CARD_USED_AGAINST',
      jsonb_build_object(
        'card_name', c.name, 'result', cul.result, 'detail', cul.effect_detail,
        'used_by_team_name', tm4.team_name
      ),
      array[]::text[]
    from card_usage_log cul
    join teams tm4 on tm4.id = cul.team_id
    join cards c on c.id = cul.card_id
    where tm4.event_id = v_event_id and cul.hidden_from_log_at is null and cul.target_team_id is not null

    union all
    -- その他のコイン増減(ミッション・ゴール到達・カード効果はそれぞれ上の出来事に内包されるため除外)
    select cl.team_id, cl.created_at, 'COIN',
      jsonb_build_object('transaction_type', cl.transaction_type, 'amount', cl.amount, 'reason', cl.reason),
      array[]::text[]
    from coin_ledger cl
    join teams tm5 on tm5.id = cl.team_id
    where tm5.event_id = v_event_id
      and cl.hidden_from_log_at is null
      and cl.transaction_type not in ('MISSION_SUCCESS', 'MISSION_FAILURE', 'MISSION_5X_BONUS', 'DESTINATION_BONUS', 'CARD_EFFECT')

    union all
    -- 到着却下(本部差し戻し。却下理由つき)
    select al.team_id, al.created_at, 'STAFF_REJECT',
      jsonb_build_object('reason', al.reason),
      array[]::text[]
    from audit_log al
    where al.event_id = v_event_id and al.action_type = 'ARRIVAL_REJECT' and al.team_id is not null

    union all
    -- ボンビー付与
    select al.team_id, al.created_at, 'BOMBII_ASSIGNED',
      jsonb_build_object('from_station_name', s3.name),
      array[]::text[]
    from audit_log al
    left join stations s3 on s3.id = nullif(al.after_value->>'from_station', '')::uuid
    where al.event_id = v_event_id and al.action_type = 'BOMBII_ASSIGNED' and al.team_id is not null
  )
  select jsonb_agg(jsonb_build_object(
      'team_id', combined.team_id, 'at', combined.at, 'kind', combined.kind,
      'detail', combined.detail, 'photos', to_jsonb(combined.photos)
    ) order by combined.team_id, combined.at)
    into v_events
  from combined;

  return jsonb_build_object('teams', coalesce(v_teams, '[]'::jsonb), 'events', coalesce(v_events, '[]'::jsonb));
end;
$$;


grant execute on function fn_retrospective_timeline() to authenticated;
