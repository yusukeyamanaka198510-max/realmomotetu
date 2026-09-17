import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import type { GoogleAuthManager } from '../google/auth'
import { listFolderMedia } from '../google/drive'

export function registerDriveIpc(auth: GoogleAuthManager): void {
  ipcMain.handle(IPC.authStatus, () => auth.getStatus())

  ipcMain.handle(IPC.authSignIn, async () => {
    return auth.signIn()
  })

  ipcMain.handle(IPC.authSignOut, async () => {
    await auth.signOut()
  })

  ipcMain.handle(IPC.driveLoad, async (_event, folderInput: string) => {
    const client = await auth.getAuthorizedClient()
    return listFolderMedia(client, folderInput)
  })
}
