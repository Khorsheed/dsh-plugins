/**
 * MODES: reading the catalog through each agent preset.
 *
 * A dsh instance composes every session from an agent preset — 「模式」 in the
 * settings copy, `preset` in the code: the same deployment can run a full
 * coding agent, a minimal single-tool one, or a user-authored preset, and each
 * of those sees a DIFFERENT set of skills and tools. The catalog's default read
 * answers for one of them (the deployment default). "Which of these does this
 * mode actually load, and which modes load it?" is a different question, and
 * this module is the whole answer to it.
 *
 * Two shapes travel:
 *
 * - a mode ROSTER ({@link modeOptions}) — the presets a viewer offers, with the
 *   deployment default marked so a picker can label one 「标准模式（默认）」;
 * - a mode FACE ({@link readModeFaces}) — what one mode's standing scope
 *   actually registers, read through the same `resolvePresetScope` +
 *   `catalogSnapshot` path the default read uses, so a mode view and the
 *   default view cannot drift apart.
 *
 * Reading a mode is NOT free: resolving a preset's standing scope MOUNTS its
 * composition (the roster's single-flight standing mount), so a face read for a
 * mode nothing has composed yet composes it. That is the price of the only
 * honest answer — a composition file says which plugins a mode NAMES, not which
 * tools and skills those plugins register once they run — and it is why the
 * settings surface asks for faces only when a human chooses to compare modes.
 *
 * Both functions are pure over their inputs (the caller supplies the roster rows
 * and the face reader), so their unit tests need no Cordis context.
 * @module @khorsheed/dsh-capability-catalog/modes
 */

import type { CapabilityCatalogSnapshot, CatalogModeFace, CatalogPresetOption } from './types.ts'
import type { PresetRosterRow } from './preset-scope.ts'

/**
 * The mode roster a viewer offers: the agent-preset rows, path-free, with the
 * deployment default marked.
 *
 * Roster order is preserved — the roster already orders shipped presets by the
 * `order` they publish — because a picker that re-sorts hands the human a
 * different order every time the roster grows.
 * @param rows - the roster rows (`agentPresets.list()`).
 * @param defaultId - the preset a session naming none composes, when known.
 * @returns the options a mode picker renders, in roster order.
 */
export function modeOptions(
  rows: readonly PresetRosterRow[],
  defaultId: string | undefined,
): readonly CatalogPresetOption[] {
  return rows.map(row => ({
    id: row.id,
    ...row.name === undefined ? {} : { name: row.name },
    ...row.description === undefined ? {} : { description: row.description },
    ...row.broken === undefined ? {} : { broken: row.broken },
    ...row.id === defaultId ? { isDefault: true } : {},
  }))
}

/**
 * Read one face per mode, in roster order.
 *
 * A BROKEN preset is not read at all: discovery already refused it, and asking
 * the roster to mount it would spend a mount attempt on a composition known to
 * be unusable. It keeps its row with `unavailable` set, so a comparison can say
 * which mode is missing instead of silently showing an empty face — "this mode
 * has no tools" and "this mode could not be read" are different claims, and a
 * viewer that conflates them is worse than one that omits the mode.
 *
 * A reader answering `undefined` means the same thing (its scope did not
 * resolve, so the answer would be the global layer wearing a mode's name).
 * Faces are read SEQUENTIALLY: each read may start a mount, and walking the
 * roster's single-flight mount in order is cheaper than racing it.
 * @param options - the mode roster (from {@link modeOptions}).
 * @param readFace - read one mode's face; undefined when its scope refuses.
 * @returns one face per option, roster order preserved.
 */
export async function readModeFaces(
  options: readonly CatalogPresetOption[],
  readFace: (presetId: string) => Promise<CapabilityCatalogSnapshot | undefined>,
): Promise<readonly CatalogModeFace[]> {
  const faces: CatalogModeFace[] = []
  for (const option of options) {
    const identity = {
      preset: option.id,
      ...option.name === undefined ? {} : { name: option.name },
      ...option.description === undefined ? {} : { description: option.description },
      isDefault: option.isDefault === true,
    }
    if (option.broken !== undefined) {
      faces.push({ ...identity, skills: [], tools: [], unavailable: option.broken })
      continue
    }
    let face: CapabilityCatalogSnapshot | undefined
    try {
      face = await readFace(option.id)
    } catch {
      // The reader owns its own reporting; a throw here must still leave the
      // other modes comparable.
      face = undefined
    }
    faces.push(face === undefined
      ? { ...identity, skills: [], tools: [], unavailable: 'the preset resolved no standing scope' }
      : { ...identity, skills: face.skills, tools: face.tools })
  }
  return faces
}
