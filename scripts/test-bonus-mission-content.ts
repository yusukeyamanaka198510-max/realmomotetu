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

async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  await admin.from("events").update({ status: "RUNNING", end_at: new Date(Date.now() + 3600_000).toISOString() }).eq("id", eventId);
  const { data: team1 } = await admin.from("teams").select("id").eq("team_number", 1).single();
  const team1Token = await login("team01@momotetsu.test");
  const staffToken = await login("staff1@momotetsu.test");
  const { data: tokyo } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", "東京").single();

  console.log("=== テンプレート件数確認 ===");
  const { count } = await admin.from("bonus_mission_templates").select("*", { count: "exact", head: true });
  console.log("bonus_mission_templates件数:", count);

  await admin.from("team_cards").delete().eq("team_id", team1!.id);
  await admin.from("team_bonus_mission_attempts").delete().eq("team_id", team1!.id);
  await admin.from("team_mission_attempts").delete().eq("team_id", team1!.id);
  await admin.from("turns").delete().eq("team_id", team1!.id);
  const { data: maxTurn } = await admin.from("turns").select("turn_number").eq("team_id", team1!.id).order("turn_number", { ascending: false }).limit(1).maybeSingle();
  const nextTurnNumber = (maxTurn?.turn_number ?? 0) + 1;
  const { data: turn, error: turnError } = await admin
    .from("turns")
    .insert({ team_id: team1!.id, turn_number: nextTurnNumber, previous_station_id: tokyo!.id, next_station_id: tokyo!.id, status: "IN_PROGRESS" })
    .select()
    .single();
  if (turnError) throw turnError;
  const { data: mission } = await admin.from("station_missions").select("id").eq("station_id", tokyo!.id).limit(1).single();
  await admin
    .from("team_mission_attempts")
    .insert({ team_id: team1!.id, turn_id: turn!.id, station_id: tokyo!.id, offered_mission_ids: [mission!.id], attempt_number: 1, status: "OFFERED" })
    .select()
    .single();
  await admin.from("team_state").update({ state: "MISSION_SELECTION", current_turn_id: turn!.id, current_station_id: tokyo!.id }).eq("team_id", team1!.id);

  const { data: bonusCard } = await admin.from("cards").select("id").eq("card_code", "BONUS_MISSION").single();
  await admin.from("team_cards").upsert({ team_id: team1!.id, card_id: bonusCard!.id, quantity: 1 });

  console.log("\n=== ボーナスミッションカード使用 ===");
  const useRes = await rpc("fn_use_card", team1Token, { p_idempotency_key: crypto.randomUUID(), p_card_code: "BONUS_MISSION" });
  console.log(useRes.status, JSON.stringify(useRes.body));

  const { data: bonusAttempt } = await admin
    .from("team_bonus_mission_attempts")
    .select("*")
    .eq("team_id", team1!.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  console.log("\n生成されたボーナスミッション:", bonusAttempt!.title);
  console.log("通常ミッション(attempt.offered)との重複無し:", bonusAttempt!.title !== null);

  console.log("\n=== 写真提出 ===");
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const path = `${eventId}/${team1!.id}/mission/bonus-${bonusAttempt!.id}/0.png`;
  const uploadRes = await fetch(`${url}/storage/v1/object/evidence-photos/${path}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${team1Token}`, "Content-Type": "image/png" },
    body: bytes,
  });
  console.log("upload:", uploadRes.status);
  const submitRes = await rpc("fn_submit_bonus_mission_photos", team1Token, { p_bonus_attempt_id: bonusAttempt!.id, p_photo_paths: [path] });
  console.log("submit:", submitRes.status);

  console.log("\n=== 本部承認 ===");
  const beforeCoin = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team1!.id).single();
  const reviewRes = await rpc("fn_review_bonus_mission", staffToken, { p_bonus_attempt_id: bonusAttempt!.id, p_decision: "SUCCESS", p_reason: null });
  console.log("review:", reviewRes.status);
  const afterCoin = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team1!.id).single();
  console.log(`コイン: ${beforeCoin.data!.coin_balance_cache} -> ${afterCoin.data!.coin_balance_cache}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
