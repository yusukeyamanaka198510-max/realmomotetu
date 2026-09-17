import { useAppStore } from '../state/useAppStore'

export function DriveFolderInput(): JSX.Element {
  const auth = useAppStore((s) => s.auth)
  const authBusy = useAppStore((s) => s.authBusy)
  const driveFolderInput = useAppStore((s) => s.driveFolderInput)
  const driveLoading = useAppStore((s) => s.driveLoading)
  const driveError = useAppStore((s) => s.driveError)
  const setDriveFolderInput = useAppStore((s) => s.setDriveFolderInput)
  const loadDrive = useAppStore((s) => s.loadDrive)
  const signIn = useAppStore((s) => s.signIn)
  const signOut = useAppStore((s) => s.signOut)

  return (
    <section className="panel">
      <h2>Google Drive フォルダ</h2>
      <div className="row">
        <input
          type="text"
          placeholder="フォルダのURLまたはIDを入力"
          value={driveFolderInput}
          onChange={(e) => setDriveFolderInput(e.target.value)}
        />
        {auth.authenticated ? (
          <button onClick={() => loadDrive()} disabled={driveLoading || !driveFolderInput.trim()}>
            {driveLoading ? '読込中…' : '素材読み込み'}
          </button>
        ) : (
          <button onClick={() => signIn()} disabled={authBusy}>
            {authBusy ? '認証中…' : 'Googleでサインイン'}
          </button>
        )}
      </div>
      <div className="row auth-bar">
        {auth.authenticated ? (
          <>
            <span>サインイン中: {auth.email ?? '(不明なアカウント)'}</span>
            <button className="secondary" onClick={() => signOut()}>
              サインアウト
            </button>
          </>
        ) : (
          <span>Google Driveへのアクセスにはサインインが必要です。</span>
        )}
      </div>
      {driveError && <p className="callout error">{driveError}</p>}
    </section>
  )
}
