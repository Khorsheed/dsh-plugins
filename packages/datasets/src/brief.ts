/**
 * The 题集 tab's host-side projections: the dataset overview row, one item's
 * «选手将看到», and one item's judgeability. All three answer questions the
 * browser must not answer for itself — they need the register expansion, file
 * BYTES, and reads of the two judging layers — so they are computed here and
 * shipped as values (ui-spec §八: the projection is computed host-side, the
 * tab reads one face).
 *
 * The two judging reads deliberately carry an EXPLICIT single-layer scope
 * (`layers: ['grading']` / `['verify']`) rather than the operator bypass: the
 * judgeability numbers need the answer key's SHAPE, never its content on the
 * wire, and naming the one layer each read needs is the narrowest thing that
 * reaches it — the same discipline the orchestrator's judge path follows
 * (eval's faces.ts). Nothing here returns rubric or oracle text.
 * @module @khorsheed/dsh-datasets
 */
import yaml from 'js-yaml'
import {
  buildRegistry, computePassthrough, datasetDir, listDatasetLayers, listItems, loadDescriptor, loadItem,
  type DatasetDescriptor, type DatasetSummary, type DescriptorWarning, type ItemRecord,
} from './dataset.ts'
import { showFile } from './git.ts'
import { checkRubric, pickRubricPath, probePaths } from './rubric.ts'
import {
  classifyFile, GRADING_LAYER, PROMPTS_DIR, slotLayerMap, VERIFY_LAYER,
  type DatasetRole, type DatasetSlot,
} from './slots.ts'

/** One dataset's row on the list page (ui-spec §四). */
export interface DatasetOverviewRow {
  id: string
  name?: string
  itemCount: number
  /** Declared layers, descriptor order. */
  layers: string[]
  /** Layers declared `modelFacing: false`. */
  nonModelFacingLayers: string[]
  /**
   * Which layers carry each slot's files — the «槽位 ← 层» cell. Passthrough
   * files report under the reserved name `-`; a slot this dataset has no file
   * for is absent rather than empty.
   */
  slotLayers: Partial<Record<DatasetSlot, string[]>>
  /** Whether the descriptor declares a canary string (never the string itself). */
  canary: boolean
  /** Descriptor warnings (the same ones `list` reports). */
  warnings: DescriptorWarning[]
  /** The dataset's `validate` outcome, or null when the check itself failed. */
  validate: { errors: number; warnings: number; firstError: string | null } | null
}

/** The list page's answer: the repo, the commit every row was read at, and the rows. */
export interface DatasetOverview {
  /** The resolved repository toplevel — the «快照» cell's left half. */
  repo: string
  /** The commit every row was read at — the «快照» cell's right half. */
  commit: string
  datasets: DatasetOverviewRow[]
}

/** One file the player receives, with the bytes it costs them. */
export interface PlayerFile {
  /** Display path, as the item's (or the dataset's) layer map reports it. */
  path: string
  /** The modelFacing layer it comes from. */
  layer: string
  /** Where it comes from: the item's own layer, or the dataset-level shared layer. */
  source: 'item' | 'dataset'
  /** Byte length of the file's content at this commit. */
  bytes: number
}

/**
 * «选手将看到»: exactly the bytes this item puts in front of the player — the
 * item's own modelFacing-layer files (what the run loop materializes into the
 * cell) plus the dataset-level modelFacing-layer files (the per-stage prompts
 * the run loop prepends). The anti-leak self-check: an answer key that drifted
 * into a visible layer shows up HERE, before a run ever ships it.
 */
export interface PlayerView {
  files: PlayerFile[]
  totalBytes: number
  /** The modelFacing layers this dataset declares (the set the list was built from). */
  layers: string[]
}

