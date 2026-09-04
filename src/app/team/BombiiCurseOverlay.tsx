"use client";

import { useEffect, useState } from "react";
import { GameButton } from "@/components/game-ui";

type BombiiNotification = { id: string; message: string; created_at: string };

function parseBombiiAssigned(message: string): { teamName: string; reason: string } | null {
  const match = /^😈ボンビーが「(.+?)」に取り憑きました!\(理由: (.+?)\)$/.exec(message);
  if (!match) return null;
  return { teamName: match[1], reason: match[2] };
}

// 本部からの承認を確認するまで消えない演出のため、確認済みIDは他のオーバーレイと違いタイマーで
// 自動的に閉じない。localStorageに確認済みIDを残し、再読み込みしても再表示しないようにする。
function isDismissed(id: string): boolean {
  try {
    return localStorage.getItem(`bombii_dismissed:${id}`) === "1";
  } catch {
    return false;
  }
}
function markDismissed(id: string) {
  try {
    localStorage.setItem(`bombii_dismissed:${id}`, "1");
  } catch {
    // ignore
  }
}

export function BombiiCurseOverlay({ notifications, myTeamName }: { notifications: BombiiNotification[]; myTeamName: string }) {
  const [active, setActive] = useState<{ id: string; teamName: string; reason: string } | null>(null);

  const latest = notifications.find((n) => parseBombiiAssigned(n.message) && !isDismissed(n.id)) ?? null;
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (!latestId) return;
    const parsed = latest ? parseBombiiAssigned(latest.message) : null;
    if (!parsed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着ボンビー付与通知検知に応じた意図的な演出開始
    setActive({ id: latestId, ...parsed });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestが変わる時は必ずlatestIdも変わるため十分
  }, [latestId]);

  if (!active) return null;

  const isMe = active.teamName === myTeamName;

  return (
    <div role="alertdialog" className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/80 px-6">
      <div className="anim-shake w-full max-w-xs rounded-[var(--game-radius-lg)] border-4 border-purple-500 bg-white p-6 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900">
        <p className="text-5xl">😈</p>
        <p className="game-text-event mt-2 text-2xl text-purple-700 dark:text-purple-300">ボンビー出現!</p>
        <p className="mt-3 text-base font-bold">
          {isMe ? "あなたのチームに" : `「${active.teamName}」に`}取り憑きました
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">理由: {active.reason}</p>
        {isMe && (
          <p className="mt-3 rounded-lg bg-purple-50 p-2 text-xs font-bold text-purple-700 dark:bg-purple-950 dark:text-purple-300">
            ミッション成功のたびに「悪さ」が発生します。撃退チャレンジかなすりつけカードで外しましょう。
          </p>
        )}
        <div className="mt-5">
          <GameButton
            onClick={() => {
              markDismissed(active.id);
              setActive(null);
            }}
            variant="primary"
            className="w-full"
          >
            確認
          </GameButton>
        </div>
      </div>
    </div>
  );
}
