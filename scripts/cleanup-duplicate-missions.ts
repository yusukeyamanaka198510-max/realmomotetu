/**
 * station_missions に (station_id, difficulty) の重複が大量に発生している問題を修正する。
 * 原因: 過去セッションの仮ミッション(タイトルが"(仮)"始まり、created_atが古い)が、
 * 本物のミッションインポート後も削除されずに残っていた。
 * fn_generate_offered_missions は created_at が最も古い行を選ぶため、
 * 本物より仮ミッションが優先されて参加者に表示されてしまっていた。
 *
 * 各(station_id, difficulty)ごとに、
 *   1. タイトルが"(仮)"で始まらない行があればそれを1件だけ残す(複数あれば最新のものを残す)
 *   2. 無ければ"(仮)"の行を1件だけ残す
 * とし、残りは削除する。
 *
 * 実行: npx tsx scripts/cleanup-duplicate-missions.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Row = { id: string; station_id: string; difficulty: string; title: string; created_at: string };

async function fetchAll(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; ; i++) {
    const { data, error } = await admin
      .from("station_missions")
      .select("id, station_id, difficulty, title, created_at")
      .range(i * 1000, (i + 1) * 1000 - 1);
    if (error) throw error;
    rows.push(...(data as Row[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const rows = await fetchAll();
  console.log(`取得総件数: ${rows.length}`);

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.station_id}:${r.difficulty}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const toDelete: string[] = [];
  let placeholderOnlyCount = 0;

  for (const [, list] of groups) {
    if (list.length <= 1) continue;
    const real = list.filter((r) => !r.title.startsWith("(仮)"));
    let keep: Row;
    if (real.length > 0) {
      keep = real.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]; // 最新の本物を残す
    } else {
      placeholderOnlyCount++;
      keep = list.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0]; // 仮なら最も古いものを残す
    }
    for (const r of list) {
      if (r.id !== keep.id) toDelete.push(r.id);
    }
  }

  console.log(`削除対象: ${toDelete.length}件 / 重複グループ数: ${[...groups.values()].filter((l) => l.length > 1).length}`);
  console.log(`本物が無く仮のみ残すグループ数: ${placeholderOnlyCount}`);

  const chunkSize = 500;
  for (let i = 0; i < toDelete.length; i += chunkSize) {
    const chunk = toDelete.slice(i, i + chunkSize);
    const { error } = await admin.from("station_missions").delete().in("id", chunk);
    if (error) throw error;
    console.log(`  ${i + chunk.length}/${toDelete.length} 件削除済み`);
  }

  const { count } = await admin.from("station_missions").select("*", { count: "exact", head: true });
  console.log(`完了。最終件数: ${count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
