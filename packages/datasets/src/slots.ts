/**
 * Who sees a dataset file, and what to call it (ui-spec §三).
 *
 * The layer a file belongs to is the AUTHORITY: `dataset.json`'s `layers` +
 * `register` put every file in exactly one layer (or in the passthrough zone),
 * and the layer's `modelFacing` flag — plus the authoring protocol's two
 * judging layer names (§6.7/§6.8) — decide who the bytes reach. That is the
 * ROLE, and it is a mechanical fact about the repository.
 *
 * The SLOT is a display name on top of it: 题干 / 验收标准 / 参考答案 /
 * 评估标准 / 检查脚本 / 其他文件, the vocabulary an evaluation author already
 * uses (SWE-bench's problem_statement, a rubric, FAIL_TO_PASS tests). It is
 * derived from the file's own path by a basename heuristic, because the
 * protocol has no field for it and inventing one would fork the descriptor
 * format for a label. A dataset that wants its own slot names is deferred
 * work, not a contract change.
 *
 * Both layouts the protocol allows produce the same answer here: the
 * convention form (`items/<id>/<layer>/rubric.yml`, display path `rubric.yml`)
 * and the register form (`items/<id>/answers/rubric.yml`, display path
 * `answers/rubric.yml`) are the same slot, because the role's own fallback
 * catches whatever the path heuristic does not.
 *
 * Deliberately dependency-free (no `node:`, no yaml): the browser half labels
 * its tree with the same function the host computes its projections with, so
 * the tab and the service can never disagree about who sees a file.
 * @module @khorsheed/dsh-datasets
 */

/** The layer a rubric lives in (authoring protocol §6.8). */
export const GRADING_LAYER = 'grading'
/** The layer probes live in (authoring protocol §6.7). */
export const VERIFY_LAYER = 'verify'
/** The dataset-level directory holding the per-stage prompts (inside a modelFacing layer). */
export const PROMPTS_DIR = 'prompts'
/** The directory an executable probe lives under (authoring protocol §6.7). */
export const PROBES_DIR = 'probes'
/** The register layout's usual home for the probe material (`checks/`, `checks/probes/`). */
export const CHECKS_DIR = 'checks'

/**
 * Who one file's bytes reach. Computed from the declaring layer, never from
 * the path — this is the answer the visibility discipline (protocol §3) is
 * about, and a display heuristic may not have a vote in it.
 *
 * - `player` — a `modelFacing: true` layer: materialized into the cell, sent
 *   to the player (ui-spec R3);
 * - `judge` — the `grading` layer: the answer key, mounted only at judging;
 * - `probe` — the `verify` layer: executed by probes inside the unit;
 * - `withheld` — any other `modelFacing: false` layer: kept from the player,
 *   but outside the two judging conventions, so nothing here claims to know
 *   who consumes it;
 * - `passthrough` — the unprotected zone (`item.json`, `schemas/`, docs): no
 *   layer covers it, so no whitelist protects it either.
 */
export type DatasetRole = 'player' | 'judge' | 'probe' | 'withheld' | 'passthrough'

/** The displayed slot name (ui-spec §三's six). */
export type DatasetSlot = 'prompt' | 'standards' | 'oracle' | 'rubric' | 'checks' | 'other'

/** Every slot, in the order ui-spec §三 lists them (the chip row's order). */
export const DATASET_SLOTS: readonly DatasetSlot[] = ['prompt', 'standards', 'oracle', 'rubric', 'checks', 'other']

/** Every role, in decreasing exposure (the legend's order). */
export const DATASET_ROLES: readonly DatasetRole[] = ['player', 'judge', 'probe', 'withheld', 'passthrough']

/**
 * The three colours the tree paints (ui-spec §四: «树上每个文件标槽位与谁看得
 * 到，三种颜色»). Five roles, three colours: everything withheld from the
 * player shares one, because the reader's first question is «does the player
 * see this», and the role word answers the second.
 */
export type DatasetExposure = 'visible' | 'withheld' | 'unprotected'

/**
 * One file's classification: the authoritative role plus the display slot.
 */
export interface FileClassification {
  /** Who the bytes reach — from the layer. */
  role: DatasetRole
  /** What to call it — from the path, with the role as the fallback. */
  slot: DatasetSlot
  /** Which of the three colours the tree paints it. */
  exposure: DatasetExposure
}

/**
 * The role of a file in one layer.
 * @param layer - the declaring layer name, or null for the passthrough zone
 *   (`item.json`, dataset-root files, anything no layer and no register covers).
 * @param sensitiveLayers - the descriptor's `modelFacing: false` layer names.
 * @returns the role.
 */
