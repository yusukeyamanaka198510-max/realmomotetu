import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../src/main/pipeline/rng'
import { generateKenBurnsParams, buildZoompanFilter } from '../src/main/pipeline/kenBurns'
import { getMoodPreset } from '../src/main/pipeline/presets'

describe('generateKenBurnsParams', () => {
  it('keeps zoom within a bounded, non-extreme range', () => {
    const preset = getMoodPreset('tempo') // highest baseZoomAmount
    const rng = mulberry32(1)
    for (let i = 0; i < 200; i++) {
      const params = generateKenBurnsParams(rng, preset, 'fast', { x: 0.5, y: 0.5 })
      expect(Math.max(params.zoomStart, params.zoomEnd)).toBeLessThanOrEqual(1.3)
      expect(Math.min(params.zoomStart, params.zoomEnd)).toBeGreaterThanOrEqual(1.0)
    }
  })

  it('keeps pan points within the safe margin (never at the extreme edge)', () => {
    const preset = getMoodPreset('bright')
    const rng = mulberry32(2)
    for (let i = 0; i < 200; i++) {
      const params = generateKenBurnsParams(rng, preset, 'normal', { x: 0.5, y: 0.5 })
      for (const point of [params.panStart, params.panEnd]) {
        expect(point.x).toBeGreaterThanOrEqual(0.08)
        expect(point.x).toBeLessThanOrEqual(0.92)
        expect(point.y).toBeGreaterThanOrEqual(0.08)
        expect(point.y).toBeLessThanOrEqual(0.92)
      }
    }
  })

  it('is deterministic for a given seed', () => {
    const preset = getMoodPreset('natural')
    const a = generateKenBurnsParams(mulberry32(55), preset, 'slow', { x: 0.4, y: 0.6 })
    const b = generateKenBurnsParams(mulberry32(55), preset, 'slow', { x: 0.4, y: 0.6 })
    expect(a).toEqual(b)
  })

  it('scales zoom amount with zoom speed', () => {
    const preset = getMoodPreset('natural')
    const slow = generateKenBurnsParams(mulberry32(9), preset, 'slow', { x: 0.5, y: 0.5 })
    const fast = generateKenBurnsParams(mulberry32(9), preset, 'fast', { x: 0.5, y: 0.5 })
    const slowAmount = Math.abs(slow.zoomEnd - slow.zoomStart)
    const fastAmount = Math.abs(fast.zoomEnd - fast.zoomStart)
    expect(fastAmount).toBeGreaterThan(slowAmount)
  })
})

describe('buildZoompanFilter', () => {
  it('produces a well-formed zoompan filter string', () => {
    const params = { zoomStart: 1.0, zoomEnd: 1.1, panStart: { x: 0.4, y: 0.5 }, panEnd: { x: 0.6, y: 0.5 } }
    const filter = buildZoompanFilter(params, 1080, 1920, {
      outWidth: 1080,
      outHeight: 1920,
      durationSec: 4,
      fps: 30
    })
    expect(filter).toContain('zoompan=')
    expect(filter).toContain('s=1080x1920')
    expect(filter).toContain('fps=30')
    expect(filter).toMatch(/scale=\d+:\d+/)
  })
})
