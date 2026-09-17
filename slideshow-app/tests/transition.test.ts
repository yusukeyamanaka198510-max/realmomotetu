import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../src/main/pipeline/rng'
import { buildXfadeChain } from '../src/main/pipeline/transition'

describe('buildXfadeChain', () => {
  it('returns the single input unchanged when there is only one segment', () => {
    const result = buildXfadeChain([{ path: 'a.mp4', durationSec: 5 }], 1, mulberry32(1))
    expect(result.filterComplex).toBe('')
    expect(result.outputLabel).toBe('[0:v]')
    expect(result.totalDurationSec).toBe(5)
  })

  it('chains N segments with N-1 xfade filters using only fade/dissolve', () => {
    const segments = [
      { path: 'a.mp4', durationSec: 4 },
      { path: 'b.mp4', durationSec: 3 },
      { path: 'c.mp4', durationSec: 5 }
    ]
    const result = buildXfadeChain(segments, 1, mulberry32(3))
    const xfadeCalls = result.filterComplex.split(';')
    expect(xfadeCalls).toHaveLength(2)
    for (const call of xfadeCalls) {
      expect(call).toMatch(/xfade=transition=(fade|dissolve):duration=[\d.]+:offset=[\d.]+/)
    }
    expect(result.outputLabel).toBe('[vout]')
    // total duration = sum(durations) - overlaps
    expect(result.totalDurationSec).toBeLessThan(4 + 3 + 5)
    expect(result.totalDurationSec).toBeGreaterThan(4 + 3 + 5 - 2 * 1 - 0.01)
  })

  it('clamps transition duration so it never exceeds a short clip length', () => {
    const segments = [
      { path: 'a.mp4', durationSec: 0.3 },
      { path: 'b.mp4', durationSec: 10 }
    ]
    const result = buildXfadeChain(segments, 2, mulberry32(4))
    const match = /duration=([\d.]+)/.exec(result.filterComplex)
    expect(match).not.toBeNull()
    const usedDuration = Number(match![1])
    expect(usedDuration).toBeLessThanOrEqual(0.3 * 0.9 + 1e-9)
  })

  it('never produces a negative offset', () => {
    const segments = [
      { path: 'a.mp4', durationSec: 1 },
      { path: 'b.mp4', durationSec: 1 },
      { path: 'c.mp4', durationSec: 1 }
    ]
    const result = buildXfadeChain(segments, 5, mulberry32(2))
    const offsets = [...result.filterComplex.matchAll(/offset=([\d.]+)/g)].map((m) => Number(m[1]))
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0)
    }
  })

  it('is deterministic for a given seed', () => {
    const segments = [
      { path: 'a.mp4', durationSec: 4 },
      { path: 'b.mp4', durationSec: 3 }
    ]
    const a = buildXfadeChain(segments, 1, mulberry32(123))
    const b = buildXfadeChain(segments, 1, mulberry32(123))
    expect(a).toEqual(b)
  })
})
