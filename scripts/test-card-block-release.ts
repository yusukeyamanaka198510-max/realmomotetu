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
  await admin.from("events").update({ status: "RUNNING", end_at: new Date(Date.now() + 3600_000).toISOString(), obstruction_cooldown_seconds: 0 }).eq("id", eventId);
  const { data: team1 } = await admin.from("teams").select("id").eq("team_number", 1).single();
  const { data: team2 } = await admin.from("teams").select("id").eq("team_number", 2).single();
  const team2Token = await login("team02@momotetsu.test");
  const team1Token = await login("team01@momotetsu.test");
  const { data: tokyo } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", "東京").single();

  for (const teamId of [team1!.id, team2!.id]) {
    await admin.from("team_state").update({ state: "DICE_READY", current_station_id: tokyo!.id, current_turn_id: null }).eq("team_id", teamId);
    await admin.from("team_cards").delete().eq("team_id", teamId);
    await admin.from("card_active_effects").delete().eq("team_id", teamId);
  }

  console.log("=== サイコロ封印カードをteam2にかける ===");
  const { data: sealCard } = await admin.from("cards").select("id").eq("card_code", "DICE_SEAL").single();
  await admin.from("team_cards").upsert({ team_id: team1!.id, card_id: sealCard!.id, quantity: 1 });
  const r1 = await rpc("fn_use_card", team1Token, { p_idempotency_key: crypto.randomUUID(), p_card_code: "DICE_SEAL", p_target_team_id: team2!.id });
  console.log(r1.status, JSON.stringify(r1.body));

  const { data: advCard } = await admin.from("cards").select("id").eq("card_code", "ADVANCE_1").single();
  await admin.from("team_cards").upsert({ team_id: team2!.id, card_id: advCard!.id, quantity: 1 });

  console.log("\n=== team2が移動カードを使おうとする(ブロックされるはず) ===");
  const r2 = await rpc("fn_use_card", team2Token, { p_idempotency_key: crypto.randomUUID(), p_card_code: "ADVANCE_1" });
  console.log(r2.status, JSON.stringify(r2.body));

  console.log("\n=== team2が通常サイコロで移動する(成功して封印が解除されるはず) ===");
  const r3 = await rpc("fn_roll_dice", team2Token, { p_dice_count: 1 });
  console.log(r3.status, JSON.stringify(r3.body));

  await admin.from("team_state").update({ state: "DICE_READY", current_turn_id: null }).eq("team_id", team2!.id);

  console.log("\n=== 解除後、team2が移動カードを使える(成功するはず) ===");
  const r4 = await rpc("fn_use_card", team2Token, { p_idempotency_key: crypto.randomUUID(), p_card_code: "ADVANCE_1" });
  console.log(r4.status, JSON.stringify(r4.body));

  await admin.from("team_state").update({ state: "DICE_READY", current_turn_id: null }).eq("team_id", team1!.id);

  console.log("\n=== 冬眠カードをteam1にかける ===");
  const { data: hibCard } = await admin.from("cards").select("id").eq("card_code", "HIBERNATE").single();
  await admin.from("team_cards").upsert({ team_id: team2!.id, card_id: hibCard!.id, quantity: 1 });
  const { data: lotteryCard } = await admin.from("cards").select("id").eq("card_code", "LOTTERY").single();
  await admin.from("team_cards").upsert({ team_id: team1!.id, card_id: lotteryCard!.id, quantity: 1 });
  const r5 = await rpc("fn_use_card", team2Token, { p_idempotency_key: crypto.randomUUID(), p_card_code: "HIBERNATE", p_target_team_id: team1!.id });
  console.log(r5.status, JSON.stringify(r5.body));

  console.log("\n=== team1がカードを使おうとする(ブロックされるはず) ===");
  const r6 = await rpc("fn_use_card", team1Token, { p_idempotency_key: crypto.randomUUID(), p_card_code: "LOTTERY" });
  console.log(r6.status, JSON.stringify(r6.body));

  console.log("\n=== team1が通常サイコロで移動する(冬眠が解除されるはず) ===");
  const r7 = await rpc("fn_roll_dice", team1Token, { p_dice_count: 1 });
  console.log(r7.status, JSON.stringify(r7.body));

  console.log("\n=== 解除後、team1がカードを使える(成功するはず) ===");
  const r8 = await rpc("fn_use_card", team1Token, { p_idempotency_key: crypto.randomUUID(), p_card_code: "LOTTERY" });
  console.log(r8.status, JSON.stringify(r8.body));
}
main().catch((e) => { console.error(e); process.exit(1); });
