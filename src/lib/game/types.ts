export const TEAM_GAME_STATES = [
  "WAITING",
  "START_CHECKIN",
  "START_CHECKIN_REVIEW",
  "DICE_READY",
  "ROLLING",
  "DESTINATION_SELECTION",
  "TRAVELING",
  "ARRIVAL_SUBMISSION",
  "ARRIVAL_REVIEW",
  "MISSION_SELECTION",
  "MISSION_ACTIVE",
  "MISSION_REVIEW",
  "MISSION_REWARD_CHOICE",
  "PROPERTY_PURCHASE",
  "PAUSED",
  "FINISHED",
] as const;

export type TeamGameState = (typeof TEAM_GAME_STATES)[number];

// 許可された遷移。PAUSED / FINISHED は任意状態から到達しうるため別枠で扱う。
export const TEAM_STATE_TRANSITIONS: Record<TeamGameState, TeamGameState[]> = {
  WAITING: ["START_CHECKIN"],
  START_CHECKIN: ["START_CHECKIN_REVIEW"],
  START_CHECKIN_REVIEW: ["DICE_READY", "START_CHECKIN"],
  DICE_READY: ["ROLLING"],
  ROLLING: ["DESTINATION_SELECTION"],
  DESTINATION_SELECTION: ["TRAVELING"],
  TRAVELING: ["ARRIVAL_SUBMISSION"],
  ARRIVAL_SUBMISSION: ["ARRIVAL_REVIEW"],
  ARRIVAL_REVIEW: ["MISSION_SELECTION", "ARRIVAL_SUBMISSION"],
  MISSION_SELECTION: ["MISSION_ACTIVE"],
  MISSION_ACTIVE: ["MISSION_REVIEW"],
  MISSION_REVIEW: ["MISSION_REWARD_CHOICE", "MISSION_ACTIVE"],
  MISSION_REWARD_CHOICE: ["DICE_READY", "PROPERTY_PURCHASE"],
  PROPERTY_PURCHASE: ["DICE_READY"],
  PAUSED: [],
  FINISHED: [],
};

export type MissionDifficulty = "EASY" | "NORMAL" | "HARD";

export const MISSION_DEFAULT_REWARD: Record<MissionDifficulty, number> = {
  EASY: 10_000_000,
  NORMAL: 20_000_000,
  HARD: 30_000_000,
};

export const MISSION_DEFAULT_PENALTY: Record<MissionDifficulty, number> = {
  EASY: 5_000_000,
  NORMAL: 10_000_000,
  HARD: 15_000_000,
};

export type CoinTransactionType =
  | "MISSION_SUCCESS"
  | "MISSION_FAILURE"
  | "MISSION_5X_BONUS"
  | "DESTINATION_BONUS"
  | "LATE_PENALTY"
  | "ADMIN_ADJUSTMENT"
  | "PROPERTY_PURCHASE"
  | "PROPERTY_PAYOUT"
  | "REPEAT_VISIT_BONUS"
  | "CARD_EFFECT"
  | "LUCKY_BONUS";

export type StaffRole = "ADMIN" | "STAFF";

export type CardCategory = "MOVEMENT" | "OBSTRUCTION" | "DEFENSE" | "MISSION" | "PROPERTY" | "SPECIAL";
export type CardRarity = "NORMAL" | "RARE" | "SUPER_RARE";
export type CardTargetType = "NONE" | "OTHER_TEAM" | "SELF";

export const CARD_CATEGORY_LABELS: Record<CardCategory, string> = {
  MOVEMENT: "移動",
  OBSTRUCTION: "妨害",
  DEFENSE: "防御",
  MISSION: "ミッション",
  PROPERTY: "物件",
  SPECIAL: "特殊",
};

export const CARD_RARITY_LABELS: Record<CardRarity, string> = {
  NORMAL: "NORMAL",
  RARE: "RARE",
  SUPER_RARE: "SUPER RARE",
};

export const COIN_TRANSACTION_LABELS: Record<CoinTransactionType, string> = {
  MISSION_SUCCESS: "🎯 ミッション成功",
  MISSION_FAILURE: "💦 ミッション失敗",
  MISSION_5X_BONUS: "✨ ミッション5倍ボーナス",
  DESTINATION_BONUS: "🏁 ゴール到達ボーナス",
  LATE_PENALTY: "⏰ 遅延ペナルティ",
  ADMIN_ADJUSTMENT: "🛠️ 本部による調整",
  PROPERTY_PURCHASE: "🏠 物件購入",
  PROPERTY_PAYOUT: "💰 物件収益",
  REPEAT_VISIT_BONUS: "🔁 再訪問ボーナス",
  CARD_EFFECT: "🎴 カード効果",
  LUCKY_BONUS: "🍀 ラッキーボーナス",
};
