import { existsSync } from 'node:fs'
import ffmpegStaticPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

function resolveUnpacked(p: string): string {
  // electron-builder unpacks these from asar at build time (see
  // asarUnpack in electron-builder.yml); when running from inside an
  // asar archive the literal path still contains `.asar` and must be
  // rewritten to `.asar.unpacked` to be executable.
  return p.replace('app.asar', 'app.asar.unpacked')
}

export function getFfmpegPath(): string {
  const envOverride = process.env.FFMPEG_PATH
  if (envOverride && existsSync(envOverride)) return envOverride
  return resolveUnpacked(ffmpegStaticPath)
}

export function getFfprobePath(): string {
  const envOverride = process.env.FFPROBE_PATH
  if (envOverride && existsSync(envOverride)) return envOverride
  return resolveUnpacked(ffprobeStatic.path)
}
