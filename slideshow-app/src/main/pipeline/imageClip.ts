import { unlink } from 'node:fs/promises'
import type { ZoomSpeed } from '@shared/types'
import { runFfmpeg } from './ffmpegRunner'
import { probeMedia } from './probe'
import { computeCropPlan } from './cropPlanner'
import { detectFaces, type FaceDetectOptions } from './faceDetector'
import { generateKenBurnsParams, buildZoompanFilter } from './kenBurns'
import { buildEqFilter } from './colorFilter'
import { isHeic, convertHeicToJpeg } from './heic'
import { PIX_FMT, VIDEO_CODEC, VIDEO_CRF, VIDEO_PRESET } from './constants'
import type { MoodPreset } from './presets'
import type { Rng } from './rng'

export interface ImageClipInput {
  sourcePath: string
  mimeType: string
  outputPath: string
  targetWidth: number
  targetHeight: number
  durationSec: number
  fps: number
  zoomSpeed: ZoomSpeed
  preset: MoodPreset
  rng: Rng
  tempDir: string
  /** Undefined disables face detection entirely (falls back to a centered
   * crop) -- e.g. when Python/OpenCV isn't installed on the user's machine. */
  faceDetection?: FaceDetectOptions
}

/** Renders one photo into a fixed-duration, silent, Ken-Burns-animated
 * video segment normalized to the project's resolution/fps/pixel format. */
export async function renderImageClip(input: ImageClipInput): Promise<void> {
  let workingPath = input.sourcePath
  let heicTempPath: string | null = null

  if (isHeic(input.mimeType, input.sourcePath)) {
    workingPath = await convertHeicToJpeg(input.sourcePath, input.tempDir)
    heicTempPath = workingPath
  }

  try {
    const probe = await probeMedia(workingPath)

    let faces = null as Awaited<ReturnType<typeof detectFaces>>
    if (input.faceDetection) {
      faces = await detectFaces(workingPath, input.faceDetection)
    }

    const plan = computeCropPlan(probe.width, probe.height, input.targetWidth, input.targetHeight, faces ?? [])
    const kb = generateKenBurnsParams(input.rng, input.preset, input.zoomSpeed, plan.faceCenterFrac)
    const zoompan = buildZoompanFilter(kb, plan.crop.w, plan.crop.h, {
      outWidth: input.targetWidth,
      outHeight: input.targetHeight,
      durationSec: input.durationSec,
      fps: input.fps
    })
    const eq = buildEqFilter(input.preset.color)

    const vf = [
      `crop=${plan.crop.w}:${plan.crop.h}:${plan.crop.x}:${plan.crop.y}`,
      zoompan,
      eq,
      `format=${PIX_FMT}`
    ].join(',')

    await runFfmpeg(
      [
        '-loop',
        '1',
        '-t',
        input.durationSec.toFixed(3),
        '-i',
        workingPath,
        '-vf',
        vf,
        '-r',
        String(input.fps),
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
      { totalDurationSec: input.durationSec }
    )
  } finally {
    if (heicTempPath) {
      await unlink(heicTempPath).catch(() => undefined)
    }
  }
}
