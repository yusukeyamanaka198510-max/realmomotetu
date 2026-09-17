import type { MoodPresetKey, ZoomSpeed } from '@shared/types'

export interface ColorCorrection {
  /** ffmpeg eq filter params */
  brightness: number // -1..1
  contrast: number // 0..2 (1 = neutral)
  saturation: number // 0..3 (1 = neutral)
  gamma: number // 0.1..10 (1 = neutral)
}

export interface MoodPreset {
  key: MoodPresetKey
  label: string
  /** photo display duration range in seconds */
  photoDurationRange: [number, number]
  /** xfade transition duration in seconds */
  transitionDurationSec: number
  /** max fractional zoom added on top of 1.0 at "normal" zoom speed, before
   * the user's zoom-speed selection scales it further */
  baseZoomAmount: number
  /** max pan travel as a fraction of the pannable window (0..1) */
  panRange: number
  color: ColorCorrection
}

export const MOOD_PRESET_TABLE: Record<MoodPresetKey, MoodPreset> = {
  natural: {
    key: 'natural',
    label: 'ナチュラル',
    photoDurationRange: [3.5, 4.5],
    transitionDurationSec: 0.8,
    baseZoomAmount: 0.08,
    panRange: 0.18,
    color: { brightness: 0, contrast: 1.0, saturation: 1.0, gamma: 1.0 }
  },
  shittori: {
    key: 'shittori',
    label: 'しっとり',
    photoDurationRange: [4.5, 5.5],
    transitionDurationSec: 1.2,
    baseZoomAmount: 0.06,
    panRange: 0.12,
    color: { brightness: -0.02, contrast: 0.95, saturation: 0.85, gamma: 1.05 }
  },
  bright: {
    key: 'bright',
    label: '明るい',
    photoDurationRange: [3.5, 4.5],
    transitionDurationSec: 0.7,
    baseZoomAmount: 0.09,
    panRange: 0.2,
    color: { brightness: 0.04, contrast: 1.08, saturation: 1.15, gamma: 1.0 }
  },
  tempo: {
    key: 'tempo',
    label: 'テンポ良く',
    photoDurationRange: [2.5, 3.2],
    transitionDurationSec: 0.4,
    baseZoomAmount: 0.1,
    panRange: 0.22,
    color: { brightness: 0.01, contrast: 1.1, saturation: 1.1, gamma: 1.0 }
  },
  cinematic: {
    key: 'cinematic',
    label: 'シネマティック',
    photoDurationRange: [4.0, 5.0],
    transitionDurationSec: 1.0,
    baseZoomAmount: 0.1,
    panRange: 0.16,
    color: { brightness: -0.03, contrast: 1.15, saturation: 0.8, gamma: 0.95 }
  }
}

/** Multiplies the preset's base zoom amount and controls how fast the zoom
 * animates within a clip's fixed duration. */
export const ZOOM_SPEED_MULTIPLIER: Record<ZoomSpeed, number> = {
  slow: 0.7,
  normal: 1.0,
  fast: 1.5
}

export function getMoodPreset(key: MoodPresetKey): MoodPreset {
  return MOOD_PRESET_TABLE[key]
}
