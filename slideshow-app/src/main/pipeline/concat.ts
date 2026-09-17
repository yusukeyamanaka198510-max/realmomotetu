import { runFfmpeg } from './ffmpegRunner'
import { buildXfadeChain, type SegmentInfo } from './transition'
import { PIX_FMT, VIDEO_CODEC, VIDEO_CRF, VIDEO_PRESET } from './constants'
import type { Rng } from './rng'

export interface ConcatResult {
  durationSec: number
}

/** Concatenates already-normalized (same resolution/fps/pixel format)
 * silent segments into one silent video using xfade cross-fades. */
export async function concatSegmentsWithXfade(
  segments: readonly SegmentInfo[],
  transitionDurationSec: number,
  rng: Rng,
  outputPath: string,
  fps: number,
  onProgress?: (fraction: number) => void
): Promise<ConcatResult> {
  const chain = buildXfadeChain(segments, transitionDurationSec, rng)
  const inputArgs = segments.flatMap((s) => ['-i', s.path])

  const args =
    segments.length === 1
      ? [...inputArgs, '-c:v', VIDEO_CODEC, '-pix_fmt', PIX_FMT, '-preset', VIDEO_PRESET, '-crf', VIDEO_CRF, '-an', outputPath]
      : [
          ...inputArgs,
          '-filter_complex',
          chain.filterComplex,
          '-map',
          chain.outputLabel,
          '-r',
          String(fps),
          '-c:v',
          VIDEO_CODEC,
          '-pix_fmt',
          PIX_FMT,
          '-preset',
          VIDEO_PRESET,
          '-crf',
          VIDEO_CRF,
          '-an',
          outputPath
        ]

  await runFfmpeg(args, { totalDurationSec: chain.totalDurationSec, onProgress })
  return { durationSec: chain.totalDurationSec }
}
