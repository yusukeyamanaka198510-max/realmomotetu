"use client";

import { useMemo, useState } from "react";
import { buildLineChain } from "@/lib/game/lineChains";

type Station = { id: string; name: string };
type Line = { id: string; name: string };
type Edge = { station_a_id: string; station_b_id: string; line_id: string };

export function StationMapPicker({
  stations,
  lines,
  edges,
  selectedStationId,
  onSelectStation,
  customizedStationIds,
}: {
  stations: Station[];
  lines: Line[];
  edges: Edge[];
  selectedStationId: string;
  onSelectStation: (stationId: string, lineId: string) => void;
  customizedStationIds: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [manuallyOpen, setManuallyOpen] = useState<Record<string, boolean>>({});

  const stationNames: Record<string, string> = useMemo(
    () => Object.fromEntries(stations.map((s) => [s.id, s.name])),
    [stations]
  );

  const lineChains = useMemo(
    () =>
      lines
        .map((l) => ({
          id: l.id,
          name: l.name,
          stationIds: buildLineChain(edges.filter((e) => e.line_id === l.id).map((e) => ({ a: e.station_a_id, b: e.station_b_id }))),
        }))
        .filter((l) => l.stationIds.length > 0),
    [lines, edges]
  );

  const q = query.trim();
  const matchesQuery = (line: (typeof lineChains)[number]) =>
    !q || line.name.includes(q) || line.stationIds.some((sid) => (stationNames[sid] ?? "").includes(q));

  const visibleLines = lineChains.filter(matchesQuery);

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="路線名・駅名で絞り込み"
        className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      />
      <div className="mt-2 max-h-96 space-y-1.5 overflow-y-auto">
        {visibleLines.length === 0 && <p className="text-xs text-zinc-400">該当する路線がありません</p>}
        {visibleLines.map((line) => {
          const autoOpen = !!q && matchesQuery(line);
          const isOpen = manuallyOpen[line.id] ?? autoOpen;
          return (
            <div key={line.id} className="rounded border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setManuallyOpen((m) => ({ ...m, [line.id]: !isOpen }))}
                className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs font-medium"
              >
                <span>{line.name}</span>
                <span className="text-zinc-400">{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div className="overflow-x-auto border-t border-zinc-200 px-2 py-2 dark:border-zinc-800">
                  <div className="flex min-w-max items-center">
                    {line.stationIds.map((sid, i) => {
                      const isSelected = sid === selectedStationId;
                      const isCustomized = customizedStationIds.has(sid);
                      return (
                        <div key={sid} className="flex items-center">
                          <button
                            type="button"
                            onClick={() => onSelectStation(sid, line.id)}
                            className="flex flex-col items-center gap-1"
                            style={{ width: 56 }}
                            title={stationNames[sid] ?? ""}
                          >
                            <span
                              className={`h-3 w-3 rounded-full border-2 ${
                                isSelected
                                  ? "border-blue-600 bg-blue-500"
                                  : isCustomized
                                    ? "border-emerald-500 bg-emerald-400"
                                    : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
                              }`}
                            />
                            <span
                              className={`w-14 truncate text-center text-[10px] ${
                                isSelected ? "font-bold text-blue-600" : "text-zinc-400"
                              }`}
                            >
                              {stationNames[sid] ?? "?"}
                            </span>
                          </button>
                          {i < line.stationIds.length - 1 && <div className="h-0.5 w-4 shrink-0 bg-zinc-200 dark:bg-zinc-700" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 text-[10px] text-zinc-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-blue-600 bg-blue-500" />選択中
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-emerald-500 bg-emerald-400" />個別設定あり
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900" />
          未設定(全カード対象)
        </span>
      </div>
    </div>
  );
}