export function roleOfLayer(layer: string | null, sensitiveLayers: ReadonlySet<string>): DatasetRole {
  if (layer === null) return 'passthrough'
  if (!sensitiveLayers.has(layer)) return 'player'
  if (layer === GRADING_LAYER) return 'judge'
  if (layer === VERIFY_LAYER) return 'probe'
  return 'withheld'
}

/**
 * The colour class of a role.
 * @param role - the file's role.
 * @returns the exposure class the tree paints.
 */
export function exposureOfRole(role: DatasetRole): DatasetExposure {
  if (role === 'player') return 'visible'
  if (role === 'passthrough') return 'unprotected'
  return 'withheld'
}

/** Path segments, with the empty ones dropped (a display path is already normalized). */
function segmentsOf(displayPath: string): string[] {
  return displayPath.split('/').filter(segment => segment !== '')
}

/**
 * The slot a path names, by basename heuristic alone — undefined when no rule
 * fires (the caller falls back to the role; see {@link classifyFile}).
 *
 * Rule order is the point, so it is spelled out:
 * 1. anything under an `oracle/` segment is the answer key, whatever it is
 *    named — the strongest signal, so it wins over every other rule;
 * 2. `task.md`, and anything under a `prompts/` segment, is the 题干;
 * 3. `rubric*` and `standards-notes*` are the 评估标准 — `standards-notes.yml`
 *    is a grading companion, not a player-facing standard, so this rule must
 *    come BEFORE the next one;
 * 4. `standards*` is the 验收标准;
 * 5. anything under a `checks/` or `probes/` segment is a 检查脚本.
 *
 * @param displayPath - the file's display path: layer-relative in the
 *   convention layout, item-relative in the register layout — the same string
 *   the item's layer map and the dataset-level layer map report.
 * @returns the slot, or undefined when the path says nothing.
 */
export function slotOfPath(displayPath: string): DatasetSlot | undefined {
  const segments = segmentsOf(displayPath)
  const base = segments[segments.length - 1] ?? ''
  const directories = segments.slice(0, -1)
  if (directories.includes('oracle')) return 'oracle'
  if (base === 'task.md' || directories.includes(PROMPTS_DIR)) return 'prompt'
  if (/^rubric\b/i.test(base) || /^standards-notes/i.test(base)) return 'rubric'
  if (/^standards/i.test(base)) return 'standards'
  if (directories.includes(CHECKS_DIR) || directories.includes(PROBES_DIR)) return 'checks'
  return undefined
}

/**
 * The slot a role defaults to when the path names nothing. This is what makes
 * the two layouts agree: `verify/checklist.yml` (convention, display path
 * `checklist.yml`) and `checks/checklist.yml` (register, display path
 * `checks/checklist.yml`) are both 检查脚本, one by its role and one by its
 * path.
 * @param role - the file's role.
 * @returns the default slot.
 */
export function slotOfRole(role: DatasetRole): DatasetSlot {
  if (role === 'probe') return 'checks'
  if (role === 'judge') return 'rubric'
  return 'other'
}

/**
 * Classify one file: role from the layer, slot from the path with the role as
 * the fallback.
 * @param layer - the declaring layer, or null for the passthrough zone.
 * @param displayPath - the file's display path (see {@link slotOfPath}).
 * @param sensitiveLayers - the descriptor's `modelFacing: false` layer names.
 * @returns the role, the slot, and the colour class.
 */
export function classifyFile(
  layer: string | null,
  displayPath: string,
  sensitiveLayers: ReadonlySet<string>,
): FileClassification {
  const role = roleOfLayer(layer, sensitiveLayers)
  return { role, slot: slotOfPath(displayPath) ?? slotOfRole(role), exposure: exposureOfRole(role) }
}

/**
 * Which layers carry files of each slot — the list page's «槽位 ← 层» cell.
 * A slot with no file anywhere is omitted, so the row shows what this dataset
 * actually has rather than a table of empty promises.
 * @param files - every classified file with the layer it came from.
 * @returns slot → the layer names carrying it, sorted, passthrough files
 *   reported under the reserved name `-` (they are in no layer).
 */
export function slotLayerMap(
  files: readonly { layer: string | null; slot: DatasetSlot }[],
): Partial<Record<DatasetSlot, string[]>> {
  const map = new Map<DatasetSlot, Set<string>>()
  for (const file of files) {
    const bucket = map.get(file.slot) ?? new Set<string>()
    bucket.add(file.layer ?? '-')
    map.set(file.slot, bucket)
  }
  const out: Partial<Record<DatasetSlot, string[]>> = {}
  for (const slot of DATASET_SLOTS) {
    const bucket = map.get(slot)
    if (bucket !== undefined) out[slot] = [...bucket].sort()
  }
  return out
}
