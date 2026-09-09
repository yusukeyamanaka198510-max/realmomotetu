"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COIN_TRANSACTION_LABELS, type CoinTransactionType } from "@/lib/game/types";
import { formatYen } from "@/lib/game/format";

type LedgerRow = {
  id: string;
  amount: number;
  transaction_type: CoinTransactionType;
  reason: string | null;
  created_at: string;
  announced_at: string | null;
  team: { team_name: string } | null;
};
type CardLogRow = {
  id: string;
  used_at: string;
  result: string;
  announced_at: string | null;
  card: { name: string } | null;
  team: { team_name: string } | null;
  target_team: { team_name: string } | null;
};

type LogItem = {
  id: string;
  sourceTable: "coin_ledger" | "card_usage_log";
  sourceId: string;
  at: string;
  icon: string;
  text: string;
  amountLabel: string | null;
  amountTone: "up" | "down" | null;
  announceMessage: string;
  announced: boolean;
};

const CARD_RESULT_LABEL: Record<string, string> = {
  SUCCESS: "成功",
  BLOCKED_BY_BARRIER: "カードバリアで無効化された",
  FAILED: "失敗",
};

export function AdminActionLogPanel({ ledger, cardLog }: { ledger: LedgerRow[]; cardLog: CardLogRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 一度アナウンス済みの項目は、間違って同じ内容を連投しないようボタンを戻さずそのままにする。
  // announced_atはDB側(coin_ledger/card_usage_log)に永続化されているため、再読み込みしても消えない。
  // ここではrouter.refresh()が返ってくる前の一瞬だけ先回りして表示するために使う。
  const [optimisticSentIds, setOptimisticSentIds] = useState<Set<string>>(new Set());

  const ledgerItems: LogItem[] = ledger.map((r) => {
    const teamName = r.team?.team_name ?? "不明なチーム";
    const label = COIN_TRANSACTION_LABELS[r.transaction_type];
    const spaceIdx = label.indexOf(" ");
    const icon = spaceIdx === -1 ? label : label.slice(0, spaceIdx);
    const labelText = spaceIdx === -1 ? "" : label.slice(spaceIdx + 1);
    const detail = `${labelText}${r.reason ? `(${r.reason})` : ""}`;
    return {
      id: `ledger-${r.id}`,
      sourceTable: "coin_ledger" as const,
      sourceId: r.id,
      at: r.created_at,
      icon,
      text: `${teamName}: ${detail}`,
      amountLabel: `${r.amount >= 0 ? "+" : ""}${formatYen(r.amount)}`,
      amountTone: r.amount >= 0 ? "up" : "down",
      announceMessage: `${teamName}が${detail}で${r.amount >= 0 ? "+" : ""}${formatYen(r.amount)}!`,
      announced: r.announced_at !== null,
    };
  });

  const cardItems: LogItem[] = cardLog.map((r) => {
    const teamName = r.team?.team_name ?? "不明なチーム";
    const cardName = r.card?.name ?? "カード";
    const resultLabel = CARD_RESULT_LABEL[r.result] ?? r.result;
    const targetPart = r.target_team ? ` → 対象: ${r.target_team.team_name}` : "";
    return {
      id: `card-${r.id}`,
      sourceTable: "card_usage_log" as const,
      sourceId: r.id,
      at: r.used_at,
      icon: "🎴",
      text: `${teamName}が「${cardName}」を使用(${resultLabel})${targetPart}`,
      amountLabel: null,
      amountTone: null,
      announceMessage: `${teamName}が「${cardName}」を使用しました!${r.target_team ? `(対象: ${r.target_team.team_name})` : ""}`,
      announced: r.announced_at !== null,
    };
  });

  const items = [...ledgerItems, ...cardItems].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 60);

  async function handleAnnounce(item: LogItem) {
    if (!window.confirm(`全チームへアナウンスします:\n\n「${item.announceMessage}」\n\nよろしいですか?`)) return;
    setBusyId(item.id);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_broadcast_announcement", {
      p_message: item.announceMessage,
      p_source_table: item.sourceTable,
      p_source_id: item.sourceId,
    });
    setBusyId(null);
    if (error) return window.alert(error.message);
    setOptimisticSentIds((prev) => new Set(prev).add(item.id));
    router.refresh();
  }

  return (
    <div className="mt-8 rounded border border-zinc-200 dark:border-zinc-800">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between p-4 text-left">
        <h2 className="text-lg font-semibold">📜アクションログ(全チーム、直近{items.length}件)</h2>
        <span className="text-xs text-zinc-400">{open ? "▲ 閉じる" : "▼ 開く"}</span>
      </button>
      {open && (
        <ul className="max-h-[32rem] space-y-1.5 overflow-y-auto px-4 pb-4 text-xs">
          {items.length === 0 && <li className="text-zinc-400">まだ記録がありません</li>}
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/60"
            >
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
              {it.announced || optimisticSentIds.has(it.id) ? (
                <span className="shrink-0 rounded-full border border-emerald-400 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  ✅送信済み
                </span>
              ) : (
                <button
                  onClick={() => handleAnnounce(it)}
                  disabled={busyId === it.id}
                  className="shrink-0 rounded-full border border-amber-400 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 disabled:opacity-50 dark:bg-amber-950 dark:text-amber-300"
                >
                  {busyId === it.id ? "送信中…" : "📢アナウンス"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
