/**
 * Skeletons: the file sets «新建题集» and «题目骨架» write into the WORKING
 * TREE, and the rule that decides where an item's skeleton files land.
 *
 * The tab deliberately has no body editor (ui-spec §四: a check script is
 * code and a rubric is weighted YAML — a form cannot write either), so the
 * only thing a skeleton owes the author is a file in the RIGHT PLACE with an
 * obviously unfinished body. `validate` then complains about the placeholders,
 * which is the intended next step rather than a defect.
 *
 * Placement follows the dataset's own shape, never a house style: an item the
 * descriptor's `register` already speaks for gets its files at the registered
 * paths (P0's `task.md` / `answers/rubric.yml` / `checks/probes/…`), and an
 * item it does not gets the convention layout (`<layer>/rubric.yml`). Both are
 * the protocol's §1 layouts, and a skeleton that picked the wrong one would
 * land outside every layer — visible to everyone, which for a rubric is the
 * exact accident the visibility discipline exists to prevent.
 *
 * Nothing here commits: the plugin never does (protocol §0), and the tab says so.
 * @module @khorsheed/dsh-datasets
 */
import {
  registerPatternMatches, type DatasetDescriptor,
} from './dataset.ts'
import { modelFacingLayers } from './brief.ts'
import { GRADING_LAYER, PROBES_DIR, PROMPTS_DIR, VERIFY_LAYER, type DatasetSlot } from './slots.ts'

/** Marker every placeholder body carries, so an author can grep for what is still unwritten. */
export const PLACEHOLDER_MARKER = 'TODO(dataset-skeleton)'

/** One planned skeleton file. */
export interface SkeletonFile {
  /** Which slot the file fills (the tab labels it with this). */
  slot: DatasetSlot
  /** The declaring layer, or null for a dataset-root (passthrough) file. */
  layer: string | null
  /** Path relative to the item directory (item skeleton) or the dataset directory (dataset skeleton). */
  path: string
  content: string
}

/** What one skeleton write produced. */
export interface SkeletonResult {
  /** Repo-relative paths written (in plan order). */
  written: string[]
  /** Files that were already present and were left alone. */
  skipped: string[]
  /** Why a planned file was not planned at all, one sentence each. */
  notes: string[]
}

/** One placeholder body: the lines as given, newline-terminated. */
function body(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`
}

/** The 题干 placeholder. */
function taskBody(itemId: string): string {
  return body([
    `# ${itemId}`,
    '',
    `<!-- ${PLACEHOLDER_MARKER}: write the task statement the player reads -->`,
    '',
    'Describe the task exactly as the player should receive it: the goal, the',
    'inputs they start from, and what they hand back. This file is materialized',
    'into the cell and prepended to every stage prompt, so it is the one place',
    'the player learns what to do.',
    '',
    'If this dataset declares a canary, embed it verbatim here — `validate`',
    'reports the file until you do (the plugin never injects one for you).',
  ])
}

/** The 验收标准 placeholder. */
function standardsBody(itemId: string): string {
  return body([
    `# ${PLACEHOLDER_MARKER}: the acceptance standards ${itemId} is held to`,
    '# The player SEES this file. Keep grading rationale out of it — that',
    `# belongs in the ${GRADING_LAYER} layer.`,
    'standards: []',
  ])
}

/** The 评估标准 placeholder: leafless on purpose, so `validate` names it. */
function rubricBody(itemId: string): string {
  return body([
    `# ${PLACEHOLDER_MARKER}: the leaf criteria ${itemId} is scored on`,
    '#',
    '# Every leaf needs: id, axis, weight, kind, criterion, evidence.',
    '# kind routes the verdict — objective (a probe writes it), llm-draft (a',
    '# blind judge does), human (the judge bench does).',
    '#',
    '# An empty `items` list is what `validate` fails on: axes alone cannot be',
    '# judged, so fill this in before the item runs anywhere.',
    'items: []',
  ])
}

/** The 检查脚本 placeholder: a README rather than an executable nobody reviewed. */
function probesBody(itemId: string): string {
  return body([
    `# Probes for ${itemId}`,
    '',
    PLACEHOLDER_MARKER,
    '',
    'Drop one `.mjs` or `.sh` file per objective rubric leaf in this directory.',
    'A probe runs inside the unit and writes the verdict for the leaf it names;',
    'a `kind: objective` leaf with no probe is judged by nobody.',
  ])
}

/** The four files an item skeleton plans, in the order the tab lists them. */
export interface ItemSkeletonPlan {
  slot: DatasetSlot
  /** The layer the file belongs to (a declared layer name). */
  layer: string
  /** The path INSIDE the layer, in the convention layout. */
  conventionPath: string
  /** The path relative to the item directory, after register homing. */
  itemPath: string
  content: string
}

/**
 * Where one skeleton file lands inside the item directory.
 *
 * The register wins when it already speaks for this (item, layer): an exact
 * pattern matching the convention path is used verbatim, then an exact pattern
 * with the same basename, then a single-segment glob whose trailing `*` can
 * host the basename — preferring the glob whose directory ends with the
 * convention path's own directory, so `probes/README.md` lands under
 * `checks/probes/*` rather than `checks/*`. With no register entry the
 * convention layout applies: `<layer>/<conventionPath>`.
 * @param descriptor - the validated descriptor.
 * @param itemId - the item the skeleton is for.
 * @param layer - the declaring layer.
 * @param conventionPath - the layer-relative path in the convention layout.
 * @returns the item-relative path to write.
 */
