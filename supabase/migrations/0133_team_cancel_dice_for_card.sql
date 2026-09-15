-- 「サイコロを振ったが、その出目を使わずカードで移動したい」と思い直した参加者が、
-- 自分自身で出目をキャンセルしてDICE_READYへ戻れるRPCを追加する。
-- 本部用のfn_admin_invalidate_diceと同じ考え方だが、以下2点で異なる:
--   1) staff権限ではなく参加者自身(auth_team_id())が呼べる。
--   2) カードで振った出目(used_card_id が not null)は対象外にし、
--      「カード使用のやり直し」を防ぐ(通常のサイコロ出目のみキャンセル可能)。
--   3) dice_rolls.invalidated_by は staff_users への外部キーのため、
--      参加者自身のuidは入れられない(nullのままにする)。

create or replace function fn_team_cancel_dice_for_card()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_turn_id uuid;
  v_dice_roll_id uuid;
  v_used_card_id uuid;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select ts.state, ts.event_id, ts.current_turn_id into v_state, v_event_id, v_turn_id
    from team_state ts where ts.team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);

  if v_state <> 'DESTINATION_SELECTION' then
    raise exception 'invalid state: %', v_state;
  end if;

  select id, used_card_id into v_dice_roll_id, v_used_card_id from dice_rolls
    where turn_id = v_turn_id and is_valid order by rolled_at desc limit 1;

  if v_dice_roll_id is null then
    raise exception 'no active dice roll to cancel';
  end if;
  if v_used_card_id is not null then
    raise exception 'cannot cancel a card-based movement';
  end if;

  update dice_rolls
    set is_valid = false, invalidated_at = now(), invalidation_reason = '本人がカード使用に切り替えるためキャンセル'
    where id = v_dice_roll_id;

  update turns set status = 'ABORTED' where id = v_turn_id;
  update team_state
    set state = 'DICE_READY', current_turn_id = null, version = version + 1
    where team_id = v_team_id;

  insert into audit_log (event_id, team_id, action_type, before_value)
    values (v_event_id, v_team_id, 'DICE_CANCELLED_FOR_CARD_SELF', jsonb_build_object('dice_roll_id', v_dice_roll_id));
end;
$$;

grant execute on function fn_team_cancel_dice_for_card() to authenticated;
