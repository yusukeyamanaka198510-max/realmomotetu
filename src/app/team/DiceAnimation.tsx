"use client";

import { useEffect, useRef } from "react";

const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 2],
  ],
};

const SIZE = 64;
const HALF = SIZE / 2;
const ROLL_SPEED = 620; // deg/sec — 振っている間の回転速度

// 回転中(ロール中・減速中)に使う斜め軸(右下→左上に見えるように選んだ軸)。
const AXIS: [number, number, number] = [1, -1, 0.3];

// 各出目の面をこの斜め軸まわりでなるべくカメラ正面に近づける角度(度)。
// Rodriguesの回転公式で各面の法線を軸まわりに回し、+Z(カメラ向き)に最も近づく角度を
// 事前に数値計算して求めたもの。減速はここまでこの軸だけで行う。
const FACE_TILT_ANGLE: Record<number, number> = {
  1: 0,
  3: 101.5,
  2: 258.5,
  6: 180,
  5: 78.5,
  4: 281.5,
};

// 最終的に出目を正面(=縦横軸だけのきれいな向き)へ見せるための回転角。
const FACE_SQUARE: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  6: { x: 0, y: 180 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  2: { x: -90, y: 0 },
  5: { x: 90, y: 0 },
};

function pips(value: number) {
  return Array.from({ length: 9 }).map((_, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const active = PIP_LAYOUTS[value]?.some(([r, c]) => r === row && c === col);
    return <div key={i} className={`rounded-full ${active ? "bg-game-red" : ""}`} />;
  });
}

function CubeFace({ transform, value }: { transform: string; value: number }) {
  return (
    <div
      className="absolute grid grid-cols-3 grid-rows-3 gap-1 rounded-xl border-4 border-game-navy bg-white p-2.5 shadow-[var(--game-shadow-md)]"
      style={{ width: SIZE, height: SIZE, transform, backfaceVisibility: "hidden" }}
    >
      {pips(value)}
    </div>
  );
}

export type DicePhase = "rolling" | "landing" | "revealed";

// currentから見て、常に増加方向(rollingと同じ回転方向)へ進んだ先でtargetDeg(mod 360)に
// 一致する絶対角を返す。これにより減速演出が絶対に逆回転しない。
function forwardTarget(current: number, targetDeg: number, extraTurns: number) {
  const targetMod = ((targetDeg % 360) + 360) % 360;
  const currentMod = ((current % 360) + 360) % 360;
  let diff = targetMod - currentMod;
  if (diff <= 0) diff += 360;
  return current + diff + 360 * extraTurns;
}

// 減速の何%進んだ時点で「正面向きへの受け渡し」を始めるか。まだ緩やかに回転している
// うちに始めることで、完全に止まってから急に動き出したように見えるのを防ぐ。
const HANDOFF_FRACTION = 0.6;
const MIN_SETTLE_MS = 500;

