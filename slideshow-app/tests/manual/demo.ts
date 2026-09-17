import { mulberry32, createSeed } from '../../src/main/pipeline/rng'
import { getMoodPreset } from '../../src/main/pipeline/presets'
import { renderImageClip } from '../../src/main/pipeline/imageClip'
import { renderVideoClip } from '../../src/main/pipeline/videoClip'
import { concatSegmentsWithXfade } from '../../src/main/pipeline/concat'
import { muxFinalOutput } from '../../src/main/pipeline/audioMix'
import { PIPELINE_FPS } from '../../src/main/pipeline/constants'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function main(): Promise<void> {
  const seed = createSeed()
  console.log('seed:', seed)
  const rng = mulberry32(seed)
  const preset = getMoodPreset('cinematic')
  const targetWidth = 1280
  const targetHeight = 720
  const tmp = await mkdtemp(join(tmpdir(), 'slideshow-demo-'))

  const photos = ['photo_acf9.jpg', 'photo_b008.jpg', 'photo_dec8.jpg', 'photo_e235.jpg']
  const segments: { path: string; durationSec: number }[] = []

  for (let i = 0; i < photos.length; i++) {
    const outPath = join(tmp, `seg_photo_${i}.mp4`)
    const duration = 3
    await renderImageClip({
      sourcePath: join('/tmp/demoassets', photos[i]),
      mimeType: 'image/jpeg',
      outputPath: outPath,
      targetWidth,
      targetHeight,
      durationSec: duration,
      fps: PIPELINE_FPS,
      zoomSpeed: 'normal',
      preset,
      rng,
      tempDir: tmp
    })
    segments.push({ path: outPath, durationSec: duration })
    console.log('rendered photo segment', i)
  }

  const videoOut = join(tmp, 'seg_video.mp4')
  const videoResult = await renderVideoClip({
    sourcePath: '/tmp/demoassets/clip.mp4',
    outputPath: videoOut,
    targetWidth,
    targetHeight,
    maxDurationSec: 3,
    fps: PIPELINE_FPS,
    preset,
    useOriginalAudio: false
  })
  segments.splice(2, 0, { path: videoOut, durationSec: videoResult.durationSec })
  console.log('rendered video segment')

  const concatPath = join(tmp, 'concat.mp4')
  const concatResult = await concatSegmentsWithXfade(
    segments,
    preset.transitionDurationSec,
    rng,
    concatPath,
    PIPELINE_FPS
  )
  console.log('concatenated, total duration', concatResult.durationSec)

  const finalPath = '/tmp/demoassets/slideshow_demo.mp4'
  await muxFinalOutput({
    silentVideoPath: concatPath,
    videoDurationSec: concatResult.durationSec,
    bgm: { enabled: true, filePath: '/tmp/demoassets/bgm.m4a', fadeOutSec: 2 },
    outputPath: finalPath
  })
  console.log('final output written to', finalPath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
