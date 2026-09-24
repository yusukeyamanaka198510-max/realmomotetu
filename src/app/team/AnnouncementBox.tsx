"use client";

import { useMemo } from "react";

type CardNotification = { id: string; message: string; created_at: string };

// カード獲得(🎴CARD:)と本部アナウンス(📢本部アナウンス:)は専用の演出モーダルがあるため、ここでは表示しない。
export function AnnouncementBox({ notifications }: { notifications: CardNotification[] }) {
  const visible = useMemo(
    () => notifications.filter((n) => !n.message.startsWith("🎴CARD:") && !n.message.startsWith("📢本部アナウンス: ")),
    [notifications]
  );

  if (visible.length === 0) return null;

  return (
    <div className="mb-3 space-y-1.5">
      {visible.slice(0, 3).map((n) =>
        n.message.startsWith("🏁") ? (
          <p
            key={n.id}
            className="anim-pop rounded-xl border-2 border-game-gold bg-amber-100 p-2.5 text-xs font-bold text-amber-900 shadow-[var(--game-shadow-sm)] dark:bg-amber-900 dark:text-amber-100"
          >
            {n.message}
          </p>
        ) : (
          <p key={n.id} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            ⚠ {n.message}
          </p>
        )
      )}
    </div>
  );
}
