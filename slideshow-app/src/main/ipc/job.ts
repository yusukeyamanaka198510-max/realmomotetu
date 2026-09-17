import { randomUUID } from 'node:crypto'
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC, type GenerationSettings, type MediaItem } from '@shared/types'
import type { GoogleAuthManager } from '../google/auth'
import { downloadDriveFile } from '../google/drive'
import { runJob } from '../pipeline/job'
import { resolveFaceDetectionOptions } from '../paths'

export function registerJobIpc(auth: GoogleAuthManager): void {
  let currentAbort: AbortController | null = null

  ipcMain.handle(
    IPC.generateStart,
    async (event: IpcMainInvokeEvent, items: MediaItem[], settings: GenerationSettings) => {
      const client = await auth.getAuthorizedClient()
      const jobId = randomUUID()
      currentAbort = new AbortController()

      return runJob(
        { jobId, items, settings },
        {
          downloadFile: (driveFileId, destPath) => downloadDriveFile(client, driveFileId, destPath),
          tempBaseDir: app.getPath('temp'),
          faceDetection: resolveFaceDetectionOptions(),
          signal: currentAbort.signal,
          onProgress: (progress) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(IPC.jobProgress, progress)
            }
          }
        }
      )
    }
  )

  ipcMain.on(IPC.generateCancel, () => {
    currentAbort?.abort()
  })
}