function Cube3D({ phase, value, seed }: { phase: DicePhase; value: number; seed: number }) {
  const cubeRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  const angle = useRef(0);
  const rafId = useRef<number | null>(null);
  const lastTs = useRef<number | null>(null);
  const decel = useRef<{ from: number; v0: number; durationMs: number; start: number } | null>(null);
  const settleStarted = useRef(false);
  const decelMsRef = useRef(0);
  const settleMsRef = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
    if (phase === "landing" && decel.current === null) {
      const target = FACE_TILT_ANGLE[value] ?? 0;
      const extraTurns = 1;
      const dist = forwardTarget(angle.current, target, extraTurns) - angle.current;
      // 一定の加速度で速度0まで減速する(実物の摩擦ブレーキと同じ物理)ため、
      // 「振っている速度」から絶対に速くならず、常に単調に遅くなっていく。
      // 移動距離 = v0 * T / 2 の関係から、距離に応じて減速時間Tを決める。
      const durationMs = (2 * dist * 1000) / ROLL_SPEED;
      decel.current = { from: angle.current, v0: ROLL_SPEED, durationMs, start: performance.now() };
      decelMsRef.current = durationMs;
      // 受け渡し後の残り時間ぶんは引き続き惰性で回っているように見せたいので、
      // 減速の残り時間+ゆとりを最終調整の時間として使う。
      settleMsRef.current = Math.max(MIN_SETTLE_MS, durationMs * (1 - HANDOFF_FRACTION) + 300);
      settleStarted.current = false;
    }
    if (phase !== "landing") {
      decel.current = null;
      settleStarted.current = false;
    }
    if (phase === "revealed") {
      const target = FACE_SQUARE[value] ?? { x: 0, y: 0 };
      if (cubeRef.current) {
        cubeRef.current.style.transition = "none";
        cubeRef.current.style.transform = `rotateX(${target.x}deg) rotateY(${target.y}deg)`;
      }
    }
  }, [phase, value, seed]);

  useEffect(() => {
    const el = cubeRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    function applyAxisAngle() {
      el!.style.transition = "none";
      el!.style.transform = `rotate3d(${AXIS.join(",")}, ${angle.current}deg)`;
    }

    function startSettle() {
      settleStarted.current = true;
      const target = FACE_SQUARE[value] ?? { x: 0, y: 0 };
      if (reduceMotion) {
        el!.style.transition = "none";
        el!.style.transform = `rotateX(${target.x}deg) rotateY(${target.y}deg)`;
        return;
      }
      // まだ緩やかに回転が残っている段階(完全停止前)で正面向きへ受け渡す。
      // 完全に止まってから動かすと「止まった後に急に動き出した」ように見えるため、
      // 惰性のうちに引き継いで、そのまま自然に減速して収まるようにする。
      requestAnimationFrame(() => {
        el!.style.transition = `transform ${settleMsRef.current}ms ease-out`;
        el!.style.transform = `rotateX(${target.x}deg) rotateY(${target.y}deg)`;
      });
    }

    function tick(ts: number) {
      if (lastTs.current == null) lastTs.current = ts;
      const dt = Math.min((ts - lastTs.current) / 1000, 0.05);
      lastTs.current = ts;

      if (phaseRef.current === "rolling") {
        angle.current += ROLL_SPEED * dt;
        applyAxisAngle();
        rafId.current = requestAnimationFrame(tick);
        return;
      }

      if (phaseRef.current === "landing" && decel.current) {
        const { from, v0, start } = decel.current;
        const durationMs = reduceMotion ? 0 : decelMsRef.current;
        const handoffMs = durationMs * HANDOFF_FRACTION;
        const rawElapsed = ts - start;

        if (!settleStarted.current && (reduceMotion || rawElapsed >= handoffMs)) {
          startSettle();
          return;
        }

        const elapsedMs = Math.min(rawElapsed, handoffMs);
        const t = elapsedMs / 1000;
        const durationSec = durationMs / 1000;
        // 等加速度(摩擦ブレーキ)による減速: 速度はv0から0まで一定の割合で単調に下がり続ける。
        // (受け渡し地点までしか進めないので、まだ完全な停止には至っていない)
        const a = durationSec > 0 ? v0 / durationSec : 0;
        angle.current = from + v0 * t - 0.5 * a * t * t;
        applyAxisAngle();
        rafId.current = requestAnimationFrame(tick);
        return;
      }
    }

    lastTs.current = null;
    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      lastTs.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value/seedはdecel.current算出時にのみ必要で、tickループ自体はphaseの変化だけで再起動すれば十分
  }, [phase]);

  return (
    <div className="h-20 w-20" style={{ perspective: 400 }}>
      <div ref={cubeRef} className="relative mx-auto" style={{ width: SIZE, height: SIZE, transformStyle: "preserve-3d" }}>
        <CubeFace value={1} transform={`translateZ(${HALF}px)`} />
        <CubeFace value={6} transform={`rotateY(180deg) translateZ(${HALF}px)`} />
        <CubeFace value={3} transform={`rotateY(90deg) translateZ(${HALF}px)`} />
        <CubeFace value={4} transform={`rotateY(-90deg) translateZ(${HALF}px)`} />
        <CubeFace value={2} transform={`rotateX(90deg) translateZ(${HALF}px)`} />
        <CubeFace value={5} transform={`rotateX(-90deg) translateZ(${HALF}px)`} />
      </div>
    </div>
  );
}

export function DiceAnimation({
  phase,
  values,
  onLanded,
}: {
  phase: DicePhase;
  values: number[];
  onLanded?: () => void;
}) {
  useEffect(() => {
    if (phase !== "landing" || !onLanded) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // 減速時間は目的の出目までの距離次第で変わる(最大でも1周+360度分)ため、
    // 受け渡し後の最終調整時間もあわせ、十分に長い上限値+余裕を確保しておく。
    const maxDecelMs = (2 * 720 * 1000) / ROLL_SPEED;
    const maxSettleMs = Math.max(MIN_SETTLE_MS, maxDecelMs * (1 - HANDOFF_FRACTION) + 300);
    const timer = setTimeout(onLanded, reduceMotion ? 0 : maxDecelMs * HANDOFF_FRACTION + maxSettleMs + 80);
    return () => clearTimeout(timer);
  }, [phase, onLanded]);

  const dice = values.length > 0 ? values : [1];

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="flex justify-center gap-4">
        {dice.map((v, i) => (
          <Cube3D key={i} phase={phase} value={v} seed={i} />
        ))}
      </div>
      {phase === "revealed" && (
        <p className="anim-pop text-lg font-black text-game-navy dark:text-white">
          出目: <span className="text-2xl text-game-red">{dice.reduce((a, b) => a + b, 0)}</span>
          {dice.length > 1 && <span className="ml-1 text-sm text-zinc-500">({dice.join(" + ")})</span>}
        </p>
      )}
    </div>
  );
}
