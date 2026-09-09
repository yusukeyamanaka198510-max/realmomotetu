"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { staffBtn } from "./StaffUI";

export function RehearsalResetPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    setError(null);
    const typed = window.prompt(
      "全チームの進行状況(所持コイン・カード・不動産・ミッション履歴など)を消去し、イベントを開始前の状態に戻します。\n" +
        "チームのアカウント自体は残ります。取り消せません。\n\n" +
        "続行するには「リセット」と入力してください。"
    );
    if (typed !== "リセット") return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_rehearsal_reset");
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        試運転が終わったら、これを押すだけで全チームがまっさらな状態に戻ります(細かい個別設定は不要です)。
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={handleReset} disabled={busy} className={staffBtn.danger}>
        🔄 リハーサルリセット(全チーム初期化)
      </button>
    </div>
  );
}
