import { JOB_STAGE_LABELS } from '@shared/types'
import { useAppStore } from '../state/useAppStore'

export function OutputPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const chooseOutputDir = useAppStore((s) => s.chooseOutputDir)
  const driveResult = useAppStore((s) => s.driveResult)
  const jobRunning = useAppStore((s) => s.jobRunning)
  const jobProgress = useAppStore((s) => s.jobProgress)
  const jobResult = useAppStore((s) => s.jobResult)
  const startGeneration = useAppStore((s) => s.startGeneration)
  const cancelGeneration = useAppStore((s) => s.cancelGeneration)
  const openOutput = useAppStore((s) => s.openOutput)

  const canGenerate = Boolean(driveResult && driveResult.items.length > 0 && settings.outputDir && !jobRunning)

  return (
    <section className="panel">
      <h2>出力</h2>
      <div className="row">
        <input type="text" readOnly value={settings.outputDir || '(出力先フォルダ未選択)'} />
        <button className="secondary" onClick={() => chooseOutputDir()}>
          出力先を選択
        </button>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        {jobRunning ? (
          <button className="secondary" onClick={() => cancelGeneration()}>
            キャンセル
          </button>
        ) : (
          <button onClick={() => startGeneration()} disabled={!canGenerate}>
            スライドショー生成
          </button>
        )}
      </div>

      {jobProgress && (
        <div style={{ marginTop: 16 }}>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${jobProgress.percent}%` }} />
          </div>
          <p className="stage-label">
            {JOB_STAGE_LABELS[jobProgress.stage]} {jobProgress.percent}%
            {jobProgress.currentItem ? ` — ${jobProgress.currentItem}` : ''}
          </p>
        </div>
      )}

      {jobResult && jobResult.success && (
        <div className="callout success" style={{ marginTop: 12 }}>
          <p>完成しました！ Seed: {jobResult.seedUsed}</p>
          <p className="path-display">{jobResult.outputPath}</p>
          <button className="secondary" style={{ marginTop: 8 }} onClick={() => openOutput()}>
            出力フォルダを開く
          </button>
          {jobResult.skippedItems.length > 0 && (
            <>
              <p className="muted" style={{ marginTop: 8 }}>
                以下の素材はスキップされました:
              </p>
              <ul className="skip-list">
                {jobResult.skippedItems.map((s) => (
                  <li key={s.name}>
                    {s.name}: {s.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {jobResult && !jobResult.success && (
        <div className="callout error" style={{ marginTop: 12 }}>
          <p>生成に失敗しました: {jobResult.error}</p>
        </div>
      )}
    </section>
  )
}
