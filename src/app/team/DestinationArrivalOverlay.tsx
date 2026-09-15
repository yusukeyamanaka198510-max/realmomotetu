"use client";

import { useEffect, useState } from "react";
import { ConfettiBurst, SpeedLines } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";
import { isOverlayShown, markOverlayShown } from "./notificationOverlayStorage";

type ArrivalNotification = { id: string; message: string; created_at: string };

function parseSelfArrival(message: string): { station: string; amount: number; nextStation: string } | null {
  const match = /^🏁 ゴール到達!「(.+?)」で\+([\d,]+)円を獲得しました。次のゴールは「(.+?)」です。$/.exec(message);
  if (!match) return null;
  return { station: match[1], amount: Number(match[2].replace(/,/g, "")), nextStation: match[3] };
}

const NAMESPACE = "destination_arrival";

export function DestinationArrivalOverlay({ notifications }: { notifications: ArrivalNotification[] }) {
  const [active, setActive] = useState<{ station: string; amount: number; nextStation: string } | null>(null);
  const [stage, setStage] = useState<"in" | "settled">("in");

  const latest = notifications.find((n) => parseSelfArrival(n.message) && !isOverlayShown(NAMESPACE, n.id)) ?? null;
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (!latestId) return;
    const parsed = latest ? parseSelfArrival(latest.message) : null;
    if (!parsed) return;

    markOverlayShown(NAMESPACE, latestId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着到達通知検知に応じた意図的な演出開始
    setActive(parsed);
    setStage("in");
    const settleTimer = setTimeout(() => setStage("settled"), 700);
    const dismissTimer = setTimeout(() => setActive(null), 2800);
    return () => {
      clearTimeout(settleTimer);
      clearTimeout(dismissTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestが変わる時は必ずlatestIdも変わるため十分
  }, [latestId]);

  if (!active) return null;

  return (
    <div
      role="status"
      onClick={() => setActive(null)}
      className="fixed inset-0 z-[65] flex cursor-pointer flex-col items-center justify-center bg-black/70"
    >
      <SpeedLines />
      {stage === "settled" && <ConfettiBurst />}
      <div className={`relative text-center ${stage === "in" ? "anim-slam" : ""}`}>
        <p className="game-text-event text-3xl">目的地</p>
        <p className="game-text-event mt-1 text-5xl">到着!!</p>
        <p className="mt-4 text-lg font-bold text-white">{active.station}</p>
        <p className="mt-2 text-3xl font-black text-game-gold [text-shadow:0_2px_0_rgba(0,0,0,0.4)]">
          +{formatYen(active.amount)}
        </p>
        <p className="mt-4 text-sm font-bold text-white/80">次のゴール: {active.nextStation}</p>
        <p className="mt-3 text-xs text-white/50">(タップで閉じる)</p>
      </div>
    </div>
  );
}
