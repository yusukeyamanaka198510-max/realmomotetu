"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GameButton } from "@/components/game-ui";

export function TeamNameChangePanel({ currentName }: { currentName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setMessage(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("チーム名を入力してください");
      return;
    }
    if (trimmed.length > 30) {
      setError("チーム名は30文字以内にしてください");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_team_rename_self", { p_team_name: trimmed });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setMessage("チーム名を変更しました");
    router.refresh();
  }

  return (
    <div className="mt-4 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <button onClick={() => setOpen(!open)} className="font-medium">
        チーム名変更 {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">他チーム・本部からも見える名前です</p>
          <input
            type="text"
            placeholder="チーム名"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          {message && <p className="text-xs text-emerald-600">{message}</p>}
          <GameButton onClick={handleSubmit} disabled={busy || !name.trim()} variant="primary" className="!px-3 !py-1.5 !text-xs">
            変更する
          </GameButton>
        </div>
      )}
    </div>
  );
}
