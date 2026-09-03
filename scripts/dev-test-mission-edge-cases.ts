/**
 * 開発用一時検証スクリプト: 失敗ペナルティ(毎回減算+再挑戦)と5回ごとボーナス(2倍)を確認する。
 * 実行: npx tsx scripts/dev-test-mission-edge-cases.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function login(email: string) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "momotetsu-dev-2026" }),
  });
  const j = await res.json();
  return j.access_token as string;
}

async function rpc(fn: string, token: string, body: unknown) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function uploadDummyPhoto(token: string, eventId: string, teamId: string, kind: string, subId: string) {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const bytes = Buffer.from(b64, "base64");
  const path = `${eventId}/${teamId}/${kind}/${subId}/0-test.png`;
  const res = await fetch(`${url}/storage/v1/object/evidence-photos/${path}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
    body: bytes,
  });
  if (res.status !== 200) throw new Error(`upload failed: ${await res.text()}`);
  return path;
}

async function main() {
  const { data: team3 } = await admin.from("teams").select("id, event_id").eq("team_number", 3).single();
  const staffToken = await login("staff1@momotetsu.test");
  const t3token = await login("team03@momotetsu.test");

  // --- 失敗ペナルティ + 再挑戦の検証(team03: MISSION_SELECTIONのはず) ---
  let { data: attempt } = await admin
    .from("team_mission_attempts")
    .select("*")
    .eq("team_id", team3!.id)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!attempt) {
    // Phase3マイグレーション適用前に承認された旧データのバックフィル
    const { data: ts3 } = await admin.from("team_state").select("current_turn_id").eq("team_id", team3!.id).single();
    const { data: turn3 } = await admin.from("turns").select("next_station_id").eq("id", ts3!.current_turn_id).single();
    const { data: missions3 } = await admin.from("station_missions").select("id, difficulty").eq("station_id", turn3!.next_station_id);
    const offered = ["EASY", "NORMAL", "HARD"].map((d) => missions3!.find((m) => m.difficulty === d)!.id);
    const { data: created } = await admin
      .from("team_mission_attempts")
      .insert({
        team_id: team3!.id,
        turn_id: ts3!.current_turn_id,
        station_id: turn3!.next_station_id,
        offered_mission_ids: offered,
        attempt_number: 1,
        status: "OFFERED",
      })
      .select()
      .single();
    attempt = created;
  }

  console.log("team03 現在のattempt:", attempt.id, attempt.offered_mission_ids, attempt.status);

  if (attempt.status === "OFFERED") {
    const missionId = attempt.offered_mission_ids[0];
    const sel = await rpc("fn_select_mission", t3token, { p_attempt_id: attempt.id, p_selected_mission_id: missionId });
    console.log("fn_select_mission:", sel.status);
  }

  const { data: attempt2 } = await admin.from("team_mission_attempts").select("*").eq("id", attempt.id).single();
  const path = await uploadDummyPhoto(t3token, team3!.event_id, team3!.id, "mission", attempt.id);
  const sub = await rpc("fn_submit_mission_photos", t3token, { p_attempt_id: attempt.id, p_photo_paths: [path] });
  console.log("fn_submit_mission_photos:", sub.status, sub.text);

  const { data: beforeState } = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team3!.id).single();
  const fail = await rpc("fn_review_mission", staffToken, { p_attempt_id: attempt.id, p_decision: "FAILURE", p_reason: "写真不十分" });
  console.log("fn_review_mission FAILURE:", fail.status, fail.text);

  const { data: afterState } = await admin.from("team_state").select("*").eq("team_id", team3!.id).single();
  console.log(`コイン: ${beforeState!.coin_balance_cache} -> ${afterState.coin_balance_cache} (state=${afterState.state})`);

  const { data: newAttempt } = await admin
    .from("team_mission_attempts")
    .select("*")
    .eq("team_id", team3!.id)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .single();
  console.log("再挑戦attempt:", newAttempt.attempt_number, newAttempt.status, newAttempt.selected_mission_id === attempt2.selected_mission_id ? "(同一ミッション: OK)" : "(NG: ミッションが変わっている)");

  // --- 5回ごとボーナスの検証(team01のmission_success_countを4に設定してからもう1回成功させる) ---
  const { data: team1 } = await admin.from("teams").select("id, event_id").eq("team_number", 1).single();
  const { data: stB } = await admin.from("stations").select("id").eq("event_id", team1!.event_id).eq("name", "B駅").single();
  const { data: stA } = await admin.from("stations").select("id").eq("event_id", team1!.event_id).eq("name", "A駅").single();

  await admin.from("team_state").update({ mission_success_count: 4 }).eq("team_id", team1!.id);

  const { data: turn } = await admin
    .from("turns")
    .insert({ team_id: team1!.id, turn_number: 99, previous_station_id: stA!.id, next_station_id: stB!.id, status: "IN_PROGRESS" })
    .select()
    .single();

  const { data: missions } = await admin.from("station_missions").select("id, difficulty").eq("station_id", stB!.id);
  const normalMission = missions!.find((m) => m.difficulty === "NORMAL")!;

  const { data: bonusAttempt } = await admin
    .from("team_mission_attempts")
    .insert({
      team_id: team1!.id,
      turn_id: turn.id,
      station_id: stB!.id,
      offered_mission_ids: [normalMission.id],
      selected_mission_id: normalMission.id,
      locked_at: new Date().toISOString(),
      attempt_number: 1,
      status: "AWAITING_PHOTO",
    })
    .select()
    .single();

  await admin.from("team_state").update({ state: "MISSION_ACTIVE", current_turn_id: turn.id }).eq("team_id", team1!.id);

  const t1token = await login("team01@momotetsu.test");
  const bonusPath = await uploadDummyPhoto(t1token, team1!.event_id, team1!.id, "mission", bonusAttempt.id);
  const bonusSub = await rpc("fn_submit_mission_photos", t1token, { p_attempt_id: bonusAttempt.id, p_photo_paths: [bonusPath] });
  console.log("5回目 fn_submit_mission_photos:", bonusSub.status);

  const { data: beforeBonus } = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team1!.id).single();
  const bonusReview = await rpc("fn_review_mission", staffToken, { p_attempt_id: bonusAttempt.id, p_decision: "SUCCESS" });
  console.log("5回目 fn_review_mission SUCCESS:", bonusReview.status);

  const { data: afterBonus } = await admin.from("team_state").select("*").eq("team_id", team1!.id).single();
  const { data: bonusLedger } = await admin
    .from("coin_ledger")
    .select("*")
    .eq("related_mission_attempt_id", bonusAttempt.id)
    .single();
  console.log(
    `5回目成功: コイン ${beforeBonus!.coin_balance_cache} -> ${afterBonus.coin_balance_cache} (差分=${afterBonus.coin_balance_cache - beforeBonus!.coin_balance_cache}), ledger種別=${bonusLedger.transaction_type}, 金額=${bonusLedger.amount} (NORMAL通常1000の2倍=2000が期待値)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
