import { runFfmpeg } from './ffmpegRunner'
import { probeAudioDurationSec } from './probe'
import { AUDIO_BITRATE, AUDIO_CODEC } from './constants'
import type { BgmSettings } from '@shared/types'

export interface FinalMuxInput {
  silentVideoPath: string
  videoDurationSec: number
  bgm: BgmSettings
  outputPath: string
  onProgress?: (fraction: number) => void
}

/** Final mux stage: muxes the silent, xfade-concatenated video with an
 * optional BGM track (trimmed to the video length, faded out a few seconds
 * before it ends) and encodes to H.264/AAC MP4. When BGM is disabled, the
 * video stream is simply remuxed without an audio track. */
export async function muxFinalOutput(input: FinalMuxInput): Promise<void> {
  if (!input.bgm.enabled || !input.bgm.filePath) {
    await runFfmpeg(
      [
        '-i',
        input.silentVideoPath,
        '-c:v',
        'copy',
        '-an',
        '-movflags',
        '+faststart',
        input.outputPath
      ],
      { totalDurationSec: input.videoDurationSec, onProgress: input.onProgress }
    )
    return
  }

  const bgmDurationSec = await probeAudioDurationSec(input.bgm.filePath)
  const effectiveBgmDuration = Math.min(bgmDurationSec, input.videoDurationSec)
  const fadeOutSec = Math.max(0, Math.min(input.bgm.fadeOutSec, effectiveBgmDuration))
  const fadeStart = Math.max(0, effectiveBgmDuration - fadeOutSec)

  // `apad` is bounded to the video's exact duration (rather than padding
  // indefinitely) and the output is hard-capped with `-t` instead of
  // relying on `-shortest`, which was observed to hang ffmpeg when paired
  // with `-c:v copy` and an otherwise-unbounded padded audio stream.
  const audioFilter =
    `[1:a]atrim=0:${effectiveBgmDuration.toFixed(3)},` +
    `afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeOutSec.toFixed(3)},` +
    `apad=whole_dur=${input.videoDurationSec.toFixed(3)}[aout]`

  await runFfmpeg(
    [
      '-i',
      input.silentVideoPath,
      '-i',
      input.bgm.filePath,
      '-filter_complex',
      audioFilter,
      '-map',
      '0:v',
      '-map',
      '[aout]',
      '-t',
      input.videoDurationSec.toFixed(3),
      '-c:v',
      'copy',
      '-c:a',
      AUDIO_CODEC,
      '-b:a',
      AUDIO_BITRATE,
      '-movflags',
      '+faststart',
      input.outputPath
    ],
    { totalDurationSec: input.videoDurationSec, onProgress: input.onProgress }
  )
}
