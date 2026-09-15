"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { staffBtn } from "./StaffUI";

type EventInfo = {
  id: string;
  name: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  time_limit_minutes: number | null;
  leaderboard_hide_minutes_before_end: number;
  obstruction_cooldown_seconds: number;
  dividend_interval_minutes: number;
  dividend_scheduled_times: string[];
  last_dividend_run_at: string | null;
  scheduled_start_at: string | null;
  auto_start_enabled: boolean;
  auto_start_time_limit_minutes: number | null;
  auto_start_end_at: string | null;
  start_station_id: string | null;
  min_destination_distance_hops: number;
};

// datetime-local入力用にローカルタイムゾーンの "YYYY-MM-DDTHH:mm" 形式へ変換
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventControlPanel({
  event,
  topTeams,
  stations,
  startStationName,
}: {
  event: EventInfo;
  topTeams: { team_name: string; coin_balance_cache: number }[];
  stations: { id: string; name: string }[];
  startStationName: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [startStationId, setStartStationId] = useState(event.start_station_id ?? "");
  const [minutes, setMinutes] = useState(event.auto_start_time_limit_minutes ?? event.time_limit_minutes ?? 240);
  const [hideMinutes, setHideMinutes] = useState(event.leaderboard_hide_minutes_before_end);
  const [endAtInput, setEndAtInput] = useState(toDatetimeLocalValue(event.auto_start_end_at ?? event.end_at));
  const [nameDraft, setNameDraft] = useState(event.name);
  const [cooldownSeconds, setCooldownSeconds] = useState(event.obstruction_cooldown_seconds);
  const [dividendMinutes, setDividendMinutes] = useState(event.dividend_interval_minutes);
  const [dividendTimes, setDividendTimes] = useState<string[]>(event.dividend_scheduled_times ?? []);
  const [newDividendTime, setNewDividendTime] = useState("");
  const [minDistanceHops, setMinDistanceHops] = useState(event.min_destination_distance_hops);
  const [scheduledStartInput, setScheduledStartInput] = useState(toDatetimeLocalValue(event.scheduled_start_at));
  const [autoStartEnabled, setAutoStartEnabled] = useState(event.auto_start_enabled);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`event:${event.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `id=eq.${event.id}` }, () =>
        router.refresh()
      )
      .subscribe();
    // 参加者の端末がロック・バックグラウンド化してポーリングが止まっていても、定期配当や
    // 順位表記録が確実に動くよう、本部画面側からもポーリングする(チーム画面のみに
    // 依存していたため、全チームの端末が同時に非アクティブだと定期配当が実行されない
    // 不具合があった)。
    const autoStartInterval = setInterval(() => {
      supabase.rpc("fn_maybe_auto_start_event").then(() => router.refresh());
      supabase.rpc("fn_maybe_run_lucky_hourly_bonus");
      supabase.rpc("fn_maybe_run_dividend_settlement").then(() => router.refresh());
      supabase.rpc("fn_maybe_take_leaderboard_snapshot");
    }, 10000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(autoStartInterval);
    };
  }, [event.id, router]);

  async function handleStart() {
    const useFixedEnd = !!endAtInput;
    const confirmMsg = useFixedEnd
      ? `${new Date(endAtInput).toLocaleString("ja-JP")}に終了するようイベントを開始します。よろしいですか?`
      : `制限時間${minutes}分でイベントを開始します。よろしいですか?`;
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_start_event", {
      p_time_limit_minutes: useFixedEnd ? null : minutes,
      p_end_at: useFixedEnd ? new Date(endAtInput).toISOString() : null,
    });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleSaveCooldown() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_obstruction_cooldown", { p_seconds: cooldownSeconds });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleSaveName() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_update_event_name", { p_name: nameDraft });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleForceEnd() {
    const reason = window.prompt("強制終了の理由を入力してください");
    if (reason === null) return;
    if (!window.confirm("イベントを強制終了します。以降、参加者は新規操作ができなくなります。よろしいですか?")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_force_end_event", { p_reason: reason });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleSaveDividendInterval() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_dividend_interval", { p_minutes: dividendMinutes });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  function handleAddDividendTime() {
    if (!newDividendTime) return;
    if (dividendTimes.includes(newDividendTime)) {
      setNewDividendTime("");
      return;
    }
    setDividendTimes([...dividendTimes, newDividendTime].sort());
    setNewDividendTime("");
  }

  async function handleSaveDividendTimes(times: string[]) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_dividend_schedule", { p_times: times });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleSaveMinDistanceHops() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_min_destination_distance", { p_hops: minDistanceHops });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleRunDividendNow() {
    if (!window.confirm("今すぐ全チームに定期配当を実行します。よろしいですか?")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_run_dividend_settlement_now");
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleSaveScheduledStart() {
    if (autoStartEnabled && !scheduledStartInput) {
      window.alert("自動開始を有効にする場合は開始予定日時を入力してください");
      return;
    }
    const useFixedEnd = !!endAtInput;
    if (
      autoStartEnabled &&
      !window.confirm(
        `${new Date(scheduledStartInput).toLocaleString("ja-JP")}に自動でイベントを開始します。よろしいですか?`
      )
    ) {
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_schedule_start", {
      p_scheduled_start_at: scheduledStartInput ? new Date(scheduledStartInput).toISOString() : null,
      p_auto_start_enabled: autoStartEnabled,
      p_time_limit_minutes: autoStartEnabled && !useFixedEnd ? minutes : null,
      p_end_at: autoStartEnabled && useFixedEnd ? new Date(endAtInput).toISOString() : null,
    });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleSaveStartStation() {
    if (!startStationId) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_start_station", { p_station_id: startStationId });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function handleSaveHideMinutes() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_leaderboard_hide_minutes", { p_minutes: hideMinutes });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  const isEnded = event.status === "FORCE_ENDED" || event.status === "ENDED";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-3 text-sm dark:border-zinc-800">
        <span className="shrink-0 text-zinc-500">イベント名(参加者画面には表示されない、社内管理用のラベル)</span>
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          className="min-w-[140px] flex-1 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
        />
        <button onClick={handleSaveName} disabled={busy || !nameDraft.trim()} className={`ml-auto ${staffBtn.neutral}`}>
          保存
        </button>
      </div>

      <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <p className="text-sm">
          ステータス: <span className="font-semibold">{event.status}</span>
        </p>
        {event.end_at && (
          <p className="mt-0.5 text-xs text-zinc-500">終了予定: {new Date(event.end_at).toLocaleString("ja-JP")}</p>
        )}

        {event.status === "SCHEDULED" && (
          <div className="mt-3 space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-500">
                デフォルトのスタート駅{startStationName ? `(現在: ${startStationName})` : "(未設定)"}
              </span>
              <select
                value={startStationId}
                onChange={(e) => setStartStationId(e.target.value)}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="">駅を選択...</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button onClick={handleSaveStartStation} disabled={busy || !startStationId} className={`ml-auto ${staffBtn.neutral}`}>
                保存
              </button>
              <p className="w-full text-xs text-zinc-400">スタート駅を選ばなかったチームは、この駅からスタートします。</p>
            </div>

            <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
              <span className="text-zinc-500">開始予定日時</span>
              <input
                type="datetime-local"
                value={scheduledStartInput}
                onChange={(e) => setScheduledStartInput(e.target.value)}
                className="w-fit rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
              />

              <span />
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={autoStartEnabled} onChange={(e) => setAutoStartEnabled(e.target.checked)} />
                予定日時に自動でイベント開始する
              </label>

              <span className="text-zinc-500">終了日時</span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  value={endAtInput}
                  onChange={(e) => setEndAtInput(e.target.value)}
                  className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
                />
                <span className="text-xs text-zinc-400">または</span>
                <input
                  type="number"
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  disabled={!!endAtInput}
                  className="w-20 rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
                />
                <span>分後に終了</span>
              </div>
            </div>
            <p className="text-xs text-zinc-400">
              開始予定日時は参加者画面への案内表示に使われます。終了日時は自動開始する場合にも使われます。
            </p>
            <div className="flex justify-end pt-1">
              <button onClick={handleSaveScheduledStart} disabled={busy} className={staffBtn.neutral}>
                予約を保存
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={handleStart} disabled={busy} className={staffBtn.approve}>
                🚀 今すぐイベント開始
              </button>
            </div>
          </div>
        )}
        {event.status === "RUNNING" && (
          <div className="mt-3">
            <button onClick={handleForceEnd} disabled={busy} className={staffBtn.danger}>
              🛑 強制終了
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
        <span>終了</span>
        <input
          type="number"
          min={0}
          value={hideMinutes}
          onChange={(e) => setHideMinutes(Number(e.target.value))}
          className="w-16 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
        />
        <span>分前からランキング・ゴール表示を参加者から非表示にする(0=常に表示)</span>
        <button onClick={handleSaveHideMinutes} disabled={busy} className={`ml-auto ${staffBtn.neutral}`}>
          保存
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
        <span>妨害カードのクールタイム</span>
        <input
          type="number"
          min={0}
          value={cooldownSeconds}
          onChange={(e) => setCooldownSeconds(Number(e.target.value))}
          className="w-16 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
        />
        <span>秒(同一チームから同じ相手への妨害カード連続使用を防ぐ。0=無効)</span>
        <button onClick={handleSaveCooldown} disabled={busy} className={`ml-auto ${staffBtn.neutral}`}>
          保存
        </button>
      </div>

      <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <span>不動産の定期配当間隔</span>
          <input
            type="number"
            min={0}
            value={dividendMinutes}
            onChange={(e) => setDividendMinutes(Number(e.target.value))}
            className="w-16 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <span>分ごと(0=自動実行を停止)</span>
          <button onClick={handleSaveDividendInterval} disabled={busy} className={`ml-auto ${staffBtn.neutral}`}>
            保存
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-500">
            {event.last_dividend_run_at
              ? `前回実行: ${new Date(event.last_dividend_run_at).toLocaleString("ja-JP")}`
              : ""}
          </span>
          <button onClick={handleRunDividendNow} disabled={busy} className={staffBtn.primary}>
            📈 今すぐ配当を実行
          </button>
        </div>
        <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <p className="text-xs text-zinc-500">
            時刻を1つ以上指定すると、上の「◯分ごと」より優先してその時刻(日本時間)に配当を実行します(本番で毎時00分に実行したい場合などに使用)。
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              type="time"
              value={newDividendTime}
              onChange={(e) => setNewDividendTime(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
            />
            <button onClick={handleAddDividendTime} disabled={busy || !newDividendTime} className={staffBtn.neutral}>
              追加
            </button>
            <button
              onClick={() => handleSaveDividendTimes(dividendTimes)}
              disabled={busy}
              className={`ml-auto ${staffBtn.primary}`}
            >
              時刻指定を保存
            </button>
          </div>
          {dividendTimes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {dividendTimes.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700"
                >
                  {t}
                  <button
                    onClick={() => setDividendTimes(dividendTimes.filter((x) => x !== t))}
                    className="text-zinc-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
        <span>次ゴールの最低距離</span>
        <input
          type="number"
          min={0}
          value={minDistanceHops}
          onChange={(e) => setMinDistanceHops(Number(e.target.value))}
          className="w-16 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
        />
        <span>マス(直前のゴールからこの距離以上離れた駅のみ次ゴール候補にする。路線を増やすと同じ値でも実際の範囲が広がるので注意)</span>
        <button onClick={handleSaveMinDistanceHops} disabled={busy} className={`ml-auto ${staffBtn.neutral}`}>
          保存
        </button>
      </div>

      {isEnded && topTeams.length === 1 && (
        <p className="mt-3 rounded bg-amber-100 p-3 text-sm font-semibold dark:bg-amber-900">
          優勝: {topTeams[0].team_name}(所持コイン {topTeams[0].coin_balance_cache})
        </p>
      )}
      {isEnded && topTeams.length > 1 && (
        <div className="mt-3 rounded bg-amber-100 p-3 text-sm font-semibold dark:bg-amber-900">
          <p>
            同着1位({topTeams.length}チーム、所持コイン {topTeams[0].coin_balance_cache})— 本部判断で最終順位を決定してください
          </p>
          <ul className="mt-1 list-disc pl-5 font-normal">
            {topTeams.map((t) => (
              <li key={t.team_name}>{t.team_name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