/** «可判性»: can this item be judged at all, in numbers. */
export interface Judgeability {
  /** The rubric's display path in the grading layer, or null when it ships none. */
  rubricPath: string | null
  /** Leaf criteria the rubric declares. */
  leaves: number
  /** `kind` → how many leaves route to that judgement source (objective / llm-draft / human). */
  kinds: Record<string, number>
  /** Executable probes in the item's verify layer (display paths). */
  probes: string[]
  /** Executable probes in the DATASET-level verify layer — shared by every item. */
  sharedProbes: string[]
  /** Per-stage structured schemas in the passthrough zone (`schemas/<stage>.json`). */
  stageSchemas: string[]
  /** Why a number is missing, one sentence each; empty when everything read. */
  notes: string[]
}

/** One item's tab-facing brief: what the player gets, and whether it can be judged. */
export interface ItemBrief {
  dataset: string
  item: string
  commit: string
  player: PlayerView
  judgeability: Judgeability
}

/** The modelFacing layer names of a descriptor, in declaration order. */
export function modelFacingLayers(descriptor: DatasetDescriptor): string[] {
  return descriptor.layers.filter(layer => layer.modelFacing).map(layer => layer.name)
}

/** The `modelFacing: false` layer names of a descriptor, as a set. */
export function sensitiveLayerSet(descriptor: DatasetDescriptor): Set<string> {
  return new Set(descriptor.layers.filter(layer => !layer.modelFacing).map(layer => layer.name))
}

/** Every (layer, display path) pair of one dataset at a commit — items, shared layers, passthrough. */
async function classifiedFiles(
  repo: string,
  commit: string,
  datasetId: string,
  descriptor: DatasetDescriptor,
): Promise<{ layer: string | null; slot: DatasetSlot; role: DatasetRole }[]> {
  const sensitive = sensitiveLayerSet(descriptor)
  const registry = await buildRegistry(repo, commit, datasetId, descriptor)
  const out: { layer: string | null; slot: DatasetSlot; role: DatasetRole }[] = []
  const push = (layer: string | null, path: string): void => {
    const { role, slot } = classifyFile(layer, path, sensitive)
    out.push({ layer, slot, role })
  }
  const shared = await listDatasetLayers(repo, commit, datasetId, descriptor.layers.map(layer => layer.name))
  for (const [layer, paths] of Object.entries(shared)) {
    for (const path of paths) push(layer, path)
  }
  for (const item of await listItems(repo, commit, datasetId, registry)) {
    for (const [layer, paths] of Object.entries(item.layers)) {
      for (const path of paths) push(layer, path)
    }
    if (item.metadata !== undefined) push(null, `items/${item.id}/item.json`)
  }
  for (const path of await computePassthrough(repo, commit, datasetId, descriptor, registry)) push(null, path)
  return out
}

/**
 * One dataset's overview row. `validateOne` is injected rather than imported
 * so this module stays free of the service core (which imports it) — the
 * caller passes its own `validate`, and a validate that throws becomes a null
 * cell instead of losing the whole row.
 * @param repo - resolved repository toplevel.
 * @param commit - the commit to read at.
 * @param summary - the dataset summary `list` already computed.
 * @param validateOne - the service's per-dataset validate, or undefined to skip it.
 * @returns the row.
 */
export async function overviewRow(
  repo: string,
  commit: string,
  summary: DatasetSummary,
  validateOne?: (datasetId: string) => Promise<{ errors: { message: string }[]; warnings: unknown[] }>,
): Promise<DatasetOverviewRow> {
  const descriptor = await loadDescriptor(repo, commit, summary.id)
  const files = await classifiedFiles(repo, commit, summary.id, descriptor)
  let validate: DatasetOverviewRow['validate'] = null
  if (validateOne !== undefined) {
    try {
      const result = await validateOne(summary.id)
      validate = {
        errors: result.errors.length,
        warnings: result.warnings.length,
        firstError: result.errors[0]?.message ?? null,
      }
    } catch {
      /* a validate that cannot run leaves the cell empty — the row still answers */
    }
  }
  return {
    id: summary.id,
    ...(summary.name !== undefined ? { name: summary.name } : {}),
    itemCount: summary.itemCount,
    layers: summary.layers,
    nonModelFacingLayers: summary.nonModelFacingLayers,
    slotLayers: slotLayerMap(files),
    canary: descriptor.canary !== undefined,
    warnings: summary.warnings,
    validate,
  }
}

