/**
 * 東京23区内のJR主要路線・東京メトロ全9路線の駅・接続データを既存イベントに投入する。
 * ミッションは投入しない(内容は管理画面 /staff/manage から個別に登録する想定)。
 *
 * 実行: npx tsx scripts/import-real-tokyo-data.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

config({ path: ".env.local" });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type LineDef = { name: string; stations: string[]; loop?: boolean };

async function main() {
  const fileName = process.argv[2] ?? "real-data-tokyo.json";
  const raw = fs.readFileSync(path.join(__dirname, fileName), "utf-8");
  const { lines }: { lines: LineDef[] } = JSON.parse(raw);

  const { data: event } = await admin.from("events").select("id").single();
  if (!event) throw new Error("イベントが見つかりません。先に npm run seed を実行してください");
  const eventId = event.id as string;

  const stationIdByName = new Map<string, string>();
  const { data: existingStations } = await admin.from("stations").select("id, name").eq("event_id", eventId);
  existingStations?.forEach((s) => stationIdByName.set(s.name, s.id));

  async function getOrCreateStation(name: string) {
    const existing = stationIdByName.get(name);
    if (existing) return existing;
    const { data, error } = await admin.from("stations").insert({ event_id: eventId, name }).select().single();
    if (error) throw error;
    stationIdByName.set(name, data.id);
    return data.id as string;
  }

  let edgeCount = 0;
  let stationCount = 0;

  for (const line of lines) {
    let { data: lineRow } = await admin.from("lines").select("id").eq("event_id", eventId).eq("name", line.name).maybeSingle();
    if (!lineRow) {
      const { data, error } = await admin.from("lines").insert({ event_id: eventId, name: line.name }).select().single();
      if (error) throw error;
      lineRow = data;
    }
    const lineId = lineRow!.id as string;

    const stationIds: string[] = [];
    for (const name of line.stations) {
      const before = stationIdByName.has(name);
      const id = await getOrCreateStation(name);
      if (!before) stationCount++;
      stationIds.push(id);

      await admin.from("station_lines").upsert(
        { station_id: id, line_id: lineId },
        { onConflict: "station_id,line_id", ignoreDuplicates: true }
      );
    }

    const pairs: [string, string][] = [];
    for (let i = 0; i < stationIds.length - 1; i++) {
      pairs.push([stationIds[i], stationIds[i + 1]]);
    }
    if (line.loop) {
      pairs.push([stationIds[stationIds.length - 1], stationIds[0]]);
    }

    for (const [a, b] of pairs) {
      const { data: existingEdge } = await admin
        .from("edges")
        .select("id")
        .eq("event_id", eventId)
        .eq("line_id", lineId)
        .or(`and(station_a_id.eq.${a},station_b_id.eq.${b}),and(station_a_id.eq.${b},station_b_id.eq.${a})`)
        .maybeSingle();
      if (existingEdge) continue;

      const { error } = await admin.from("edges").insert({ event_id: eventId, station_a_id: a, station_b_id: b, line_id: lineId });
      if (error) throw error;
      edgeCount++;
    }

    console.log(`路線「${line.name}」: ${line.stations.length}駅を処理`);
  }

  console.log(`完了: 新規駅 ${stationCount} 件, 新規接続 ${edgeCount} 件を投入しました`);
  console.log("ミッションは投入していません。/staff/manage の管理画面から各駅に登録してください。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
