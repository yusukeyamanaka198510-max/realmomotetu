import type { ZoomSpeed } from '@shared/types'
import type { Rng } from './rng'
import { randRange } from './rng'
import { ZOOM_SPEED_MULTIPLIER, type MoodPreset } from './presets'

export interface KenBurnsParams {
  zoomStart: number
  zoomEnd: number
  panStart: { x: number; y: number }
  panEnd: { x: number; y: number }
}

const MIN_ZOOM_AMOUNT = 0.03
const MAX_ZOOM_AMOUNT = 0.3
const EDGE_MARGIN = 0.08

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Randomizes zoom direction/amount and a modest pan around the subject
 * anchor (face center, or image center when no face was detected), keeping
 * all motion within a bounded range so it never looks extreme and never
 * drifts a detected face out of frame. */
export function generateKenBurnsParams(
  rng: Rng,
  preset: MoodPreset,
  zoomSpeed: ZoomSpeed,
  anchor: { x: number; y: number }
): KenBurnsParams {
  const zoomAmount = clamp(preset.baseZoomAmount * ZOOM_SPEED_MULTIPLIER[zoomSpeed], MIN_ZOOM_AMOUNT, MAX_ZOOM_AMOUNT)
  const zoomIn = rng() > 0.5
  const zoomStart = zoomIn ? 1.0 : 1.0 + zoomAmount
  const zoomEnd = zoomIn ? 1.0 + zoomAmount : 1.0

  const angle = randRange(rng, 0, Math.PI * 2)
  const dist = randRange(rng, preset.panRange * 0.3, preset.panRange)
  const dx = (Math.cos(angle) * dist) / 2
  const dy = (Math.sin(angle) * dist) / 2

  const panStart = {
    x: clamp(anchor.x - dx, EDGE_MARGIN, 1 - EDGE_MARGIN),
    y: clamp(anchor.y - dy, EDGE_MARGIN, 1 - EDGE_MARGIN)
  }
  const panEnd = {
    x: clamp(anchor.x + dx, EDGE_MARGIN, 1 - EDGE_MARGIN),
    y: clamp(anchor.y + dy, EDGE_MARGIN, 1 - EDGE_MARGIN)
  }

  return { zoomStart, zoomEnd, panStart, panEnd }
}

export interface ZoompanFilterOptions {
  outWidth: number
  outHeight: number
  durationSec: number
  fps: number
  /** Upscale factor applied before zoompan for smooth subpixel motion. */
  upscale?: number
}

function n(v: number): string {
  return v.toFixed(5)
}

function evenFloor(v: number): number {
  return Math.max(2, Math.floor(v / 2) * 2)
}

/** Builds the `scale,zoompan,format` portion of the filter chain that
 * animates a single already-cropped (aspect-correct) photo. Expects the
 * upstream filter to have already produced a frame of `srcWidth`x`srcHeight`
 * matching the target aspect ratio. */
export function buildZoompanFilter(
  params: KenBurnsParams,
  srcWidth: number,
  srcHeight: number,
  options: ZoompanFilterOptions
): string {
  const upscale = options.upscale ?? 4
  const bigW = evenFloor(srcWidth * upscale)
  const bigH = evenFloor(srcHeight * upscale)
  const totalFrames = Math.max(1, Math.round(options.durationSec * options.fps))
  const denom = Math.max(1, totalFrames - 1)

  const zExpr = `${n(params.zoomStart)}+(${n(params.zoomEnd)}-${n(params.zoomStart)})*on/${denom}`
  const xFracExpr = `(${n(params.panStart.x)}+(${n(params.panEnd.x)}-${n(params.panStart.x)})*on/${denom})`
  const yFracExpr = `(${n(params.panStart.y)}+(${n(params.panEnd.y)}-${n(params.panStart.y)})*on/${denom})`
  const xExpr = `${xFracExpr}*(iw-iw/zoom)`
  const yExpr = `${yFracExpr}*(ih-ih/zoom)`

  return (
    `scale=${bigW}:${bigH},` +
    `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${options.outWidth}x${options.outHeight}:fps=${options.fps}`
  )
}
