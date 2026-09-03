/**
 * ミッションが1件も無い駅に、仮のミッション(EASY/NORMAL/HARD 各1)を登録する。
 * 内容はプレースホルダーなので、実際の運用前に /staff/manage から編集すること。
 *
 * 実行: npx tsx scripts/seed-placeholder-missions.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const { data: stations } = await admin.from("stations").select("id, name").eq("event_id", event!.id);
  const { data: missions } = await admin.from("station_missions").select("station_id, difficulty");

  const hasMission = new Set((missions ?? []).map((m) => `${m.station_id}:${m.difficulty}`));
  const difficulties = ["EASY", "NORMAL", "HARD"] as const;

  const rows: { station_id: string; difficulty: (typeof difficulties)[number]; title: string; description: string }[] = [];
  for (const s of stations ?? []) {
    for (const d of difficulties) {
      if (!hasMission.has(`${s.id}:${d}`)) {
        rows.push({
          station_id: s.id,
          difficulty: d,
          title: `(仮)${s.name}のミッション`,
          description: "本部が管理画面から内容を編集してください。",
        });
      }
    }
  }

  if (rows.length === 0) {
    console.log("追加不要: すべての駅に各難易度のミッションが既にあります");
    return;
  }

  const { error } = await admin.from("station_missions").insert(rows);
  if (error) throw error;
  console.log(`${rows.length}件の仮ミッションを追加しました(${stations!.length}駅対象)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
