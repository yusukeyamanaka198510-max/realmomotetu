"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Station = { id: string; name: string };
type Property = {
  id: string;
  station_id: string;
  name: string;
  price: number;
  yield_amount: number;
  description: string;
  is_active: boolean;
};

export function PropertiesManager({ stations, properties }: { stations: Station[]; properties: Property[] }) {
  const router = useRouter();
  const [stationId, setStationId] = useState(stations[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, Partial<Property>>>({});

  const stationProperties = properties.filter((p) => p.station_id === stationId);

  function getDraft(p: Property) {
    return { name: p.name, price: p.price, yield_amount: p.yield_amount, description: p.description, ...draft[p.id] };
  }

  async function handleSave(p: Property) {
    const d = getDraft(p);
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("station_properties")
      .update({ name: d.name, price: d.price, yield_amount: d.yield_amount, description: d.description })
      .eq("id", p.id);
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleAdd() {
    if (!stationId) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("station_properties").insert({
      station_id: stationId,
      name: "(新しい物件)",
      price: 0,
      yield_amount: 0,
      description: "",
    });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("この物件を削除しますか?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("station_properties").delete().eq("id", id);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">物件(駅ごとに設定)</h2>
      <p className="text-xs text-zinc-500">ミッション成功後、その駅に物件があれば参加者に購入画面が表示されます。</p>
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

      <div className="mt-2 space-y-2">
        {stationProperties.map((p) => {
          const d = getDraft(p);
          return (
            <div key={p.id} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
              <input
                value={d.name}
                onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, name: e.target.value } })}
                onBlur={() => handleSave(p)}
                className="w-full border-b border-transparent bg-transparent text-sm font-medium focus:border-zinc-400 focus:outline-none"
              />
              <div className="mt-1 flex gap-2 text-xs">
                <label className="flex items-center gap-1">
                  価格
                  <input
                    type="number"
                    value={d.price}
                    onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, price: Number(e.target.value) } })}
                    onBlur={() => handleSave(p)}
                    className="w-28 rounded border border-zinc-300 px-1 dark:border-zinc-700 dark:bg-zinc-800"
                  />
                </label>
                <label className="flex items-center gap-1">
                  利回り(固定額)
                  <input
                    type="number"
                    value={d.yield_amount}
                    onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, yield_amount: Number(e.target.value) } })}
                    onBlur={() => handleSave(p)}
                    className="w-28 rounded border border-zinc-300 px-1 dark:border-zinc-700 dark:bg-zinc-800"
                  />
                </label>
              </div>
              <textarea
                value={d.description}
                onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, description: e.target.value } })}
                onBlur={() => handleSave(p)}
                rows={2}
                placeholder="説明"
                className="mt-1 w-full resize-none border-b border-transparent bg-transparent text-xs text-zinc-600 focus:border-zinc-400 focus:outline-none dark:text-zinc-400"
              />
              <button onClick={() => handleDelete(p.id)} className="mt-1 text-xs text-zinc-400 hover:text-red-600">
                削除
              </button>
            </div>
          );
        })}
        {stationProperties.length === 0 && <p className="text-xs text-zinc-400">未登録</p>}
      </div>
      <button
        onClick={handleAdd}
        disabled={busy || !stationId}
        className="mt-2 text-xs text-zinc-500 hover:underline"
      >
        + 物件を追加
      </button>
    </section>
  );
}
