-- 振り返り画面: 物件購入時に物件名・利回りを表示し、妨害カードを使われた際に何が出来なくなるかを
-- クライアント側で表示できるよう card_usage_log の関連イベントに cards.effect_type を含める。

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
        'card_name', c.name, 'result', cul.result, 'detail', cul.effect_detail, 'effect_type', c.effect_type,
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
        'card_name', c.name, 'result', cul.result, 'detail', cul.effect_detail, 'effect_type', c.effect_type,
        'used_by_team_name', tm4.team_name
      ),
      array[]::text[]
    from card_usage_log cul
    join teams tm4 on tm4.id = cul.team_id
    join cards c on c.id = cul.card_id
    where tm4.event_id = v_event_id and cul.hidden_from_log_at is null and cul.target_team_id is not null

    union all
    -- 物件購入(物件名・購入額・利回りを表示するため専用の出来事として分離する)
    select tpp.team_id, tpp.purchased_at, 'PROPERTY_PURCHASE',
      jsonb_build_object(
        'property_name', sp.name, 'price', tpp.price_paid, 'yield_amount', tpp.yield_amount,
        'station_name', s4.name
      ),
      array[]::text[]
    from team_property_purchases tpp
    join teams tm6 on tm6.id = tpp.team_id
    join station_properties sp on sp.id = tpp.property_id
    left join stations s4 on s4.id = sp.station_id
    where tm6.event_id = v_event_id

    union all
    -- その他のコイン増減(ミッション・ゴール到達・カード効果・物件購入はそれぞれ上の出来事に内包されるため除外)
    select cl.team_id, cl.created_at, 'COIN',
      jsonb_build_object('transaction_type', cl.transaction_type, 'amount', cl.amount, 'reason', cl.reason),
      array[]::text[]
    from coin_ledger cl
    join teams tm5 on tm5.id = cl.team_id
    where tm5.event_id = v_event_id
      and cl.hidden_from_log_at is null
      and cl.transaction_type not in ('MISSION_SUCCESS', 'MISSION_FAILURE', 'MISSION_5X_BONUS', 'DESTINATION_BONUS', 'CARD_EFFECT', 'PROPERTY_PURCHASE')

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
