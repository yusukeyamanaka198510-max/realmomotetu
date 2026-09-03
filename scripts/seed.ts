/**
 * Phase 1 Seed Data
 *   - 本部スタッフ3名
 *   - チーム20組(各1アカウント)
 *   - テスト用路線・駅(分岐・乗換駅を含む)
 *   - 各駅9ミッション(EASY/NORMAL/HARD 各3)
 *   - 最終目的地キュー
 *
 * 実行: npx tsx scripts/seed.ts
 * 事前に .env.local に NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を設定すること。
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("環境変数 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を設定してください");
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULT_PASSWORD = "momotetsu-dev-2026"; // 開発環境専用。本番Seedでは必ず変更すること。

async function createAuthUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user!.id;
}

async function main() {
  console.log("Seeding event...");
  const { data: event, error: eventError } = await admin
    .from("events")
    .insert({
      name: "リアル桃鉄 開発テストイベント",
      status: "SCHEDULED",
      time_limit_minutes: 240,
      default_destination_bonus_amount: 3000,
    })
    .select()
    .single();
  if (eventError) throw eventError;
  const eventId = event.id as string;

  console.log("Seeding staff (3名)...");
  for (let i = 1; i <= 3; i++) {
    const userId = await createAuthUser(`staff${i}@momotetsu.test`);
    const { error } = await admin.from("staff_users").insert({
      id: userId,
      event_id: eventId,
      display_name: `本部スタッフ${i}`,
      role: i === 1 ? "ADMIN" : "STAFF",
    });
    if (error) throw error;
  }

  console.log("Seeding lines...");
  const lineNames = ["山手線(テスト)", "中央線(テスト)", "支線(テスト)"];
  const { data: lines, error: lineError } = await admin
    .from("lines")
    .insert(lineNames.map((name) => ({ event_id: eventId, name })))
    .select();
  if (lineError) throw lineError;
  const [yamanote, chuo, branch] = lines;

  console.log("Seeding stations...");
  // 山手線: A-B-C-D-E-F-A(環状) / 中央線: C-G-H-I(乗換Cで接続) / 支線: I-J(行き止まり、乗換Iで接続)
  const stationNames = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const { data: stations, error: stationError } = await admin
    .from("stations")
    .insert(stationNames.map((name) => ({ event_id: eventId, name: `${name}駅` })))
    .select();
  if (stationError) throw stationError;
  const st = Object.fromEntries(stations.map((s) => [s.name.replace("駅", ""), s.id as string]));

  const yamanoteStations = ["A", "B", "C", "D", "E", "F"];
  const chuoStations = ["C", "G", "H", "I"];
  const branchStations = ["I", "J"];

  await admin.from("station_lines").insert([
    ...yamanoteStations.map((n) => ({ station_id: st[n], line_id: yamanote.id })),
    ...chuoStations.map((n) => ({ station_id: st[n], line_id: chuo.id })),
    ...branchStations.map((n) => ({ station_id: st[n], line_id: branch.id })),
  ]);

  console.log("Seeding edges...");
  const edgePairs: [string, string, string][] = [
    ["A", "B", yamanote.id], ["B", "C", yamanote.id], ["C", "D", yamanote.id],
    ["D", "E", yamanote.id], ["E", "F", yamanote.id], ["F", "A", yamanote.id],
    ["C", "G", chuo.id], ["G", "H", chuo.id], ["H", "I", chuo.id],
    ["I", "J", branch.id],
  ];
  const { error: edgeError } = await admin.from("edges").insert(
    edgePairs.map(([a, b, lineId]) => ({
      event_id: eventId,
      station_a_id: st[a],
      station_b_id: st[b],
      line_id: lineId,
    }))
  );
  if (edgeError) throw edgeError;

  await admin.from("events").update({ start_station_id: st["A"] }).eq("id", eventId);

  console.log("Seeding missions (各駅9個)...");
  const difficulties: Array<"EASY" | "NORMAL" | "HARD"> = ["EASY", "NORMAL", "HARD"];
  const missionRows = stations.flatMap((s) =>
    difficulties.flatMap((difficulty, dIdx) =>
      [1, 2, 3].map((n) => ({
        station_id: s.id,
        difficulty,
        title: `${s.name} ミッション${dIdx * 3 + n}`,
        description: `${s.name}周辺で指定の課題を達成し、証拠写真を提出してください。(テストデータ #${n})`,
      }))
    )
  );
  const { error: missionError } = await admin.from("station_missions").insert(missionRows);
  if (missionError) throw missionError;

  console.log("Seeding destination queue...");
  const destinationOrder = ["F", "H", "J"];
  const { error: destError } = await admin.from("destination_queue").insert(
    destinationOrder.map((n, idx) => ({
      event_id: eventId,
      station_id: st[n],
      sequence_order: idx + 1,
      status: idx === 0 ? "ACTIVE" : "PENDING",
    }))
  );
  if (destError) throw destError;

  console.log("Seeding teams (20組)...");
  for (let i = 1; i <= 20; i++) {
    const userId = await createAuthUser(`team${String(i).padStart(2, "0")}@momotetsu.test`);
    const { data: team, error: teamError } = await admin
      .from("teams")
      .insert({
        event_id: eventId,
        team_number: i,
        team_name: `チーム${i}`,
        auth_user_id: userId,
      })
      .select()
      .single();
    if (teamError) throw teamError;

    const { error: stateError } = await admin.from("team_state").insert({
      team_id: team.id,
      event_id: eventId,
      state: "WAITING",
      current_station_id: st["A"],
    });
    if (stateError) throw stateError;
  }

  console.log("Seed完了:");
  console.log(`  event_id = ${eventId}`);
  console.log(`  staff: staff1@momotetsu.test 〜 staff3@momotetsu.test / password: ${DEFAULT_PASSWORD}`);
  console.log(`  teams: team01@momotetsu.test 〜 team20@momotetsu.test / password: ${DEFAULT_PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
