import Link from "next/link";
import type { TeamGameState } from "@/lib/game/types";
import { CoinDisplay } from "./CoinDisplay";
import { GameBadge, GamePanel } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";

const ACTION_LABEL: Record<TeamGameState, string> = {
  WAITING: "本部の開始を待っています",
  DICE_READY: "サイコロを振る",
  ROLLING: "サイコロを振る",
  DESTINATION_SELECTION: "移動する駅を選ぶ",
  TRAVELING: "到着を報告する",
  ARRIVAL_SUBMISSION: "到着証拠を提出する",
  ARRIVAL_REVIEW: "本部確認中…",
  MISSION_SELECTION: "ミッションを選ぶ",
  MISSION_ACTIVE: "証拠写真を提出する",
  MISSION_REVIEW: "本部判定中…",
  MISSION_REWARD_CHOICE: "報酬を選ぶ",
  PROPERTY_PURCHASE: "物件を見る(任意)",
  PAUSED: "一時停止中",
  FINISHED: "ゲーム終了",
};

const EFFECT_LABEL: Record<string, { label: string; tone: "bad" | "good" }> = {
  FORCED_FIXED_MOVE_1: { label: "次の移動は1駅固定", tone: "bad" },
  BLOCK_NEXT_MOVEMENT_CARD: { label: "移動カード使用不可", tone: "bad" },
  BLOCK_UNTIL_MISSION_SUCCESS: { label: "ミッション成功まで移動不可", tone: "bad" },
  BLOCK_NEXT_CARD_USE: { label: "カード使用不可", tone: "bad" },
  MISSION_REWARD_MULTIPLIER: { label: "ミッション報酬アップ中", tone: "good" },
  HOT_STREAK: { label: "絶好調(サイコロ2個)", tone: "good" },
  PROPERTY_YIELD_X2: { label: "物件収益2倍(決算時)", tone: "good" },
  SHARE_NEXT_MISSION_REWARD: { label: "おすそわけ設定中", tone: "good" },
};

export function StatusHeader({
  teamName,
  representativeName,
  state,
  isEventOver,
  isEventScheduled,
  coinBalance,
  currentStationName,
  transitLabel,
  nextStationName,
  destinationStationName,
  currentGoalDistance,
  propertyAssetTotal,
  activeEffects,
  hasBombii,
}: {
  teamName: string;
  representativeName: string | null;
  state: TeamGameState;
  isEventOver: boolean;
  isEventScheduled: boolean;
  coinBalance: number;
  currentStationName: string | null;
  transitLabel: string | null;
  nextStationName: string | null;
  destinationStationName: string | null;
  currentGoalDistance: number | null;
  propertyAssetTotal: number;
  activeEffects: { id: string; effect_type: string }[];
  hasBombii: boolean;
}) {
  const actionLabel = isEventOver ? "ゲーム終了" : isEventScheduled ? "本部の開始を待っています" : ACTION_LABEL[state] ?? state;

  return (
    <GamePanel accent="gold" className="border-2 border-game-navy/10">
      <div className="flex items-center justify-between">
        <h1 className="font-game text-lg font-black text-game-navy dark:text-game-gold">
          🚃 {teamName}
          {representativeName && <span className="ml-1.5 text-sm font-bold text-zinc-400">({representativeName})</span>}
          {hasBombii && <span className="ml-1.5 align-middle text-base" title="ボンビー憑依中">😈</span>}
        </h1>
        <Link href="/team/mypage" className="shrink-0 rounded-full border-2 border-zinc-300 px-2.5 py-1 text-xs font-bold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
          マイページ
        </Link>
      </div>

      {!isEventOver && (
        <div className="mt-2 rounded-full bg-gradient-to-b from-amber-300 to-game-gold px-3 py-2.5 text-center text-sm font-black text-amber-950 shadow-[var(--game-shadow-sm)]">
          今すべきこと: {actionLabel}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <CoinDisplay balance={coinBalance} />
        <div className="rounded-xl bg-gradient-to-b from-emerald-50 to-emerald-100 px-3 py-2 dark:from-emerald-950 dark:to-emerald-900">
          <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">🏠不動産資産額</p>
          <p className="text-lg font-black tabular-nums text-emerald-700 dark:text-emerald-300">{formatYen(propertyAssetTotal)}</p>
        </div>
      </div>

      <div className="mt-2 rounded-xl bg-sky-50 px-3 py-2 text-sm dark:bg-sky-950">
        <p className="text-[11px] font-bold text-sky-700 dark:text-sky-300">現在地</p>
        <p className="truncate text-base font-semibold text-sky-900 dark:text-sky-100">
          {transitLabel && nextStationName ? (
            <>
              {currentStationName ?? "-"}→{nextStationName}
            </>
          ) : (
            currentStationName ?? "-"
          )}
        </p>
        {transitLabel && nextStationName && <p className="text-[11px] text-sky-700 dark:text-sky-300">({transitLabel})</p>}
        {!transitLabel && currentGoalDistance !== null && (
          <p className="text-[11px] font-bold text-sky-700 dark:text-sky-300">
            {currentGoalDistance === 0 ? "🏁 ゴール駅!" : `ゴールまで ${currentGoalDistance}マス`}
          </p>
        )}
      </div>

      {destinationStationName && (
        <div className="mt-2 flex items-center justify-between rounded-xl border-2 border-dashed border-game-gold/60 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40">
          <span className="font-bold text-amber-700 dark:text-amber-300">今の目的地</span>
          <span className="font-black text-game-gold">🏁 {destinationStationName}</span>
        </div>
      )}

      {activeEffects.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {activeEffects.map((e) => {
            const info = EFFECT_LABEL[e.effect_type] ?? { label: e.effect_type, tone: "bad" as const };
            return (
              <GameBadge key={e.id} tone={info.tone === "bad" ? "red" : "green"}>
                {info.label}
              </GameBadge>
            );
          })}
        </div>
      )}
    </GamePanel>
  );
}
