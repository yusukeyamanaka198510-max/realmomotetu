import { spawn } from 'node:child_process'
import type { FaceBox } from './cropPlanner'

export interface FaceDetectOptions {
  pythonPath: string
  scriptPath: string
  timeoutMs?: number
}

/** Runs the bundled Python/OpenCV face detector on one image.
 *
 * Returns `null` (never throws) when Python or OpenCV are unavailable, the
 * script errors, or it times out -- callers must treat that as "no face
 * information" and fall back to a center crop. A single missing
 * dependency must never abort the slideshow generation job. */
export function detectFaces(imagePath: string, options: FaceDetectOptions): Promise<FaceBox[] | null> {
  const timeoutMs = options.timeoutMs ?? 8000
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(options.pythonPath, [options.scriptPath, imagePath], { windowsHide: true })
    let stdout = ''

    const finish = (value: FaceBox[] | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, timeoutMs)

    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()))
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (code !== 0) {
        finish(null)
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '') as {
          faces?: FaceBox[]
          error?: string
        }
        if (parsed.error || !parsed.faces) {
          finish(null)
          return
        }
        finish(parsed.faces)
      } catch {
        finish(null)
      }
    })
  })
}

export function defaultPythonPath(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}
