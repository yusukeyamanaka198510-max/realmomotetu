/**
 * property-master.json(納品されたExcelから抽出)を station_properties に投入する。
 * 価格・利回りは「万円」単位なので円に変換(×10,000)する。
 * 利回りは「収益率%」ではなく「1回決算収益_万円」の値をそのまま固定額として使う
 * (station_properties.yield_amountは固定額として設計しているため)。
 *
 * 実行: npx tsx scripts/import-properties.ts
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
  property_id: string;
  station_name: string;
  slot: number;
  name: string;
  category: string;
  price_manen: number;
  yield_pct: number;
  settlement_manen: number;
  note: string | null;
};

// 物件マスタ側の表記と、こちらのDB(公式サイト基準の表記)の揺れを吸収する
const STATION_NAME_ALIASES: Record<string, string> = {
  "市ヶ谷": "市ケ谷",
  "千駄ヶ谷": "千駄ケ谷",
  "麴町": "麹町",
  "二重橋前〈丸の内〉": "二重橋前",
  "明治神宮前〈原宿〉": "明治神宮前",
};

async function main() {
  const rows: Row[] = JSON.parse(fs.readFileSync(path.join(__dirname, "property-master.json"), "utf-8")).map(
    (r: Row) => ({ ...r, station_name: STATION_NAME_ALIASES[r.station_name] ?? r.station_name })
  );

  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  const { data: stations } = await admin.from("stations").select("id, name").eq("event_id", eventId);
  const stationIdByName = new Map((stations ?? []).map((s) => [s.name, s.id]));

  const missingStations = new Set<string>();
  const toInsert: {
    station_id: string;
    name: string;
    price: number;
    yield_amount: number;
    description: string;
    is_active: boolean;
  }[] = [];

  for (const r of rows) {
    const stationId = stationIdByName.get(r.station_name);
    if (!stationId) {
      missingStations.add(r.station_name);
      continue;
    }
    toInsert.push({
      station_id: stationId,
      name: r.name,
      price: Math.round(r.price_manen * 10000),
      yield_amount: Math.round(r.settlement_manen * 10000),
      description: `${r.category}${r.note ? " / " + r.note : ""}`,
      is_active: true,
    });
  }

  console.log(`投入対象: ${toInsert.length}件 / DB未存在の駅名: ${missingStations.size}件`);
  if (missingStations.size > 0) {
    console.log("未存在の駅名一覧:", [...missingStations].join(", "));
  }

  // 既存の物件データは全て入れ替える
  const stationIds = [...stationIdByName.values()];
  await admin.from("station_properties").delete().in("station_id", stationIds);

  const chunkSize = 500;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    const { error } = await admin.from("station_properties").insert(chunk);
    if (error) throw error;
    console.log(`  ${i + chunk.length}/${toInsert.length} 件投入済み`);
  }

  console.log("完了");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
