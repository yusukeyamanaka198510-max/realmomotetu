"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type LeaderboardRow = { rank: number; coin_balance_cache: number; team_name: string | null; is_mine: boolean };
type GoalRow = { sequence_order: number; station_name: string; team_name: string | null; cleared_at: string };

const RANK_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function Leaderboard({ eventId }: { eventId: string }) {
  const [visible, setVisible] = useState(true);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [myRankDelta, setMyRankDelta] = useState<"up" | "down" | null>(null);
  const prevMyRankRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: lb }, { data: goalData }] = await Promise.all([
      supabase.rpc("fn_get_leaderboard"),
      supabase.rpc("fn_get_goal_achievements"),
    ]);
    if (lb) {
      setVisible(lb.visible);
      const newRows: LeaderboardRow[] = lb.rows ?? [];
      setRows(newRows);
      const mine = newRows.find((r) => r.is_mine);
      if (mine) {
        const prev = prevMyRankRef.current;
        if (prev !== null && prev !== mine.rank) {
          setMyRankDelta(mine.rank < prev ? "up" : "down");
          setTimeout(() => setMyRankDelta(null), 2400);
        }
        prevMyRankRef.current = mine.rank;
      }
    }
    if (goalData) {
      setGoals(goalData.rows ?? []);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初回マウント時のデータ取得
    load();
    const supabase = createClient();
    const channel = supabase
      .channel(`leaderboard:${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_state", filter: `event_id=eq.${eventId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "destination_queue", filter: `event_id=eq.${eventId}` }, load)
      .subscribe();
    const interval = setInterval(load, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [eventId, load]);

  if (!visible) {
    return (
      <div className="mt-6 rounded border border-zinc-200 p-4 text-center text-sm text-zinc-500 dark:border-zinc-800">
        まもなく終了のため、ランキング・ゴール到達状況の表示は終了しました
      </div>
    );
  }

  const maxCoin = Math.max(1, ...rows.map((r) => r.coin_balance_cache));

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">順位(コイン)</h2>
          {myRankDelta && (
            <span
              className={`animate-[rank-pop_0.5s_ease-out] rounded-full px-2 py-0.5 text-xs font-bold ${
                myRankDelta === "up"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
                  : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
              }`}
            >
              {myRankDelta === "up" ? "▲ 順位アップ!" : "▼ 順位ダウン"}
            </span>
          )}
        </div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {rows.map((r, i) => {
            const barPct = Math.max(4, Math.round((r.coin_balance_cache / maxCoin) * 100));
            return (
              <li
                key={`${r.rank}-${i}`}
                className={`relative overflow-hidden rounded-lg px-3 py-2 transition-transform ${
                  r.is_mine
                    ? "scale-[1.02] bg-amber-100 font-semibold ring-1 ring-amber-400 dark:bg-amber-950 dark:ring-amber-600"
                    : "bg-zinc-50 dark:bg-zinc-800/60"
                }`}
              >
                <div
                  className={`absolute inset-y-0 left-0 ${r.is_mine ? "bg-amber-200/70 dark:bg-amber-800/50" : "bg-zinc-200/70 dark:bg-zinc-700/50"}`}
                  style={{ width: `${barPct}%` }}
                />
                <div className="relative flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className={r.rank <= 3 ? "text-base" : "text-xs text-zinc-400"}>
                      {RANK_MEDAL[r.rank] ?? `${r.rank}位`}
                    </span>
                    {r.is_mine && r.team_name ? `${r.team_name}(あなた)` : r.rank <= 3 ? `${r.rank}位` : ""}
                  </span>
                  <span className="font-mono tabular-nums">{r.coin_balance_cache.toLocaleString()} コイン</span>
                </div>
              </li>
            );
          })}
        </ul>
        <style>{`
          @keyframes rank-pop {
            0% { opacity: 0; transform: scale(0.8); }
            60% { opacity: 1; transform: scale(1.08); }
            100% { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>

      {goals.length > 0 && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-bold">ゴール到達状況</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {goals.map((g) => (
              <li key={g.sequence_order} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
                <span className="text-zinc-600 dark:text-zinc-300">
                  🚩第{g.sequence_order}ゴール<span className="text-zinc-400">({g.station_name})</span>
                </span>
                <span className="font-semibold">{g.team_name ?? "-"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
