"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type CardHolding = { card_code: string; name: string; quantity: number };
type ActiveEffect = { id: string; effect_type: string; remaining_uses: number; created_at: string; source_team_id: string | null };
type Team = {
  id: string;
  team_name: string;
  state: string;
  cards?: CardHolding[];
  activeEffects?: ActiveEffect[];
};
type Station = { id: string; name: string };
type CardOption = { id: string; card_code: string; name: string; category: string; rarity: string };

export function TeamAdminPanel({ teams, stations, allCards = [] }: { teams: Team[]; stations: Station[]; allCards?: CardOption[] }) {
  const router = useRouter();
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coinAmount, setCoinAmount] = useState(0);
  const [coinReason, setCoinReason] = useState("");
  const [lateAmount, setLateAmount] = useState(500);
  const [lateReason, setLateReason] = useState("");
  const [currentStationId, setCurrentStationId] = useState("");
  const [nextStationId, setNextStationId] = useState("");
  const [correctReason, setCorrectReason] = useState("");
  const [grantCardCode, setGrantCardCode] = useState(allCards[0]?.card_code ?? "");
  const [grantQty, setGrantQty] = useState(1);
  const [teamNameDraft, setTeamNameDraft] = useState<Record<string, string>>({});

  async function call(fn: string, args: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      window.alert(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="space-y-2">
        {teams.map((t) => (
          <div key={t.id} className="rounded border border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => setOpenTeamId(openTeamId === t.id ? null : t.id)}
              className="flex w-full items-center justify-between p-3 text-left text-sm"
            >
              <span className="font-medium">
                {t.team_name}
                <span className="ml-2 text-xs text-zinc-500">{t.state}</span>
              </span>
              <span>{openTeamId === t.id ? "▲" : "▼"}</span>
            </button>
            {openTeamId === t.id && (
              <div className="space-y-4 border-t border-zinc-200 p-3 text-sm dark:border-zinc-800">
                {/* チーム名変更 */}
                <div>
                  <p className="font-medium">チーム名</p>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={teamNameDraft[t.id] ?? t.team_name}
                      onChange={(e) => setTeamNameDraft({ ...teamNameDraft, [t.id]: e.target.value })}
                      className="flex-1 min-w-[140px] rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <button
                      disabled={busy || !(teamNameDraft[t.id] ?? "").trim()}
                      onClick={() => call("fn_admin_rename_team", { p_team_id: t.id, p_team_name: teamNameDraft[t.id] })}
                      className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                    >
                      変更
                    </button>
                  </div>
                </div>

                {/* コイン調整 */}
                <div>
                  <p className="font-medium">コイン調整</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      value={coinAmount}
                      onChange={(e) => setCoinAmount(Number(e.target.value))}
                      className="w-24 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <input
                      type="text"
                      placeholder="理由"
                      value={coinReason}
                      onChange={(e) => setCoinReason(e.target.value)}
                      className="flex-1 min-w-[140px] rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <button
                      disabled={busy || coinAmount === 0}
                      onClick={() =>
                        call(
                          "fn_admin_adjust_coin",
                          { p_team_id: t.id, p_amount: coinAmount, p_reason: coinReason || null },
                          `${t.team_name}に${coinAmount}コインを適用します。よろしいですか?`
                        )
                      }
                      className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                    >
                      適用
                    </button>
                  </div>
                </div>

                {/* 遅刻減点 */}
                <div>
                  <p className="font-medium">遅刻減点</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      value={lateAmount}
                      onChange={(e) => setLateAmount(Number(e.target.value))}
                      className="w-24 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <input
                      type="text"
                      placeholder="理由(例: 開始15分遅刻)"
                      value={lateReason}
                      onChange={(e) => setLateReason(e.target.value)}
                      className="flex-1 min-w-[140px] rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <button
                      disabled={busy || lateAmount <= 0}
                      onClick={() =>
                        call(
                          "fn_admin_late_penalty",
                          { p_team_id: t.id, p_amount: lateAmount, p_reason: lateReason || null },
                          `${t.team_name}に-${lateAmount}コインの遅刻減点を適用します。よろしいですか?`
                        )
                      }
                      className="rounded bg-red-600 px-3 py-1.5 text-white disabled:opacity-50"
                    >
                      適用
                    </button>
                  </div>
                </div>

                {/* 現在駅/次駅修正 */}
                <div>
                  <p className="font-medium">現在駅・次駅の修正</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <select
                      value={currentStationId}
                      onChange={(e) => setCurrentStationId(e.target.value)}
                      className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      <option value="">現在駅を変更しない</option>
                      {stations.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={nextStationId}
                      onChange={(e) => setNextStationId(e.target.value)}
                      className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      <option value="">次駅を変更しない</option>
                      {stations.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="理由"
                      value={correctReason}
                      onChange={(e) => setCorrectReason(e.target.value)}
                      className="flex-1 min-w-[120px] rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <button
                      disabled={busy || (!currentStationId && !nextStationId)}
                      onClick={() =>
                        call(
                          "fn_admin_correct_station",
                          {
                            p_team_id: t.id,
                            p_current_station_id: currentStationId || null,
                            p_next_station_id: nextStationId || null,
                            p_reason: correctReason || null,
                          },
                          `${t.team_name}の駅情報を修正します。よろしいですか?`
                        )
                      }
                      className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                    >
                      修正
                    </button>
                  </div>
                </div>

                {/* 一時停止 / 再開 */}
                <div className="flex items-center gap-2">
                  <button
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt("一時停止の理由");
                      if (reason === null) return;
                      call("fn_admin_set_paused", { p_team_id: t.id, p_pause: true, p_reason: reason });
                    }}
                    className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
                  >
                    一時停止
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => call("fn_admin_set_paused", { p_team_id: t.id, p_pause: false, p_reason: null })}
                    className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
                  >
                    再開
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt("サイコロ再実行の理由(トラブル救済用)");
                      if (reason === null) return;
                      call("fn_admin_invalidate_dice", { p_team_id: t.id, p_reason: reason });
                    }}
                    className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
                  >
                    サイコロ再実行許可
                  </button>
                </div>

                {/* カード付与/剥奪 */}
                <div>
                  <p className="font-medium">カード付与・剥奪</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <select
                      value={grantCardCode}
                      onChange={(e) => setGrantCardCode(e.target.value)}
                      className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      {allCards.map((c) => (
                        <option key={c.id} value={c.card_code}>
                          [{c.rarity}] {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={grantQty}
                      onChange={(e) => setGrantQty(Number(e.target.value))}
                      className="w-16 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <button
                      disabled={busy || !grantCardCode}
                      onClick={() => call("fn_admin_grant_card", { p_team_id: t.id, p_card_code: grantCardCode, p_qty: grantQty })}
                      className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                    >
                      付与
                    </button>
                    <button
                      disabled={busy || !grantCardCode}
                      onClick={() => call("fn_admin_revoke_card", { p_team_id: t.id, p_card_code: grantCardCode, p_qty: grantQty })}
                      className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
                    >
                      剥奪
                    </button>
                  </div>
                  {t.cards && t.cards.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">
                      所持: {t.cards.map((c) => `${c.name}x${c.quantity}`).join("、")}
                    </p>
                  )}
                </div>

                {/* 有効中のカード効果 */}
                {t.activeEffects && t.activeEffects.length > 0 && (
                  <div>
                    <p className="font-medium">有効中のカード効果</p>
                    <ul className="mt-1 space-y-1">
                      {t.activeEffects.map((e) => (
                        <li key={e.id} className="flex items-center justify-between rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800">
                          <span>
                            {e.effect_type}(残り{e.remaining_uses}回)
                          </span>
                          <button
                            disabled={busy}
                            onClick={() => call("fn_admin_clear_card_effect", { p_effect_id: e.id })}
                            className="text-zinc-400 hover:text-red-600"
                          >
                            解除
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
