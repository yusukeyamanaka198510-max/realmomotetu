"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LinesManager({ lines }: { lines: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    if (!name.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { data: event } = await supabase.from("events").select("id").single();
    const { error } = await supabase.from("lines").insert({ event_id: event!.id, name: name.trim() });
    setBusy(false);
    if (error) return window.alert(error.message);
    setName("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("この路線を削除しますか?(関連する接続情報も削除されます)")) return;
    const supabase = createClient();
    const { error } = await supabase.from("lines").delete().eq("id", id);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">路線</h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-1 rounded-full border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700">
            {l.name}
            <button onClick={() => handleDelete(l.id)} className="text-zinc-400 hover:text-red-600">
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新しい路線名"
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
