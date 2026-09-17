import { join } from 'node:path'
import type { GenerationSettings, JobProgress, JobResult, JobStage, MediaItem, SkippedItem } from '@shared/types'
import { ASPECT_RATIO_SPECS } from '@shared/types'
import { createSeed, mulberry32, randRange, seededShuffle } from './rng'
import { getMoodPreset } from './presets'
import { PIPELINE_FPS } from './constants'
import { createJobTempDir, cleanupTempDir, extensionForMedia } from './tempDir'
import { renderImageClip } from './imageClip'
import { renderVideoClip } from './videoClip'
import { concatSegmentsWithXfade } from './concat'
import { muxFinalOutput } from './audioMix'
import { probeMedia } from './probe'
import { JobLogger } from './logger'
import { NoOpPersonTagger, reorderByPersonBias } from './personBias'
import type { FaceDetectOptions } from './faceDetector'
import type { SegmentInfo } from './transition'

export interface RunJobDeps {
  /** Downloads one Drive file's bytes to `destPath`. Injected so the
   * pipeline stays independent of the Google APIs client. */
  downloadFile: (driveFileId: string, destPath: string) => Promise<void>
  tempBaseDir: string
  faceDetection?: FaceDetectOptions
  onProgress: (progress: JobProgress) => void
  signal?: AbortSignal
}

export interface RunJobInput {
  jobId: string
  items: readonly MediaItem[]
  settings: GenerationSettings
}

const STAGE_WEIGHTS: Record<Exclude<JobStage, 'done' | 'error'>, [number, number]> = {
  drive_fetch: [0, 15],
  analyzing: [15, 22],
  image_transform: [22, 50],
  video_transform: [50, 65],
  concat: [65, 82],
  bgm: [82, 94],
  mux: [94, 100]
}

function stagePercent(stage: keyof typeof STAGE_WEIGHTS, fraction: number): number {
  const [from, to] = STAGE_WEIGHTS[stage]
  return Math.round(from + (to - from) * Math.max(0, Math.min(1, fraction)))
}

