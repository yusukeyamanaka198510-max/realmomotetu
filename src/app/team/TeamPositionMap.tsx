"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildLineChain } from "@/lib/game/lineChains";

export type LineTopology = { id: string; name: string; edges: { a: string; b: string }[] };
export type StationDict = Record<string, string>;

type PositionRow = {
  is_mine: boolean;
  team_name: string | null;
  current_station_id: string | null;
  next_station_id: string | null;
  state: string;
};

type RenderLine = { id: string; name: string; stationIds: string[] };

export function TeamPositionMap({ lines, stationNames }: { lines: LineTopology[]; stationNames: StationDict }) {
  const [visible, setVisible] = useState(true);
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("fn_get_team_positions");
    if (data) {
      setVisible(data.visible);
      setRows(data.rows ?? []);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初回マウント時のデータ取得
    load();
    const supabase = createClient();
    const channel = supabase
      .channel("team-position-map")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_state" }, load)
      .subscribe();
    const interval = setInterval(load, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [load]);

  if (!visible) return null;

  const renderLines: RenderLine[] = lines
    .map((l) => ({ id: l.id, name: l.name, stationIds: buildLineChain(l.edges) }))
    .filter((l) => l.stationIds.length > 0);

  const stationOnLine = (lineStationIds: string[], stationId: string | null) =>
    !!stationId && lineStationIds.includes(stationId);

  const activeLines = renderLines.filter((l) =>
    rows.some((r) => stationOnLine(l.stationIds, r.current_station_id) || stationOnLine(l.stationIds, r.next_station_id))
  );

  if (activeLines.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 text-center text-sm text-zinc-400 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        現在地マップ: まだチームの位置情報がありません
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-left shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-bold">各チームの現在地マップ</h2>
        <span className="text-xs text-zinc-400">{open ? "▲ 閉じる" : "▼ 開く"}</span>
      </button>
      {open &&
        activeLines.map((line) => {
        const teamsHere = rows.filter(
          (r) => stationOnLine(line.stationIds, r.current_station_id) || stationOnLine(line.stationIds, r.next_station_id)
        );
        return (
          <div key={line.id} className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{line.name}</p>
            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-max items-center">
                {line.stationIds.map((sid, i) => {
                  const teamsAt = teamsHere.filter((r) => r.current_station_id === sid);
                  return (
                    <div key={sid} className="flex items-center">
                      <div className="flex flex-col items-center" style={{ width: 64 }}>
                        <div className="relative flex h-3 w-3 items-center justify-center">
                          <span className="h-2.5 w-2.5 rounded-full border-2 border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900" />
                        </div>
                        <span className="mt-1 w-16 truncate text-center text-[10px] text-zinc-400" title={stationNames[sid] ?? ""}>
                          {stationNames[sid] ?? "?"}
                        </span>
                        <div className="mt-1 flex flex-col items-center gap-0.5">
                          {teamsAt.map((t, idx) => (
                            <span
                              key={idx}
                              className={`animate-[pos-pop_0.4s_ease-out] whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                                t.is_mine
                                  ? "bg-amber-400 text-amber-950"
                                  : "bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                              }`}
                            >
                              {t.next_station_id ? "🚃" : ""}
                              {t.is_mine ? (t.team_name ?? "あなた") : "他"}
                              {t.is_mine && t.next_station_id ? `→${stationNames[t.next_station_id] ?? ""}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                      {i < line.stationIds.length - 1 && <div className="-mt-6 h-0.5 w-6 bg-zinc-200 dark:bg-zinc-700" />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      <style>{`
        @keyframes pos-pop {
          0% { opacity: 0; transform: scale(0.6); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
