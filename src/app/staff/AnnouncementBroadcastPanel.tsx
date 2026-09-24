"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { staffBtn } from "./StaffUI";

// 各チームの画面にモーダルで一斉表示する自由入力のアナウンス機能。
// 送信後は動作確認のため、本部画面にもチーム側と同じ見た目のモーダルを表示する。
export function AnnouncementBroadcastPanel() {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) return;
    if (!window.confirm(`全チームの画面にモーダルで表示します:\n\n「${trimmed}」\n\nよろしいですか?`)) return;
    setSending(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_broadcast_announcement", { p_message: trimmed });
    setSending(false);
    if (error) return window.alert(error.message);
    setPreview(trimmed);
    setMessage("");
  }

  return (
    <>
      <div className="space-y-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="例: 昼休憩まで1時間を切りました!まだまだデッドヒートです!諦めずに頑張りましょう!"
          rows={3}
          className="w-full rounded-xl border-2 border-zinc-300 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button onClick={handleSend} disabled={sending || !message.trim()} className={staffBtn.primary}>
          {sending ? "送信中…" : "📢全チームへモーダル表示"}
        </button>
      </div>

      {preview && (
        <div role="alertdialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5">
          <div className="w-full max-w-md rounded-2xl border-4 border-indigo-500 bg-white p-8 text-center shadow-xl dark:bg-zinc-900">
            <p className="text-6xl">📢</p>
            <p className="mt-2 text-2xl font-bold text-indigo-600 dark:text-indigo-400">本部からのお知らせ</p>
            <p className="mt-1 text-xs text-zinc-400">(動作確認用プレビュー。全チームの画面にも同じ内容が表示されています)</p>
            <p className="mt-4 whitespace-pre-wrap rounded-lg bg-indigo-50 p-4 text-left text-lg font-bold leading-relaxed text-zinc-700 dark:bg-indigo-950 dark:text-zinc-200">
              {preview}
            </p>
            <div className="mt-6">
              <button onClick={() => setPreview(null)} className={`${staffBtn.primary} w-full`}>
                確認しました
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
