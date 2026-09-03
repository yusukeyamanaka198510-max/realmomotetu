"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Station = { id: string; name: string };
type Line = { id: string; name: string };
type Edge = { id: string; station_a_id: string; station_b_id: string; line_id: string };

export function EdgesManager({
  stations,
  lines,
  edges,
  eventId,
}: {
  stations: Station[];
  lines: Line[];
  edges: Edge[];
  eventId: string;
}) {
  const router = useRouter();
  const [stationA, setStationA] = useState("");
  const [stationB, setStationB] = useState("");
  const [lineId, setLineId] = useState("");
  const [busy, setBusy] = useState(false);

  const nameOf = (id: string) => stations.find((s) => s.id === id)?.name ?? "?";
  const lineNameOf = (id: string) => lines.find((l) => l.id === id)?.name ?? "?";

  async function handleAdd() {
    if (!stationA || !stationB || !lineId || stationA === stationB) return;
    setBusy(true);
    const supabase = createClient();

    const { error: edgeError } = await supabase
      .from("edges")
      .insert({ event_id: eventId, station_a_id: stationA, station_b_id: stationB, line_id: lineId });
    if (edgeError) {
      setBusy(false);
      return window.alert(edgeError.message);
    }

    // 駅がその路線に属していることを記録(既存なら無視)
    await supabase.from("station_lines").upsert(
      [
        { station_id: stationA, line_id: lineId },
        { station_id: stationB, line_id: lineId },
      ],
      { onConflict: "station_id,line_id", ignoreDuplicates: true }
    );

    setBusy(false);
    router.refresh();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("edges").delete().eq("id", id);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">駅間接続({edges.length}件)</h2>
      <div className="mt-2 max-h-64 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <tbody>
            {edges.map((e) => (
              <tr key={e.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="p-2">
                  {nameOf(e.station_a_id)} ⇔ {nameOf(e.station_b_id)}
                </td>
                <td className="p-2 text-xs text-zinc-500">{lineNameOf(e.line_id)}</td>
                <td className="p-2 text-right">
                  <button onClick={() => handleDelete(e.id)} className="text-zinc-400 hover:text-red-600">
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          value={stationA}
          onChange={(e) => setStationA(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="">駅A</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="self-center">⇔</span>
        <select
          value={stationB}
          onChange={(e) => setStationB(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="">駅B</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={lineId}
          onChange={(e) => setLineId(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="">路線</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleAdd}
          disabled={busy || !stationA || !stationB || !lineId || stationA === stationB}
          className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          接続を追加
        </button>
      </div>
    </section>
  );
}
