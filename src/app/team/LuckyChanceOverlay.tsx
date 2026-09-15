"use client";

import { useEffect, useState } from "react";
import { ConfettiBurst, SparkleField } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";
import { isOverlayShown, markOverlayShown } from "./notificationOverlayStorage";

type LuckyNotification = { id: string; message: string; created_at: string };

function parseLuckyBonus(message: string): { copy: string; amount: number } | null {
  const match = /^🍀ラッキーボーナス!(.+?)\+([\d,]+)円$/.exec(message);
  if (!match) return null;
  return { copy: match[1], amount: Number(match[2].replace(/,/g, "")) };
}

const NAMESPACE = "lucky_bonus";

export function LuckyChanceOverlay({ notifications }: { notifications: LuckyNotification[] }) {
  const [active, setActive] = useState<{ copy: string; amount: number } | null>(null);
  const [stage, setStage] = useState<"in" | "settled">("in");

  const latest = notifications.find((n) => parseLuckyBonus(n.message) && !isOverlayShown(NAMESPACE, n.id)) ?? null;
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (!latestId) return;
    const parsed = latest ? parseLuckyBonus(latest.message) : null;
    if (!parsed) return;

    markOverlayShown(NAMESPACE, latestId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着ラッキーボーナス通知検知に応じた意図的な演出開始
    setActive(parsed);
    setStage("in");
    const settleTimer = setTimeout(() => setStage("settled"), 500);
    const dismissTimer = setTimeout(() => setActive(null), 5500);
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
      className="fixed inset-0 z-[65] flex cursor-pointer flex-col items-center justify-center bg-black/70 px-6"
    >
      {stage === "settled" && <ConfettiBurst />}
      <SparkleField />
      <div className={`relative max-w-md text-center ${stage === "in" ? "anim-slam" : ""}`}>
        <p className="text-4xl">🍀</p>
        <p className="game-text-event mt-1 text-4xl">ラッキーボーナス!</p>
        <div className="mt-4 space-y-1 text-2xl leading-snug font-black text-white [text-shadow:0_2px_0_rgba(0,0,0,0.4)]">
          {active.copy
            .split(/[!!]/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, i) => (
              <p key={i}>{line}!</p>
            ))}
        </div>
        <p className="mt-4 text-3xl font-black text-game-gold [text-shadow:0_2px_0_rgba(0,0,0,0.4)]">
          +{formatYen(active.amount)}
        </p>
        <p className="mt-4 text-xs text-white/50">(タップで閉じる)</p>
      </div>
    </div>
  );
}
