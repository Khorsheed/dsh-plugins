/**
 * The settings cards' own store: what a person sets on a local-agent card
 * (the live switch, the dsh default model, …) lives in the harness's scoped
 * home as `card-settings.json`, never in the profile patch.
 *
 * Why not the profile patch: when several installed suites each insert the
 * same family row, the host's config editor checks a write against the FIRST
 * duplicate (which carries no config) and refuses every volatile write — the
 * switches were dead on any profile with two mode suites. The scoped home is
 * already where the family keeps the endpoint credential and the model list,
 * which never had the problem.
 *
 * The stored values are overrides: a field absent here falls back to the
 * row config (so values a profile already carried keep working unmigrated),
 * then to the schema default.
 * @module @khorsheed/dsh-local-agent/card-settings
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CardSettings, CardSettingValue } from './types.ts'

export type { CardSettings, CardSettingValue } from './types.ts'

/** The store's file name inside a scoped home. */
export const CARD_SETTINGS_FILE = 'card-settings.json'

/** Whether a value is one the store keeps. */
function isSettingValue(value: unknown): value is CardSettingValue {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
    || (Array.isArray(value) && value.every(entry => typeof entry === 'string'))
}

/**
 * Read a scoped home's stored card settings; a missing or unreadable file is empty.
 * @param homeDir - the harness's scoped home.
 * @returns the stored values.
 */
export function readCardSettings(homeDir: string): CardSettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(homeDir, CARD_SETTINGS_FILE), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isSettingValue(value))) as CardSettings
  } catch {
    return {}
  }
}

/**
 * Apply a patch to a scoped home's stored card settings (`null` removes a
 * field, so it falls back to the row config again) and write it atomically.
 * @param homeDir - the harness's scoped home.
 * @param patch - field → new value, or null to remove.
 * @returns the stored values after the write.
 * @throws on a value the store does not keep.
 */
export function writeCardSettings(homeDir: string, patch: Readonly<Record<string, CardSettingValue | null>>): CardSettings {
  const next: Record<string, CardSettingValue> = { ...readCardSettings(homeDir) }
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) delete next[field]
    else if (isSettingValue(value)) next[field] = value
    else throw new Error(`card setting "${field}" must be a string, number, boolean or string list`)
  }
  mkdirSync(homeDir, { recursive: true, mode: 0o700 })
  const target = join(homeDir, CARD_SETTINGS_FILE)
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, target)
  return next
}
