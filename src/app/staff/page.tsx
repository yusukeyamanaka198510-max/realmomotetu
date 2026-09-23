import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/game/actor";
import { createClient } from "@/lib/supabase/server";
import { ArrivalReviewQueue } from "./ArrivalReviewQueue";
import { StartCheckinReviewQueue } from "./StartCheckinReviewQueue";
import { MissionReviewQueue } from "./MissionReviewQueue";
import { EventControlPanel } from "./EventControlPanel";
import { TeamAdminPanel } from "./TeamAdminPanel";
import { DestinationQueuePanel } from "./DestinationQueuePanel";
import { BonusMissionReviewQueue } from "./BonusMissionReviewQueue";
import { AdminActionLogPanel } from "./AdminActionLogPanel";
import { LeaderboardSnapshotPanel } from "./LeaderboardSnapshotPanel";
import { PasswordChangePanel } from "@/components/PasswordChangePanel";
import { StaffSection } from "./StaffUI";
import { CardEnabledPanel } from "./CardEnabledPanel";
import { RehearsalResetPanel } from "./RehearsalResetPanel";

export default async function StaffPage() {
  const actor = await getActor();
  if (actor.kind !== "staff") redirect("/login");

  const supabase = await createClient();

  // 以前は15件以上のクエリを1つずつawaitしており、ダッシュボード自体の表示・他ページへの
  // 遷移前のレンダリングが毎回待たされる原因になっていた。互いに依存しないものは並列化する。
  const [
    { data: event },
    { data: teams },
    { data: stations },
    { data: connectedStations },
    { data: destinationHistory },
    { data: queueRows },
    { data: startCheckinQueueRows },
    { data: missionQueueRows },
    { data: bonusMissionQueueRows },
    { data: allCards },
    { data: allTeamCards },
    { data: allPropertyPurchases },
    { data: allActiveEffects },
    { data: recentUsageLog },
    { data: recentLedger },
  ] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, name, status, start_at, end_at, time_limit_minutes, default_destination_bonus_amount, leaderboard_hide_minutes_before_end, obstruction_cooldown_seconds, active_destination_station_id, active_destination:active_destination_station_id(name), dividend_interval_minutes, dividend_scheduled_times, last_dividend_run_at, scheduled_start_at, auto_start_enabled, auto_start_time_limit_minutes, auto_start_end_at, leaderboard_snapshot_interval_minutes, last_leaderboard_snapshot_at, start_station_id, start_station:start_station_id(name), min_destination_distance_hops"
      )
      .eq("id", actor.eventId)
      .single(),
    supabase
      .from("teams")
      .select(
        "id, team_number, team_name, representative_name, team_state(state, current_station_id, coin_balance_cache, is_paused, updated_at, current_station:current_station_id(name))"
      )
      .eq("event_id", actor.eventId)
      .order("team_number"),
    supabase.from("stations").select("id, name, is_destination_candidate").eq("event_id", actor.eventId).order("name"),
    // 有効な接続(edge)を1本も持たない孤立駅を、現在駅/次駅の手動補正・デフォルトスタート駅・
    // ゴール手動設定の各プルダウンから除外する(選ぶと即詰みになるため)。
    supabase.rpc("fn_list_connected_stations"),
    supabase
      .from("destination_queue")
      .select("id, sequence_order, bonus_coin_amount, cleared_at, station:station_id(name), team:cleared_by_team_id(team_name)")
      .eq("event_id", actor.eventId)
      .eq("status", "CLEARED")
      .order("sequence_order", { ascending: false }),
    supabase
      .from("review_queue")
      .select("id, ref_id, team_id, created_at, teams:team_id(team_name)")
      .eq("event_id", actor.eventId)
      .eq("type", "ARRIVAL")
      .eq("status", "OPEN")
      .order("created_at"),
    supabase
      .from("review_queue")
      .select("id, ref_id, team_id, created_at, teams:team_id(team_name)")
      .eq("event_id", actor.eventId)
      .eq("type", "START_CHECKIN")
      .eq("status", "OPEN")
      .order("created_at"),
    supabase
      .from("review_queue")
      .select("id, ref_id, team_id, created_at, teams:team_id(team_name)")
      .eq("event_id", actor.eventId)
      .eq("type", "MISSION")
      .eq("status", "OPEN")
      .order("created_at"),
    supabase
      .from("review_queue")
      .select("id, ref_id, team_id, created_at, teams:team_id(team_name)")
      .eq("event_id", actor.eventId)
      .eq("type", "BONUS_MISSION")
      .eq("status", "OPEN")
      .order("created_at"),
    supabase.from("cards").select("id, card_code, name, category, rarity, enabled").order("category").order("rarity"),
    supabase.from("team_cards").select("team_id, quantity, card:card_id(card_code, name)").gt("quantity", 0),
    // ⑧ 順位・優勝判定がコイン残高だけで計算され、保有不動産の価値が一切反映されて
    // いなかったため、物件に投資するほど順位が下がって見える不具合があった。
    supabase.from("team_property_purchases").select("team_id, price_paid").eq("settled", false),
    supabase
      .from("card_active_effects")
      .select("id, team_id, effect_type, remaining_uses, created_at, source_team_id")
      .eq("event_id", actor.eventId)
      .is("consumed_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("card_usage_log")
      .select("id, used_at, result, announced_at, card:card_id(name), team:team_id(team_name), target_team:target_team_id(team_name)")
      .eq("event_id", actor.eventId)
      .is("hidden_from_log_at", null)
      .order("used_at", { ascending: false })
      .limit(30),
    supabase
      .from("coin_ledger")
      .select("id, amount, transaction_type, reason, created_at, announced_at, team:team_id(team_name)")
      .eq("event_id", actor.eventId)
      .is("hidden_from_log_at", null)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const connectedStationIds = new Set((connectedStations ?? []).map((s: { id: string }) => s.id));
  const reachableStations = (stations ?? []).filter((s) => connectedStationIds.has(s.id));

  const refIds = (queueRows ?? []).map((r) => r.ref_id);
  const startCheckinRefIds = (startCheckinQueueRows ?? []).map((r) => r.ref_id);
  const missionRefIds = (missionQueueRows ?? []).map((r) => r.ref_id);
  const bonusMissionRefIds = (bonusMissionQueueRows ?? []).map((r) => r.ref_id);

  const [{ data: arrivalRows }, { data: startCheckinRows }, { data: missionAttemptRows }, { data: bonusMissionAttemptRows }] =
    await Promise.all([
      refIds.length
        ? supabase
            .from("arrival_submissions")
            .select("id, submitted_at, station:station_id(name), arrival_photos(id, storage_path)")
            .in("id", refIds)
        : Promise.resolve({ data: [] as { id: string }[] }),
      startCheckinRefIds.length
        ? supabase
            .from("team_start_checkins")
            .select("id, submitted_at, station:station_id(name), start_checkin_photos(id, storage_path)")
            .in("id", startCheckinRefIds)
        : Promise.resolve({ data: [] as { id: string }[] }),
      missionRefIds.length
        ? supabase
            .from("team_mission_attempts")
            .select(
              "id, attempt_number, selected_mission_id, mission:selected_mission_id(title, description), mission_photos(id, storage_path)"
            )
            .in("id", missionRefIds)
        : Promise.resolve({ data: [] as { id: string }[] }),
      bonusMissionRefIds.length
        ? supabase
            .from("team_bonus_mission_attempts")
            .select("id, reward, title, description, bonus_mission_photos(id, storage_path)")
            .in("id", bonusMissionRefIds)
        : Promise.resolve({ data: [] as { id: string }[] }),
    ]);

  const pendingArrivals = (queueRows ?? []).map((r) => ({
    ...r,
    arrival_submissions: arrivalRows?.find((a) => a.id === r.ref_id) ?? null,
  }));
  const pendingStartCheckins = (startCheckinQueueRows ?? []).map((r) => ({
    ...r,
    team_start_checkins: startCheckinRows?.find((c) => c.id === r.ref_id) ?? null,
  }));
  const pendingMissions = (missionQueueRows ?? []).map((r) => ({
    ...r,
    team_mission_attempts: missionAttemptRows?.find((a) => a.id === r.ref_id) ?? null,
  }));
  const pendingBonusMissions = (bonusMissionQueueRows ?? []).map((r) => ({
    ...r,
    team_bonus_mission_attempts: bonusMissionAttemptRows?.find((a) => a.id === r.ref_id) ?? null,
  }));

  const pendingCountByTeam = new Map<string, number>();
  for (const r of [...(queueRows ?? []), ...(missionQueueRows ?? []), ...(bonusMissionQueueRows ?? []), ...(startCheckinQueueRows ?? [])]) {
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
    const coinBalance = ts?.coin_balance_cache ?? 0;
    const propertyAssetTotal = (allPropertyPurchases ?? [])
      .filter((p) => p.team_id === t.id)
      .reduce((sum, p) => sum + p.price_paid, 0);
    return {
      id: t.id,
      team_name: t.team_name,
      representative_name: t.representative_name,
      state: ts?.state ?? "WAITING",
      coin_balance_cache: coinBalance,
      totalAssets: coinBalance + propertyAssetTotal,
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
  const maxAssets = teamRows.length ? Math.max(...teamRows.map((t) => t.totalAssets)) : null;
  const topTeams = maxAssets !== null ? teamRows.filter((t) => t.totalAssets === maxAssets) : [];

  const totalPending = pendingArrivals.length + pendingMissions.length + pendingBonusMissions.length + pendingStartCheckins.length;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          本部ダッシュボード({actor.displayName})
          {totalPending > 0 && (
            <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 align-middle text-xs font-bold text-white">
              承認待ち {totalPending}件
            </span>
          )}
        </h1>
        <div className="flex gap-4">
          <Link href="/retrospective" className="text-sm text-zinc-500 hover:underline">
            振り返り →
          </Link>
          <Link href="/staff/manage" className="text-sm text-zinc-500 hover:underline">
            駅・路線・ミッション管理 →
          </Link>
          <Link href="/staff/audit" className="text-sm text-zinc-500 hover:underline">
            Audit Log →
          </Link>
        </div>
      </div>

      {/* 触る頻度の高い操作(承認キュー)を上位に、開始/終了などの設定系は下に配置している。 */}

      <StaffSection icon="🚉" title="スタートチェックイン確認待ち" count={pendingStartCheckins.length} accent="sky">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <StartCheckinReviewQueue eventId={actor.eventId} initialItems={(pendingStartCheckins as any) ?? []} />
      </StaffSection>

      <StaffSection icon="🚩" title="到着確認待ち" count={pendingArrivals.length} accent="amber">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ArrivalReviewQueue eventId={actor.eventId} initialItems={(pendingArrivals as any) ?? []} />
      </StaffSection>

      <StaffSection icon="🎯" title="ミッション判定待ち" count={pendingMissions.length} accent="sky">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <MissionReviewQueue eventId={actor.eventId} initialItems={(pendingMissions as any) ?? []} />
      </StaffSection>

      <StaffSection icon="✨" title="ボーナスミッション判定待ち" count={pendingBonusMissions.length} accent="fuchsia">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <BonusMissionReviewQueue eventId={actor.eventId} initialItems={(pendingBonusMissions as any) ?? []} />
      </StaffSection>

      {event && (
        <StaffSection icon="🏁" title="最終目的地(ゴール)" accent="indigo">
          <DestinationQueuePanel
            // @ts-expect-error 1:1リレーションが配列型で推論されるため
            activeStationName={event.active_destination?.name ?? null}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            history={(destinationHistory as any) ?? []}
            stations={reachableStations}
            defaultBonus={event.default_destination_bonus_amount}
          />
        </StaffSection>
      )}

      <StaffSection icon="📋" title="チーム一覧・状況" accent="zinc">
        <div className="overflow-x-auto">
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
      </StaffSection>

      <StaffSection icon="🛠️" title="チーム個別操作" accent="zinc">
        <TeamAdminPanel teams={teamRows} stations={reachableStations} allCards={allCards ?? []} />
      </StaffSection>

      <StaffSection icon="🎴" title="採用カード選択" accent="zinc">
        <CardEnabledPanel cards={allCards ?? []} />
      </StaffSection>

      <StaffSection icon="🔄" title="リハーサルリセット" accent="red">
        <RehearsalResetPanel />
      </StaffSection>

      <StaffSection icon="⚙️" title="イベント制御(開始/終了/各種設定)" accent="zinc">
        <PasswordChangePanel />
        {event && (
          <EventControlPanel
            event={event}
            topTeams={topTeams}
            stations={reachableStations}
            // @ts-expect-error 1:1リレーションが配列型で推論されるため
            startStationName={event.start_station?.name ?? null}
          />
        )}
      </StaffSection>

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <AdminActionLogPanel ledger={(recentLedger as any) ?? []} cardLog={(recentUsageLog as any) ?? []} />

      {event && (
        <LeaderboardSnapshotPanel
          intervalMinutes={event.leaderboard_snapshot_interval_minutes}
          lastSnapshotAt={event.last_leaderboard_snapshot_at}
        />
      )}
    </div>
  );
}
