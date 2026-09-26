/**
 * Built-in preset display names, localized through the host's own copy keys.
 *
 * The four shipped presets (standard/ptc/minimal/cordis) publish NO name of
 * their own — surfaces are expected to resolve their copy through
 * `presetDisplayText` from `@deepseek-ai/dsh-agent-preset-registry/display`,
 * the pure fold the host ships exactly so browser bundles inline it. Rendering
 * `name ?? id` leaks the raw English ids; this helper routes every roster row
 * through the fold with this card's own dictionary (the eight preset* keys),
 * while user-authored presets keep their published names untouched.
 * @module @khorsheed/dsh-capability-catalog/client/preset-display
 */

import { presetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type { CapabilityCatalogKey } from './locales.ts'

/** One roster row or face's identity, as display copy resolution needs it. */
export interface PresetLike {
  readonly id: string
  readonly name?: string | undefined
}

/** The row's display name: localized built-in copy, else its published name (or id). */
export function presetName(preset: PresetLike, t: (key: CapabilityCatalogKey) => string): string {
  // exactOptionalPropertyTypes: the upstream source type spells `name?: string`,
  // so an explicit undefined must collapse into an absent property instead.
  const source = preset.name === undefined ? { id: preset.id } : { id: preset.id, name: preset.name }
  return presetDisplayText(source, key => t(key)).name
}
