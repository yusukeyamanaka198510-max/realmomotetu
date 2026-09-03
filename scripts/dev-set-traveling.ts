/**
 * 開発用: Phase 4(サイコロ・経路探索)がまだ無いため、Phase 2(到着フロー)を手動で
 * テストできるようにチーム1を強制的に TRAVELING 状態(次の目的駅=B駅)にする。
 * 本番運用では使用しない。
 *
 * 実行: npx tsx scripts/dev-set-traveling.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: team } = await admin.from("teams").select("id, event_id").eq("team_number", 1).single();
  if (!team) throw new Error("team01 not found. run `npm run seed` first");

  const { data: stationA } = await admin
    .from("stations")
    .select("id")
    .eq("event_id", team.event_id)
    .eq("name", "A駅")
    .single();
  const { data: stationB } = await admin
    .from("stations")
    .select("id")
    .eq("event_id", team.event_id)
    .eq("name", "B駅")
    .single();
  if (!stationA || !stationB) throw new Error("stations not found");

  const { data: turn, error: turnError } = await admin
    .from("turns")
    .insert({
      team_id: team.id,
      turn_number: 1,
      previous_station_id: stationA.id,
      next_station_id: stationB.id,
      status: "IN_PROGRESS",
    })
    .select()
    .single();
  if (turnError) throw turnError;

  const { error: stateError } = await admin
    .from("team_state")
    .update({ state: "TRAVELING", current_turn_id: turn.id, current_station_id: stationA.id })
    .eq("team_id", team.id);
  if (stateError) throw stateError;

  console.log(`team01 (${team.id}) を TRAVELING に設定しました。次の目的駅: B駅`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
