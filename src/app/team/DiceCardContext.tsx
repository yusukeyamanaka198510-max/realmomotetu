"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { TeamGameState } from "@/lib/game/types";
import type { DicePhase } from "./DiceAnimation";

type DiceResult = { total: number; individual_results: number[] };

type DiceCardValue = {
  dicePhase: DicePhase | null;
  canStopDice: boolean;
  // 回転演出中に表示すべきサイコロの個数(振ってすぐは実際の出目がまだ届いていないため、
  // 個数だけ先に確定させておく。出目そのものは回転中は見えないため問題ない)。
  rollingDiceCount: number;
  rollPlainDice: () => Promise<{ error?: string }>;
  rollCardDice: (cardCode: string, diceCount: number) => Promise<{ error?: string; message?: string }>;
  stopDice: () => void;
  diceLanded: () => void;
};

const DiceCardContext = createContext<DiceCardValue | null>(null);

// 通常のサイコロを振る操作と、特急・急行・新幹線等の「サイコロ複数個カード」の使用が
// 同じ演出(振る→止める→着地)を共有できるよう、TeamGameFlowとCardPanelの間でこの状態を共有する。
export function DiceCardProvider({
  initialState,
  diceResult,
  hotStreakDiceCount,
  children,
}: {
  initialState: TeamGameState;
  diceResult: DiceResult | null;
  // 絶好調カード等が有効な間、通常の「サイコロを振る」(1個リクエスト)もサーバー側で
  // この個数に引き上げられる。振り始めた瞬間からその個数で演出しないと、着地の瞬間だけ
  // 個数が変わって見える不具合になるため、あらかじめ渡しておく。
  hotStreakDiceCount: number | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [dicePhase, setDicePhase] = useState<DicePhase | null>(null);
  const [canStopDice, setCanStopDice] = useState(false);
  const [rollingDiceCount, setRollingDiceCount] = useState(1);

  useEffect(() => {
    if (initialState === "DESTINATION_SELECTION") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- サーバー状態(initialState)への同期が目的の意図的な同期
      setDicePhase((p) => p ?? "revealed");
      // router.refresh()のPromiseはRSCペイロードが実際に反映される前に解決することがあるため、
      // 「止める」を押せる判定はrefresh呼び出し自体ではなく、実際にdiceResultが届いた
      // (=initialStateが本当にDESTINATION_SELECTIONへ切り替わった)ことで行う。
      if (diceResult) {
        setCanStopDice(true);
      }
    } else {
      setDicePhase(null);
      setCanStopDice(false);
    }
  }, [initialState, diceResult]);

  async function rollPlainDice(): Promise<{ error?: string }> {
    setCanStopDice(false);
    setRollingDiceCount(hotStreakDiceCount ?? 1);
    setDicePhase("rolling");
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_roll_dice", { p_dice_count: 1 });
    if (error) {
      setDicePhase(null);
      return { error: error.message };
    }
    router.refresh();
    return {};
  }

  async function rollCardDice(cardCode: string, diceCount: number): Promise<{ error?: string; message?: string }> {
    setCanStopDice(false);
    setRollingDiceCount(diceCount);
    setDicePhase("rolling");
    const supabase = createClient();
    const idempotencyKey = crypto.randomUUID();
    const { data, error } = await supabase.rpc("fn_use_card", {
      p_idempotency_key: idempotencyKey,
      p_card_code: cardCode,
      p_target_team_id: null,
      p_payload: {},
    });
    if (error) {
      setDicePhase(null);
      return { error: error.message };
    }
    router.refresh();
    const result = data as { message?: string } | null;
    return { message: result?.message ?? undefined };
  }

  function stopDice() {
    setDicePhase("landing");
  }

  function diceLanded() {
    setDicePhase("revealed");
  }

  return (
    <DiceCardContext.Provider value={{ dicePhase, canStopDice, rollingDiceCount, rollPlainDice, rollCardDice, stopDice, diceLanded }}>
      {children}
    </DiceCardContext.Provider>
  );
}

export function useDiceCard(): DiceCardValue {
  const ctx = useContext(DiceCardContext);
  if (!ctx) throw new Error("useDiceCard must be used within a DiceCardProvider");
  return ctx;
}
