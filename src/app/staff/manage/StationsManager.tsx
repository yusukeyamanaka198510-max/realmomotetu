"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Station = { id: string; name: string; is_destination_candidate: boolean };
type Line = { id: string; name: string };
type StationLine = { station_id: string; line_id: string };

export function StationsManager({
  stations,
  lines,
  stationLines,
}: {
  stations: Station[];
  lines: Line[];
  stationLines: StationLine[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  async function handleAdd() {
    if (!name.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { data: event } = await supabase.from("events").select("id").single();
    const { error } = await supabase.from("stations").insert({ event_id: event!.id, name: name.trim() });
    setBusy(false);
    if (error) return window.alert(error.message);
    setName("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("この駅を削除しますか?(関連する接続・ミッションも削除されます)")) return;
    const supabase = createClient();
    const { error } = await supabase.from("stations").delete().eq("id", id);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleToggleCandidate(id: string, current: boolean) {
    const supabase = createClient();
    const { error } = await supabase.from("stations").update({ is_destination_candidate: !current }).eq("id", id);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  const linesOf = (stationId: string) =>
    stationLines.filter((sl) => sl.station_id === stationId).map((sl) => lines.find((l) => l.id === sl.line_id)?.name);

  const filtered = stations.filter((s) => s.name.includes(filter));
  const candidateCount = stations.filter((s) => s.is_destination_candidate).length;

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">
        駅({stations.length}駅 / ゴール候補{candidateCount}駅)
      </h2>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="駅名で絞り込み"
        className="mt-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      />
      <div className="mt-2 max-h-64 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">駅名</th>
              <th className="p-2">路線</th>
              <th className="p-2 text-center">ゴール候補</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="p-2 font-medium">{s.name}</td>
                <td className="p-2 text-xs text-zinc-500">{linesOf(s.id).join(" / ") || "-"}</td>
                <td className="p-2 text-center">
                  <input
                    type="checkbox"
                    checked={s.is_destination_candidate}
                    onChange={() => handleToggleCandidate(s.id, s.is_destination_candidate)}
                  />
                </td>
                <td className="p-2 text-right">
                  <button onClick={() => handleDelete(s.id)} className="text-zinc-400 hover:text-red-600">
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新しい駅名"
          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
        <button
          onClick={handleAdd}
          disabled={busy || !name.trim()}
          className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          追加
        </button>
      </div>
    </section>
  );
}
