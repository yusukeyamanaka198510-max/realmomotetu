/**
 * Phase 8(物件・カード・動的ゴール・現在駅更新バグ修正)の検証スクリプト。
 * 実行: npx tsx scripts/test-phase8.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function login(email: string) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "momotetsu-dev-2026" }),
  });
  return (await res.json()).access_token as string;
}

async function rpc(fn: string, token: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
}

async function uploadDummy(token: string, eventId: string, teamId: string, kind: string, subId: string) {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const path = `${eventId}/${teamId}/${kind}/${subId}/0.png`;
  const res = await fetch(`${url}/storage/v1/object/evidence-photos/${path}`, {
    method: "POST", headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "image/png" }, body: bytes,
  });
  if (res.status !== 200) throw new Error(`upload failed: ${await res.text()}`);
  return path;
}

async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  const staffTokenEarly = await login("staff1@momotetsu.test");
  await admin.from("events").update({ status: "SCHEDULED", active_destination_station_id: null }).eq("id", eventId);
  const startRes = await rpc("fn_admin_start_event", staffTokenEarly, { p_time_limit_minutes: 1440 });
  console.log("fn_admin_start_event:", startRes.status);

  const { data: shibuya } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", "渋谷").single();
  await rpc("fn_admin_set_active_destination", staffTokenEarly, { p_station_id: shibuya!.id });

  // テスト用に渋谷へ物件とカードを1件ずつ用意
  await admin.from("station_properties").delete().eq("station_id", shibuya!.id);
  await admin.from("station_cards").delete().eq("station_id", shibuya!.id);
  const { data: property } = await admin
    .from("station_properties")
    .insert({ station_id: shibuya!.id, name: "テスト物件", price: 10_000_000, yield_amount: 2_000_000, description: "検証用" })
    .select()
    .single();
  await admin.from("station_cards").insert({ station_id: shibuya!.id, name: "テストカード", description: "検証用" });

  const { data: team } = await admin.from("teams").select("id, event_id").eq("team_number", 1).single();
  const { data: tokyo } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", "東京").single();

  // team01を渋谷の隣駅(表参道など、経路探索を使わず直接turnを作る)にTRAVELING状態でセット
  await admin.from("team_state").update({
    state: "DICE_READY", current_station_id: tokyo!.id, current_turn_id: null,
    mission_success_count: 0, coin_balance_cache: 50_000_000, is_paused: false, paused_from_state: null,
  }).eq("team_id", team!.id);
  await admin.from("team_mission_attempts").delete().eq("team_id", team!.id);
  await admin.from("team_property_purchases").delete().eq("team_id", team!.id);
  await admin.from("team_cards").delete().eq("team_id", team!.id);
  await admin.from("dice_rolls").delete().eq("team_id", team!.id);
  await admin.from("destination_selections").delete().eq("team_id", team!.id);
  await admin.from("arrival_submissions").delete().eq("team_id", team!.id);
  await admin.from("turns").delete().eq("team_id", team!.id);

  const { data: turn } = await admin.from("turns").insert({
    team_id: team!.id, turn_number: 1, previous_station_id: tokyo!.id, next_station_id: shibuya!.id, status: "IN_PROGRESS",
  }).select().single();
  await admin.from("team_state").update({ state: "TRAVELING", current_turn_id: turn!.id }).eq("team_id", team!.id);

  const token = await login("team01@momotetsu.test");
  const staffToken = await login("staff1@momotetsu.test");

  console.log("--- 動的ゴール選定の確認 ---");
  const { data: eventNow } = await admin.from("events").select("active_destination_station_id").eq("id", eventId).single();
  console.log("現在のactive_destination_station_id:", eventNow!.active_destination_station_id, "(渋谷id:", shibuya!.id, ")");

  await rpc("fn_start_arrival", token);
  const idem = crypto.randomUUID();
  const path = await uploadDummy(token, eventId, team!.id, "arrival", idem);
  const submit = await rpc("fn_submit_arrival", token, { p_photo_paths: [path], p_idempotency_key: idem });
  const arrivalId = submit.body as string;
  console.log("submit_arrival:", submit.status);

  const before = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team!.id).single();
  const approve = await rpc("fn_review_arrival", staffToken, { p_arrival_submission_id: arrivalId, p_decision: "APPROVE" });
  console.log("review_arrival(APPROVE):", approve.status);

  const after = await admin.from("team_state").select("coin_balance_cache, current_station_id").eq("team_id", team!.id).single();
  console.log(`目的地一致ボーナス: ${before.data!.coin_balance_cache} -> ${after.data!.coin_balance_cache}`);
  console.log("現在駅は到着駅と一致するか(承認直後、まだミッション未完了なのでこの時点ではA駅=東京駅のまま想定):", after.data!.current_station_id === tokyo!.id ? "OK(まだ更新されない)" : "NG");

  const { data: eventAfterClear } = await admin.from("events").select("active_destination_station_id").eq("id", eventId).single();
  console.log("次の目的地(渋谷から変わっているはず):", eventAfterClear!.active_destination_station_id, eventAfterClear!.active_destination_station_id !== shibuya!.id ? "OK(ローテーション成功)" : "NG(変わっていない)");

  const { data: attempt } = await admin.from("team_mission_attempts").select("*").eq("team_id", team!.id).order("created_at", { ascending: false }).limit(1).single();
  const missionId = attempt!.offered_mission_ids[0] as string;
  await rpc("fn_select_mission", token, { p_attempt_id: attempt!.id, p_selected_mission_id: missionId });
  const missionPath = await uploadDummy(token, eventId, team!.id, "mission", attempt!.id);
  await rpc("fn_submit_mission_photos", token, { p_attempt_id: attempt!.id, p_photo_paths: [missionPath] });

  console.log("\n--- ミッション成功 → 現在駅更新バグ修正 & カード自動取得 & 物件購入ゲートの確認 ---");
  const review = await rpc("fn_review_mission", staffToken, { p_attempt_id: attempt!.id, p_decision: "SUCCESS" });
  console.log("review_mission(SUCCESS):", review.status);

  const stateAfterMission = await admin.from("team_state").select("state, current_station_id, coin_balance_cache").eq("team_id", team!.id).single();
  console.log("current_station_id == 渋谷か:", stateAfterMission.data!.current_station_id === shibuya!.id ? "OK(バグ修正確認)" : "NG");
  console.log("state == PROPERTY_PURCHASE か(渋谷に物件があるため):", stateAfterMission.data!.state === "PROPERTY_PURCHASE" ? "OK" : `NG(${stateAfterMission.data!.state})`);

  const { data: cardsAcquired } = await admin.from("team_cards").select("*").eq("team_id", team!.id);
  console.log("カード自動取得件数:", cardsAcquired?.length, cardsAcquired?.length === 1 ? "OK" : "NG");

  console.log("\n--- 物件購入 ---");
  const beforePurchase = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team!.id).single();
  const purchase = await rpc("fn_purchase_property", token, { p_property_id: property!.id });
  console.log("fn_purchase_property:", purchase.status);
  const afterPurchase = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team!.id).single();
  console.log(`コイン: ${beforePurchase.data!.coin_balance_cache} -> ${afterPurchase.data!.coin_balance_cache} (差分=${afterPurchase.data!.coin_balance_cache - beforePurchase.data!.coin_balance_cache}, 期待値=-${property!.price})`);

  const finish = await rpc("fn_finish_property_purchase", token);
  console.log("fn_finish_property_purchase:", finish.status);
  const stateAfterFinish = await admin.from("team_state").select("state").eq("team_id", team!.id).single();
  console.log("state == DICE_READY か:", stateAfterFinish.data!.state === "DICE_READY" ? "OK" : `NG(${stateAfterFinish.data!.state})`);

  console.log("\n--- イベント強制終了時の物件精算 ---");
  const beforeEnd = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team!.id).single();
  const forceEnd = await rpc("fn_admin_force_end_event", staffToken, { p_reason: "test" });
  console.log("fn_admin_force_end_event:", forceEnd.status);
  const afterEnd = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team!.id).single();
  const expectedPayout = property!.price + property!.yield_amount;
  console.log(`精算: ${beforeEnd.data!.coin_balance_cache} -> ${afterEnd.data!.coin_balance_cache} (差分=${afterEnd.data!.coin_balance_cache - beforeEnd.data!.coin_balance_cache}, 期待値=+${expectedPayout})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
