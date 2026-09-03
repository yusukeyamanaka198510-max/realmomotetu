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
  await admin.from("events").update({ status: "RUNNING", end_at: new Date(Date.now() + 3600_000).toISOString(), obstruction_cooldown_seconds: 30 }).eq("id", eventId);
  const { data: team1 } = await admin.from("teams").select("id").eq("team_number", 1).single();
  const { data: team2 } = await admin.from("teams").select("id").eq("team_number", 2).single();
  const team1Token = await login("team01@momotetsu.test");
  const { data: tokyo } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", "東京").single();

  for (const teamId of [team1!.id, team2!.id]) {
    await admin.from("team_state").update({ state: "DICE_READY", current_station_id: tokyo!.id, current_turn_id: null }).eq("team_id", teamId);
    await admin.from("team_cards").delete().eq("team_id", teamId);
    await admin.from("card_active_effects").delete().eq("team_id", teamId);
    await admin.from("card_usage_log").delete().eq("team_id", teamId);
  }
  await admin.from("cards").select("id").eq("card_code", "SLOW_WALK").single().then(async ({ data }) => {
    await admin.from("team_cards").upsert({ team_id: team1!.id, card_id: data!.id, quantity: 2 });
  });

  console.log("=== 1回目の妨害カード使用(成功するはず) ===");
  const r1 = await rpc("fn_use_card", team1Token, { p_idempotency_key: crypto.randomUUID(), p_card_code: "SLOW_WALK", p_target_team_id: team2!.id });
  console.log(r1.status, JSON.stringify(r1.body));

  console.log("\n=== 直後に同じ相手へ2回目(クールタイムでブロックされるはず) ===");
  const r2 = await rpc("fn_use_card", team1Token, { p_idempotency_key: crypto.randomUUID(), p_card_code: "SLOW_WALK", p_target_team_id: team2!.id });
  console.log(r2.status, JSON.stringify(r2.body));

  console.log("\n=== クールタイムを0にして再試行(成功するはず) ===");
  await admin.from("events").update({ obstruction_cooldown_seconds: 0 }).eq("id", eventId);
  const r3 = await rpc("fn_use_card", team1Token, { p_idempotency_key: crypto.randomUUID(), p_card_code: "SLOW_WALK", p_target_team_id: team2!.id });
  console.log(r3.status, JSON.stringify(r3.body));
}
main().catch((e) => { console.error(e); process.exit(1); });