/** Byte length of one file at a commit; a file that cannot be read costs 0 and says so. */
async function byteLength(repo: string, commit: string, objectPath: string): Promise<number> {
  const content = await showFile(repo, commit, objectPath)
  return content === undefined ? 0 : Buffer.byteLength(content, 'utf8')
}

/**
 * «选手将看到» for one item: the item's modelFacing-layer files plus the
 * dataset-level modelFacing-layer files, each with its byte count.
 * @param repo - resolved repository toplevel.
 * @param commit - the commit to read at.
 * @param datasetId - the dataset id.
 * @param descriptor - its validated descriptor.
 * @param item - the item record (its layer maps carry the display paths).
 * @returns the player's view of this item.
 */
export async function playerView(
  repo: string,
  commit: string,
  datasetId: string,
  descriptor: DatasetDescriptor,
  item: ItemRecord,
): Promise<PlayerView> {
  const layers = modelFacingLayers(descriptor)
  const registry = await buildRegistry(repo, commit, datasetId, descriptor)
  const base = `${datasetDir(datasetId)}/items/${item.id}`
  const files: PlayerFile[] = []
  for (const layer of layers) {
    for (const path of item.layers[layer] ?? []) {
      // A register-claimed file sits where the register put it; a convention
      // file under its layer directory. The registry knows which.
      const registered = registry.entries.get(`${item.id}\0${layer}`)?.find(file => file.display === path)
      const object = registered?.object ?? `${base}/${layer}/${path}`
      files.push({ path, layer, source: 'item', bytes: await byteLength(repo, commit, object) })
    }
  }
  const shared = await listDatasetLayers(repo, commit, datasetId, layers)
  for (const [layer, paths] of Object.entries(shared)) {
    for (const path of paths) {
      files.push({
        path, layer, source: 'dataset',
        bytes: await byteLength(repo, commit, `${datasetDir(datasetId)}/${layer}/${path}`),
      })
    }
  }
  files.sort((left, right) => (left.source === right.source
    ? left.path.localeCompare(right.path)
    : left.source === 'item' ? -1 : 1))
  return { files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), layers }
}

/**
 * «可判性» for one item: the rubric's leaf and kind counts, the probes, and
 * the stage schemas. The rubric is read for its SHAPE — the counts — and its
 * text never leaves this function.
 * @param repo - resolved repository toplevel.
 * @param commit - the commit to read at.
 * @param datasetId - the dataset id.
 * @param descriptor - its validated descriptor.
 * @param item - the item record.
 * @param readLayerFile - reads one layer file through an explicit single-layer
 *   scope (the caller supplies the service's own read, so the layer ceiling is
 *   enforced by the service core, not re-implemented here).
 * @returns the judgeability numbers.
 */
