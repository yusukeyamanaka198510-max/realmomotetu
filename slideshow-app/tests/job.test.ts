import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, copyFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runJob } from '../src/main/pipeline/job'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import type { MediaItem } from '../src/shared/types'

const FIXTURES = '/tmp/pipelinetest'

describe('job orchestrator', () => {
  it('runs all stages, reports progress in order, and skips a failing download without aborting', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'slideshow-job-out-'))
    const tempBaseDir = await mkdtemp(join(tmpdir(), 'slideshow-job-temp-'))
    try {
      const items: MediaItem[] = [
        {
          id: 'a',
          driveFileId: 'drive-a',
          name: 'photo1.jpg',
          mimeType: 'image/jpeg',
          kind: 'image',
          sizeBytes: 1000,
          createdTime: null,
          status: 'listed'
        },
        {
          id: 'b',
          driveFileId: 'drive-b',
          name: 'photo2.jpg',
          mimeType: 'image/jpeg',
          kind: 'image',
          sizeBytes: 1000,
          createdTime: null,
          status: 'listed'
        },
        {
          id: 'c',
          driveFileId: 'drive-c',
          name: 'video1.mp4',
          mimeType: 'video/mp4',
          kind: 'video',
          sizeBytes: 1000,
          createdTime: null,
          status: 'listed'
        },
        {
          id: 'broken',
          driveFileId: 'drive-broken',
          name: 'broken.jpg',
          mimeType: 'image/jpeg',
          kind: 'image',
          sizeBytes: 1000,
          createdTime: null,
          status: 'listed'
        }
      ]

      const stagesSeen: string[] = []

      const result = await runJob(
        {
          jobId: 'test-job-1',
          items,
          settings: {
            ...DEFAULT_SETTINGS,
            mood: 'tempo',
            zoomSpeed: 'fast',
            outputDir: outDir
          }
        },
        {
          tempBaseDir,
          downloadFile: async (driveFileId, destPath) => {
            if (driveFileId === 'drive-broken') {
              throw new Error('simulated network failure')
            }
            const sourceName = driveFileId === 'drive-a' ? 'photo1.jpg' : driveFileId === 'drive-b' ? 'photo2.jpg' : 'video1.mp4'
            await copyFile(join(FIXTURES, sourceName), destPath)
          },
          onProgress: (p) => {
            if (stagesSeen[stagesSeen.length - 1] !== p.stage) stagesSeen.push(p.stage)
          }
        }
      )

      expect(result.success).toBe(true)
      expect(result.skippedItems).toEqual([
        expect.objectContaining({ name: 'broken.jpg', reason: expect.stringContaining('simulated network failure') })
      ])
      expect(result.outputPath).toBeTruthy()
      await access(result.outputPath!)

      expect(stagesSeen).toEqual([
        'drive_fetch',
        'analyzing',
        'image_transform',
        'video_transform',
        'concat',
        'bgm',
        'mux',
        'done'
      ])

      // temp dir cleaned up on success
      await expect(access(join(tempBaseDir, 'slideshow-maker', 'test-job-1'))).rejects.toThrow()
    } finally {
      await rm(outDir, { recursive: true, force: true })
      await rm(tempBaseDir, { recursive: true, force: true })
    }
  }, 60_000)
})
