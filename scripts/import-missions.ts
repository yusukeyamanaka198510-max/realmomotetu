/**
 * mission-master.json(納品されたExcelから抽出)を station_missions に投入する。
 * success_reward/failure_penalty は null のままにし、難易度デフォルト(1000万/2000万/3000万 等)を使う。
 *
 * 実行: npx tsx scripts/import-missions.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

config({ path: ".env.local" });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Row = {
  station_name: string;
  difficulty: "EASY" | "NORMAL" | "HARD";
  title: string;
  description: string;
};

const STATION_NAME_ALIASES: Record<string, string> = {
  "市ヶ谷": "市ケ谷",
  "千駄ヶ谷": "千駄ケ谷",
  "麴町": "麹町",
  "二重橋前〈丸の内〉": "二重橋前",
  "明治神宮前〈原宿〉": "明治神宮前",
};

async function main() {
  const rows: Row[] = JSON.parse(fs.readFileSync(path.join(__dirname, "mission-master.json"), "utf-8")).map(
    (r: Row) => ({ ...r, station_name: STATION_NAME_ALIASES[r.station_name] ?? r.station_name })
  );

  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  const { data: stations } = await admin.from("stations").select("id, name").eq("event_id", eventId);
  const stationIdByName = new Map((stations ?? []).map((s) => [s.name, s.id]));

  const missingStations = new Set<string>();
  const toInsert: { station_id: string; difficulty: string; title: string; description: string; is_active: boolean }[] = [];

  for (const r of rows) {
    const stationId = stationIdByName.get(r.station_name);
    if (!stationId) {
      missingStations.add(r.station_name);
      continue;
    }
    toInsert.push({
      station_id: stationId,
      difficulty: r.difficulty,
      title: r.title,
      description: r.description,
      is_active: true,
    });
  }

  console.log(`投入対象: ${toInsert.length}件 / DB未存在の駅名: ${missingStations.size}件`);
  if (missingStations.size > 0) {
    console.log("未存在の駅名一覧:", [...missingStations].join(", "));
  }

  // マッチした駅だけでなく全駅分を消してから入れ直す(過去の仮ミッション等の残骸を残さないため)
  const allStationIds = [...stationIdByName.values()];
  await admin.from("station_missions").delete().in("station_id", allStationIds);

  const chunkSize = 500;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    const { error } = await admin.from("station_missions").insert(chunk);
    if (error) throw error;
    console.log(`  ${i + chunk.length}/${toInsert.length} 件投入済み`);
  }

  console.log("完了");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
