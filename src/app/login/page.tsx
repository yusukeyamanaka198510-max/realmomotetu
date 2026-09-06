"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GameButton, GameText } from "@/components/game-ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("ログインに失敗しました。メールアドレスとパスワードを確認してください。");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-dvh items-end justify-center overflow-hidden bg-gradient-to-b from-game-skyblue via-sky-200 to-game-gold px-4 pb-10 pt-[40vh] dark:from-slate-900 dark:via-slate-800 dark:to-amber-950">
      <div
        className="anim-bg-fade-in pointer-events-none absolute inset-0 bg-cover bg-top"
        style={{ backgroundImage: "url(/board-illustration.webp)" }}
      />
      <form
        onSubmit={handleSubmit}
        className="anim-modal-fade-in relative w-full max-w-sm space-y-5 rounded-[var(--game-radius-lg)] border-4 border-white/70 bg-white/95 p-6 shadow-[var(--game-shadow-lg)] backdrop-blur dark:border-white/10 dark:bg-zinc-900/95"
      >
        <div className="text-center">
          <p className="anim-bounce text-4xl">🚃</p>
          <GameText as="h1" variant="title" className="mt-1 block">
            リアル桃鉄
          </GameText>
          <p className="mt-1 text-xs font-bold text-zinc-500 dark:text-zinc-400">ログインして参加</p>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-zinc-600 dark:text-zinc-400">メールアドレス</label>
          <input
            type="email"
            required
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border-2 border-zinc-300 px-3 py-2.5 text-base dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-zinc-600 dark:text-zinc-400">パスワード</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border-2 border-zinc-300 px-3 py-2.5 text-base dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        {error && <p className="anim-shake text-sm font-bold text-game-red">{error}</p>}
        <GameButton type="submit" variant="dice" size="lg" disabled={loading} className="w-full">
          {loading ? "ログイン中..." : "しゅっぱつ進行!"}
        </GameButton>
      </form>
    </div>
  );
}
