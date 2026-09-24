"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GamePanel, GameBadge, GameText, ConfettiBurst } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";
import { COIN_TRANSACTION_LABELS, type CoinTransactionType } from "@/lib/game/types";

export type RetrospectiveTeam = {
  team_id: string;
  team_number: number;
  team_name: string;
  representative_name: string | null;
  rank: number;
  coin_balance: number;
  total_assets: number;
};

export type RetrospectiveEvent = {
  at: string;
  kind:
    | "ARRIVAL"
    | "MISSION"
    | "BONUS_MISSION"
    | "DESTINATION_CLEAR"
    | "CARD_USE"
    | "CARD_USED_AGAINST"
    | "PROPERTY_PURCHASE"
    | "COIN"
    | "STAFF_REJECT"
    | "BOMBII_ASSIGNED";
  detail: Record<string, unknown>;
};

const RANK_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const DIFFICULTY_LABEL: Record<string, string> = { EASY: "かんたん", NORMAL: "ふつう", HARD: "むずかしい" };

// 妨害カードを使われた際に、具体的に何が出来なくなるか(振り返り画面での表示用)。
const CARD_EFFECT_RESTRICTION_LABEL: Record<string, string> = {
  SWAP_LOCATION: "現在地を交換させられた",
  FORCE_NEXT_MOVE_FIXED_1: "次回の移動が1駅固定にされた",
  BLOCK_NEXT_MOVEMENT_CARD: "次回移動時、移動系カードが使えなくなった",
  BLOCK_UNTIL_MISSION_SUCCESS: "ミッションに成功するまで移動できなくなった",
  PUSH_BACK_SAME_STATION_TEAMS: "目的地から遠ざかる方向へ移動させられた",
  BLOCK_NEXT_CARD_USE: "次回のカード使用権を失った",
  STEAL_RANDOM_CARD: "所持カードを1枚奪われた",
  DESTROY_RANDOM_CARD: "所持カードを1枚破棄された",
  STEAL_COIN_PERCENT: "所持コインの一部を奪われた",
  BOMBII_TRANSFER: "ボンビーを押し付けられた",
};

