/**
 * 20チーム同時進行の負荷テスト。
 * 全チームでサイコロ→移動先確定→到着報告を並列実行し、本部3スタッフが並列で承認処理を行う。
 * 最後にコイン残高キャッシュとCoin Ledgerの合計が一致すること、二重承認が起きていないことを検証する。
 *
 * 実行: npx tsx scripts/load-test-20-teams.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function login(email: string) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "momotetsu-dev-2026" }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`login failed: ${email}: ${JSON.stringify(j)}`);
  return j.access_token as string;
}

async function rpc(fn: string, token: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function uploadDummy(token: string, eventId: string, teamId: string, kind: string, subId: string) {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const path = `${eventId}/${teamId}/${kind}/${subId}/0.png`;
  const res = await fetch(`${url}/storage/v1/object/evidence-photos/${path}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
    body: bytes,
  });
  if (res.status !== 200) throw new Error(`upload failed: ${await res.text()}`);
  return path;
}

async function runTeamCycle(teamNumber: number, staffToken: string) {
  const email = `team${String(teamNumber).padStart(2, "0")}@momotetsu.test`;
  const { data: team } = await admin.from("teams").select("id, event_id").eq("team_number", teamNumber).single();
  const teamId = team!.id;
  const eventId = team!.event_id;

  await admin
    .from("team_state")
    .update({ state: "DICE_READY", current_turn_id: null, is_paused: false, paused_from_state: null })
    .eq("team_id", teamId);

  const token = await login(email);

  const roll = await rpc("fn_roll_dice", token, { p_dice_count: 1 });
  if (roll.status !== 200) return { teamNumber, ok: false, step: "roll", detail: roll };
  const diceRollId = roll.body as string;

  const { data: snapshot } = await admin
    .from("reachable_stations_snapshot")
    .select("station_id")
    .eq("dice_roll_id", diceRollId)
    .limit(1)
    .single();

  const dest = await rpc("fn_select_destination", token, { p_station_id: snapshot!.station_id });
  if (dest.status !== 204) return { teamNumber, ok: false, step: "select_destination", detail: dest };

  const start = await rpc("fn_start_arrival", token);
  if (start.status !== 204) return { teamNumber, ok: false, step: "start_arrival", detail: start };

  const idem = crypto.randomUUID();
  const path = await uploadDummy(token, eventId, teamId, "arrival", idem);
  const submit = await rpc("fn_submit_arrival", token, { p_photo_paths: [path], p_idempotency_key: idem });
  if (submit.status !== 200) return { teamNumber, ok: false, step: "submit_arrival", detail: submit };
  const arrivalId = submit.body as string;

  const approve = await rpc("fn_review_arrival", staffToken, { p_arrival_submission_id: arrivalId, p_decision: "APPROVE" });
  if (approve.status !== 204) return { teamNumber, ok: false, step: "review_arrival", detail: approve };

  const { data: attempt } = await admin
    .from("team_mission_attempts")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const missionId = attempt!.offered_mission_ids[0] as string;
  const select = await rpc("fn_select_mission", token, { p_attempt_id: attempt!.id, p_selected_mission_id: missionId });
  if (select.status !== 204) return { teamNumber, ok: false, step: "select_mission", detail: select };

  const missionPath = await uploadDummy(token, eventId, teamId, "mission", attempt!.id);
  const submitMission = await rpc("fn_submit_mission_photos", token, {
    p_attempt_id: attempt!.id,
    p_photo_paths: [missionPath],
  });
  if (submitMission.status !== 204) return { teamNumber, ok: false, step: "submit_mission_photos", detail: submitMission };

  const decision = Math.random() < 0.5 ? "SUCCESS" : "FAILURE";
  const review = await rpc("fn_review_mission", staffToken, {
    p_attempt_id: attempt!.id,
    p_decision: decision,
    p_reason: decision === "FAILURE" ? "load-test" : null,
  });
  if (review.status !== 204) return { teamNumber, ok: false, step: "review_mission", detail: review };

  return { teamNumber, ok: true, decision };
}

async function main() {
  console.log("20チーム分のstaffトークンを準備中...");
  const staffTokens = await Promise.all([
    login("staff1@momotetsu.test"),
    login("staff2@momotetsu.test"),
    login("staff3@momotetsu.test"),
  ]);

  console.log("20チーム同時実行を開始します...");
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => runTeamCycle(i + 1, staffTokens[i % staffTokens.length]))
  );

  const failures = results.filter((r) => !r.ok);
  console.log(`成功: ${results.length - failures.length} / ${results.length}`);
  if (failures.length) {
    console.log("失敗詳細:", JSON.stringify(failures, null, 2));
  }

  console.log("\nデータ整合性検証中...");
  const { data: teams } = await admin.from("teams").select("id, team_number");
  let mismatchCount = 0;
  for (const t of teams ?? []) {
    const { data: ledger } = await admin.from("coin_ledger").select("amount").eq("team_id", t.id);
    const ledgerSum = (ledger ?? []).reduce((a, b) => a + b.amount, 0);
    const { data: state } = await admin.from("team_state").select("coin_balance_cache").eq("team_id", t.id).single();
    if (ledgerSum !== state!.coin_balance_cache) {
      mismatchCount++;
      console.log(`不整合: team${t.team_number} ledger合計=${ledgerSum} vs cache=${state!.coin_balance_cache}`);
    }
  }
  console.log(mismatchCount === 0 ? "コイン整合性: OK(全チームでLedger合計とキャッシュが一致)" : `コイン整合性: NG(${mismatchCount}件不一致)`);

  const { data: reviewQueueLeftover } = await admin.from("review_queue").select("id, status").eq("status", "CLAIMED");
  console.log(
    reviewQueueLeftover?.length
      ? `警告: CLAIMEDのまま未解決のreview_queueが${reviewQueueLeftover.length}件あります(二重承認の兆候の可能性)`
      : "review_queue: OK(CLAIMEDのまま放置された行なし)"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
