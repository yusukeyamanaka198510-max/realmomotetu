import type { ColorCorrection } from './presets'

/** Builds an ffmpeg `eq` filter fragment (no surrounding commas) from a
 * preset's simple color-correction values. */
export function buildEqFilter(c: ColorCorrection): string {
  return `eq=brightness=${c.brightness}:contrast=${c.contrast}:saturation=${c.saturation}:gamma=${c.gamma}`
}
