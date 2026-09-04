"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COIN_TRANSACTION_LABELS, type CoinTransactionType } from "@/lib/game/types";
import { formatYen } from "@/lib/game/format";

type LedgerRow = {
  id: string;
  amount: number;
  transaction_type: CoinTransactionType;
  reason: string | null;
  created_at: string;
};

type CardLogRow = {
  id: string;
  used_at: string;
  result: string;
  team_id: string;
  target_team_id: string | null;
  card: { name: string } | null;
};

type HistoryItem = { id: string; at: string; icon: string; text: string; amountLabel: string | null; amountTone: "up" | "down" | null };

const CARD_RESULT_LABEL: Record<string, string> = {
  SUCCESS: "成功",
  BLOCKED: "防御カードで無効化された",
  FAILED: "失敗",
};

export function ActionHistory({ teamId }: { teamId: string }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: ledger }, { data: cardLog }] = await Promise.all([
      supabase
        .from("coin_ledger")
        .select("id, amount, transaction_type, reason, created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("card_usage_log")
        .select("id, used_at, result, team_id, target_team_id, card:card_id(name)")
        .or(`team_id.eq.${teamId},target_team_id.eq.${teamId}`)
        .order("used_at", { ascending: false })
        .limit(50),
    ]);

    const ledgerItems: HistoryItem[] = ((ledger as LedgerRow[] | null) ?? []).map((r) => ({
      id: `ledger-${r.id}`,
      at: r.created_at,
      icon: COIN_TRANSACTION_LABELS[r.transaction_type].slice(0, 2),
      text: `${COIN_TRANSACTION_LABELS[r.transaction_type].slice(2).trim()}${r.reason ? `(${r.reason})` : ""}`,
      amountLabel: `${r.amount >= 0 ? "+" : ""}${formatYen(r.amount)}`,
      amountTone: r.amount >= 0 ? "up" : "down",
    }));

    const cardItems: HistoryItem[] = ((cardLog as unknown as CardLogRow[] | null) ?? []).map((r) => {
      const isMine = r.team_id === teamId;
      const cardName = r.card?.name ?? "カード";
      return {
        id: `card-${r.id}`,
        at: r.used_at,
        icon: "🎴",
        text: isMine
          ? `「${cardName}」を使用(${CARD_RESULT_LABEL[r.result] ?? r.result})`
          : `他チームから「${cardName}」を受けた(${CARD_RESULT_LABEL[r.result] ?? r.result})`,
        amountLabel: null,
        amountTone: null,
      };
    });

    const merged = [...ledgerItems, ...cardItems].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    setItems(merged.slice(0, 60));
  }, [teamId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初回マウント時のデータ取得
    load();
    const supabase = createClient();
    const channel = supabase
      .channel(`action-history:${teamId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "coin_ledger", filter: `team_id=eq.${teamId}` }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "card_usage_log", filter: `team_id=eq.${teamId}` }, load)
      .subscribe();
    // このコンポーネントはpage.tsxのpropsではなく自前でデータ取得しているため、
    // 他コンポーネントのrouter.refresh()では追従しない。Realtime切断時の保険として定期再取得する。
    const interval = setInterval(load, 20000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [teamId, load]);

  return (
    <div className="mt-6 rounded-[var(--game-radius-md)] border-2 border-zinc-200 bg-white shadow-[var(--game-shadow-sm)] dark:border-zinc-800 dark:bg-zinc-900">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between p-4 text-left">
        <h2 className="text-sm font-bold">📜アクションログ({items.length}件)</h2>
        <span className="text-xs text-zinc-400">{open ? "▲ 閉じる" : "▼ 開く"}</span>
      </button>
      {open && (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto px-4 pb-4 text-xs">
          {items.length === 0 && <li className="text-zinc-400">まだ記録がありません</li>}
          {items.map((it) => (
            <li key={it.id} className="flex items-start justify-between gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/60">
              <span className="flex-1">
                <span className="mr-1">{it.icon}</span>
                {it.text}
                <span className="ml-1.5 text-[10px] text-zinc-400">
                  {new Date(it.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
              {it.amountLabel && (
                <span className={`shrink-0 font-mono font-bold ${it.amountTone === "up" ? "text-game-green" : "text-game-red"}`}>
                  {it.amountLabel}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
