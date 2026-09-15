"use client";

import { useEffect, useState } from "react";
import { ConfettiBurst, SparkleField } from "@/components/game-ui";
import { isOverlayShown, markOverlayShown } from "./notificationOverlayStorage";

type Notif = { id: string; message: string; created_at: string };

function parseGoalBroadcast(message: string): { teamName: string; station: string; nextStation: string } | null {
  const match = /^🏁 (.+?)がゴールの「(.+?)」に到着しました!次のゴールは「(.+?)」です!$/.exec(message);
  if (!match) return null;
  return { teamName: match[1], station: match[2], nextStation: match[3] };
}

const NAMESPACE = "goal_broadcast";

export function GoalBroadcastOverlay({ notifications }: { notifications: Notif[] }) {
  const [active, setActive] = useState<{ teamName: string; station: string; nextStation: string } | null>(null);

  const latest = notifications.find((n) => parseGoalBroadcast(n.message) && !isOverlayShown(NAMESPACE, n.id)) ?? null;
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (!latestId) return;
    const parsed = latest ? parseGoalBroadcast(latest.message) : null;
    if (!parsed) return;

    markOverlayShown(NAMESPACE, latestId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着ゴール到達通知検知に応じた意図的な演出開始
    setActive(parsed);
    const dismissTimer = setTimeout(() => setActive(null), 3500);
    return () => clearTimeout(dismissTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestが変わる時は必ずlatestIdも変わるため十分
  }, [latestId]);

  if (!active) return null;

  return (
    <div
      role="status"
      onClick={() => setActive(null)}
      className="fixed inset-0 z-[65] flex cursor-pointer flex-col items-center justify-center bg-black/70 px-6"
    >
      <SparkleField />
      <ConfettiBurst />
      <div className="anim-slam relative max-w-md text-center">
        <p className="text-4xl">🏁</p>
        <p className="game-text-event mt-2 text-xl text-white">{active.teamName}が</p>
        <p className="mt-1 text-3xl font-black text-game-gold [text-shadow:0_2px_0_rgba(0,0,0,0.4)]">{active.station}</p>
        <p className="mt-1 text-lg font-bold text-white">に到着しました!</p>
        <p className="mt-4 text-sm font-bold text-white/80">次のゴール: {active.nextStation}</p>
        <p className="mt-4 text-xs text-white/50">(タップで閉じる)</p>
      </div>
    </div>
  );
}
