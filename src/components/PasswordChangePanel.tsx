"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function PasswordChangePanel() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setMessage(null);
    if (password.length < 6) {
      setError("パスワードは6文字以上にしてください");
      return;
    }
    if (password !== confirm) {
      setError("確認用パスワードが一致しません");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setMessage("パスワードを変更しました");
    setPassword("");
    setConfirm("");
  }

  return (
    <div className="mt-4 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <button onClick={() => setOpen(!open)} className="font-medium">
        パスワード変更 {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <input
            type="password"
            placeholder="新しいパスワード(6文字以上)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <input
            type="password"
            placeholder="新しいパスワード(確認)"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          {message && <p className="text-xs text-emerald-600">{message}</p>}
          <button
            onClick={handleSubmit}
            disabled={busy || !password || !confirm}
            className="rounded bg-zinc-900 px-3 py-1.5 text-xs text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            変更する
          </button>
        </div>
      )}
    </div>
  );
}
