"use client";

import { useEffect, useState } from "react";
import { GameButton } from "@/components/game-ui";
import { isOverlayShown, markOverlayShown } from "./notificationOverlayStorage";

type Notif = { id: string; message: string; created_at: string };

const PREFIX = "📢本部アナウンス: ";

function parseAnnouncement(message: string): string | null {
  if (!message.startsWith(PREFIX)) return null;
  return message.slice(PREFIX.length);
}

const NAMESPACE = "admin_announcement";

// 本部からの一斉アナウンス(励ましメッセージ・重要な連絡等)は、通知欄に小さく流れる
// だけでは見落とされやすいため、ミッション失敗・妨害カード受信等と同様に専用モーダルで表示する。
export function AdminAnnouncementOverlay({ notifications }: { notifications: Notif[] }) {
  const [active, setActive] = useState<string | null>(null);

  const latest = notifications.find((n) => parseAnnouncement(n.message) && !isOverlayShown(NAMESPACE, n.id)) ?? null;
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (!latestId) return;
    const parsed = latest ? parseAnnouncement(latest.message) : null;
    if (!parsed) return;
    markOverlayShown(NAMESPACE, latestId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着アナウンス検知に応じた意図的な演出開始
    setActive(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestが変わる時は必ずlatestIdも変わるため十分
  }, [latestId]);

  if (!active) return null;

  return (
    <div role="alertdialog" className="fixed inset-0 z-[65] flex flex-col items-center justify-center bg-black/85 px-5">
      <div className="anim-pop w-full max-w-md rounded-[var(--game-radius-lg)] border-4 border-indigo-500 bg-white p-8 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900">
        <p className="text-7xl">📢</p>
        <p className="game-text-event mt-3 text-3xl text-indigo-600 dark:text-indigo-400">本部からのお知らせ</p>
        <p className="mt-4 whitespace-pre-wrap rounded-lg bg-indigo-50 p-4 text-left text-lg font-bold leading-relaxed text-zinc-700 dark:bg-indigo-950 dark:text-zinc-200">
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
