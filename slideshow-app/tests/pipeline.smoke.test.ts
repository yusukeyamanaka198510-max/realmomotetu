import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mulberry32 } from '../src/main/pipeline/rng'
import { getMoodPreset } from '../src/main/pipeline/presets'
import { renderImageClip } from '../src/main/pipeline/imageClip'
import { renderVideoClip } from '../src/main/pipeline/videoClip'
import { concatSegmentsWithXfade } from '../src/main/pipeline/concat'
import { muxFinalOutput } from '../src/main/pipeline/audioMix'
import { probeMedia } from '../src/main/pipeline/probe'
import { PIPELINE_FPS } from '../src/main/pipeline/constants'

const FIXTURES = '/tmp/pipelinetest'

describe('end-to-end pipeline against real ffmpeg', () => {
  it('renders photos + a video clip into a transitioned, BGM-muxed MP4', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'slideshow-smoke-'))
    try {
      const rng = mulberry32(42)
      const preset = getMoodPreset('natural')
      const targetWidth = 640
      const targetHeight = 360

      const seg1 = join(tmp, 'seg1.mp4')
      const seg2 = join(tmp, 'seg2.mp4')
      const seg3 = join(tmp, 'seg3.mp4')

      await renderImageClip({
        sourcePath: join(FIXTURES, 'photo1.jpg'),
        mimeType: 'image/jpeg',
        outputPath: seg1,
        targetWidth,
        targetHeight,
        durationSec: 2,
        fps: PIPELINE_FPS,
        zoomSpeed: 'normal',
        preset,
        rng,
        tempDir: tmp
      })

      await renderImageClip({
        sourcePath: join(FIXTURES, 'photo2.jpg'),
        mimeType: 'image/jpeg',
        outputPath: seg2,
        targetWidth,
        targetHeight,
        durationSec: 2.5,
        fps: PIPELINE_FPS,
        zoomSpeed: 'fast',
        preset,
        rng,
        tempDir: tmp
      })

      const videoResult = await renderVideoClip({
        sourcePath: join(FIXTURES, 'video1.mp4'),
        outputPath: seg3,
        targetWidth,
        targetHeight,
        maxDurationSec: 1.5,
        fps: PIPELINE_FPS,
        preset,
        useOriginalAudio: false
      })
      expect(videoResult.durationSec).toBeCloseTo(1.5, 1)

      for (const seg of [seg1, seg2, seg3]) {
        const p = await probeMedia(seg)
        expect(p.width).toBe(targetWidth)
        expect(p.height).toBe(targetHeight)
      }

      const concatPath = join(tmp, 'concat.mp4')
      const concatResult = await concatSegmentsWithXfade(
        [
          { path: seg1, durationSec: 2 },
          { path: seg2, durationSec: 2.5 },
          { path: seg3, durationSec: videoResult.durationSec }
        ],
        0.5,
        rng,
        concatPath,
        PIPELINE_FPS
      )
      expect(concatResult.durationSec).toBeGreaterThan(3)

      const concatProbe = await probeMedia(concatPath)
      expect(concatProbe.durationSec).toBeGreaterThan(3)
      expect(concatProbe.width).toBe(targetWidth)

      const finalPath = join(tmp, 'final.mp4')
      await muxFinalOutput({
        silentVideoPath: concatPath,
        videoDurationSec: concatResult.durationSec,
        bgm: { enabled: true, filePath: join(FIXTURES, 'bgm.m4a'), fadeOutSec: 1 },
        outputPath: finalPath
      })

      const finalProbe = await probeMedia(finalPath)
      expect(finalProbe.hasAudio).toBe(true)
      expect(finalProbe.durationSec).toBeGreaterThan(3)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }, 60_000)

  it('produces a video-only MP4 when BGM is disabled', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'slideshow-smoke-nobgm-'))
    try {
      const rng = mulberry32(7)
      const preset = getMoodPreset('bright')
      const seg1 = join(tmp, 'seg1.mp4')
      await renderImageClip({
        sourcePath: join(FIXTURES, 'photo1.jpg'),
        mimeType: 'image/jpeg',
        outputPath: seg1,
        targetWidth: 480,
        targetHeight: 480,
        durationSec: 1.2,
        fps: PIPELINE_FPS,
        zoomSpeed: 'slow',
        preset,
        rng,
        tempDir: tmp
      })
      const concatPath = join(tmp, 'concat.mp4')
      const concatResult = await concatSegmentsWithXfade(
        [{ path: seg1, durationSec: 1.2 }],
        0.5,
        rng,
        concatPath,
        PIPELINE_FPS
      )
      const finalPath = join(tmp, 'final.mp4')
      await muxFinalOutput({
        silentVideoPath: concatPath,
        videoDurationSec: concatResult.durationSec,
        bgm: { enabled: false, filePath: null, fadeOutSec: 3 },
        outputPath: finalPath
      })
      const finalProbe = await probeMedia(finalPath)
      expect(finalProbe.hasAudio).toBe(false)
      expect(finalProbe.width).toBe(480)
      expect(finalProbe.height).toBe(480)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }, 30_000)
})
