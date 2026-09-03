"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Station = { id: string; name: string };
type Mission = {
  id: string;
  station_id: string;
  difficulty: "EASY" | "NORMAL" | "HARD";
  title: string;
  description: string;
  success_reward: number | null;
  failure_penalty: number | null;
  is_active: boolean;
};

const DIFFICULTY_LABEL: Record<Mission["difficulty"], string> = {
  EASY: "EASY(成功+500 / 失敗-250)",
  NORMAL: "NORMAL(成功+1000 / 失敗-500)",
  HARD: "HARD(成功+2000 / 失敗-1000)",
};

export function MissionsManager({ stations, missions }: { stations: Station[]; missions: Mission[] }) {
  const router = useRouter();
  const [stationId, setStationId] = useState(stations[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, { title: string; description: string }>>({});

  const stationMissions = missions.filter((m) => m.station_id === stationId);

  function getDraft(m: Mission) {
    return draft[m.id] ?? { title: m.title, description: m.description };
  }

  async function handleSave(m: Mission) {
    const d = getDraft(m);
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("station_missions")
      .update({ title: d.title, description: d.description })
      .eq("id", m.id);
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleAdd(difficulty: Mission["difficulty"]) {
    if (!stationId) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("station_missions").insert({
      station_id: stationId,
      difficulty,
      title: "(新しいミッション)",
      description: "",
    });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("このミッションを削除しますか?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("station_missions").delete().eq("id", id);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">ミッション(駅ごとに難易度別3個以上を推奨)</h2>
      <select
        value={stationId}
        onChange={(e) => setStationId(e.target.value)}
        className="mt-2 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      >
        {stations.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {(["EASY", "NORMAL", "HARD"] as const).map((difficulty) => (
        <div key={difficulty} className="mt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{DIFFICULTY_LABEL[difficulty]}</h3>
            <button
              onClick={() => handleAdd(difficulty)}
              disabled={busy}
              className="text-xs text-zinc-500 hover:underline"
            >
              + 追加
            </button>
          </div>
          <div className="mt-1 space-y-2">
            {stationMissions
              .filter((m) => m.difficulty === difficulty)
              .map((m) => {
                const d = getDraft(m);
                return (
                  <div key={m.id} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
                    <input
                      value={d.title}
                      onChange={(e) => setDraft({ ...draft, [m.id]: { ...d, title: e.target.value } })}
                      onBlur={() => handleSave(m)}
                      className="w-full border-b border-transparent bg-transparent text-sm font-medium focus:border-zinc-400 focus:outline-none"
                    />
                    <textarea
                      value={d.description}
                      onChange={(e) => setDraft({ ...draft, [m.id]: { ...d, description: e.target.value } })}
                      onBlur={() => handleSave(m)}
                      rows={2}
                      className="mt-1 w-full resize-none border-b border-transparent bg-transparent text-xs text-zinc-600 focus:border-zinc-400 focus:outline-none dark:text-zinc-400"
                    />
                    <button onClick={() => handleDelete(m.id)} className="mt-1 text-xs text-zinc-400 hover:text-red-600">
                      削除
                    </button>
                  </div>
                );
              })}
            {stationMissions.filter((m) => m.difficulty === difficulty).length === 0 && (
              <p className="text-xs text-zinc-400">未登録</p>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
