"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GameBadge, GamePanel } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";

type LeaderboardRow = { rank: number; coin_balance_cache: number; team_name: string | null; is_mine: boolean };
type GoalRow = { sequence_order: number; station_name: string; team_name: string | null; cleared_at: string };

const RANK_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function Leaderboard({ eventId }: { eventId: string }) {
  const [visible, setVisible] = useState(true);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [myRankDelta, setMyRankDelta] = useState<"up" | "down" | null>(null);
  const prevMyRankRef = useRef<number | null>(null);
  const myRowRef = useRef<HTMLLIElement | null>(null);
  const prevMyRowTopRef = useRef<number | null>(null);

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

  // 自チームの行が順位変動でDOM上の位置を変えた瞬間、旧位置からのオフセットを一旦適用してから
  // transform:none へアニメーションさせる(FLIP)。動いたことを視覚的に伝えるための演出のみで、
  // 順位データそのものには一切影響しない。
  useLayoutEffect(() => {
    const el = myRowRef.current;
    if (!el) return;
    const newTop = el.getBoundingClientRect().top;
    if (prevMyRowTopRef.current !== null) {
      const delta = prevMyRowTopRef.current - newTop;
      if (delta !== 0) {
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 450ms cubic-bezier(0.34, 1.56, 0.64, 1)";
          el.style.transform = "translateY(0)";
        });
      }
    }
    prevMyRowTopRef.current = newTop;
  }, [rows]);

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
      <GamePanel title="順位(資産額)" icon="🏆" accent="gold">
        {myRankDelta && (
          <div className="mb-2 flex justify-end">
            <span className={myRankDelta === "up" ? "anim-pop" : "anim-shake"}>
              <GameBadge tone={myRankDelta === "up" ? "green" : "red"}>
                {myRankDelta === "up" ? "▲ 順位アップ!" : "▼ 順位ダウン"}
              </GameBadge>
            </span>
          </div>
        )}
        <ul className="space-y-1.5 text-sm">
          {rows.map((r, i) => {
            const barPct = Math.max(4, Math.round((r.coin_balance_cache / maxCoin) * 100));
            return (
              <li
                key={r.is_mine ? "mine" : `other-${i}`}
                ref={r.is_mine ? myRowRef : undefined}
                className={`relative overflow-hidden rounded-xl px-3 py-2 ${
                  r.is_mine
                    ? `scale-[1.02] bg-amber-100 font-semibold ring-2 ring-game-gold dark:bg-amber-950 dark:ring-amber-600 ${
                        myRankDelta ? "shadow-[0_0_16px_rgba(245,166,35,0.7)]" : ""
                      }`
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
                  <span className="font-mono tabular-nums text-game-gold">{formatYen(r.coin_balance_cache)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </GamePanel>

      {goals.length > 0 && (
        <GamePanel title="ゴール到達状況" icon="🚩" accent="navy">
          <ul className="space-y-1.5 text-sm">
            {goals.map((g) => (
              <li key={g.sequence_order} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
                <span className="text-zinc-600 dark:text-zinc-300">
                  🚩第{g.sequence_order}ゴール<span className="text-zinc-400">({g.station_name})</span>
                </span>
                <span className="font-bold">{g.team_name ?? "-"}</span>
              </li>
            ))}
          </ul>
        </GamePanel>
      )}
    </div>
  );
}
