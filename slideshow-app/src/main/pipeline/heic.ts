import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import convert from 'heic-convert'

const HEIC_EXTENSIONS = ['.heic', '.heif']
const HEIC_MIME_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']

export function isHeic(mimeType: string, filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return HEIC_MIME_TYPES.includes(mimeType.toLowerCase()) || HEIC_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** Converts a HEIC/HEIF file to a JPEG in `tempDir`, returning the new path.
 * Uses the pure-JS `heic-convert` decoder so it works on Windows without any
 * native codec being pre-installed. */
export async function convertHeicToJpeg(sourcePath: string, tempDir: string): Promise<string> {
  const inputBuffer = await readFile(sourcePath)
  const outputBuffer = await convert({ buffer: inputBuffer, format: 'JPEG', quality: 0.92 })
  const outPath = join(tempDir, `heic_${randomUUID()}.jpg`)
  await writeFile(outPath, outputBuffer)
  return outPath
}
