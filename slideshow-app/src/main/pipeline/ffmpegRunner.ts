import { spawn } from 'node:child_process'
import { getFfmpegPath, getFfprobePath } from './ffmpegBinary'

export interface RunFfmpegOptions {
  /** Total output duration in seconds, used to compute progress percent
   * from ffmpeg's `-progress pipe:1` `out_time_ms=` lines. */
  totalDurationSec?: number
  onProgress?: (fractionDone: number) => void
  /** Abort signal to allow job cancellation. */
  signal?: AbortSignal
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    public readonly stderrTail: string,
    public readonly args: string[]
  ) {
    super(message)
    this.name = 'FfmpegError'
  }
}

const STDERR_TAIL_LIMIT = 4000

export function runFfmpeg(args: string[], options: RunFfmpegOptions = {}): Promise<void> {
  const fullArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args]
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), fullArgs, { windowsHide: true })
    let stderrTail = ''
    let stdoutBuf = ''

    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    options.signal?.addEventListener('abort', onAbort)

    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT)
    })

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
      let idx: number
      // -progress emits blocks of key=value lines terminated by a line
      // "progress=continue" or "progress=end"
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim()
        stdoutBuf = stdoutBuf.slice(idx + 1)
        if (!options.onProgress || !options.totalDurationSec) continue
        const match = /^out_time_ms=(\d+)/.exec(line)
        if (match) {
          const doneSec = Number(match[1]) / 1_000_000
          const fraction = Math.max(0, Math.min(1, doneSec / options.totalDurationSec))
          options.onProgress(fraction)
        }
      }
    })

    child.on('error', (err) => {
      options.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })

    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort)
      if (code === 0) {
        options.onProgress?.(1)
        resolve()
      } else {
        reject(new FfmpegError(`ffmpeg exited with code ${code}`, stderrTail, fullArgs))
      }
    })
  })
}

export interface ProbeStream {
  codec_type: string
  width?: number
  height?: number
  duration?: string
  r_frame_rate?: string
  tags?: Record<string, string>
}

export interface ProbeResult {
  streams: ProbeStream[]
  format: { duration?: string }
}

export function runFfprobe(filePath: string): Promise<ProbeResult> {
  const args = [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(getFfprobePath(), args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed for ${filePath}: ${stderr.slice(-2000)}`))
        return
      }
      try {
        resolve(JSON.parse(stdout) as ProbeResult)
      } catch (e) {
        reject(new Error(`ffprobe returned invalid JSON for ${filePath}: ${(e as Error).message}`))
      }
    })
  })
}
