import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import { IPC } from '@shared/types'

export function registerDialogIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.chooseOutputDir, async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.chooseBgmFile, async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.openPath, async (_event, path: string) => {
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
}
