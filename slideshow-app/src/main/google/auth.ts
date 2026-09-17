import { createServer, type Server } from 'node:http'
import { OAuth2Client, type Credentials } from 'google-auth-library'
import { google } from 'googleapis'
import Store from 'electron-store'
import type { AuthStatus } from '@shared/types'
import { DRIVE_SCOPES, type GoogleOAuthConfig } from './config'

interface StoredAuth {
  tokens?: Credentials
  email?: string
}

const REDIRECT_HOST = '127.0.0.1'

export class GoogleAuthManager {
  private store = new Store<StoredAuth>({ name: 'google-auth' })

  constructor(
    private config: GoogleOAuthConfig,
    private openExternal: (url: string) => Promise<void>
  ) {}

  private buildClient(redirectUri?: string): OAuth2Client {
    return new OAuth2Client(this.config.clientId, this.config.clientSecret, redirectUri)
  }

  async getStatus(): Promise<AuthStatus> {
    const tokens = this.store.get('tokens')
    const email = this.store.get('email')
    if (!tokens?.refresh_token) return { authenticated: false }
    return { authenticated: true, email }
  }

  /** Runs the installed-app OAuth flow via a one-shot local loopback
   * server: opens the user's browser to Google's consent screen, and
   * exchanges the resulting code for tokens once Google redirects back. */
  async signIn(): Promise<AuthStatus> {
    const { server, port } = await this.listenOnEphemeralPort()
    try {
      const redirectUri = `http://${REDIRECT_HOST}:${port}/oauth2callback`
      const client = this.buildClient(redirectUri)
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: DRIVE_SCOPES
      })

      const codePromise = this.waitForCode(server)
      await this.openExternal(authUrl)
      const code = await codePromise

      const { tokens } = await client.getToken(code)
      client.setCredentials(tokens)
      this.store.set('tokens', tokens)

      // The email is only used for display ("signed in as ...") -- Drive
      // access itself only needs the drive.readonly scope above, so a
      // failure here (e.g. a future scope change) must never fail sign-in.
      let email: string | undefined
      try {
        const oauth2 = google.oauth2({ auth: client, version: 'v2' })
        const userInfo = await oauth2.userinfo.get()
        email = userInfo.data.email ?? undefined
        if (email) this.store.set('email', email)
      } catch {
        // ignore -- sign-in still succeeded
      }

      return { authenticated: true, email }
    } finally {
      server.close()
    }
  }

  async signOut(): Promise<void> {
    this.store.clear()
  }

  /** Returns an OAuth2 client with valid (auto-refreshed) credentials, or
   * throws if the user has never signed in. */
  async getAuthorizedClient(): Promise<OAuth2Client> {
    const tokens = this.store.get('tokens')
    if (!tokens?.refresh_token) {
      throw new Error('Not signed in to Google Drive')
    }
    const client = this.buildClient()
    client.setCredentials(tokens)
    client.on('tokens', (newTokens) => {
      this.store.set('tokens', { ...tokens, ...newTokens })
    })
    return client
  }

  private listenOnEphemeralPort(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.on('error', reject)
      server.listen(0, REDIRECT_HOST, () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          resolve({ server, port: address.port })
        } else {
          reject(new Error('Failed to determine OAuth callback port'))
        }
      })
    })
  }

  private waitForCode(server: Server): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sign-in timed out')), 5 * 60 * 1000)
      server.on('request', (req, res) => {
        try {
          const url = new URL(req.url ?? '', `http://${REDIRECT_HOST}`)
          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          if (error) {
            res.end('<html><body>Google認証がキャンセルされました。このタブは閉じて構いません。</body></html>')
            clearTimeout(timeout)
            reject(new Error(`OAuth error: ${error}`))
            return
          }
          if (!code) {
            res.end('<html><body>認証コードが見つかりませんでした。</body></html>')
            return
          }
          res.end('<html><body>認証が完了しました。このタブは閉じてアプリに戻ってください。</body></html>')
          clearTimeout(timeout)
          resolve(code)
        } catch (err) {
          clearTimeout(timeout)
          reject(err as Error)
        }
      })
    })
  }
}
