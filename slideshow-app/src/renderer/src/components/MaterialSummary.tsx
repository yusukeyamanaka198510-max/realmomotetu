import { useAppStore } from '../state/useAppStore'

export function MaterialSummary(): JSX.Element | null {
  const driveResult = useAppStore((s) => s.driveResult)
  if (!driveResult) return null

  return (
    <section className="panel">
      <h2>読み込んだ素材: {driveResult.folderName}</h2>
      <div className="summary-counts">
        <div>
          <strong>{driveResult.imageCount}</strong>
          <span className="muted">画像</span>
        </div>
        <div>
          <strong>{driveResult.videoCount}</strong>
          <span className="muted">動画</span>
        </div>
      </div>
    </section>
  )
}
