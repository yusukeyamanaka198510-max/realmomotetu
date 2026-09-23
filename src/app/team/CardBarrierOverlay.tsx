"use client";

import { useEffect, useState } from "react";
import { GameButton } from "@/components/game-ui";
import { isOverlayShown, markOverlayShown } from "./notificationOverlayStorage";

type Notif = { id: string; message: string; created_at: string };

type BarrierEvent = { kind: "BLOCKED" | "DEFENDED"; cardName: string };

function parseBarrierEvent(message: string): BarrierEvent | null {
  const defended = /^(.+)をカードバリアで防ぎました。$/.exec(message);
  if (defended) return { kind: "DEFENDED", cardName: defended[1] };
  const blocked = /^(.+)はカードバリアで防がれました。$/.exec(message);
  if (blocked) return { kind: "BLOCKED", cardName: blocked[1] };
  return null;
}

const NAMESPACE = "card_barrier";

// カードバリアで妨害カードが防がれた結果は、防いだ側・防がれた側どちらにとっても
// 見落とせない重要な出来事のため、ミッション失敗等と同様に専用モーダルで表示する。
export function CardBarrierOverlay({ notifications }: { notifications: Notif[] }) {
  const [active, setActive] = useState<BarrierEvent | null>(null);

  const latest = notifications.find((n) => parseBarrierEvent(n.message) && !isOverlayShown(NAMESPACE, n.id)) ?? null;
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (!latestId) return;
    const parsed = latest ? parseBarrierEvent(latest.message) : null;
    if (!parsed) return;
    markOverlayShown(NAMESPACE, latestId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着バリア発動通知検知に応じた意図的な演出開始
    setActive(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestが変わる時は必ずlatestIdも変わるため十分
  }, [latestId]);

  if (!active) return null;

  const isDefended = active.kind === "DEFENDED";

  return (
    <div role="alertdialog" className="fixed inset-0 z-[65] flex flex-col items-center justify-center bg-black/85 px-5">
      <div
        className={`anim-shake w-full max-w-md rounded-[var(--game-radius-lg)] border-4 bg-white p-8 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900 ${
          isDefended ? "border-game-blue" : "border-zinc-400"
        }`}
      >
        <p className="text-7xl">🛡️</p>
        <p className={`game-text-event mt-3 text-3xl ${isDefended ? "text-game-blue" : "text-zinc-500"}`}>
          {isDefended ? "カードバリアで防いだ!" : "カードバリアで防がれた"}
        </p>
        <p className="mt-4 rounded-lg bg-zinc-50 p-4 text-left text-lg font-bold leading-relaxed text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {isDefended
            ? `相手の「${active.cardName}」を、カードバリアで無効化しました。`
            : `使用した「${active.cardName}」は、相手のカードバリアで防がれました。`}
        </p>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          {isDefended ? "カードバリアは1回使い切りで消費されました。" : "効果は発動しませんでした。"}
        </p>
        <div className="mt-6">
          <GameButton onClick={() => setActive(null)} variant="primary" className="w-full !py-4 !text-lg">
            確認しました
          </GameButton>
        </div>
      </div>
    </div>
  );
}
