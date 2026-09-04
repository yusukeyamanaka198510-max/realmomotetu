-- 不動産の定期配当(利回りのみ)。本部が間隔(分)を設定でき、0にすると自動実行を止められる。
-- 「いつ・何回」は、間隔設定に加えて本部の手動即時実行ボタンでもコントロールできるようにする。

alter table events add column if not exists dividend_interval_minutes int not null default 60;
alter table events add column if not exists last_dividend_run_at timestamptz;

-- 誰か(参加者・本部いずれか)がアクセスするたびに軽く呼ばれ、間隔を過ぎていれば配当を実行する。
-- eventsの行ロックにより、複数クライアントが同時に呼んでも二重実行されない。
create or replace function fn_maybe_run_dividend_settlement()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
  v_status event_status;
  v_interval_minutes int;
  v_last_run timestamptz;
begin
  if v_team_id is not null then
    select event_id into v_event_id from team_state where team_id = v_team_id;
  elsif v_staff_event_id is not null then
    v_event_id := v_staff_event_id;
  else
    raise exception 'not authenticated';
  end if;

  select status, dividend_interval_minutes, last_dividend_run_at
    into v_status, v_interval_minutes, v_last_run
    from events where id = v_event_id for update;

  if v_status <> 'RUNNING' or v_interval_minutes <= 0 then
    return;
  end if;
  if v_last_run is not null and now() - v_last_run < make_interval(mins => v_interval_minutes) then
    return;
  end if;

  perform fn_run_dividend_settlement_internal(v_event_id);
end;
$$;

-- 実際の配当処理本体(本部の即時実行からも共用する)。呼び出し元がeventsを既にロック済みの前提。
create or replace function fn_run_dividend_settlement_internal(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team record;
  v_yield_total bigint;
begin
  update events set last_dividend_run_at = now() where id = p_event_id;

  for v_team in select id from teams where event_id = p_event_id loop
    select coalesce(sum(yield_amount), 0) into v_yield_total
      from team_property_purchases
      where team_id = v_team.id and settled = false;

    if v_yield_total > 0 then
      insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
        values (p_event_id, v_team.id, v_yield_total, 'PROPERTY_PAYOUT', gen_random_uuid(), '定期配当', null);
      update team_state set coin_balance_cache = coin_balance_cache + v_yield_total where team_id = v_team.id;
    end if;

    perform fn_notify_team(p_event_id, v_team.id,
      case when v_yield_total > 0
        then format('📈定期配当が発生しました。不動産利回り+%s円を獲得しました。', v_yield_total)
        else '📈定期配当が発生しました(保有不動産なし)。'
      end
    );
  end loop;

  insert into audit_log (event_id, action_type, after_value)
    values (p_event_id, 'DIVIDEND_SETTLEMENT', jsonb_build_object('run_at', now()));
end;
$$;

create or replace function fn_admin_run_dividend_settlement_now()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  perform 1 from events where id = v_staff_event_id for update;
  perform fn_run_dividend_settlement_internal(v_staff_event_id);
end;
$$;

create or replace function fn_admin_set_dividend_interval(p_minutes int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if p_minutes < 0 then raise exception 'p_minutes must be >= 0'; end if;
  update events set dividend_interval_minutes = p_minutes where id = v_staff_event_id;
end;
$$;

grant execute on function fn_maybe_run_dividend_settlement() to authenticated;
grant execute on function fn_admin_run_dividend_settlement_now() to authenticated;
grant execute on function fn_admin_set_dividend_interval(int) to authenticated;
