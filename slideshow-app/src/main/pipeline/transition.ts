import type { Rng } from './rng'
import { pick } from './rng'

export interface SegmentInfo {
  path: string
  durationSec: number
}

export interface XfadeChainResult {
  /** Empty string when there is only one segment (nothing to chain). */
  filterComplex: string
  outputLabel: string
  totalDurationSec: number
}

const TRANSITION_TYPES = ['fade', 'dissolve'] as const
const MIN_TRANSITION_SEC = 0.1

/** Builds an ffmpeg `xfade` filter_complex chain that cross-fades every
 * segment into the next, using only `fade`/`dissolve` transitions per spec.
 * Each pair's transition duration is clamped to never exceed either
 * neighboring clip's own length, avoiding invalid negative offsets on very
 * short clips. */
export function buildXfadeChain(
  segments: readonly SegmentInfo[],
  transitionDurationSec: number,
  rng: Rng
): XfadeChainResult {
  if (segments.length === 0) {
    throw new Error('buildXfadeChain requires at least one segment')
  }
  if (segments.length === 1) {
    return { filterComplex: '', outputLabel: '[0:v]', totalDurationSec: segments[0].durationSec }
  }

  let prevLabel = '[0:v]'
  let cumulative = segments[0].durationSec
  const parts: string[] = []

  for (let i = 1; i < segments.length; i++) {
    const d = segments[i].durationSec
    const t = Math.max(MIN_TRANSITION_SEC, Math.min(transitionDurationSec, cumulative * 0.9, d * 0.9))
    const offset = Math.max(0, cumulative - t)
    const type = pick(rng, TRANSITION_TYPES)
    const outLabel = i === segments.length - 1 ? '[vout]' : `[v${i}]`
    parts.push(
      `${prevLabel}[${i}:v]xfade=transition=${type}:duration=${t.toFixed(3)}:offset=${offset.toFixed(3)}${outLabel}`
    )
    prevLabel = outLabel
    cumulative = cumulative + d - t
  }

  return { filterComplex: parts.join(';'), outputLabel: prevLabel, totalDurationSec: cumulative }
}
