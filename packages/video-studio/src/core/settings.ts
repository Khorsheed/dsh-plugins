import type { SettingKey, Settings } from './types.ts'

export const DEFAULT_SETTINGS: Settings = {
  audioLoudness: -16,
  videoLoudness: -14,
  introMusic: '',
  outroMusic: '',
  bedMusic: '',
  subtitleStyle: 'standard',
  pauseKeep: 0.6,
  pauseThreshold: 1.2,
  speakerPauseThreshold: {},
  fillers: ['嗯', '啊', '呃', '额', '那个', '就是说', '然后呢'],
  replacements: {},
  shownotes: '{title}\n\n{summary}\n\n{chapters}',
}

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[]

export type SettingSource = 'global' | 'show' | 'project'

export interface EffectiveSetting<K extends SettingKey = SettingKey> {
  key: K
  value: Settings[K]
  source: SettingSource
  /** The value this project would fall back to (show, or global without a show). */
  fallback: Settings[K]
}

/** Fill gaps in a partial settings object (old files, hand edits) from the defaults. */
export function normalizeSettings(raw: Partial<Settings> | undefined, base: Settings = DEFAULT_SETTINGS): Settings {
  const out = { ...base }
  if (!raw || typeof raw !== 'object') return out
  for (const key of SETTING_KEYS) {
    const v = raw[key]
    if (v === undefined || v === null) continue
    if (typeof v !== typeof base[key]) continue
    if (Array.isArray(base[key]) !== Array.isArray(v)) continue
    ;(out as Record<string, unknown>)[key] = v
  }
  return out
}

/**
 * The settings tab's "这期" view: the project's value of every key plus where
 * it comes from. A key the project overrode is 'project'; otherwise it is
 * inherited from the show (or from global when the project has no show).
 */
export function effectiveSettings(
  project: { settings: Settings; overrides: SettingKey[]; showId: string | null },
  showSettings: Settings | null,
  globalSettings: Settings,
): EffectiveSetting[] {
  const parent = showSettings ?? globalSettings
  const inherited: SettingSource = showSettings ? 'show' : 'global'
  return SETTING_KEYS.map((key) => ({
    key,
    value: project.settings[key],
    source: project.overrides.includes(key) ? 'project' : inherited,
    fallback: parent[key],
  }))
}

/** Set one project key; it becomes an override unless it equals the fallback. */
export function setProjectSetting<K extends SettingKey>(
  project: { settings: Settings; overrides: SettingKey[] },
  fallback: Settings,
  key: K,
  value: Settings[K],
): void {
  project.settings = { ...project.settings, [key]: value }
  const same = JSON.stringify(value) === JSON.stringify(fallback[key])
  const has = project.overrides.includes(key)
  if (same && has) project.overrides = project.overrides.filter((k) => k !== key)
  if (!same && !has) project.overrides = [...project.overrides, key]
}

/** 恢复为节目默认 */
export function resetProjectSetting(
  project: { settings: Settings; overrides: SettingKey[] },
  fallback: Settings,
  key: SettingKey,
): void {
  project.settings = { ...project.settings, [key]: fallback[key] }
  project.overrides = project.overrides.filter((k) => k !== key)
}

/** 存为节目默认: copy the project's value into the show; the key stops being an override. */
export function saveAsShowDefault(
  project: { settings: Settings; overrides: SettingKey[] },
  show: { settings: Settings },
  key: SettingKey,
): void {
  show.settings = { ...show.settings, [key]: project.settings[key] }
  project.overrides = project.overrides.filter((k) => k !== key)
}

export function pauseThresholdFor(settings: Settings, speakerName: string): number {
  const v = speakerName ? settings.speakerPauseThreshold[speakerName] : undefined
  return typeof v === 'number' && v > 0 ? v : settings.pauseThreshold
}
