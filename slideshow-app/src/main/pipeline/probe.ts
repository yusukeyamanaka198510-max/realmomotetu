import { runFfprobe } from './ffmpegRunner'

export interface MediaProbeInfo {
  width: number
  height: number
  durationSec: number
  hasAudio: boolean
  rotationDeg: number
}

/** Probes a media file and normalizes rotation-aware width/height, since
 * phone-shot portrait video is often stored landscape with a 90/270 degree
 * rotate tag. */
export async function probeMedia(filePath: string): Promise<MediaProbeInfo> {
  const result = await runFfprobe(filePath)
  const videoStream = result.streams.find((s) => s.codec_type === 'video')
  const audioStream = result.streams.find((s) => s.codec_type === 'audio')
  if (!videoStream) {
    throw new Error(`No video/image stream found in ${filePath}`)
  }

  const rawWidth = videoStream.width ?? 0
  const rawHeight = videoStream.height ?? 0
  const rotationDeg = normalizeRotation(Number(videoStream.tags?.rotate ?? '0'))
  const swapped = rotationDeg === 90 || rotationDeg === 270
  const width = swapped ? rawHeight : rawWidth
  const height = swapped ? rawWidth : rawHeight

  const durationSec = Number(videoStream.duration ?? result.format.duration ?? '0') || 0

  return { width, height, durationSec, hasAudio: Boolean(audioStream), rotationDeg }
}

function normalizeRotation(deg: number): number {
  const mod = ((deg % 360) + 360) % 360
  return mod
}

/** Probes an audio-only file (e.g. a BGM track) for its duration. */
export async function probeAudioDurationSec(filePath: string): Promise<number> {
  const result = await runFfprobe(filePath)
  const audioStream = result.streams.find((s) => s.codec_type === 'audio')
  const duration = Number(audioStream?.duration ?? result.format.duration ?? '0')
  if (!duration || Number.isNaN(duration)) {
    throw new Error(`Could not determine duration of audio file: ${filePath}`)
  }
  return duration
}