export function homeForSkeletonFile(
  descriptor: DatasetDescriptor,
  itemId: string,
  layer: string,
  conventionPath: string,
): string {
  const patterns = descriptor.register
    .filter(entry => entry.item === itemId && entry.layer === layer)
    .flatMap(entry => entry.files)
  if (patterns.length === 0) return `${layer}/${conventionPath}`
  const base = conventionPath.slice(conventionPath.lastIndexOf('/') + 1)
  const directory = conventionPath.includes('/') ? conventionPath.slice(0, conventionPath.lastIndexOf('/')) : ''
  const exact = patterns.filter(pattern => !pattern.includes('*'))
  if (exact.includes(conventionPath)) return conventionPath
  const sameBase = exact.find(pattern => pattern.slice(pattern.lastIndexOf('/') + 1) === base)
  if (sameBase !== undefined) return sameBase
  const globs = patterns
    .filter(pattern => pattern.endsWith('*'))
    .map(pattern => ({ pattern, path: `${pattern.slice(0, -1)}${base}` }))
    .filter(candidate => registerPatternMatches(candidate.pattern, candidate.path))
  const preferred = directory === ''
    ? undefined
    : globs.find(candidate => candidate.pattern.slice(0, candidate.pattern.lastIndexOf('/')).endsWith(directory))
  return (preferred ?? globs[0])?.path ?? `${layer}/${conventionPath}`
}

/**
 * Plan one item's skeleton: the 题干 and 验收标准 in the first modelFacing
 * layer, the 评估标准 in `grading`, the 检查脚本 in `verify` — each only when
 * the dataset declares the layer it needs, and each homed by
 * {@link homeForSkeletonFile}.
 * @param descriptor - the validated descriptor.
 * @param itemId - the item id.
 * @returns the planned files and one note per slot the dataset cannot hold.
 */
export function planItemSkeleton(
  descriptor: DatasetDescriptor,
  itemId: string,
): { files: ItemSkeletonPlan[]; notes: string[] } {
  const declared = new Set(descriptor.layers.map(layer => layer.name))
  const visible = modelFacingLayers(descriptor)[0]
  const notes: string[] = []
  const planned: Array<{ slot: DatasetSlot; layer: string | undefined; conventionPath: string; content: string; need: string }> = [
    { slot: 'prompt', layer: visible, conventionPath: 'task.md', content: taskBody(itemId), need: 'a modelFacing layer' },
    { slot: 'standards', layer: visible, conventionPath: 'standards.yml', content: standardsBody(itemId), need: 'a modelFacing layer' },
    {
      slot: 'rubric',
      layer: declared.has(GRADING_LAYER) ? GRADING_LAYER : undefined,
      conventionPath: 'rubric.yml',
      content: rubricBody(itemId),
      need: `a ${GRADING_LAYER} layer`,
    },
    {
      slot: 'checks',
      layer: declared.has(VERIFY_LAYER) ? VERIFY_LAYER : undefined,
      conventionPath: `${PROBES_DIR}/README.md`,
      content: probesBody(itemId),
      need: `a ${VERIFY_LAYER} layer`,
    },
  ]
  const files: ItemSkeletonPlan[] = []
  for (const entry of planned) {
    if (entry.layer === undefined) {
      notes.push(`no ${entry.slot} placeholder: this dataset declares no ${entry.need} `
        + `(declared: ${[...declared].join(', ')})`)
      continue
    }
    files.push({
      slot: entry.slot,
      layer: entry.layer,
      conventionPath: entry.conventionPath,
      itemPath: homeForSkeletonFile(descriptor, itemId, entry.layer, entry.conventionPath),
      content: entry.content,
    })
  }
  return { files, notes }
}

/** The descriptor a new dataset starts from: three layers, the discipline declared per layer. */
export function newDescriptor(id: string, name?: string): Record<string, unknown> {
  return {
    id,
    ...(name !== undefined && name !== '' ? { name } : {}),
    layers: [
      { name: 'visible', modelFacing: true },
      { name: VERIFY_LAYER, modelFacing: false },
      { name: GRADING_LAYER, modelFacing: false },
    ],
    itemMetaSchema: {
      type: 'object',
      required: ['id', 'title'],
      properties: { id: { type: 'string' }, title: { type: 'string' } },
    },
  }
}

/**
 * Plan a new dataset's skeleton: the descriptor, one stage prompt inside the
 * modelFacing layer, one stage schema in the passthrough zone, and the item
 * container. No `manifest.yml`: the suite manifest is the ORCHESTRATOR's
 * contract, and this package neither reads nor writes it.
 * @param id - the dataset id (also its directory name).
 * @param name - the display name, when the author gave one.
 * @returns the planned files, dataset-relative.
 */
export function planDatasetSkeleton(id: string, name?: string): SkeletonFile[] {
  const descriptor = newDescriptor(id, name)
  return [
    { slot: 'other', layer: null, path: 'dataset.json', content: `${JSON.stringify(descriptor, null, 2)}\n` },
    {
      slot: 'prompt',
      layer: 'visible',
      path: `visible/${PROMPTS_DIR}/stage1.md`,
      content: body([
        '# Stage 1',
        '',
        `<!-- ${PLACEHOLDER_MARKER}: write the stage prompt every item shares -->`,
        '',
        'This prompt is shared by every item of the set: it says how to work the',
        "stage. The item's own task.md is appended to it, byte for byte, so keep",
        'anything item-specific out of here.',
      ]),
    },
    {
      slot: 'other',
      layer: null,
      path: 'schemas/stage1.json',
      content: `${JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: `${id} stage 1 submission`,
        description: `${PLACEHOLDER_MARKER}: describe the structured submission this stage must produce`,
        type: 'object',
        additionalProperties: true,
        properties: {},
      }, null, 2)}\n`,
    },
    {
      slot: 'other',
      layer: null,
      path: 'items/.gitkeep',
      content: '',
    },
  ]
}
