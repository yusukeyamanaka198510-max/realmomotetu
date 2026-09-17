/** OAuth client credentials for the "Desktop app" client the user creates
 * in Google Cloud Console (see README). These are not secret in the way a
 * server-side client secret would be -- Google's installed-app flow still
 * requires passing them, but security relies on the loopback redirect +
 * user consent, not on the secret being hidden. */
export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
}

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

export function loadGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}
