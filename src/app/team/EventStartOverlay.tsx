"use client";

import { useEffect, useState } from "react";
import { ConfettiBurst, SparkleField } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";

type Notif = { id: string; message: string; created_at: string };

function parseDestination(message: string): string | null {
  const match = /^🏁 最初の目的地が「(.+?)」に設定されました$/.exec(message);
  return match ? match[1] : null;
}

function parseFunding(message: string): number | null {
  const match = /^💰 初期資金として、全チームに([\d,]+)円が付与されました!$/.exec(message);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

export function EventStartOverlay({ notifications }: { notifications: Notif[] }) {
  const destNotif = notifications.find((n) => parseDestination(n.message)) ?? null;
  const fundNotif = notifications.find((n) => parseFunding(n.message)) ?? null;
  const comboKey = `${destNotif?.id ?? "-"}:${fundNotif?.id ?? "-"}`;
  const [stage, setStage] = useState<"idle" | "destination" | "funding">("idle");

  useEffect(() => {
    if (!destNotif && !fundNotif) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着イベント開始通知検知に応じた意図的な演出開始
    setStage(destNotif ? "destination" : "funding");
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (destNotif && fundNotif) {
      timers.push(setTimeout(() => setStage("funding"), 3200));
      timers.push(setTimeout(() => setStage("idle"), 6400));
    } else {
      timers.push(setTimeout(() => setStage("idle"), 3200));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- destNotif/fundNotifが変わる時は必ずcomboKeyも変わるため十分
  }, [comboKey]);

  if (stage === "idle") return null;

  function handleClick() {
    if (stage === "destination" && fundNotif) {
      setStage("funding");
    } else {
      setStage("idle");
    }
  }

  const destinationName = destNotif ? parseDestination(destNotif.message) : null;
  const fundingAmount = fundNotif ? parseFunding(fundNotif.message) : null;

  return (
    <div
      role="status"
      onClick={handleClick}
      className="fixed inset-0 z-[65] flex cursor-pointer flex-col items-center justify-center bg-black/70 px-6"
    >
      <SparkleField />
      <ConfettiBurst />
      {stage === "destination" && destinationName && (
        <div className="anim-slam relative max-w-md text-center">
          <p className="text-4xl">🏁</p>
          <p className="game-text-event mt-1 text-2xl">最初の目的地が</p>
          <p className="mt-3 text-4xl font-black text-game-gold [text-shadow:0_2px_0_rgba(0,0,0,0.4)]">{destinationName}</p>
          <p className="mt-2 text-sm font-bold text-white/80">に設定されました!</p>
          <p className="mt-4 text-xs text-white/50">(タップで閉じる)</p>
        </div>
      )}
      {stage === "funding" && fundingAmount !== null && (
        <div className="anim-slam relative max-w-md text-center">
          <p className="text-4xl">💰</p>
          <p className="game-text-event mt-1 text-2xl">初期資金として全チームに</p>
          <p className="mt-3 text-4xl font-black text-game-gold [text-shadow:0_2px_0_rgba(0,0,0,0.4)]">
            {formatYen(fundingAmount)}
          </p>
          <p className="mt-2 text-sm font-bold text-white/80">が付与されました!</p>
          <p className="mt-4 text-xs text-white/50">(タップで閉じる)</p>
        </div>
      )}
    </div>
  );
}
