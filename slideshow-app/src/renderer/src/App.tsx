import { useEffect } from 'react'
import { DriveFolderInput } from './components/DriveFolderInput'
import { MaterialSummary } from './components/MaterialSummary'
import { SettingsPanel } from './components/SettingsPanel'
import { OutputPanel } from './components/OutputPanel'
import { subscribeJobProgress, useAppStore } from './state/useAppStore'

export function App(): JSX.Element {
  const refreshAuthStatus = useAppStore((s) => s.refreshAuthStatus)

  useEffect(() => {
    subscribeJobProgress()
    refreshAuthStatus()
  }, [refreshAuthStatus])

  return (
    <div className="app">
      <header className="app-header">
        <h1>Slideshow Maker</h1>
        <span className="muted">Google Drive → 自動スライドショー生成</span>
      </header>
      <DriveFolderInput />
      <MaterialSummary />
      <SettingsPanel />
      <OutputPanel />
    </div>
  )
}
