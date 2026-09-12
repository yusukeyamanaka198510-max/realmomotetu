"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GamePanel, GameButton } from "@/components/game-ui";

type Station = { id: string; name: string };

export function StartStationPicker({
  stations,
  initialSelectedStationId,
}: {
  stations: Station[];
  initialSelectedStationId: string | null;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(initialSelectedStationId ?? "");
  const [savedId, setSavedId] = useState(initialSelectedStationId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedStations = [...stations].sort((a, b) => a.name.localeCompare(b.name, "ja"));

  async function handleDecide() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_select_start_station", { p_station_id: selectedId });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSavedId(selectedId);
    router.refresh();
  }

  const savedStationName = sortedStations.find((s) => s.id === savedId)?.name ?? null;

  return (
    <GamePanel title="スタート駅を選ぶ" icon="🚉" accent="navy" className="w-full">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        好きな駅からスタートできます(他のチームと同じ駅でもOK)。開始時刻までは何度でも変更できます。選ばなかった場合は本部が指定した駅からのスタートになります。
      </p>
      {savedStationName && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          ✅ 「{savedStationName}」に決定しました
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border-2 border-zinc-300 px-2 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="">駅を選択...</option>
          {sortedStations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <GameButton onClick={handleDecide} disabled={busy || !selectedId || selectedId === savedId} variant="primary">
          {busy ? "設定中..." : "決定"}
        </GameButton>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </GamePanel>
  );
}
