/**
 * 振り返りダッシュボード(/retrospective)の動作確認用デモデータ投入スクリプト。
 *
 * 新しいイベント・チーム・駅・ミッションは一切作らない。既存の(本番と共有の)DBに
 * 既に登録されている「イベント1件・チーム・駅・ミッション・カード」をそのまま使い、
 * 各チームに対して到着・ミッション・ボーナスミッション・カード使用・コイン増減・
 * 到着却下・ボンビー付与・ゴール到達といった「1日の出来事」をでっちあげて挿入する。
 *
 * 実行前に対象イベント名・チーム数を表示して確認を求める(誤って進行中の本番イベントに
 * 投入しないためのセーフガード)。
 *
 * 投入したデータは、本部画面の「リハーサルリセット」(fn_admin_rehearsal_reset)で
 * まとめて削除できる(チーム・スタッフアカウント自体は残る)。
 *
 * 実行: npx tsx scripts/seed-retrospective-demo.ts
 * 事前に .env.local に NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を設定すること。
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("環境変数 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を設定してください");
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EVIDENCE_BUCKET = "evidence-photos";
// 1x1の最小PNG(黒)。全チーム・全写真で使い回すプレースホルダー。
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const MISSION_DEFAULT_REWARD: Record<string, number> = { EASY: 10_000_000, NORMAL: 20_000_000, HARD: 30_000_000 };
const MISSION_DEFAULT_PENALTY: Record<string, number> = { EASY: 5_000_000, NORMAL: 10_000_000, HARD: 15_000_000 };
const REJECT_REASONS = ["写真がミッション内容と一致しません", "到着駅の証拠写真が不鮮明です", "指定の駅と違う場所で撮影されています"];

function minutesAfter(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}
function pick<T>(arr: T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

async function main() {
  const { data: event, error: eventError } = await admin.from("events").select("id, name, status").single();
  if (eventError || !event) throw eventError ?? new Error("イベントが見つかりません");

  const { data: teams, error: teamsError } = await admin
    .from("teams")
    .select("id, team_number, team_name")
    .eq("event_id", event.id)
    .order("team_number");
  if (teamsError) throw teamsError;
  if (!teams || teams.length === 0) throw new Error("チームが1件もありません(先にチームを作成してください)");

  const { data: stations, error: stationsError } = await admin
    .from("stations")
    .select("id, name")
    .eq("event_id", event.id);
  if (stationsError) throw stationsError;
  if (!stations || stations.length < 2) throw new Error("駅が2件未満です(既存の駅データが必要です)");

  const { data: missions } = await admin
    .from("station_missions")
    .select("id, station_id, difficulty, title, success_reward, failure_penalty")
    .in(
      "station_id",
      stations.map((s) => s.id)
    );
  const missionsByStation = new Map<string, NonNullable<typeof missions>>();
  for (const m of missions ?? []) {
    const list = missionsByStation.get(m.station_id) ?? [];
    list.push(m);
    missionsByStation.set(m.station_id, list);
  }

  const { data: cards } = await admin.from("cards").select("id, name").eq("enabled", true);

  const { data: destinationQueue } = await admin
    .from("destination_queue")
    .select("id, sequence_order, status")
    .eq("event_id", event.id)
    .in("status", ["PENDING", "ACTIVE"])
    .order("sequence_order")
    .limit(2);

  console.log(`イベント: ${event.name}(status=${event.status}, id=${event.id})`);
  console.log(`対象チーム: ${teams.length}組 (${teams.map((t) => t.team_name).join(", ")})`);
  console.log(`駅: ${stations.length}件 / ミッション: ${missions?.length ?? 0}件 / カード: ${cards?.length ?? 0}件`);
  if (event.status === "RUNNING") {
    console.log("⚠️ このイベントは status=RUNNING (進行中)です。本番進行中データに書き込む可能性があります。");
  }
  console.log("このイベントの全チームに振り返り確認用デモデータ(到着・ミッション・カード使用等)を投入します。");
  console.log("完了後は本部画面の「リハーサルリセット」でまとめて削除できます。");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("続行しますか? (yes と入力): ");
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("中止しました。");
    return;
  }

  console.log("プレースホルダー画像をアップロード中...");
  const demoPhotoPath = `${event.id}/_demo/placeholder.png`;
  const { error: uploadError } = await admin.storage
    .from(EVIDENCE_BUCKET)
    .upload(demoPhotoPath, PLACEHOLDER_PNG, { contentType: "image/png", upsert: true });
  if (uploadError) throw uploadError;

  const baseTime = new Date();
  baseTime.setHours(10, 0, 0, 0);

  for (let ti = 0; ti < teams.length; ti++) {
    const team = teams[ti];
    let coinBalance = 0;
    let clock = ti * 7; // チームごとに開始時刻をずらして時系列を重ならせすぎない
    let prevStation = pick(stations)!;

    console.log(`\n[${team.team_name}] 投入中...`);

    // 到着却下(本部差し戻し)を1件
    await admin.from("audit_log").insert({
      event_id: event.id,
      team_id: team.id,
      action_type: "ARRIVAL_REJECT",
      before_value: {},
      reason: pick(REJECT_REASONS),
      created_at: minutesAfter(baseTime, clock),
    });
    clock += 5;

    const TURNS = 3;
    let lastStationId = prevStation.id;
    for (let turnNumber = 1; turnNumber <= TURNS; turnNumber++) {
      const nextStation = pick(stations.filter((s) => s.id !== prevStation.id)) ?? stations[0];

      const { data: turn, error: turnError } = await admin
        .from("turns")
        .insert({
          team_id: team.id,
          turn_number: turnNumber,
          previous_station_id: prevStation.id,
          next_station_id: nextStation.id,
          status: "COMPLETED",
          created_at: minutesAfter(baseTime, clock),
          completed_at: minutesAfter(baseTime, clock + 20),
        })
        .select()
        .single();
      if (turnError) {
        console.error(`  turn${turnNumber} 作成失敗:`, turnError.message);
        prevStation = nextStation;
        lastStationId = nextStation.id;
        clock += 25;
        continue;
      }

      // 到着報告(承認済み+写真)
      const { data: arrival } = await admin
        .from("arrival_submissions")
        .insert({
          team_id: team.id,
          turn_id: turn.id,
          station_id: nextStation.id,
          status: "APPROVED",
          submitted_at: minutesAfter(baseTime, clock + 15),
          reviewed_at: minutesAfter(baseTime, clock + 18),
          idempotency_key: crypto.randomUUID(),
        })
        .select()
        .single();
      if (arrival) {
        await admin.from("arrival_photos").insert({ arrival_submission_id: arrival.id, storage_path: demoPhotoPath });
      }

      // ミッション(そのstationにミッションがあれば)
      const stationMissions = missionsByStation.get(nextStation.id) ?? [];
      if (stationMissions.length > 0) {
        const mission = pick(stationMissions)!;
        const success = Math.random() > 0.35;
        const reward = mission.success_reward ?? MISSION_DEFAULT_REWARD[mission.difficulty] ?? 10_000_000;
        const penalty = mission.failure_penalty ?? MISSION_DEFAULT_PENALTY[mission.difficulty] ?? 5_000_000;

        const { data: attempt } = await admin
          .from("team_mission_attempts")
          .insert({
            team_id: team.id,
            turn_id: turn.id,
            station_id: nextStation.id,
            offered_mission_ids: stationMissions.slice(0, 3).map((m) => m.id),
            selected_mission_id: mission.id,
            attempt_number: 1,
            status: success ? "SUCCESS" : "FAILURE",
            reviewed_at: minutesAfter(baseTime, clock + 25),
            created_at: minutesAfter(baseTime, clock + 20),
          })
          .select()
          .single();

        if (attempt) {
          await admin.from("mission_photos").insert({ mission_attempt_id: attempt.id, storage_path: demoPhotoPath });
          const amount = success ? reward : -penalty;
          await admin.from("coin_ledger").insert({
            event_id: event.id,
            team_id: team.id,
            amount,
            transaction_type: success ? "MISSION_SUCCESS" : "MISSION_FAILURE",
            related_mission_attempt_id: attempt.id,
            related_turn_id: turn.id,
            idempotency_key: crypto.randomUUID(),
            reason: mission.title,
            created_at: minutesAfter(baseTime, clock + 25),
          });
          coinBalance += amount;
        }
      }

      prevStation = nextStation;
      lastStationId = nextStation.id;
      clock += 30;
    }

    // ボーナスミッション1件
    {
      const success = Math.random() > 0.3;
      const reward = 15_000_000;
      const { data: bonusAttempt } = await admin
        .from("team_bonus_mission_attempts")
        .insert({
          team_id: team.id,
          turn_id: null,
          station_id: lastStationId,
          status: success ? "SUCCESS" : "FAILURE",
          reward: success ? reward : 0,
          title: "ボーナスチャレンジ(デモ)",
          description: "その場にいる本部スタッフとハイタッチしてください",
          reviewed_at: minutesAfter(baseTime, clock),
          created_at: minutesAfter(baseTime, clock - 5),
        })
        .select()
        .single();
      if (bonusAttempt) {
        await admin.from("bonus_mission_photos").insert({ bonus_attempt_id: bonusAttempt.id, storage_path: demoPhotoPath });
        if (success) {
          await admin.from("coin_ledger").insert({
            event_id: event.id,
            team_id: team.id,
            amount: reward,
            transaction_type: "MISSION_5X_BONUS",
            idempotency_key: crypto.randomUUID(),
            reason: "ボーナスチャレンジ(デモ)",
            created_at: minutesAfter(baseTime, clock),
          });
          coinBalance += reward;
        }
      }
      clock += 10;
    }

    // カード使用1件(他チームがいれば対象に)
    if (cards && cards.length > 0) {
      const card = pick(cards)!;
      const otherTeams = teams.filter((t) => t.id !== team.id);
      const target = otherTeams.length > 0 && Math.random() > 0.5 ? pick(otherTeams) : undefined;
      await admin.from("card_usage_log").insert({
        event_id: event.id,
        team_id: team.id,
        card_id: card.id,
        target_team_id: target?.id ?? null,
        idempotency_key: crypto.randomUUID(),
        result: "SUCCESS",
        effect_detail: {},
        used_at: minutesAfter(baseTime, clock),
      });
      clock += 5;
    }

    // ラッキーボーナス的なコイン増減1件
    {
      const amount = pick([30_000_000, 20_000_000, 10_000_000, -5_000_000])!;
      await admin.from("coin_ledger").insert({
        event_id: event.id,
        team_id: team.id,
        amount,
        transaction_type: amount > 0 ? "LUCKY_BONUS" : "LATE_PENALTY",
        idempotency_key: crypto.randomUUID(),
        reason: amount > 0 ? "ラッキーボーナス(デモ)" : "遅延ペナルティ(デモ)",
        created_at: minutesAfter(baseTime, clock),
      });
      coinBalance += amount;
      clock += 5;
    }

    // 最初のチームにだけボンビー付与イベントを1件
    if (ti === 0) {
      await admin.from("audit_log").insert({
        event_id: event.id,
        team_id: team.id,
        action_type: "BOMBII_ASSIGNED",
        after_value: { from_station: lastStationId },
        created_at: minutesAfter(baseTime, clock),
      });
      clock += 5;
    }

    await admin
      .from("team_state")
      .update({ coin_balance_cache: coinBalance, current_station_id: lastStationId })
      .eq("team_id", team.id);

    console.log(`  完了(資産額デモ値: ${coinBalance.toLocaleString()}円)`);
  }

  // ゴール到達を最大2チーム分(資産額にもボーナスを反映する)
  if (destinationQueue && destinationQueue.length > 0) {
    console.log("\nゴール到達デモを投入中...");
    const bonusAmount = 50_000_000;
    for (let i = 0; i < Math.min(2, destinationQueue.length, teams.length); i++) {
      const dq = destinationQueue[i];
      const team = teams[i];
      await admin
        .from("destination_queue")
        .update({
          status: "CLEARED",
          cleared_by_team_id: team.id,
          cleared_at: minutesAfter(baseTime, 200 + i * 5),
          bonus_coin_amount: bonusAmount,
        })
        .eq("id", dq.id);
      await admin.from("coin_ledger").insert({
        event_id: event.id,
        team_id: team.id,
        amount: bonusAmount,
        transaction_type: "DESTINATION_BONUS",
        idempotency_key: crypto.randomUUID(),
        reason: "最終目的地到達ボーナス(デモ)",
        created_at: minutesAfter(baseTime, 200 + i * 5),
      });
      const { data: ts } = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team.id).single();
      await admin
        .from("team_state")
        .update({ coin_balance_cache: (ts?.coin_balance_cache ?? 0) + bonusAmount })
        .eq("team_id", team.id);
      console.log(`  第${dq.sequence_order}ゴール → ${team.team_name}`);
    }
  } else {
    console.log("\n(destination_queueが未設定のため、ゴール到達デモはスキップしました)");
  }

  console.log("\n投入完了。/retrospective で確認してください。");
  console.log("片付けは 本部画面 → 「リハーサルリセット」 でまとめて削除できます。");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
