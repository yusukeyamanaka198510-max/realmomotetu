"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Card = {
  id: string;
  card_code: string;
  name: string;
  category: string;
  rarity: string;
  enabled: boolean;
};

const categoryLabel: Record<string, string> = {
  MOVEMENT: "移動",
  OBSTRUCTION: "妨害",
  DEFENSE: "防御",
  MISSION: "ミッション",
  PROPERTY: "不動産",
  SPECIAL: "特殊",
};

export function CardEnabledPanel({ cards }: { cards: Card[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(card: Card) {
    setError(null);
    setPendingId(card.id);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_card_enabled", {
      p_card_id: card.id,
      p_enabled: !card.enabled,
    });
    setPendingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  const grouped = cards.reduce<Record<string, Card[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        チェックを外したカードは、以後の抽選で出現しなくなり、既に持っているチームも使用できなくなります。
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {Object.entries(grouped).map(([category, list]) => (
        <div key={category}>
          <h3 className="mb-1.5 text-sm font-bold text-zinc-500">{categoryLabel[category] ?? category}</h3>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {list.map((card) => (
              <label
                key={card.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  card.enabled
                    ? "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                    : "border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
                }`}
              >
                <input
                  type="checkbox"
                  checked={card.enabled}
                  disabled={pendingId === card.id}
                  onChange={() => handleToggle(card)}
                  className="h-4 w-4"
                />
                <span className="flex-1">{card.name}</span>
                <span className="text-xs text-zinc-400">{card.rarity}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
