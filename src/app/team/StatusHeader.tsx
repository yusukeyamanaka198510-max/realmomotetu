import type { TeamGameState } from "@/lib/game/types";
import { CoinDisplay } from "./CoinDisplay";
import { GameBadge, GamePanel } from "@/components/game-ui";

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
  state,
  isEventOver,
  isEventScheduled,
  coinBalance,
  currentStationName,
  transitLabel,
  nextStationName,
  destinationStationName,
  currentGoalDistance,
  activeEffects,
}: {
  teamName: string;
  state: TeamGameState;
  isEventOver: boolean;
  isEventScheduled: boolean;
  coinBalance: number;
  currentStationName: string | null;
  transitLabel: string | null;
  nextStationName: string | null;
  destinationStationName: string | null;
  currentGoalDistance: number | null;
  activeEffects: { id: string; effect_type: string }[];
}) {
  const actionLabel = isEventOver ? "ゲーム終了" : isEventScheduled ? "本部の開始を待っています" : ACTION_LABEL[state] ?? state;

  return (
    <GamePanel accent="gold" className="border-2 border-game-navy/10">
      <div className="flex items-center justify-between">
        <h1 className="font-game text-lg font-black text-game-navy dark:text-game-gold">🚃 {teamName}</h1>
      </div>

      {!isEventOver && (
        <div className="mt-2 rounded-full bg-gradient-to-b from-game-navy to-slate-900 px-3 py-2.5 text-center text-sm font-bold text-white shadow-[var(--game-shadow-sm)]">
          今すべきこと: {actionLabel}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <CoinDisplay balance={coinBalance} />
        <div className="rounded-xl bg-sky-50 px-3 py-2 dark:bg-sky-950">
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
      </div>

      {destinationStationName && (
        <div className="mt-2 flex items-center justify-between rounded-xl border-2 border-dashed border-game-gold/60 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40">
          <span className="font-bold text-amber-700 dark:text-amber-300">目的地(ゴール)</span>
          <span className="font-black text-game-gold">
            🏁 {destinationStationName}
            {currentGoalDistance !== null && currentGoalDistance > 0 && (
              <span className="ml-1 text-xs font-bold text-amber-600">(あと{currentGoalDistance}マス)</span>
            )}
          </span>
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
