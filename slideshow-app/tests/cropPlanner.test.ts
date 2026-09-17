import { describe, expect, it } from 'vitest'
import { computeCropPlan } from '../src/main/pipeline/cropPlanner'

describe('computeCropPlan', () => {
  it('crops a landscape source to a portrait target by cutting left/right, centered', () => {
    const plan = computeCropPlan(4000, 3000, 1080, 1920, [])
    // target ratio 1080/1920 = 0.5625; source is wider than that so full
    // height is kept and width is cropped
    expect(plan.crop.h).toBe(3000)
    expect(plan.crop.w).toBe(Math.round(3000 * (1080 / 1920)))
    expect(plan.crop.x).toBe(Math.round((4000 - plan.crop.w) / 2))
    expect(plan.crop.y).toBe(0)
    expect(plan.faceCenterFrac).toEqual({ x: 0.5, y: 0.5 })
  })

  it('crops a portrait source to a landscape target by cutting top/bottom, centered', () => {
    const plan = computeCropPlan(3000, 4000, 1920, 1080, [])
    expect(plan.crop.w).toBe(3000)
    expect(plan.crop.h).toBe(Math.round(3000 / (1920 / 1080)))
    expect(plan.crop.y).toBe(Math.round((4000 - plan.crop.h) / 2))
  })

  it('shifts the crop so a detected face stays fully inside the frame', () => {
    // A tall portrait image with a face near the top -- a naive center
    // crop for a square target would cut the head off.
    const srcW = 1200
    const srcH = 2000
    const face = { x: 500, y: 100, w: 200, h: 200 }
    const centerPlan = computeCropPlan(srcW, srcH, 1, 1, [])
    const facePlan = computeCropPlan(srcW, srcH, 1, 1, [face])

    // Center crop would start far below the face; the face-aware crop
    // should start higher up (smaller y) to keep the face in frame.
    expect(facePlan.crop.y).toBeLessThan(centerPlan.crop.y)
    expect(facePlan.crop.y).toBeGreaterThanOrEqual(0)
    // The face's vertical span must be fully inside the crop.
    expect(face.y).toBeGreaterThanOrEqual(facePlan.crop.y)
    expect(face.y + face.h).toBeLessThanOrEqual(facePlan.crop.y + facePlan.crop.h)
  })

  it('clamps the crop to stay within source bounds even for an edge-hugging face', () => {
    const plan = computeCropPlan(1200, 1200, 1, 1, [{ x: 1150, y: 1150, w: 40, h: 40 }])
    expect(plan.crop.x).toBeGreaterThanOrEqual(0)
    expect(plan.crop.y).toBeGreaterThanOrEqual(0)
    expect(plan.crop.x + plan.crop.w).toBeLessThanOrEqual(1200)
    expect(plan.crop.y + plan.crop.h).toBeLessThanOrEqual(1200)
  })

  it('throws on invalid source dimensions', () => {
    expect(() => computeCropPlan(0, 100, 16, 9)).toThrow()
  })
})
