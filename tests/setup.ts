import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !anon || !serviceRoleKey) {
  throw new Error(".env.local に NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY を設定してください");
}

export const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

export async function loginToken(email: string, password = "momotetsu-dev-2026") {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`login failed for ${email}: ${JSON.stringify(j)}`);
  return j.access_token as string;
}

export async function rpc(fn: string, token: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, body: json, raw: text };
}

export async function ensureEventRunning() {
  const { data: event } = await admin.from("events").select("id, status").single();
  if (!event) throw new Error("no event found; run `npm run seed` first");
  if (event.status !== "RUNNING") {
    await admin
      .from("events")
      .update({
        status: "RUNNING",
        start_at: new Date().toISOString(),
        end_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      })
      .eq("id", event.id);
  }
  return event.id as string;
}

export async function getTeamByNumber(teamNumber: number) {
  const { data } = await admin.from("teams").select("id, event_id, team_name").eq("team_number", teamNumber).single();
  if (!data) throw new Error(`team ${teamNumber} not found; run \`npm run seed\` first`);
  return data;
}

export async function getStationByName(eventId: string, name: string) {
  const { data } = await admin.from("stations").select("id, name").eq("event_id", eventId).eq("name", name).single();
  if (!data) throw new Error(`station ${name} not found`);
  return data;
}

/** 指定チームを直接DICE_READY状態(現在駅=A駅)にリセットする(テスト専用のバックドア)。 */
export async function resetTeamToDiceReady(teamId: string, eventId: string) {
  const start = await getStationByName(eventId, "A駅");
  await admin
    .from("team_state")
    .update({
      state: "DICE_READY",
      current_station_id: start.id,
      current_turn_id: null,
      mission_success_count: 0,
      coin_balance_cache: 0,
      is_paused: false,
      paused_from_state: null,
    })
    .eq("team_id", teamId);
  await admin.from("coin_ledger").delete().eq("team_id", teamId);
  await admin.from("team_mission_attempts").delete().eq("team_id", teamId);
  await admin.from("turns").delete().eq("team_id", teamId);
}

export async function getStaffToken() {
  return loginToken("staff1@momotetsu.test");
}

/**
 * チームをDICE_READYからMISSION_SELECTIONまで一気に進める(テスト用ショートカット)。
 * 到着写真はパス形式のみ検証されるため、ダミーパスで進行できる。
 */
export async function advanceToMissionSelection(teamNumber: number, stationName: string) {
  const team = await getTeamByNumber(teamNumber);
  await resetTeamToDiceReady(team.id, team.event_id);

  const start = await getStationByName(team.event_id, "A駅");
  const dest = await getStationByName(team.event_id, stationName);

  const { data: turn } = await admin
    .from("turns")
    .insert({ team_id: team.id, turn_number: 1, previous_station_id: start.id, next_station_id: dest.id, status: "IN_PROGRESS" })
    .select()
    .single();
  await admin.from("team_state").update({ state: "TRAVELING", current_turn_id: turn!.id }).eq("team_id", team.id);

  const email = `team${String(teamNumber).padStart(2, "0")}@momotetsu.test`;
  const teamToken = await loginToken(email);
  const staffToken = await getStaffToken();

  const startArrival = await rpc("fn_start_arrival", teamToken);
  if (startArrival.status >= 300) throw new Error(`fn_start_arrival failed: ${startArrival.raw}`);

  const idem = crypto.randomUUID();
  const fakePath = `${team.event_id}/${team.id}/arrival/${idem}/0-test.png`;
  const submit = await rpc("fn_submit_arrival", teamToken, { p_photo_paths: [fakePath], p_idempotency_key: idem });
  if (submit.status >= 300) throw new Error(`fn_submit_arrival failed: ${submit.raw}`);
  const arrivalSubmissionId = submit.body as string;

  const review = await rpc("fn_review_arrival", staffToken, { p_arrival_submission_id: arrivalSubmissionId, p_decision: "APPROVE" });
  if (review.status >= 300) throw new Error(`fn_review_arrival failed: ${review.raw}`);

  const { data: attempt } = await admin
    .from("team_mission_attempts")
    .select("*")
    .eq("team_id", team.id)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .single();

  return { team, teamToken, staffToken, attempt: attempt!, turnId: turn!.id };
}
