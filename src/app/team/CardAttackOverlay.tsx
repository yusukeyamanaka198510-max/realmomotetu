"use client";

import { useEffect, useState } from "react";
import { GameButton } from "@/components/game-ui";
import { isOverlayShown, markOverlayShown } from "./notificationOverlayStorage";

type Notif = { id: string; message: string; created_at: string };

const MARKER = "⚔️";

function parseAttack(message: string): string | null {
  if (!message.startsWith(MARKER)) return null;
  return message.slice(MARKER.length);
}

const NAMESPACE = "card_attack";

// 他チームからの妨害系カード(なすりつけ・場所がえ・牛歩・サイコロ封印・足止め・オナラ・
// 冬眠・刀狩り・豪速球・強奪・乗っ取り等)を受けた結果は、汎用の通知欄に小さく流れるだけでは
// 見落とされやすい重要な出来事のため、ミッション失敗等と同様に専用モーダルで表示する。
export function CardAttackOverlay({ notifications }: { notifications: Notif[] }) {
  const [active, setActive] = useState<string | null>(null);

  const latest = notifications.find((n) => parseAttack(n.message) && !isOverlayShown(NAMESPACE, n.id)) ?? null;
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (!latestId) return;
    const parsed = latest ? parseAttack(latest.message) : null;
    if (!parsed) return;
    markOverlayShown(NAMESPACE, latestId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着攻撃通知検知に応じた意図的な演出開始
    setActive(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestが変わる時は必ずlatestIdも変わるため十分
  }, [latestId]);

  if (!active) return null;

  return (
    <div role="alertdialog" className="fixed inset-0 z-[65] flex flex-col items-center justify-center bg-black/85 px-5">
      <div className="anim-shake w-full max-w-md rounded-[var(--game-radius-lg)] border-4 border-game-red bg-white p-8 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900">
        <p className="text-7xl">⚔️</p>
        <p className="game-text-event mt-3 text-3xl text-game-red">妨害カードを受けました!</p>
        <p className="mt-4 rounded-lg bg-red-50 p-4 text-left text-lg font-bold leading-relaxed text-zinc-700 dark:bg-red-950 dark:text-zinc-200">
          {active}
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
