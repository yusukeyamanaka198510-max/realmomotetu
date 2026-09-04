import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/game/actor";
import { createClient } from "@/lib/supabase/server";
import { ArrivalReviewQueue } from "./ArrivalReviewQueue";
import { MissionReviewQueue } from "./MissionReviewQueue";
import { EventControlPanel } from "./EventControlPanel";
import { TeamAdminPanel } from "./TeamAdminPanel";
import { DestinationQueuePanel } from "./DestinationQueuePanel";
import { BonusMissionReviewQueue } from "./BonusMissionReviewQueue";
import { CardUsageLogPanel } from "./CardUsageLogPanel";
import { LeaderboardSnapshotPanel } from "./LeaderboardSnapshotPanel";
import { PasswordChangePanel } from "@/components/PasswordChangePanel";

export default async function StaffPage() {
  const actor = await getActor();
  if (actor.kind !== "staff") redirect("/login");

  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, name, status, start_at, end_at, time_limit_minutes, default_destination_bonus_amount, leaderboard_hide_minutes_before_end, obstruction_cooldown_seconds, active_destination_station_id, active_destination:active_destination_station_id(name), dividend_interval_minutes, last_dividend_run_at"
    )
    .eq("id", actor.eventId)
    .single();

  const { data: teams } = await supabase
    .from("teams")
    .select(
      "id, team_number, team_name, representative_name, team_state(state, current_station_id, coin_balance_cache, is_paused, updated_at, current_station:current_station_id(name))"
    )
    .eq("event_id", actor.eventId)
    .order("team_number");

  const { data: stations } = await supabase
    .from("stations")
    .select("id, name, is_destination_candidate")
    .eq("event_id", actor.eventId)
    .order("name");

  const { data: destinationHistory } = await supabase
    .from("destination_queue")
    .select("id, sequence_order, bonus_coin_amount, cleared_at, station:station_id(name), team:cleared_by_team_id(team_name)")
    .eq("event_id", actor.eventId)
    .eq("status", "CLEARED")
    .order("sequence_order", { ascending: false });

  const { data: queueRows } = await supabase
    .from("review_queue")
    .select("id, ref_id, team_id, created_at, teams:team_id(team_name)")
    .eq("event_id", actor.eventId)
    .eq("type", "ARRIVAL")
    .eq("status", "OPEN")
    .order("created_at");

  const refIds = (queueRows ?? []).map((r) => r.ref_id);
  const { data: arrivalRows } = refIds.length
    ? await supabase
        .from("arrival_submissions")
        .select("id, submitted_at, station:station_id(name), arrival_photos(id, storage_path)")
        .in("id", refIds)
    : { data: [] };

  const pendingArrivals = (queueRows ?? []).map((r) => ({
    ...r,
    arrival_submissions: arrivalRows?.find((a) => a.id === r.ref_id) ?? null,
  }));

  const { data: missionQueueRows } = await supabase
    .from("review_queue")
    .select("id, ref_id, team_id, created_at, teams:team_id(team_name)")
    .eq("event_id", actor.eventId)
    .eq("type", "MISSION")
    .eq("status", "OPEN")
    .order("created_at");

  const missionRefIds = (missionQueueRows ?? []).map((r) => r.ref_id);
  const { data: missionAttemptRows } = missionRefIds.length
    ? await supabase
        .from("team_mission_attempts")
        .select(
          "id, attempt_number, selected_mission_id, mission:selected_mission_id(title, description), mission_photos(id, storage_path)"
        )
        .in("id", missionRefIds)
    : { data: [] };

  const pendingMissions = (missionQueueRows ?? []).map((r) => ({
    ...r,
    team_mission_attempts: missionAttemptRows?.find((a) => a.id === r.ref_id) ?? null,
  }));

  const { data: bonusMissionQueueRows } = await supabase
    .from("review_queue")
    .select("id, ref_id, team_id, created_at, teams:team_id(team_name)")
    .eq("event_id", actor.eventId)
    .eq("type", "BONUS_MISSION")
    .eq("status", "OPEN")
    .order("created_at");

  const bonusMissionRefIds = (bonusMissionQueueRows ?? []).map((r) => r.ref_id);
  const { data: bonusMissionAttemptRows } = bonusMissionRefIds.length
    ? await supabase
        .from("team_bonus_mission_attempts")
        .select("id, reward, title, description, bonus_mission_photos(id, storage_path)")
        .in("id", bonusMissionRefIds)
    : { data: [] };

  const pendingBonusMissions = (bonusMissionQueueRows ?? []).map((r) => ({
    ...r,
    team_bonus_mission_attempts: bonusMissionAttemptRows?.find((a) => a.id === r.ref_id) ?? null,
  }));

  const { data: allCards } = await supabase.from("cards").select("id, card_code, name, category, rarity").order("category").order("rarity");
  const { data: allTeamCards } = await supabase
    .from("team_cards")
    .select("team_id, quantity, card:card_id(card_code, name)")
    .gt("quantity", 0);
  const { data: allActiveEffects } = await supabase
    .from("card_active_effects")
    .select("id, team_id, effect_type, remaining_uses, created_at, source_team_id")
    .eq("event_id", actor.eventId)
    .is("consumed_at", null)
    .order("created_at", { ascending: false });
  const { data: recentUsageLog } = await supabase
    .from("card_usage_log")
    .select("id, used_at, result, card:card_id(name), team:team_id(team_name), target_team:target_team_id(team_name)")
    .eq("event_id", actor.eventId)
    .order("used_at", { ascending: false })
    .limit(30);

  const pendingCountByTeam = new Map<string, number>();
  for (const r of [...(queueRows ?? []), ...(missionQueueRows ?? []), ...(bonusMissionQueueRows ?? [])]) {
    pendingCountByTeam.set(r.team_id, (pendingCountByTeam.get(r.team_id) ?? 0) + 1);
  }

  // eslint-disable-next-line react-hooks/purity -- サーバーレンダリング時点の経過時間表示のため
  const nowMsForStaff = Date.now();
  const STUCK_THRESHOLD_MS = 20 * 60 * 1000;

  const teamRows = (teams ?? []).map((t) => {
    // @ts-expect-error 1:1リレーションが配列型で推論されるため
    const ts = t.team_state as {
      state: string; coin_balance_cache: number; is_paused: boolean; updated_at: string; current_station: { name: string } | null;
    } | null;
    const updatedAgoMs = ts?.updated_at ? nowMsForStaff - new Date(ts.updated_at).getTime() : null;
    const pendingCount = pendingCountByTeam.get(t.id) ?? 0;
    const isStuck = !ts?.is_paused && updatedAgoMs !== null && updatedAgoMs > STUCK_THRESHOLD_MS && !["WAITING"].includes(ts?.state ?? "");
    return {
      id: t.id,
      team_name: t.team_name,
      representative_name: t.representative_name,
      state: ts?.state ?? "WAITING",
      coin_balance_cache: ts?.coin_balance_cache ?? 0,
      currentStationName: ts?.current_station?.name ?? "-",
      isPaused: ts?.is_paused ?? false,
      updatedAgoMinutes: updatedAgoMs !== null ? Math.floor(updatedAgoMs / 60000) : null,
      pendingCount,
      isStuck,
      cards: (allTeamCards ?? [])
        .filter((c) => c.team_id === t.id)
        // @ts-expect-error 1:1リレーションが配列型で推論されるため
        .map((c) => ({ card_code: c.card?.card_code ?? "", name: c.card?.name ?? "", quantity: c.quantity })),
      activeEffects: (allActiveEffects ?? []).filter((e) => e.team_id === t.id),
    };
  });
  const maxCoin = teamRows.length ? Math.max(...teamRows.map((t) => t.coin_balance_cache)) : null;
  const topTeams = maxCoin !== null ? teamRows.filter((t) => t.coin_balance_cache === maxCoin) : [];

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">本部ダッシュボード({actor.displayName})</h1>
        <div className="flex gap-4">
          <Link href="/staff/manage" className="text-sm text-zinc-500 hover:underline">
            駅・路線・ミッション管理 →
          </Link>
          <Link href="/staff/audit" className="text-sm text-zinc-500 hover:underline">
            Audit Log →
          </Link>
        </div>
      </div>

      <PasswordChangePanel />

      {event && <EventControlPanel event={event} topTeams={topTeams} />}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">No</th>
              <th>チーム名</th>
              <th>代表者</th>
              <th>現在地</th>
              <th>state</th>
              <th>コイン</th>
              <th>最終操作</th>
              <th>承認待ち</th>
              <th>状況</th>
            </tr>
          </thead>
          <tbody>
            {teamRows.map((t, i) => {
              const highlight = t.state === "ARRIVAL_REVIEW" || t.state === "MISSION_REVIEW";
              return (
                <tr
                  key={t.id}
                  className={`border-b ${t.isStuck ? "bg-red-50 dark:bg-red-950" : highlight ? "bg-amber-50 dark:bg-amber-950" : ""}`}
                >
                  <td className="py-2">{i + 1}</td>
                  <td>{t.team_name}</td>
                  <td className="text-zinc-500">{t.representative_name ?? "-"}</td>
                  <td>{t.currentStationName}</td>
                  <td className={highlight ? "font-semibold" : ""}>{t.state}</td>
                  <td>{t.coin_balance_cache.toLocaleString()}</td>
                  <td>{t.updatedAgoMinutes !== null ? `${t.updatedAgoMinutes}分前` : "-"}</td>
                  <td>{t.pendingCount > 0 ? <span className="font-semibold text-amber-700 dark:text-amber-400">{t.pendingCount}件</span> : "-"}</td>
                  <td>
                    {t.isPaused && <span className="rounded bg-zinc-500 px-1.5 py-0.5 text-xs text-white">一時停止</span>}
                    {t.isStuck && <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-xs text-white">要確認</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-zinc-400">「要確認」は20分以上操作がないチーム(一時停止中を除く)。目安なので実際の状況は個別に確認してください。</p>

      <h2 className="mt-8 text-lg font-semibold">到着確認待ち</h2>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ArrivalReviewQueue eventId={actor.eventId} initialItems={(pendingArrivals as any) ?? []} />

      <h2 className="mt-8 text-lg font-semibold">ミッション判定待ち</h2>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <MissionReviewQueue eventId={actor.eventId} initialItems={(pendingMissions as any) ?? []} />

      {event && (
        <DestinationQueuePanel
          // @ts-expect-error 1:1リレーションが配列型で推論されるため
          activeStationName={event.active_destination?.name ?? null}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          history={(destinationHistory as any) ?? []}
          stations={stations ?? []}
          defaultBonus={event.default_destination_bonus_amount}
        />
      )}

      <h2 className="mt-8 text-lg font-semibold">ボーナスミッション判定待ち</h2>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <BonusMissionReviewQueue eventId={actor.eventId} initialItems={(pendingBonusMissions as any) ?? []} />

      <TeamAdminPanel teams={teamRows} stations={stations ?? []} allCards={allCards ?? []} />

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <CardUsageLogPanel logs={(recentUsageLog as any) ?? []} />

      <LeaderboardSnapshotPanel />
    </div>
  );
}