export async function judgeability(
  repo: string,
  commit: string,
  datasetId: string,
  descriptor: DatasetDescriptor,
  item: ItemRecord,
  readLayerFile: (layer: string, path: string) => Promise<string>,
): Promise<Judgeability> {
  const notes: string[] = []
  const grading = item.layers[GRADING_LAYER] ?? []
  const rubricPath = pickRubricPath(grading) ?? null
  let leaves = 0
  const kinds: Record<string, number> = {}
  if (rubricPath === null) {
    notes.push(descriptor.layers.some(layer => layer.name === GRADING_LAYER)
      ? `this item ships no rubric in its ${GRADING_LAYER} layer, so no LLM judge or human verdict has anything to score`
      : `this dataset declares no ${GRADING_LAYER} layer, so judging conventions (protocol §6.8) do not apply to it`)
  } else {
    try {
      // ONE read of the rubric: `checkRubric` for the honest complaints the
      // page relays, the local histogram for the counts it shows. The text
      // itself never leaves this scope.
      const text = await readLayerFile(GRADING_LAYER, rubricPath)
      const check = checkRubric(text, rubricPath)
      const histogram = leafKinds(text)
      leaves = histogram.leaves
      Object.assign(kinds, histogram.kinds)
      for (const error of check.errors) notes.push(error.message)
    } catch (error) {
      notes.push(`${rubricPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const probes = probePaths(item.layers[VERIFY_LAYER] ?? [])
  let sharedProbes: string[] = []
  try {
    const shared = await listDatasetLayers(repo, commit, datasetId, [VERIFY_LAYER])
    sharedProbes = probePaths(shared[VERIFY_LAYER] ?? [])
  } catch {
    /* no dataset-level verify layer: the item's own probes still count */
  }
  const registry = await buildRegistry(repo, commit, datasetId, descriptor)
  const passthrough = await computePassthrough(repo, commit, datasetId, descriptor, registry)
  const stageSchemas = passthrough.filter(path => /^schemas\/[^/]+\.json$/.test(path)).sort()
  return { rubricPath, leaves, kinds, probes, sharedProbes, stageSchemas, notes }
}

/**
 * Leaf counts per `kind`. `checkRubric` answers WHICH kinds are present (its
 * job is judgeability, not arithmetic) while the page shows «N 条，其中
 * objective M 条», so the histogram is computed here rather than widening that
 * contract. A leaf whose `kind` routes nowhere counts under `unrouted`, which
 * is exactly the gap `validate` fails on — the number must not hide it.
 * @param text - the rubric document.
 * @returns the leaf total and kind → leaf count.
 */
export function leafKinds(text: string): { leaves: number; kinds: Record<string, number> } {
  const kinds: Record<string, number> = {}
  let document: unknown
  try {
    document = yaml.load(text)
  } catch {
    return { leaves: 0, kinds }
  }
  const rows = typeof document === 'object' && document !== null && Array.isArray((document as { items?: unknown[] }).items)
    ? (document as { items: unknown[] }).items
    : []
  for (const row of rows) {
    const kind = typeof row === 'object' && row !== null ? (row as { kind?: unknown }).kind : undefined
    const key = typeof kind === 'string' && kind.trim() !== '' ? kind : 'unrouted'
    kinds[key] = (kinds[key] ?? 0) + 1
  }
  return { leaves: rows.length, kinds }
}

/**
 * One item's brief: «选手将看到» plus «可判性».
 * @param repo - resolved repository toplevel.
 * @param commit - the commit to read at.
 * @param datasetId - the dataset id.
 * @param itemId - the item id.
 * @param readLayerFile - the explicit single-layer read (see {@link judgeability}).
 * @returns the brief.
 */
export async function itemBrief(
  repo: string,
  commit: string,
  datasetId: string,
  itemId: string,
  readLayerFile: (layer: string, path: string) => Promise<string>,
): Promise<ItemBrief> {
  const descriptor = await loadDescriptor(repo, commit, datasetId)
  const registry = await buildRegistry(repo, commit, datasetId, descriptor)
  const item = await loadItem(repo, commit, datasetId, itemId, registry)
  return {
    dataset: datasetId,
    item: itemId,
    commit,
    player: await playerView(repo, commit, datasetId, descriptor, item),
    judgeability: await judgeability(repo, commit, datasetId, descriptor, item, readLayerFile),
  }
}

/** The dataset-level prompts directory inside one modelFacing layer (scaffold + copy). */
export function promptsHome(descriptor: DatasetDescriptor): string | undefined {
  const layer = modelFacingLayers(descriptor)[0]
  return layer === undefined ? undefined : `${layer}/${PROMPTS_DIR}`
}
