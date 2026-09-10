"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GamePanel, GameBadge, GameText } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";
import { COIN_TRANSACTION_LABELS, type CoinTransactionType } from "@/lib/game/types";

export type RetrospectiveTeam = {
  team_id: string;
  team_number: number;
  team_name: string;
  representative_name: string | null;
  rank: number;
  coin_balance: number;
};

export type RetrospectiveEvent = {
  at: string;
  kind: "ARRIVAL" | "MISSION" | "BONUS_MISSION" | "DESTINATION_CLEAR" | "CARD_USE" | "COIN" | "STAFF_REJECT" | "BOMBII_ASSIGNED";
  detail: Record<string, unknown>;
  photoUrls: string[];
};

const RANK_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const DIFFICULTY_LABEL: Record<string, string> = { EASY: "かんたん", NORMAL: "ふつう", HARD: "むずかしい" };

function timeLabel(at: string) {
  return new Date(at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function PhotoGallery({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {urls.map((url, i) => (
        <a key={i} href={url} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- 署名付きURL(一時的)のためnext/imageの最適化キャッシュ対象に向かない */}
          <img src={url} alt="" className="h-20 w-20 rounded-lg border-2 border-white object-cover shadow dark:border-zinc-700" />
        </a>
      ))}
    </div>
  );
}

function EventRow({ event }: { event: RetrospectiveEvent }) {
  const d = event.detail;
  let icon = "📌";
  let body: React.ReactNode = null;

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
          <GameBadge tone={success ? "green" : "red"}>{success ? "成功" : "失敗"}</GameBadge>
          {d.difficulty ? <span className="text-xs text-zinc-400"> ({DIFFICULTY_LABEL[String(d.difficulty)] ?? String(d.difficulty)})</span> : null}
          {typeof d.reward === "number" && d.reward !== 0 && (
            <span className="ml-1 font-mono text-xs text-zinc-500">{formatYen(d.reward)}</span>
          )}
        </span>
      );
      break;
    }
    case "BONUS_MISSION": {
      const success = d.result === "SUCCESS";
      icon = "✨";
      body = (
        <span>
          ボーナスミッション「{String(d.title ?? "-")}」
          <GameBadge tone={success ? "green" : "red"}>{success ? "成功" : "失敗"}</GameBadge>
          {typeof d.reward === "number" && d.reward !== 0 && (
            <span className="ml-1 font-mono text-xs text-zinc-500">{formatYen(d.reward)}</span>
          )}
        </span>
      );
      break;
    }
    case "DESTINATION_CLEAR":
      icon = "🏁";
      body = (
        <span>
          最終目的地「{String(d.station_name ?? "-")}」に到達!
          {typeof d.bonus === "number" && <span className="ml-1 font-mono text-xs text-amber-600">+{formatYen(d.bonus)}</span>}
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
    case "COIN": {
      const type = d.transaction_type as CoinTransactionType;
      const amount = Number(d.amount ?? 0);
      icon = "💰";
      body = (
        <span>
          {COIN_TRANSACTION_LABELS[type] ?? type}
          <span className={`ml-1 font-mono text-xs ${amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {amount >= 0 ? "+" : ""}
            {formatYen(amount)}
          </span>
        </span>
      );
      break;
    }
    case "STAFF_REJECT":
      icon = "🙅";
      body = (
        <span>
          本部による到着差し戻し
          {d.reason ? <span className="text-zinc-500"> 「{String(d.reason)}」</span> : null}
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
    <li className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
      <div className="flex items-start gap-2 text-sm">
        <span className="shrink-0 text-base leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-400">{timeLabel(event.at)}</p>
          <p>{body}</p>
          <PhotoGallery urls={event.photoUrls} />
        </div>
      </div>
    </li>
  );
}

function TeamResultHero({ team }: { team: RetrospectiveTeam }) {
  return (
    <div className="anim-pop rounded-[var(--game-radius-lg)] border-4 border-game-gold bg-gradient-to-b from-game-navy to-slate-900 p-6 text-center shadow-[var(--game-shadow-lg)]">
      <p className="text-sm font-bold text-white/70">最終結果</p>
      <p className="mt-1 text-5xl">{RANK_MEDAL[team.rank] ?? `${team.rank}位`}</p>
      <GameText as="h2" variant="title" className="mt-2 block !text-white">
        {team.team_name}
      </GameText>
      <p className="mt-3 text-xs font-bold text-white/60">総資産額</p>
      <GameText as="p" variant="coin-positive" className="text-3xl sm:text-4xl">
        {formatYen(team.coin_balance)}
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
    <div className="space-y-4">
      <GameText as="h1" variant="title" className="block">
        📖 振り返り
      </GameText>

      <GamePanel title="現在の順位" icon="🏆" accent="gold" collapsible defaultOpen>
        <ul className="space-y-1.5 text-sm">
          {teams.map((t) => (
            <li key={t.team_id} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
              <span className="flex items-center gap-1.5">
                <span className={t.rank <= 3 ? "text-base" : "text-xs text-zinc-400"}>{RANK_MEDAL[t.rank] ?? `${t.rank}位`}</span>
                <span>{t.team_name}</span>
              </span>
              <span className="font-mono tabular-nums text-game-gold">{formatYen(t.coin_balance)}</span>
            </li>
          ))}
        </ul>
      </GamePanel>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {teams.map((t) => (
          <button
            key={t.team_id}
            type="button"
            onClick={() => setSelectedTeamId(t.team_id)}
            className={`shrink-0 rounded-full border-2 px-3 py-1.5 text-sm font-bold ${
              t.team_id === selectedTeamId
                ? "border-game-navy bg-game-navy text-white dark:border-game-gold dark:bg-game-gold dark:text-slate-900"
                : "border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            }`}
          >
            {t.team_name}
          </button>
        ))}
      </div>

      {selectedTeam && (
        <GamePanel title={`${selectedTeam.team_name} の1日`} icon="📷" accent="navy">
          {selectedEvents.length === 0 ? (
            <p className="text-sm text-zinc-400">まだ記録がありません</p>
          ) : (
            <ul className="space-y-2">
              {selectedEvents.map((e, i) => (
                <EventRow key={i} event={e} />
              ))}
            </ul>
          )}
          <div className="mt-4">
            <TeamResultHero team={selectedTeam} />
          </div>
        </GamePanel>
      )}
    </div>
  );
}
