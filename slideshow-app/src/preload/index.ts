import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type GenerationSettings, type JobProgress, type MediaItem } from '@shared/types'
import type { SlideshowApi } from '@shared/api'

const api: SlideshowApi = {
  auth: {
    getStatus: () => ipcRenderer.invoke(IPC.authStatus),
    signIn: () => ipcRenderer.invoke(IPC.authSignIn),
    signOut: () => ipcRenderer.invoke(IPC.authSignOut)
  },
  drive: {
    load: (folderInput: string) => ipcRenderer.invoke(IPC.driveLoad, folderInput)
  },
  dialog: {
    chooseOutputDir: () => ipcRenderer.invoke(IPC.chooseOutputDir),
    chooseBgmFile: () => ipcRenderer.invoke(IPC.chooseBgmFile)
  },
  shell: {
    openPath: (path: string) => ipcRenderer.invoke(IPC.openPath, path)
  },
  job: {
    start: (items: MediaItem[], settings: GenerationSettings) => ipcRenderer.invoke(IPC.generateStart, items, settings),
    cancel: () => ipcRenderer.send(IPC.generateCancel),
    onProgress: (cb: (progress: JobProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: JobProgress): void => cb(progress)
      ipcRenderer.on(IPC.jobProgress, listener)
      return () => ipcRenderer.removeListener(IPC.jobProgress, listener)
    }
  }
}

contextBridge.exposeInMainWorld('slideshowApi', api)
