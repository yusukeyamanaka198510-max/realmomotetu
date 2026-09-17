import { describe, expect, it } from 'vitest'
import { mulberry32, seededShuffle, randRange } from '../src/main/pipeline/rng'

describe('mulberry32 seeded RNG', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(1234)
    const b = mulberry32(1234)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toBe(b())
  })

  it('stays within [0, 1)', () => {
    const rng = mulberry32(999)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('seededShuffle', () => {
  it('reproduces the same order for the same seed', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const orderA = seededShuffle(items, mulberry32(42))
    const orderB = seededShuffle(items, mulberry32(42))
    expect(orderA).toEqual(orderB)
  })

  it('is a permutation of the input (no items lost or duplicated)', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const shuffled = seededShuffle(items, mulberry32(7))
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
  })

  it('does not mutate the input array', () => {
    const items = [1, 2, 3, 4, 5]
    const copy = [...items]
    seededShuffle(items, mulberry32(1))
    expect(items).toEqual(copy)
  })
})

describe('randRange', () => {
  it('stays within the given bounds', () => {
    const rng = mulberry32(5)
    for (let i = 0; i < 500; i++) {
      const v = randRange(rng, 3.5, 4.5)
      expect(v).toBeGreaterThanOrEqual(3.5)
      expect(v).toBeLessThan(4.5)
    }
  })
})
