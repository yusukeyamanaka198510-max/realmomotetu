import { create } from 'zustand'
import type {
  AuthStatus,
  DriveLoadResult,
  GenerationSettings,
  JobProgress,
  JobResult,
  MediaItem
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

interface AppState {
  auth: AuthStatus
  authBusy: boolean
  driveFolderInput: string
  driveLoading: boolean
  driveError: string | null
  driveResult: DriveLoadResult | null
  settings: GenerationSettings
  jobRunning: boolean
  jobProgress: JobProgress | null
  jobResult: JobResult | null

  refreshAuthStatus: () => Promise<void>
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  setDriveFolderInput: (value: string) => void
  loadDrive: () => Promise<void>
  updateSettings: (patch: Partial<GenerationSettings>) => void
  chooseOutputDir: () => Promise<void>
  chooseBgmFile: () => Promise<void>
  startGeneration: () => Promise<void>
  cancelGeneration: () => void
  openOutput: () => Promise<void>
}

function mediaItemsFrom(result: DriveLoadResult | null): MediaItem[] {
  return result?.items ?? []
}

export const useAppStore = create<AppState>((set, get) => ({
  auth: { authenticated: false },
  authBusy: false,
  driveFolderInput: '',
  driveLoading: false,
  driveError: null,
  driveResult: null,
  settings: { ...DEFAULT_SETTINGS },
  jobRunning: false,
  jobProgress: null,
  jobResult: null,

  refreshAuthStatus: async () => {
    const auth = await window.slideshowApi.auth.getStatus()
    set({ auth })
  },

  signIn: async () => {
    set({ authBusy: true })
    try {
      const auth = await window.slideshowApi.auth.signIn()
      set({ auth })
    } finally {
      set({ authBusy: false })
    }
  },

  signOut: async () => {
    await window.slideshowApi.auth.signOut()
    set({ auth: { authenticated: false } })
  },

  setDriveFolderInput: (value) => set({ driveFolderInput: value }),

  loadDrive: async () => {
    const { driveFolderInput } = get()
    if (!driveFolderInput.trim()) return
    set({ driveLoading: true, driveError: null })
    try {
      const result = await window.slideshowApi.drive.load(driveFolderInput.trim())
      set({ driveResult: result, driveLoading: false })
    } catch (err) {
      set({ driveError: (err as Error).message, driveLoading: false })
    }
  },

  updateSettings: (patch) =>
    set((state) => ({
      settings: {
        ...state.settings,
        ...patch,
        bgm: { ...state.settings.bgm, ...(patch.bgm ?? {}) },
        videoClip: { ...state.settings.videoClip, ...(patch.videoClip ?? {}) }
      }
    })),

  chooseOutputDir: async () => {
    const dir = await window.slideshowApi.dialog.chooseOutputDir()
    if (dir) get().updateSettings({ outputDir: dir })
  },

  chooseBgmFile: async () => {
    const file = await window.slideshowApi.dialog.chooseBgmFile()
    if (file) get().updateSettings({ bgm: { ...get().settings.bgm, filePath: file } })
  },

  startGeneration: async () => {
    const { driveResult, settings } = get()
    const items = mediaItemsFrom(driveResult)
    if (items.length === 0 || !settings.outputDir) return
    set({ jobRunning: true, jobProgress: null, jobResult: null })
    try {
      const result = await window.slideshowApi.job.start(items, settings)
      set({ jobResult: result, jobRunning: false })
    } catch (err) {
      set({
        jobResult: {
          success: false,
          jobId: 'unknown',
          seedUsed: settings.seed ?? 0,
          skippedItems: [],
          log: [],
          error: (err as Error).message
        },
        jobRunning: false
      })
    }
  },

  cancelGeneration: () => {
    window.slideshowApi.job.cancel()
  },

  openOutput: async () => {
    const path = get().jobResult?.outputPath
    if (path) await window.slideshowApi.shell.openPath(path)
  }
}))

let progressUnsubscribe: (() => void) | null = null
export function subscribeJobProgress(): void {
  if (progressUnsubscribe) return
  progressUnsubscribe = window.slideshowApi.job.onProgress((progress) => {
    useAppStore.setState({ jobProgress: progress })
  })
}
