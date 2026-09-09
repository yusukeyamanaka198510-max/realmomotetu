"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { staffBtn } from "./StaffUI";

type SnapshotRow = {
  rank: number;
  team_number: number;
  team_name: string;
  coin_balance_cache: number;
  current_station_name: string | null;
};

type Snapshot = { id: string; label: string | null; taken_at: string; rows: SnapshotRow[] };

export function LeaderboardSnapshotPanel({
  intervalMinutes,
  lastSnapshotAt,
}: {
  intervalMinutes: number;
  lastSnapshotAt: string | null;
}) {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [intervalInput, setIntervalInput] = useState(intervalMinutes);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("fn_list_leaderboard_snapshots");
    if (data) setSnapshots(data as Snapshot[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初回マウント時のデータ取得
    load();
  }, [load]);

  useEffect(() => {
    const supabase = createClient();
    // 期限が来ていれば自動でスナップショットを記録するポーリング(本部画面を開いている間だけ動く)。
    const interval = setInterval(() => {
      supabase.rpc("fn_maybe_take_leaderboard_snapshot").then(() => {
        void load();
        router.refresh();
      });
    }, 15000);
    return () => clearInterval(interval);
  }, [load, router]);

  async function handleTake() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_take_leaderboard_snapshot", { p_label: labelInput || null });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setLabelInput("");
    void load();
  }

  async function handleSaveInterval() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_leaderboard_snapshot_interval", { p_minutes: intervalInput });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold">順位表スナップショット(振り返り用)</h2>
      <p className="mt-1 text-xs text-zinc-500">
        任意のタイミングで現在の順位・コイン・現在地を記録できます。参加者からは見えません。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span>自動記録の間隔</span>
        <input
          type="number"
          min={0}
          value={intervalInput}
          onChange={(e) => setIntervalInput(Number(e.target.value))}
          className="w-16 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
        />
        <span>分ごと(0=自動記録を停止)</span>
        <button onClick={handleSaveInterval} disabled={busy} className={`ml-auto ${staffBtn.neutral}`}>
          保存
        </button>
      </div>
      {intervalMinutes > 0 && (
        <p className="mt-1 text-xs text-zinc-400">
          前回の自動記録: {lastSnapshotAt ? new Date(lastSnapshotAt).toLocaleString("ja-JP") : "まだありません"}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={labelInput}
          onChange={(e) => setLabelInput(e.target.value)}
          placeholder="ラベル(例: 12時時点)"
          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
        <button disabled={busy} onClick={handleTake} className={staffBtn.primary}>
          今の順位を記録する
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <ul className="mt-3 space-y-2 text-sm">
        {snapshots.length === 0 && <li className="text-xs text-zinc-400">まだ記録がありません</li>}
        {snapshots.map((s) => (
          <li key={s.id} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
            <button className="flex w-full items-center justify-between text-left" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
              <span className="font-medium">
                {new Date(s.taken_at).toLocaleString("ja-JP")}
                {s.label && <span className="ml-2 text-zinc-500">「{s.label}」</span>}
              </span>
              <span className="text-xs text-zinc-400">{openId === s.id ? "▲" : "▼"}</span>
            </button>
            {openId === s.id && (
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-400">
                    <th className="pr-2">順位</th>
                    <th className="pr-2">チーム</th>
                    <th className="pr-2">コイン</th>
                    <th>現在地</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.team_number} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="pr-2">{r.rank}</td>
                      <td className="pr-2">
                        TEAM{r.team_number} {r.team_name}
                      </td>
                      <td className="pr-2 font-mono">{r.coin_balance_cache.toLocaleString()}</td>
                      <td>{r.current_station_name ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
