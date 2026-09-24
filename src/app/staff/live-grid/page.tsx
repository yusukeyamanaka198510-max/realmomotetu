import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/game/actor";
import { createClient } from "@/lib/supabase/server";
import { LiveGridClient, type LiveGridTeam } from "./LiveGridClient";
import { LineMap } from "./LineMap";

export default async function LiveGridPage() {
  const actor = await getActor();
  if (actor.kind !== "staff") redirect("/login");

  const supabase = await createClient();

  const [{ data: teams }, { data: allPropertyPurchases }, { data: stations }, { data: edges }] = await Promise.all([
    supabase
      .from("teams")
      .select(
        "id, team_number, team_name, team_state(state, current_station_id, coin_balance_cache, has_bombii, is_paused, updated_at, current_station:current_station_id(name))"
      )
      .eq("event_id", actor.eventId)
      .order("team_number"),
    supabase.from("team_property_purchases").select("team_id, price_paid").eq("settled", false),
    supabase.from("stations").select("id, name").eq("event_id", actor.eventId).order("name"),
    supabase.from("edges").select("station_a_id, station_b_id, line_id").eq("event_id", actor.eventId).eq("is_active", true),
  ]);

  // eslint-disable-next-line react-hooks/purity -- サーバーレンダリング時点の経過時間表示のため
  const nowMs = Date.now();
  const STUCK_THRESHOLD_MS = 20 * 60 * 1000;

  const teamRows: LiveGridTeam[] = (teams ?? []).map((t) => {
    // @ts-expect-error 1:1リレーションが配列型で推論されるため
    const ts = t.team_state as {
      state: string;
      current_station_id: string | null;
      coin_balance_cache: number;
      has_bombii: boolean;
      is_paused: boolean;
      updated_at: string;
      current_station: { name: string } | null;
    } | null;
    const updatedAgoMs = ts?.updated_at ? nowMs - new Date(ts.updated_at).getTime() : null;
    const propertyAssetTotal = (allPropertyPurchases ?? [])
      .filter((p) => p.team_id === t.id)
      .reduce((sum, p) => sum + p.price_paid, 0);
    const coinBalance = ts?.coin_balance_cache ?? 0;
    const isStuck = !ts?.is_paused && updatedAgoMs !== null && updatedAgoMs > STUCK_THRESHOLD_MS && ts?.state !== "WAITING";
    return {
      id: t.id,
      teamNumber: t.team_number,
      teamName: t.team_name,
      state: (ts?.state ?? "WAITING") as LiveGridTeam["state"],
      currentStationId: ts?.current_station_id ?? null,
      currentStationName: ts?.current_station?.name ?? "-",
      coinBalance,
      totalAssets: coinBalance + propertyAssetTotal,
      hasBombii: ts?.has_bombii ?? false,
      isPaused: ts?.is_paused ?? false,
      isStuck,
      updatedAgoMinutes: updatedAgoMs !== null ? Math.floor(updatedAgoMs / 60000) : null,
    };
  });

  const teamsByStation: Record<string, { teamNumber: number; teamName: string }[]> = {};
  for (const t of teamRows) {
    if (!t.currentStationId) continue;
    (teamsByStation[t.currentStationId] ??= []).push({ teamNumber: t.teamNumber, teamName: t.teamName });
  }

  return (
    <div className="min-h-dvh bg-zinc-50 p-4 dark:bg-zinc-950">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">🖥️ 全チーム一覧(大画面用)</h1>
        <Link href="/staff" className="text-sm text-zinc-500 hover:underline">
          ← ダッシュボードに戻る
        </Link>
      </div>
      <LiveGridClient eventId={actor.eventId} teams={teamRows} />
      <LineMap stations={stations ?? []} edges={edges ?? []} teamsByStation={teamsByStation} />
    </div>
  );
}
