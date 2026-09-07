"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, missionPhotoPath } from "@/lib/game/storage";
import { GameButton, GamePanel } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";

export type BonusMissionAttempt = {
  id: string;
  title: string | null;
  description: string | null;
  reward: number;
  status: string;
};

export function BonusMissionPanel({
  teamId,
  eventId,
  attempt,
}: {
  teamId: string;
  eventId: string;
  attempt: BonusMissionAttempt | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`bonus_mission:${teamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_bonus_mission_attempts", filter: `team_id=eq.${teamId}` },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId, router]);

  if (!attempt || attempt.status === "SUCCESS" || attempt.status === "FAILURE") return null;

  async function handleSubmit() {
    if (!attempt) return;
    if (files.length !== 1) {
      setError("写真を1枚アップロードしてください");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    try {
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const path = missionPhotoPath(eventId, teamId, `bonus-${attempt.id}`, i, files[i].name);
        const { error: uploadError } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, files[i]);
        if (uploadError) throw uploadError;
        paths.push(path);
      }
      const { error: rpcError } = await supabase.rpc("fn_submit_bonus_mission_photos", {
        p_bonus_attempt_id: attempt.id,
        p_photo_paths: paths,
      });
      if (rpcError) throw rpcError;
      setFiles([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提出に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GamePanel title="ボーナスミッション" icon="✨" accent="purple" className="mt-6 border-2 border-fuchsia-200 dark:border-fuchsia-900">
      <p className="font-bold">{attempt.title}</p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{attempt.description}</p>
      <p className="mt-1 text-xs font-bold text-game-gold">成功報酬: +{formatYen(attempt.reward)}(通常ミッションとは別に加算)</p>

      {error && <p className="mt-2 text-xs font-bold text-game-red">{error}</p>}

      {attempt.status === "PENDING_REVIEW" ? (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">写真を送信しました。本部確認中です…</p>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block w-full cursor-pointer rounded-xl border-2 border-dashed border-fuchsia-400 bg-white p-3 text-center text-sm hover:bg-fuchsia-50 dark:bg-transparent dark:hover:bg-fuchsia-900">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 1))}
              className="hidden"
            />
            {files.length > 0 ? `${files.length}枚選択済み(タップして変更)` : "タップして写真を選択(1枚)"}
          </label>
          <GameButton onClick={handleSubmit} disabled={busy || files.length === 0} variant="card" className="w-full">
            {busy ? "提出中..." : "✨ ボーナスミッションを提出する"}
          </GameButton>
        </div>
      )}
    </GamePanel>
  );
}
