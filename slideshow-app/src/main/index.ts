import { join } from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { app, BrowserWindow, shell } from 'electron'

// Loads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (and optional overrides
// like FFMPEG_PATH/PYTHON_PATH) from a .env file next to the app, if
// present. See README for how to obtain OAuth credentials.
loadDotenv({ path: join(app.getAppPath(), '.env') })
import { GoogleAuthManager } from './google/auth'
import { loadGoogleOAuthConfig } from './google/config'
import { registerDriveIpc } from './ipc/drive'
import { registerDialogIpc } from './ipc/dialog'
import { registerJobIpc } from './ipc/job'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  const oauthConfig = loadGoogleOAuthConfig()
  if (!oauthConfig) {
    // eslint-disable-next-line no-console
    console.warn(
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is not set. Google Drive sign-in will not work until configured (see README).'
    )
  }
  const auth = new GoogleAuthManager(
    oauthConfig ?? { clientId: '', clientSecret: '' },
    async (url) => {
      await shell.openExternal(url)
    }
  )

  registerDriveIpc(auth)
  registerDialogIpc(() => mainWindow)
  registerJobIpc(auth)
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
