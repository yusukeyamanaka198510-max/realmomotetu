"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { staffBtn } from "./StaffUI";

type HistoryRow = {
  id: string;
  sequence_order: number;
  bonus_coin_amount: number | null;
  cleared_at: string | null;
  station: { name: string } | null;
  team: { team_name: string } | null;
};
type Station = { id: string; name: string; is_destination_candidate: boolean };

export function DestinationQueuePanel({
  activeStationName,
  history,
  stations,
  defaultBonus,
}: {
  activeStationName: string | null;
  history: HistoryRow[];
  stations: Station[];
  defaultBonus: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [manualStationId, setManualStationId] = useState("");

  const candidates = stations.filter((s) => s.is_destination_candidate);

  async function handleManualSet() {
    if (!manualStationId) return;
    if (!window.confirm("このゴールを手動で設定します。よろしいですか?")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_active_destination", { p_station_id: manualStationId });
    setBusy(false);
    if (error) return window.alert(error.message);
    setManualStationId("");
    router.refresh();
  }

  return (
    <div>
      <p className="text-xs text-zinc-500">
        ゴール到達時、次のゴールは自動的に「全チームの現在駅・移動先確定済みの駅」を除いた候補からランダムに選ばれます(ゴール候補は「駅・路線・ミッション管理」画面のチェックボックスで設定)。
      </p>
      <div className="mt-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
        <p className="text-base">
          現在のゴール: <span className="font-bold text-game-navy dark:text-game-gold">{activeStationName ?? "未設定"}</span>
          <span className="text-sm text-zinc-500">(ボーナス {defaultBonus.toLocaleString()} コイン)</span>
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          通常は到達時に自動で次のゴールが決まります。到達不能な駅になっている場合や、到達済みなのに更新されない場合のみ、下から手動で修正してください。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <select
            value={manualStationId}
            onChange={(e) => setManualStationId(e.target.value)}
            className="rounded-xl border-2 border-zinc-300 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">駅を手動指定...</option>
            {candidates.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button onClick={handleManualSet} disabled={busy || !manualStationId} className={staffBtn.neutral}>
            手動設定(例外対応)
          </button>
        </div>
      </div>

      {history.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">#</th>
              <th>駅</th>
              <th>到達チーム</th>
              <th>ボーナス</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-b">
                <td className="py-1">{h.sequence_order}</td>
                <td>{h.station?.name ?? "-"}</td>
                <td>{h.team?.team_name ?? "-"}</td>
                <td>{h.bonus_coin_amount?.toLocaleString() ?? defaultBonus.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
