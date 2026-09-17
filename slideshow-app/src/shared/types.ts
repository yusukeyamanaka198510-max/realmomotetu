// Shared type contracts between the Electron main process, preload bridge,
// and the React renderer. Keep this file free of Node/DOM-only APIs so it
// can be imported from all three worlds.

export type MediaKind = 'image' | 'video'

export type MediaStatus = 'listed' | 'downloading' | 'downloaded' | 'failed' | 'skipped'

export interface MediaItem {
  id: string
  driveFileId: string
  name: string
  mimeType: string
  kind: MediaKind
  sizeBytes: number
  createdTime: string | null
  status: MediaStatus
  localPath?: string
  width?: number
  height?: number
  durationSec?: number
  error?: string
}

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const
export type AspectRatioKey = (typeof ASPECT_RATIOS)[number]

export interface AspectRatioSpec {
  key: AspectRatioKey
  width: number
  height: number
  label: string
}

export const ASPECT_RATIO_SPECS: Record<AspectRatioKey, AspectRatioSpec> = {
  '16:9': { key: '16:9', width: 1920, height: 1080, label: '16:9 (横長)' },
  '9:16': { key: '9:16', width: 1080, height: 1920, label: '9:16 (縦長)' },
  '1:1': { key: '1:1', width: 1080, height: 1080, label: '1:1 (正方形)' }
}

export const MOOD_PRESETS = ['natural', 'shittori', 'bright', 'tempo', 'cinematic'] as const
export type MoodPresetKey = (typeof MOOD_PRESETS)[number]

export const ZOOM_SPEEDS = ['slow', 'normal', 'fast'] as const
export type ZoomSpeed = (typeof ZOOM_SPEEDS)[number]

/** Person-appearance-bias suppression. `balance` is a first-implementation
 * interface only: it currently behaves like `off` until face-embedding
 * clustering (see personBias.ts) is implemented. */
export const PERSON_BIAS_MODES = ['off', 'balance'] as const
export type PersonBiasMode = (typeof PERSON_BIAS_MODES)[number]

export interface BgmSettings {
  enabled: boolean
  filePath: string | null
  fadeOutSec: number
}

export interface VideoClipSettings {
  maxDurationSec: number
  useOriginalAudio: boolean
}

export interface GenerationSettings {
  driveFolderInput: string
  aspectRatio: AspectRatioKey
  mood: MoodPresetKey
  zoomSpeed: ZoomSpeed
  bgm: BgmSettings
  personBiasMode: PersonBiasMode
  videoClip: VideoClipSettings
  /** Random seed controlling material order. If omitted, one is generated
   * and returned in the job result so the same order can be reproduced. */
  seed?: number
  outputDir: string
}

export const DEFAULT_SETTINGS: GenerationSettings = {
  driveFolderInput: '',
  aspectRatio: '16:9',
  mood: 'natural',
  zoomSpeed: 'normal',
  bgm: { enabled: false, filePath: null, fadeOutSec: 3 },
  personBiasMode: 'off',
  videoClip: { maxDurationSec: 6, useOriginalAudio: false },
  outputDir: ''
}

export const JOB_STAGES = [
  'drive_fetch',
  'analyzing',
  'image_transform',
  'video_transform',
  'concat',
  'bgm',
  'mux',
  'done',
  'error'
] as const
export type JobStage = (typeof JOB_STAGES)[number]

export const JOB_STAGE_LABELS: Record<JobStage, string> = {
  drive_fetch: 'Drive読込',
  analyzing: '素材解析',
  image_transform: '画像変換',
  video_transform: '動画変換',
  concat: '動画結合',
  bgm: 'BGM処理',
  mux: 'MP4出力',
  done: '完了',
  error: 'エラー'
}

export interface JobProgress {
  jobId: string
  stage: JobStage
  percent: number
  currentItem?: string
  message?: string
}

export interface JobLogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  itemName?: string
  timestamp: string
}

export interface SkippedItem {
  name: string
  reason: string
}

export interface JobResult {
  success: boolean
  jobId: string
  outputPath?: string
  seedUsed: number
  skippedItems: SkippedItem[]
  log: JobLogEntry[]
  error?: string
}

export interface DriveLoadResult {
  items: MediaItem[]
  imageCount: number
  videoCount: number
  folderName: string
}

export interface AuthStatus {
  authenticated: boolean
  email?: string
}

/** IPC channel names shared by preload (invoke/on) and main (handle/emit). */
export const IPC = {
  authStatus: 'auth:status',
  authSignIn: 'auth:signIn',
  authSignOut: 'auth:signOut',
  driveLoad: 'drive:load',
  chooseOutputDir: 'dialog:chooseOutputDir',
  chooseBgmFile: 'dialog:chooseBgmFile',
  openPath: 'shell:openPath',
  generateStart: 'job:start',
  generateCancel: 'job:cancel',
  jobProgress: 'job:progress',
  jobDone: 'job:done'
} as const
