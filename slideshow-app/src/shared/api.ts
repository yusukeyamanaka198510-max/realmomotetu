import type { AuthStatus, DriveLoadResult, GenerationSettings, JobProgress, JobResult, MediaItem } from './types'

/** The typed surface exposed to the renderer via preload's contextBridge. */
export interface SlideshowApi {
  auth: {
    getStatus(): Promise<AuthStatus>
    signIn(): Promise<AuthStatus>
    signOut(): Promise<void>
  }
  drive: {
    load(folderInput: string): Promise<DriveLoadResult>
  }
  dialog: {
    chooseOutputDir(): Promise<string | null>
    chooseBgmFile(): Promise<string | null>
  }
  shell: {
    openPath(path: string): Promise<void>
  }
  job: {
    start(items: MediaItem[], settings: GenerationSettings): Promise<JobResult>
    cancel(): void
    onProgress(cb: (progress: JobProgress) => void): () => void
  }
}

declare global {
  interface Window {
    slideshowApi: SlideshowApi
  }
}
