import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export async function createJobTempDir(baseDir: string, jobId: string): Promise<string> {
  const dir = join(baseDir, 'slideshow-maker', jobId)
  await mkdir(dir, { recursive: true })
  return dir
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov'
}

/** Picks a filesystem extension for a downloaded Drive file, preferring
 * the original file name's extension when it looks sane. */
export function extensionForMedia(mimeType: string, originalName: string): string {
  const match = /\.[a-zA-Z0-9]{2,5}$/.exec(originalName)
  if (match) return match[0].toLowerCase()
  return EXT_BY_MIME[mimeType] ?? ''
}
