import type { AspectRatioKey, MoodPresetKey, PersonBiasMode, ZoomSpeed } from '@shared/types'
import { ASPECT_RATIO_SPECS, MOOD_PRESETS } from '@shared/types'
import { useAppStore } from '../state/useAppStore'

const MOOD_LABELS: Record<MoodPresetKey, string> = {
  natural: 'ナチュラル',
  shittori: 'しっとり',
  bright: '明るい',
  tempo: 'テンポ良く',
  cinematic: 'シネマティック'
}

export function SettingsPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const chooseBgmFile = useAppStore((s) => s.chooseBgmFile)

  return (
    <section className="panel">
      <h2>スライドショー設定</h2>
      <div className="grid-settings">
        <div className="field">
          <label htmlFor="aspect-ratio">縦横比</label>
          <select
            id="aspect-ratio"
            value={settings.aspectRatio}
            onChange={(e) => updateSettings({ aspectRatio: e.target.value as AspectRatioKey })}
          >
            {Object.values(ASPECT_RATIO_SPECS).map((spec) => (
              <option key={spec.key} value={spec.key}>
                {spec.label} ({spec.width}x{spec.height})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="mood">雰囲気</label>
          <select id="mood" value={settings.mood} onChange={(e) => updateSettings({ mood: e.target.value as MoodPresetKey })}>
            {MOOD_PRESETS.map((key) => (
              <option key={key} value={key}>
                {MOOD_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="zoom-speed">Zoom速度</label>
          <select
            id="zoom-speed"
            value={settings.zoomSpeed}
            onChange={(e) => updateSettings({ zoomSpeed: e.target.value as ZoomSpeed })}
          >
            <option value="slow">遅い</option>
            <option value="normal">普通</option>
            <option value="fast">速い</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="max-duration">動画の最大使用時間（秒）</label>
          <input
            id="max-duration"
            type="number"
            min={1}
            max={30}
            step={0.5}
            value={settings.videoClip.maxDurationSec}
            onChange={(e) =>
              updateSettings({ videoClip: { ...settings.videoClip, maxDurationSec: Number(e.target.value) } })
            }
          />
        </div>

        <div className="field">
          <label htmlFor="person-bias">人物登場回数の平均化</label>
          <select
            id="person-bias"
            value={settings.personBiasMode}
            onChange={(e) => updateSettings({ personBiasMode: e.target.value as PersonBiasMode })}
          >
            <option value="off">オフ</option>
            <option value="balance">オン（今後の顔クラスタリング実装待ち）</option>
          </select>
        </div>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.bgm.enabled}
            onChange={(e) => updateSettings({ bgm: { ...settings.bgm, enabled: e.target.checked } })}
          />
          BGMを使用する
        </label>
      </div>
      {settings.bgm.enabled && (
        <>
          <div className="row">
            <input type="text" readOnly value={settings.bgm.filePath ?? '(未選択)'} />
            <button className="secondary" onClick={() => chooseBgmFile()}>
              BGMファイルを選択
            </button>
          </div>
          <div className="row">
            <div className="field" style={{ maxWidth: 220 }}>
              <label htmlFor="fadeout">フェードアウト秒数</label>
              <input
                id="fadeout"
                type="number"
                min={0}
                max={15}
                step={0.5}
                value={settings.bgm.fadeOutSec}
                onChange={(e) => updateSettings({ bgm: { ...settings.bgm, fadeOutSec: Number(e.target.value) } })}
              />
            </div>
          </div>
        </>
      )}
    </section>
  )
}
