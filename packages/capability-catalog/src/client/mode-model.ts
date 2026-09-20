/**
 * The cross-mode comparison model: ONE grid built from every mode's face.
 *
 * The section answers two different questions with one grid. A mode-selected
 * view shows what that mode loads; the comparison shows, for every capability
 * the instance knows, the modes that load it — which is the question "这个工具
 * 会在哪些模式下被加载?" and the reason the mode control exists at all.
 *
 * Two properties make the comparison trustworthy:
 *
 * - A capability's ROW is taken from the deployment default's face when the
 *   default mode also has it. Every mode registers its own instance of a tool
 *   (its own description, its own channel attribution), and picking whichever
 *   mode happened to be read first would make the card's prose depend on roster
 *   order. The default mode is the one the human sees everywhere else in the
 *   panel, so it wins whenever it can answer.
 * - A mode that could not be read contributes NO modes-list and no rows; it is
 *   reported in `unavailable` instead. "Not loaded in this mode" and "this mode
 *   could not be read" are different claims, and a union that merged them would
 *   quietly understate where a capability is available.
 *
 * Pure over its input, so the unit tests need no renderer.
 * @module @khorsheed/dsh-capability-catalog/client/mode-model
 */

import type { CatalogModeFace, CatalogPresetOption, CatalogSkillRow, CatalogToolRow } from '@khorsheed/dsh-capability-catalog/types'

/** One mode attributed to a capability, as a card's chip renders it. */
export interface CatalogModeChip {
  readonly id: string
  /** The preset's display name, falling back to its id. */
  readonly label: string
  readonly isDefault: boolean
}

/**
 * Resolve the mode ids a capability was found in into chips, in the order the
 * ids arrive (the roster's own read order). An id the roster no longer supplies
 * still renders — its own id is the only label left — because dropping it would
 * hide a mode the comparison actually read.
 * @param ids - mode ids, in roster order.
 * @param options - the roster, for display names and the default marker.
 * @returns one chip per id.
 */
export function resolveModeChips(
  ids: readonly string[],
  options: readonly CatalogPresetOption[],
): readonly CatalogModeChip[] {
  const byId = new Map(options.map(option => [option.id, option]))
  return ids.map((id) => {
    const option = byId.get(id)
    return { id, label: option?.name ?? id, isDefault: option?.isDefault === true }
  })
}

/** One mode's face that could not be read, and why. */
export interface UnavailableMode {
  readonly preset: string
  /** The preset's display name, falling back to its id. */
  readonly label: string
  readonly reason: string
}

/** The comparison grid: the union of every readable mode, with attribution. */
export interface ModeComparison {
  /** Union rows, name-sorted, one row per capability name. */
  readonly skills: readonly CatalogSkillRow[]
  readonly tools: readonly CatalogToolRow[]
  /** Capability name → the mode ids that load it, in the order the roster read them. */
  readonly skillModes: ReadonlyMap<string, readonly string[]>
  readonly toolModes: ReadonlyMap<string, readonly string[]>
  /** How many faces were in the union. */
  readonly modes: number
  /** Faces that could not be read; excluded from the union entirely. */
  readonly unavailable: readonly UnavailableMode[]
}

/** One capability's representative row plus whether it came from the default mode. */
interface Claimed<T> {
  readonly row: T
  readonly fromDefault: boolean
}

/** Add one capability to the union, keeping the default mode's row when it has one. */
function claim<T extends { readonly name: string }>(
  byName: Map<string, Claimed<T>>,
  modes: Map<string, string[]>,
  row: T,
  preset: string,
  isDefault: boolean,
): void {
  const claimed = byName.get(row.name)
  if (claimed === undefined) byName.set(row.name, { row, fromDefault: isDefault })
  else if (isDefault && !claimed.fromDefault) byName.set(row.name, { row, fromDefault: true })
  const listed = modes.get(row.name)
  if (listed === undefined) modes.set(row.name, [preset])
  else if (!listed.includes(preset)) listed.push(preset)
}

/** Union rows as a name-sorted list (the caller sorts again after filtering). */
function ordered<T extends { readonly name: string }>(byName: ReadonlyMap<string, Claimed<T>>): T[] {
  return [...byName.values()].map(claimed => claimed.row).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Fold every mode's face into one comparison grid.
 * @param faces - the faces the host read, in roster order.
 * @returns the union rows, the per-capability mode lists, and the unread modes.
 */
export function buildModeComparison(faces: readonly CatalogModeFace[]): ModeComparison {
  const skills = new Map<string, Claimed<CatalogSkillRow>>()
  const tools = new Map<string, Claimed<CatalogToolRow>>()
  const skillModes = new Map<string, string[]>()
  const toolModes = new Map<string, string[]>()
  const unavailable: UnavailableMode[] = []
  let modes = 0
  for (const face of faces) {
    const label = face.name ?? face.preset
    if (face.unavailable !== undefined) {
      unavailable.push({ preset: face.preset, label, reason: face.unavailable })
      continue
    }
    modes += 1
    for (const skill of face.skills) claim(skills, skillModes, skill, face.preset, face.isDefault)
    for (const tool of face.tools) claim(tools, toolModes, tool, face.preset, face.isDefault)
  }
  return {
    skills: ordered(skills),
    tools: ordered(tools),
    skillModes,
    toolModes,
    modes,
    unavailable,
  }
}
