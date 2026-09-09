"use client";

import { useEffect, useState } from "react";
import { ConfettiBurst, SparkleField } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";

type LuckyNotification = { id: string; message: string; created_at: string };

function parseLuckyChance(message: string): { label: string; amount: number } | null {
  const match = /^🍀ラッキーチャンス!(.+?)で\+([\d,]+)円を獲得しました!$/.exec(message);
  if (!match) return null;
  return { label: match[1], amount: Number(match[2].replace(/,/g, "")) };
}

export function LuckyChanceOverlay({ notifications }: { notifications: LuckyNotification[] }) {
  const [active, setActive] = useState<{ label: string; amount: number } | null>(null);
  const [stage, setStage] = useState<"in" | "settled">("in");

  const latest = notifications.find((n) => parseLuckyChance(n.message)) ?? null;
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (!latestId) return;
    const parsed = latest ? parseLuckyChance(latest.message) : null;
    if (!parsed) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着ラッキーチャンス通知検知に応じた意図的な演出開始
    setActive(parsed);
    setStage("in");
    const settleTimer = setTimeout(() => setStage("settled"), 500);
    const dismissTimer = setTimeout(() => setActive(null), 3200);
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
      {stage === "settled" && <ConfettiBurst />}
      <SparkleField />
      <div className={`relative text-center ${stage === "in" ? "anim-slam" : ""}`}>
        <p className="text-4xl">🍀</p>
        <p className="game-text-event mt-1 text-4xl">ラッキーチャンス!</p>
        <p className="mt-3 text-lg font-bold text-white">{active.label}</p>
        <p className="mt-2 text-3xl font-black text-game-gold [text-shadow:0_2px_0_rgba(0,0,0,0.4)]">
          +{formatYen(active.amount)}
        </p>
        <p className="mt-3 text-xs text-white/50">(タップで閉じる)</p>
      </div>
    </div>
  );
}