function timeLabel(at: string) {
  return new Date(at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function EventRow({ event }: { event: RetrospectiveEvent }) {
  const d = event.detail;
  let icon = "📌";
  let body: React.ReactNode = null;
  let subBody: React.ReactNode = null;
  let subBodyIsWarning = false;

  switch (event.kind) {
    case "ARRIVAL":
      icon = "🚉";
      body = <span>{String(d.station_name ?? "-")} に到着</span>;
      break;
    case "MISSION": {
      const success = d.result === "SUCCESS";
      icon = success ? "🎯" : "💦";
      body = (
        <span>
          ミッション「{String(d.title ?? "-")}」
          <GameBadge tone={success ? "green" : "red"} size="lg">{success ? "成功" : "失敗"}</GameBadge>
          {d.difficulty ? <span className="text-lg text-zinc-400"> ({DIFFICULTY_LABEL[String(d.difficulty)] ?? String(d.difficulty)})</span> : null}
          {typeof d.reward === "number" && d.reward !== 0 && (
            <span className="ml-2 font-mono text-4xl font-black text-game-gold">{formatYen(d.reward)}</span>
          )}
        </span>
      );
      if (d.description) subBody = String(d.description);
      if (!success && d.reason) {
        subBody = `却下理由: ${String(d.reason)}`;
        subBodyIsWarning = true;
      }
      break;
    }
    case "BONUS_MISSION": {
      const success = d.result === "SUCCESS";
      icon = "✨";
      body = (
        <span>
          ボーナスミッション「{String(d.title ?? "-")}」
          <GameBadge tone={success ? "green" : "red"} size="lg">{success ? "成功" : "失敗"}</GameBadge>
          {typeof d.reward === "number" && d.reward !== 0 && (
            <span className="ml-2 font-mono text-4xl font-black text-game-gold">{formatYen(d.reward)}</span>
          )}
        </span>
      );
      if (d.description) subBody = String(d.description);
      break;
    }
    case "DESTINATION_CLEAR":
      icon = "🏁";
      body = (
        <span>
          最終目的地「{String(d.station_name ?? "-")}」に到達!
          {typeof d.bonus === "number" && (
            <span className="ml-2 font-mono text-4xl font-black text-amber-600">+{formatYen(d.bonus)}</span>
          )}
        </span>
      );
      break;
    case "CARD_USE":
      icon = "🎴";
      body = (
        <span>
          カード「{String(d.card_name ?? "-")}」を使用
          {d.target_team_name ? <span className="text-zinc-500">(対象: {String(d.target_team_name)})</span> : null}
        </span>
      );
      break;
    case "CARD_USED_AGAINST": {
      icon = "🎯";
      const blocked = d.result === "BLOCKED_BY_BARRIER";
      body = (
        <span>
          {String(d.used_by_team_name ?? "-")}から「{String(d.card_name ?? "-")}」を使われた
          {blocked && <span className="text-zinc-500">(カードバリアで防いだ)</span>}
        </span>
      );
      if (!blocked) {
        const restriction = CARD_EFFECT_RESTRICTION_LABEL[String(d.effect_type ?? "")];
        if (restriction) {
          subBody = restriction;
          subBodyIsWarning = true;
        }
      }
      break;
    }
    case "PROPERTY_PURCHASE":
      icon = "🏠";
      body = (
        <span>
          物件「{String(d.property_name ?? "-")}」
          {d.station_name ? <span className="text-zinc-500">({String(d.station_name)})</span> : null}
          を購入
          {typeof d.price === "number" && (
            <span className="ml-2 font-mono text-4xl font-black text-red-600">-{formatYen(d.price)}</span>
          )}
        </span>
      );
      if (typeof d.yield_amount === "number") {
        const price = typeof d.price === "number" ? d.price : null;
        const rate = price ? (d.yield_amount / price) * 100 : null;
        subBody = `利回り${rate !== null ? ` ${rate.toFixed(1)}%` : ""}: 精算時に ${formatYen(d.yield_amount)} 上乗せ`;
      }
      break;
    case "COIN": {
      const type = d.transaction_type as CoinTransactionType;
      const amount = Number(d.amount ?? 0);
      icon = "💰";
      body = (
        <span>
          {COIN_TRANSACTION_LABELS[type] ?? type}
          <span className={`ml-2 font-mono text-4xl font-black ${amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {amount >= 0 ? "+" : ""}
            {formatYen(amount)}
          </span>
        </span>
      );
      if (d.reason) subBody = String(d.reason);
      break;
    }
    case "STAFF_REJECT":
      icon = "🙅";
      body = (
        <span>
          本部による到着差し戻し
          {d.reason ? <span className="font-bold text-game-red"> 「{String(d.reason)}」</span> : null}
        </span>
      );
      break;
    case "BOMBII_ASSIGNED":
      icon = "😈";
      body = (
        <span>
          ボンビーが取り憑いた!
          {d.from_station_name ? <span className="text-zinc-500">({String(d.from_station_name)}から)</span> : null}
        </span>
      );
      break;
  }

  return (
    <li className="rounded-2xl bg-zinc-50 px-5 py-4 dark:bg-zinc-800/60">
      <div className="flex items-start gap-4 text-2xl">
        <span className="shrink-0 text-5xl leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xl text-zinc-400">{timeLabel(event.at)}</p>
          <p className="mt-1">{body}</p>
          {subBody && (
            <p className={`mt-2 text-2xl font-bold ${subBodyIsWarning ? "text-game-red" : "text-zinc-600 dark:text-zinc-300"}`}>
              {subBody}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function TeamResultHero({ team }: { team: RetrospectiveTeam }) {
  return (
    <div className="anim-pop rounded-[var(--game-radius-lg)] border-4 border-game-gold bg-gradient-to-b from-game-navy to-slate-900 p-10 text-center shadow-[var(--game-shadow-lg)]">
      <p className="text-xl font-bold text-white/70">最終結果</p>
      <p className="mt-2 text-7xl font-black text-white">{team.rank}位</p>
      <GameText as="h2" variant="title" className="mt-3 block !text-6xl !text-white sm:!text-7xl">
        {team.team_name}
      </GameText>
      <p className="mt-4 text-lg font-bold text-white/60">総資産額</p>
      <GameText as="p" variant="coin-positive" className="text-5xl sm:text-6xl">
        {formatYen(team.total_assets)}
      </GameText>
    </div>
  );
}

export function RetrospectiveClient({
  eventId,
  teams,
  eventsByTeamId,
}: {
  eventId: string;
  teams: RetrospectiveTeam[];
  eventsByTeamId: Record<string, RetrospectiveEvent[]>;
}) {
  const router = useRouter();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(teams[0]?.team_id ?? null);
  const [revealed, setRevealed] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  function selectTeam(teamId: string) {
    setSelectedTeamId(teamId);
    setRevealed(false);
  }

  function reveal() {
    setRevealed(true);
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 2500);
  }

  useEffect(() => {
    const supabase = createClient();
    const tables = [
      "arrival_submissions",
      "team_mission_attempts",
      "team_bonus_mission_attempts",
      "destination_queue",
      "card_usage_log",
      "coin_ledger",
      "team_state",
    ];
    const channel = supabase.channel(`retrospective:${eventId}`);
    for (const table of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `event_id=eq.${eventId}` }, () =>
        router.refresh()
      );
    }
    channel.subscribe();
    // Realtime切断時の見逃し防止フォールバック(当日リアルタイム更新の要となるページのため)。
    const interval = setInterval(() => router.refresh(), 20000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [eventId, router]);

  const selectedTeam = teams.find((t) => t.team_id === selectedTeamId) ?? null;
  const selectedEvents = selectedTeamId ? (eventsByTeamId[selectedTeamId] ?? []) : [];

  return (
    <div className="space-y-6">
      <GameText as="h1" variant="title" className="block !text-5xl sm:!text-6xl">
        📖 振り返り
      </GameText>

      <GamePanel title="現在の順位" icon="🏆" accent="gold" collapsible defaultOpen={false}>
        <ul className="grid grid-cols-1 gap-2 text-xl sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((t) => (
            <li key={t.team_id} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
              <span className="flex min-w-0 items-center gap-2">
                <span className={t.rank <= 3 ? "text-3xl" : "text-lg text-zinc-400"}>{RANK_MEDAL[t.rank] ?? `${t.rank}位`}</span>
                <span className="truncate">{t.team_name}</span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-game-gold">{formatYen(t.total_assets)}</span>
            </li>
          ))}
        </ul>
      </GamePanel>

      <div className="flex flex-wrap gap-3">
        {teams.map((t) => (
          <button
            key={t.team_id}
            type="button"
            onClick={() => selectTeam(t.team_id)}
            className={`shrink-0 rounded-full border-2 px-6 py-3 text-2xl font-bold ${
              t.team_id === selectedTeamId
                ? "border-game-navy bg-game-navy text-white dark:border-game-gold dark:bg-game-gold dark:text-slate-900"
                : "border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            }`}
          >
            {t.rank}位
          </button>
        ))}
      </div>

      {selectedTeam && (
        <GamePanel title="今日のできごと" icon="📷" accent="navy">
          {selectedEvents.length === 0 ? (
            <p className="text-2xl text-zinc-400">まだ記録がありません</p>
          ) : (
            <ul className="space-y-3">
              {selectedEvents.map((e, i) => (
                <EventRow key={i} event={e} />
              ))}
            </ul>
          )}
          <div className="mt-6">
            {revealed ? (
              <>
                {showConfetti && <ConfettiBurst />}
                <TeamResultHero team={selectedTeam} />
              </>
            ) : (
              <button
                type="button"
                onClick={reveal}
                className="anim-pop w-full rounded-[var(--game-radius-lg)] border-4 border-dashed border-game-gold bg-gradient-to-b from-amber-50 to-amber-100 p-14 text-center shadow-[var(--game-shadow-md)] dark:from-amber-950 dark:to-slate-900"
              >
                <p className="text-8xl">🎁</p>
                <p className="mt-4 text-4xl font-black text-game-navy dark:text-game-gold">どのチーム?</p>
                <p className="mt-2 text-xl text-zinc-500 dark:text-zinc-400">タップして結果を発表!</p>
              </button>
            )}
          </div>
        </GamePanel>
      )}
    </div>
  );
}
