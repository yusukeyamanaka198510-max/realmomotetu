import { runFfmpeg } from './ffmpegRunner'
import { probeMedia } from './probe'
import { computeCropPlan } from './cropPlanner'
import { buildEqFilter } from './colorFilter'
import { PIX_FMT, VIDEO_CODEC, VIDEO_CRF, VIDEO_PRESET } from './constants'
import type { MoodPreset } from './presets'

export interface VideoClipInput {
  sourcePath: string
  outputPath: string
  targetWidth: number
  targetHeight: number
  maxDurationSec: number
  fps: number
  preset: MoodPreset
  /** Reserved for a future "use source audio" feature -- currently always
   * rendered silent because the final mix is BGM-only (see audioMix.ts). */
  useOriginalAudio: boolean
}

export interface VideoClipRenderResult {
  durationSec: number
}

/** Renders one video clip, trimmed to at most `maxDurationSec`, into a
 * silent segment normalized to the project's resolution/fps/pixel format.
 * Uses a plain center-weighted crop (no face detection for video, per
 * spec). */
export async function renderVideoClip(input: VideoClipInput): Promise<VideoClipRenderResult> {
  const probe = await probeMedia(input.sourcePath)
  const durationSec = Math.min(probe.durationSec || input.maxDurationSec, input.maxDurationSec)
  if (durationSec <= 0) {
    throw new Error(`Video has no usable duration: ${input.sourcePath}`)
  }

  const plan = computeCropPlan(probe.width, probe.height, input.targetWidth, input.targetHeight, [])
  const eq = buildEqFilter(input.preset.color)
  const vf = [
    `crop=${plan.crop.w}:${plan.crop.h}:${plan.crop.x}:${plan.crop.y}`,
    `scale=${input.targetWidth}:${input.targetHeight}`,
    `fps=${input.fps}`,
    eq,
    `format=${PIX_FMT}`
  ].join(',')

  await runFfmpeg(
    [
      '-i',
      input.sourcePath,
      '-t',
      durationSec.toFixed(3),
      '-vf',
      vf,
      '-an',
      '-c:v',
      VIDEO_CODEC,
      '-pix_fmt',
      PIX_FMT,
      '-preset',
      VIDEO_PRESET,
      '-crf',
      VIDEO_CRF,
      input.outputPath
    ],
    { totalDurationSec: durationSec }
  )

  return { durationSec }
}
