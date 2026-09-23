"use client";

import { useEffect, useState } from "react";
import { GameButton } from "@/components/game-ui";
import { isOverlayShown, markOverlayShown } from "./notificationOverlayStorage";

type Notif = { id: string; message: string; created_at: string };

type Rejection = { kind: "ARRIVAL" | "MISSION"; reason: string };

function parseRejection(message: string): Rejection | null {
  const arrival = /^🙅到着報告が差し戻されました。理由: (.+)$/.exec(message);
  if (arrival) return { kind: "ARRIVAL", reason: arrival[1] };
  const mission = /^💦ミッション失敗と判定されました。理由: (.+)$/.exec(message);
  if (mission) return { kind: "MISSION", reason: mission[1] };
  return null;
}

const NAMESPACE = "rejection";

// 却下・失敗理由は、汎用の通知欄(AnnouncementBox)に小さく流れるだけでは見落とされやすい
// 重要な情報のため、他の重要イベント(ゴール到着・ボンビー等)と同様に専用モーダルで表示する。
export function RejectionOverlay({ notifications }: { notifications: Notif[] }) {
  const [active, setActive] = useState<Rejection | null>(null);

  const latest = notifications.find((n) => parseRejection(n.message) && !isOverlayShown(NAMESPACE, n.id)) ?? null;
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (!latestId) return;
    const parsed = latest ? parseRejection(latest.message) : null;
    if (!parsed) return;
    markOverlayShown(NAMESPACE, latestId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着却下/失敗通知検知に応じた意図的な演出開始
    setActive(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestが変わる時は必ずlatestIdも変わるため十分
  }, [latestId]);

  if (!active) return null;

  const isArrival = active.kind === "ARRIVAL";

  return (
    <div role="alertdialog" className="fixed inset-0 z-[65] flex flex-col items-center justify-center bg-black/80 px-6">
      <div className="anim-shake w-full max-w-xs rounded-[var(--game-radius-lg)] border-4 border-game-red bg-white p-6 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900">
        <p className="text-5xl">{isArrival ? "🙅" : "💦"}</p>
        <p className="game-text-event mt-2 text-xl text-game-red">
          {isArrival ? "到着報告が差し戻されました" : "ミッション失敗"}
        </p>
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-left text-sm font-bold text-zinc-700 dark:bg-red-950 dark:text-zinc-200">
          理由: {active.reason}
        </p>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {isArrival ? "内容を確認し、もう一度到着報告を送信してください。" : "本部の判定に従い、次の操作に進んでください。"}
        </p>
        <div className="mt-5">
          <GameButton onClick={() => setActive(null)} variant="primary" className="w-full">
            確認
          </GameButton>
        </div>
      </div>
    </div>
  );
}
