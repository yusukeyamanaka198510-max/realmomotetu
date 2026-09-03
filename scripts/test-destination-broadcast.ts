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
  return { status: res.status, body: await res.text() };
}

async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  await admin.from("events").update({ status: "RUNNING", end_at: new Date(Date.now() + 3600_000).toISOString() }).eq("id", eventId);
  const { data: shibuya } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", "渋谷").single();
  await admin.from("events").update({ active_destination_station_id: shibuya!.id }).eq("id", eventId);

  const { data: team1 } = await admin.from("teams").select("id").eq("team_number", 1).single();
  const { data: team2 } = await admin.from("teams").select("id").eq("team_number", 2).single();
  const team1Token = await login("team01@momotetsu.test");
  const staffToken = await login("staff1@momotetsu.test");

  for (const teamId of [team1!.id, team2!.id]) {
    await admin.from("card_notifications").delete().eq("team_id", teamId);
  }
  await admin.from("turns").delete().eq("team_id", team1!.id);
  const { data: maxTurn } = await admin.from("turns").select("turn_number").eq("team_id", team1!.id).order("turn_number", { ascending: false }).limit(1).maybeSingle();
  const nextTurnNumber = (maxTurn?.turn_number ?? 0) + 1;
  const { data: turn, error: turnError } = await admin
    .from("turns")
    .insert({ team_id: team1!.id, turn_number: nextTurnNumber, previous_station_id: shibuya!.id, next_station_id: shibuya!.id, status: "IN_PROGRESS" })
    .select()
    .single();
  if (turnError) throw turnError;
  await admin.from("team_state").update({ state: "ARRIVAL_SUBMISSION", current_turn_id: turn!.id }).eq("team_id", team1!.id);

  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const idem = crypto.randomUUID();
  const path = `${eventId}/${team1!.id}/arrival/${idem}/0.png`;
  await fetch(`${url}/storage/v1/object/evidence-photos/${path}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${team1Token}`, "Content-Type": "image/png" },
    body: bytes,
  });
  const submitRes = await rpc("fn_submit_arrival", team1Token, { p_photo_paths: [path], p_idempotency_key: idem });
  console.log("submit_arrival:", submitRes.status);

  const { data: arrival } = await admin
    .from("arrival_submissions")
    .select("id")
    .eq("team_id", team1!.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .single();
  const reviewRes = await rpc("fn_review_arrival", staffToken, { p_arrival_submission_id: arrival!.id, p_decision: "APPROVE" });
  console.log("review_arrival:", reviewRes.status, reviewRes.body);

  const { data: notifTeam1 } = await admin.from("card_notifications").select("message").eq("team_id", team1!.id).order("created_at", { ascending: false }).limit(1);
  const { data: notifTeam2 } = await admin.from("card_notifications").select("message").eq("team_id", team2!.id).order("created_at", { ascending: false }).limit(1);
  console.log("\n到達チーム(team1)への通知:", notifTeam1?.[0]?.message);
  console.log("他チーム(team2)への通知:", notifTeam2?.[0]?.message);

  const { data: newEvent } = await admin.from("events").select("active_destination_station_id").eq("id", eventId).single();
  console.log("\n次の目的地(渋谷から変わっているはず):", newEvent!.active_destination_station_id !== shibuya!.id ? "OK" : "NG");
}
main().catch((e) => { console.error(e); process.exit(1); });
