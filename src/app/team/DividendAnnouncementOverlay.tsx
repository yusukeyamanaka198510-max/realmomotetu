"use client";

import { useEffect, useState } from "react";
import { GameButton } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";

type DividendNotification = { id: string; message: string; created_at: string };

function parseDividendNotification(message: string): { amount: number } | null {
  if (!message.startsWith("📈定期配当が発生しました")) return null;
  const match = /利回り\+([\d,]+)円を獲得しました/.exec(message);
  return { amount: match ? Number(match[1].replace(/,/g, "")) : 0 };
}

export function DividendAnnouncementOverlay({ notifications }: { notifications: DividendNotification[] }) {
  const [active, setActive] = useState<{ amount: number } | null>(null);

  const latest = notifications.find((n) => parseDividendNotification(n.message)) ?? null;
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (!latestId) return;
    const parsed = latest ? parseDividendNotification(latest.message) : null;
    if (!parsed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着配当通知検知に応じた意図的な演出開始
    setActive(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestが変わる時は必ずlatestIdも変わるため十分
  }, [latestId]);

  if (!active) return null;

  return (
    <div role="status" className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/70 px-6">
      <div className="anim-pop w-full max-w-xs rounded-[var(--game-radius-lg)] border-4 border-emerald-400 bg-white p-6 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900">
        <p className="text-4xl">📈</p>
        <p className="game-text-event mt-2 text-2xl">定期配当</p>
        <p className="mt-1 text-sm font-bold text-zinc-600 dark:text-zinc-400">定期配当が発生しました</p>
        {active.amount > 0 ? (
          <p className="mt-3 text-2xl font-black text-emerald-600 dark:text-emerald-400">
            +{formatYen(active.amount)}
          </p>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">保有不動産なし</p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <GameButton onClick={() => setActive(null)} variant="primary">
            確認
          </GameButton>
          <GameButton
            onClick={() => {
              setActive(null);
              document.getElementById("leaderboard")?.scrollIntoView({ behavior: "smooth" });
            }}
            variant="destination"
          >
            ランキングを見る
          </GameButton>
        </div>
      </div>
    </div>
  );
}