export async function runJob(input: RunJobInput, deps: RunJobDeps): Promise<JobResult> {
  const { jobId, items, settings } = input
  const log = new JobLogger()
  const skipped: SkippedItem[] = []
  const seed = settings.seed ?? createSeed()
  const rng = mulberry32(seed)
  const preset = getMoodPreset(settings.mood)
  const { width: targetWidth, height: targetHeight } = ASPECT_RATIO_SPECS[settings.aspectRatio]

  const report = (stage: JobStage, percent: number, currentItem?: string, message?: string): void => {
    deps.onProgress({ jobId, stage, percent, currentItem, message })
  }

  const checkAbort = (): void => {
    if (deps.signal?.aborted) throw new Error('Job was cancelled')
  }

  let tempDir = ''
  try {
    tempDir = await createJobTempDir(deps.tempBaseDir, jobId)
    log.info(`Temp directory: ${tempDir}`)

    let order = seededShuffle(items, rng)
    if (settings.personBiasMode === 'balance') {
      const tags = await new NoOpPersonTagger().tagAll(order)
      order = reorderByPersonBias(order, tags)
    }

    // Stage: drive_fetch
    report('drive_fetch', 0)
    const downloaded: MediaItem[] = []
    for (let i = 0; i < order.length; i++) {
      checkAbort()
      const item = order[i]
      const ext = extensionForMedia(item.mimeType, item.name)
      const destPath = join(tempDir, `src_${i.toString().padStart(3, '0')}${ext}`)
      try {
        await deps.downloadFile(item.driveFileId, destPath)
        downloaded.push({ ...item, localPath: destPath, status: 'downloaded' })
        log.info('Downloaded', item.name)
      } catch (err) {
        log.error(`Download failed: ${(err as Error).message}`, item.name)
        skipped.push({ name: item.name, reason: `Drive download failed: ${(err as Error).message}` })
      }
      report('drive_fetch', stagePercent('drive_fetch', (i + 1) / order.length), item.name)
    }

    if (downloaded.length === 0) {
      throw new Error('No media could be downloaded from Google Drive')
    }

    // Stage: analyzing (probe + sanity check each file so a corrupt file
    // never reaches the transform stage and stalls the whole job)
    report('analyzing', 0)
    const analyzed: MediaItem[] = []
    for (let i = 0; i < downloaded.length; i++) {
      checkAbort()
      const item = downloaded[i]
      try {
        const probe = await probeMedia(item.localPath!)
        analyzed.push({ ...item, width: probe.width, height: probe.height, durationSec: probe.durationSec })
      } catch (err) {
        log.error(`Analysis failed (possibly corrupt file): ${(err as Error).message}`, item.name)
        skipped.push({ name: item.name, reason: `Could not read media: ${(err as Error).message}` })
      }
      report('analyzing', stagePercent('analyzing', (i + 1) / downloaded.length), item.name)
    }

    if (analyzed.length === 0) {
      throw new Error('No media survived analysis (all files were unreadable)')
    }

    // Stage: image_transform / video_transform
    const images = analyzed.filter((m) => m.kind === 'image')
    const videos = analyzed.filter((m) => m.kind === 'video')
    const segmentsByOriginalIndex = new Map<number, SegmentInfo>()

    report('image_transform', 0)
    for (let i = 0; i < images.length; i++) {
      checkAbort()
      const item = images[i]
      const outPath = join(tempDir, `seg_img_${i.toString().padStart(3, '0')}.mp4`)
      const durationSec = randRange(rng, preset.photoDurationRange[0], preset.photoDurationRange[1])
      try {
        await renderImageClip({
          sourcePath: item.localPath!,
          mimeType: item.mimeType,
          outputPath: outPath,
          targetWidth,
          targetHeight,
          durationSec,
          fps: PIPELINE_FPS,
          zoomSpeed: settings.zoomSpeed,
          preset,
          rng,
          tempDir,
          faceDetection: deps.faceDetection
        })
        segmentsByOriginalIndex.set(analyzed.indexOf(item), { path: outPath, durationSec })
      } catch (err) {
        log.error(`Image transform failed: ${(err as Error).message}`, item.name)
        skipped.push({ name: item.name, reason: `Image processing failed: ${(err as Error).message}` })
      }
      report('image_transform', stagePercent('image_transform', (i + 1) / Math.max(1, images.length)), item.name)
    }

    report('video_transform', 0)
    for (let i = 0; i < videos.length; i++) {
      checkAbort()
      const item = videos[i]
      const outPath = join(tempDir, `seg_vid_${i.toString().padStart(3, '0')}.mp4`)
      try {
        const result = await renderVideoClip({
          sourcePath: item.localPath!,
          outputPath: outPath,
          targetWidth,
          targetHeight,
          maxDurationSec: settings.videoClip.maxDurationSec,
          fps: PIPELINE_FPS,
          preset,
          useOriginalAudio: settings.videoClip.useOriginalAudio
        })
        segmentsByOriginalIndex.set(analyzed.indexOf(item), { path: outPath, durationSec: result.durationSec })
      } catch (err) {
        log.error(`Video transform failed: ${(err as Error).message}`, item.name)
        skipped.push({ name: item.name, reason: `Video processing failed: ${(err as Error).message}` })
      }
      report('video_transform', stagePercent('video_transform', (i + 1) / Math.max(1, videos.length)), item.name)
    }

    // Preserve the seeded shuffle order: walk `analyzed` and collect the
    // segments that were rendered successfully, in that same order.
    const segments: SegmentInfo[] = []
    for (let i = 0; i < analyzed.length; i++) {
      const seg = segmentsByOriginalIndex.get(i)
      if (seg) segments.push(seg)
    }

    if (segments.length === 0) {
      throw new Error('No segments could be rendered (all materials failed processing)')
    }

    // Stage: concat
    report('concat', 0)
    const concatPath = join(tempDir, 'concat.mp4')
    const concatResult = await concatSegmentsWithXfade(
      segments,
      preset.transitionDurationSec,
      rng,
      concatPath,
      PIPELINE_FPS,
      (fraction) => report('concat', stagePercent('concat', fraction))
    )
    log.info(`Concatenated ${segments.length} segments, total duration ${concatResult.durationSec.toFixed(2)}s`)

    // Stage: bgm + mux
    report('bgm', 0)
    const outputPath = join(settings.outputDir, `slideshow_${jobId}.mp4`)
    await muxFinalOutput({
      silentVideoPath: concatPath,
      videoDurationSec: concatResult.durationSec,
      bgm: settings.bgm,
      outputPath,
      onProgress: (fraction) => report('bgm', stagePercent('bgm', fraction))
    })

    report('mux', 100)
    report('done', 100)
    await cleanupTempDir(tempDir)

    return { success: true, jobId, outputPath, seedUsed: seed, skippedItems: skipped, log: log.getEntries() }
  } catch (err) {
    log.error(`Job failed: ${(err as Error).message}`)
    report('error', 0, undefined, (err as Error).message)
    return {
      success: false,
      jobId,
      seedUsed: seed,
      skippedItems: skipped,
      log: log.getEntries(),
      error: (err as Error).message
    }
  }
}
