/**
 * Dataset repository layout convention and `dataset.json` shape validation.
 * The plugin validates the SHAPE of the descriptor only — it never interprets
 * its semantics, and every other descriptor file passes through untouched.
 *
 * Layout (layer names are arbitrary, declared by the descriptor; a layer
 * directory may exist at BOTH levels — dataset-level layers hold content
 * shared across items, item-level layers hold per-item content; the session
 * whitelist governs both):
 *
 * ```
 * <repo>/
 *   datasets/<dataset-id>/
 *     dataset.json           # id, name, layers manifest (visibility classes), item metadata schema
 *     <layer>/...            # dataset-level layer (declared in the layers manifest)
 *     <any other files>      # descriptor passthrough — anything NOT a declared layer name
 *     items/<item-id>/
 *       item.json            # item metadata (fields constrained by the declared schema)
 *       <layer>/...          # item-level layers
 * ```
 *
 * `items` is the reserved item container and may not name a layer. Everything
 * else top-level that is not a declared layer directory passes through
 * untouched — the plugin never interprets it, and it stays outside every
 * read/list/worktree path.
 *
 * v1 reads JSON descriptors: no YAML parser is available on this package's
 * dependency chain, and adding one is deliberately out of scope (see README
 * Known Limitations).
 */
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { listFiles, showFile } from './git.ts'

/** A JSON object (constrained — every value here is JSON.parse output). */
export type JsonObject = Record<string, JsonValue>

/** Root directory every dataset lives under. */
export const DATASETS_DIR = 'datasets'
/** Descriptor filename inside a dataset directory. */
export const DATASET_DESCRIPTOR = 'dataset.json'
/** Item metadata filename inside an item directory. */
export const ITEM_METADATA = 'item.json'

/** Stable error codes for dataset domain failures. */
export type DatasetsErrorCode =
  | 'NO_REPO'
  | 'NOT_A_REPO'
  | 'DATASET_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'LAYER_NOT_ALLOWED'
  | 'LAYER_UNDECLARED'
  | 'FILE_NOT_FOUND'
  | 'SHAPE_INVALID'
  | 'INVALID_NAME'
  | 'GIT_ERROR'

/** Domain error with a stable, greppable code. */
export class DatasetsError extends Error {
  constructor(
    message: string,
    readonly code: DatasetsErrorCode,
  ) {
    super(message)
    this.name = 'DatasetsError'
  }
}

/** One layer declaration in the descriptor's layers manifest. */
export interface DatasetLayerDecl {
  name: string
  /**
   * Visibility class, default true. `false` marks a layer whose export must
   * pass a human confirmation gate (the gate belongs to the exporter, not this
   * plugin). Independent of the session binding's layers whitelist.
   */
  modelFacing: boolean
  /**
   * Whether the descriptor explicitly declared `modelFacing` for this layer
   * (false = the key was absent and the default applies). Drives the
   * mixed-sensitivity warning: in a dataset that has any `modelFacing: false`
   * layer, an UNDECLARED layer is likely an authorial oversight rather than a
   * deliberate public layer.
   */
  modelFacingDeclared: boolean
}

export type DescriptorWarningCode = 'MODELFACING_UNDECLARED' | 'FIELD_NAME_SENSITIVE' | 'UNREGISTERED_FILES'

/** A non-fatal validation warning (shape checks fail loud on errors, warn on suspicion). */
export interface DescriptorWarning {
  /** Stable, greppable code. */
  code: DescriptorWarningCode
  /** Human-readable detail. */
  message: string
  /** The layer the warning is about (MODELFACING_UNDECLARED). */
  layer?: string
  /** The item the warning is about (FIELD_NAME_SENSITIVE). */
  item?: string
  /** The item.json field the warning is about (FIELD_NAME_SENSITIVE). */
  field?: string
  /** The dataset-relative file the warning is about (UNREGISTERED_FILES). */
  file?: string
}

/**
 * Item-metadata field names that smell like sensitive content misplaced into
 * the always-visible item.json: cheap literal heuristic (the authoring
 * protocol's §5), keyed on lowercase substring.
 */
export const SENSITIVE_FIELD_ROOTS: readonly string[] = ['note', 'hint', 'answer', 'rubric', 'grading']

/**
 * Scan one item's metadata for sensitive-looking field names (recursive over
 * plain objects; arrays of objects included).
 * @param item - the item id.
 * @param metadata - the parsed item.json.
 * @returns one FIELD_NAME_SENSITIVE warning per matching key.
 */
export function fieldNameWarnings(item: string, metadata: JsonObject): DescriptorWarning[] {
  const warnings: DescriptorWarning[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry)
      return
    }
    if (!isPlainObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      const lower = key.toLowerCase()
      if (SENSITIVE_FIELD_ROOTS.some(root => lower.includes(root))) {
        warnings.push({
          code: 'FIELD_NAME_SENSITIVE',
          item,
          field: key,
          message: `item ${JSON.stringify(item)} item.json field ${JSON.stringify(key)} looks sensitive `
            + '(note/hint/answer/rubric/grading); item.json is always visible — move such content into a modelFacing:false layer',
        })
      }
      walk(child)
    }
  }
  walk(metadata)
  return warnings
}

/**
 * Compute a descriptor's validation warnings. Exactly one rule today: when
 * ANY layer is explicitly `modelFacing: false` (a mixed-sensitivity dataset)
 * and ANOTHER layer left the key undeclared, that layer is probably an
 * oversight — warn per undeclared layer. Datasets with no hidden layer (all
 * public) and datasets where every layer is explicit stay silent.
 * @param descriptor - the validated descriptor.
 * @returns one warning per undeclared layer, empty when none apply.
 */
export function descriptorWarnings(descriptor: DatasetDescriptor): DescriptorWarning[] {
  if (!descriptor.layers.some(layer => !layer.modelFacing)) return []
  return descriptor.layers
    .filter(layer => !layer.modelFacingDeclared)
    .map(layer => ({
      code: 'MODELFACING_UNDECLARED' as const,
      layer: layer.name,
      message: `layer ${JSON.stringify(layer.name)} does not declare modelFacing and defaults to true; `
        + 'a mixed-sensitivity dataset should declare it per layer',
    }))
}

/** Validated `dataset.json` shape. Unknown fields pass through on `raw`. */
export interface DatasetDescriptor {
  id: string
  name?: string
  layers: DatasetLayerDecl[]
  /** Declared item-metadata JSON Schema; shape-checked as an object, never interpreted. */
  itemMetaSchema?: Record<string, unknown>
  /** Explicit path → role mappings (the authoring protocol's register; default []). */
  register: RegisterEntry[]
  /** The parsed descriptor exactly as committed. */
  raw: JsonObject
}

/**
 * One register entry: map item-relative file patterns onto a (item, layer)
 * role. v1 constraints: paths stay inside the item directory (no absolute
 * paths, no '..' segments), globs use single-segment '*' only (never '**'),
 * and `item.json` may not be re-homed. Conflicts with the layout form (a
 * registered display path colliding with a convention file of the same role)
 * fail loud when the registry is built against a commit — shape validation
 * alone cannot see them.
 */
export interface RegisterEntry {
  item: string
  layer: string
  /** Item-relative file paths or single-level glob patterns. */
  files: string[]
}

/** One item's metadata plus its files, grouped by layer. */
export interface ItemRecord {
  id: string
  /** Parsed `item.json` (a plain object), absent when the item has none. */
  metadata?: JsonObject
  /** Layer name → layer-relative file paths (sorted). */
  layers: Record<string, string[]>
}

/** A dataset summary as `list` reports it. */
export interface DatasetSummary {
  id: string
  name?: string
  /** Declared layer names (descriptor order). */
  layers: string[]
  /** Layers declared `modelFacing: false`. */
  nonModelFacingLayers: string[]
  itemCount: number
  /** Validation warnings (mixed-sensitivity undeclared-modelFacing layers); empty when none. */
  warnings: DescriptorWarning[]
}

/** Segment-safe ids: no traversal, no separators, no whitespace. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Validate one path segment id (dataset id, item id, layer name).
 * @param kind - what the id names, for the error message.
 * @param value - the candidate id.
 */
export function assertValidName(kind: string, value: string): void {
  if (!NAME_PATTERN.test(value) || value === '.' || value === '..') {
    throw new DatasetsError(`invalid ${kind} ${JSON.stringify(value)}: use letters, digits, '.', '_' or '-'`, 'INVALID_NAME')
  }
}

/**
 * Validate a layer-relative file path: relative, no '..' segment, no NUL.
 * @param path - the candidate repo-internal path.
 * @returns the normalized (forward-slash) path.
 */
export function assertSafeRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized === '' || normalized.split('/').some(segment => segment === '..' || segment === '') || path.includes('\0')) {
    throw new DatasetsError(`invalid file path ${JSON.stringify(path)}: must be a relative path without '..' segments`, 'INVALID_NAME')
  }
  return normalized
}

/** Repo-relative directory of one dataset. */
export function datasetDir(datasetId: string): string {
  return `${DATASETS_DIR}/${datasetId}`
}

/** Repo-relative directory of one item. */
export function itemDir(datasetId: string, itemId: string): string {
  return `${datasetDir(datasetId)}/items/${itemId}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate the `dataset.json` shape. Only the shape is checked — descriptor
 * semantics stay with the dataset's authors.
 * @param value - the parsed JSON.
 * @param origin - where it was read from, for error messages.
 * @returns the validated descriptor (unknown fields preserved on `raw`).
 */
export function validateDescriptor(value: unknown, origin: string): DatasetDescriptor {
  if (!isPlainObject(value)) {
    throw new DatasetsError(`${origin}: dataset descriptor must be a JSON object`, 'SHAPE_INVALID')
  }
  const id = value['id']
  if (typeof id !== 'string' || !NAME_PATTERN.test(id)) {
    throw new DatasetsError(`${origin}: "id" must be a non-empty segment-safe string`, 'SHAPE_INVALID')
  }
  const name = value['name']
  if (name !== undefined && typeof name !== 'string') {
    throw new DatasetsError(`${origin}: "name" must be a string when present`, 'SHAPE_INVALID')
  }
  const layers = value['layers']
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new DatasetsError(`${origin}: "layers" must be a non-empty array of {name, modelFacing?}`, 'SHAPE_INVALID')
  }
  const decls: DatasetLayerDecl[] = []
  const seen = new Set<string>()
  for (const entry of layers) {
    if (!isPlainObject(entry) || typeof entry['name'] !== 'string' || !NAME_PATTERN.test(entry['name'])) {
      throw new DatasetsError(`${origin}: every layer needs a segment-safe "name"`, 'SHAPE_INVALID')
    }
    const layerName = entry['name']
    if (layerName === 'items') {
      throw new DatasetsError(`${origin}: "items" is the reserved item container and may not name a layer`, 'SHAPE_INVALID')
    }
    if (seen.has(layerName)) {
      throw new DatasetsError(`${origin}: duplicate layer ${JSON.stringify(layerName)}`, 'SHAPE_INVALID')
    }
    seen.add(layerName)
    const modelFacing = entry['modelFacing']
    if (modelFacing !== undefined && typeof modelFacing !== 'boolean') {
      throw new DatasetsError(`${origin}: layer ${JSON.stringify(layerName)} "modelFacing" must be a boolean`, 'SHAPE_INVALID')
    }
    decls.push({ name: layerName, modelFacing: modelFacing ?? true, modelFacingDeclared: modelFacing !== undefined })
  }
  const itemMetaSchema = value['itemMetaSchema']
  if (itemMetaSchema !== undefined && !isPlainObject(itemMetaSchema)) {
    throw new DatasetsError(`${origin}: "itemMetaSchema" must be a JSON-Schema object when present`, 'SHAPE_INVALID')
  }
  const register = validateRegister(value['register'], decls, origin)
  return {
    id,
    ...(name !== undefined ? { name } : {}),
    layers: decls,
    ...(itemMetaSchema !== undefined ? { itemMetaSchema: itemMetaSchema as Record<string, unknown> } : {}),
    register,
    raw: value as JsonObject,
  }
}

/** A register glob segment matcher: '*' within a segment, never across '/'. */
function globSegmentToRegExp(segment: string): RegExp {
  return new RegExp(`^${segment.replace(/[.*+?^${}()|[\]\\]/g, m => (m === '*' ? '[^/]*' : `\\${m}`))}$`)
}

/** Whether a register pattern matches an item-relative path (per segment). */
export function registerPatternMatches(pattern: string, path: string): boolean {
  const patternSegments = pattern.split('/')
  const pathSegments = path.split('/')
  if (patternSegments.length !== pathSegments.length) return false
  return patternSegments.every((segment, index) =>
    segment.includes('*') ? globSegmentToRegExp(segment).test(pathSegments[index] ?? '') : segment === pathSegments[index])
}

/**
 * Validate the optional `register` array (shape only; see RegisterEntry for
 * the constraints).
 * @param value - the candidate register field.
 * @param layers - the validated layer declarations (register targets them).
 * @param origin - where it was read from, for error messages.
 * @returns the validated register entries ([] when absent).
 */
function validateRegister(value: unknown, layers: readonly DatasetLayerDecl[], origin: string): RegisterEntry[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new DatasetsError(`${origin}: "register" must be an array of {item, layer, files}`, 'SHAPE_INVALID')
  }
  const declared = new Set(layers.map(layer => layer.name))
  const entries: RegisterEntry[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      throw new DatasetsError(`${origin}: register entries must be {item, layer, files} objects`, 'SHAPE_INVALID')
    }
    const item = entry['item']
    if (typeof item !== 'string' || !NAME_PATTERN.test(item)) {
      throw new DatasetsError(`${origin}: register entry "item" must be a segment-safe item id`, 'SHAPE_INVALID')
    }
    const layer = entry['layer']
    if (typeof layer !== 'string' || !declared.has(layer)) {
      throw new DatasetsError(
        `${origin}: register entry for item ${JSON.stringify(item)} targets undeclared layer ${JSON.stringify(layer)}`,
        'SHAPE_INVALID',
      )
    }
    const files = entry['files']
    if (!Array.isArray(files) || files.length === 0 || files.some(file => typeof file !== 'string')) {
      throw new DatasetsError(`${origin}: register entry for item ${JSON.stringify(item)} needs a non-empty "files" array`, 'SHAPE_INVALID')
    }
    for (const file of files as string[]) {
      const pattern = file as string
      const bad = pattern.includes('\0') || pattern.startsWith('/') || pattern.startsWith('!')
        || pattern.split('/').some(segment => segment === '..' || segment === '')
        || pattern.includes('**')
      if (bad) {
        throw new DatasetsError(
          `${origin}: register pattern ${JSON.stringify(pattern)} must stay inside the item directory `
          + '(no absolute paths, no ".." segments, no empty segments, no "**", no leading "!")',
          'SHAPE_INVALID',
        )
      }
      if (pattern === 'item.json') {
        throw new DatasetsError(`${origin}: register may not re-home item.json`, 'SHAPE_INVALID')
      }
      const key = `${item}\0${layer}\0${pattern}`
      if (seen.has(key)) {
        throw new DatasetsError(`${origin}: duplicate register pattern ${JSON.stringify(pattern)} for ${item}/${layer}`, 'SHAPE_INVALID')
      }
      seen.add(key)
    }
    entries.push({ item, layer, files: [...(files as string[])] })
  }
  return entries
}

/**
 * Load and validate one dataset's descriptor at a commit.
 * @param repo - repository path.
 * @param commit - commit to read from.
 * @param datasetId - the dataset directory name.
 * @returns the validated descriptor.
 */
export async function loadDescriptor(repo: string, commit: string, datasetId: string): Promise<DatasetDescriptor> {
  assertValidName('dataset id', datasetId)
  const origin = `${datasetDir(datasetId)}/${DATASET_DESCRIPTOR}`
  const text = await showFile(repo, commit, origin)
  if (text === undefined) {
    throw new DatasetsError(`dataset ${JSON.stringify(datasetId)} not found at ${commit.slice(0, 12)} (no ${origin})`, 'DATASET_NOT_FOUND')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new DatasetsError(`${origin}: invalid JSON — ${String(error)}`, 'SHAPE_INVALID')
  }
  return validateDescriptor(parsed, origin)
}

/** One registered file: its display path (item-relative) and its git object path (repo-relative). */
export interface RegisteredFile {
  /** Item-relative path — what listings and the tree show. */
  display: string
  /** Repo-relative path — what `git show` reads. */
  object: string
}

/** The role map built from a descriptor's register entries against a commit. */
export interface DatasetRegistry {
  /** `${item}\0${layer}` → that role's registered files (sorted by display). */
  entries: Map<string, RegisteredFile[]>
  /** Item ids that carry content ONLY through register (no items/<id>/ directory). */
  registerOnlyItems: string[]
}

function registryKey(item: string, layer: string): string {
  return `${item}\0${layer}`
}

/**
 * Build the role map for one dataset at a commit: expand every register
 * pattern against the item directory's actual files, then fail loud on
 * layout conflicts — a registered display path colliding with a convention
 * file of the same role, or a dangling exact path (a glob may match nothing;
 * an exact path must exist).
 * @param repo - repository path.
 * @param commit - commit to read from.
 * @param datasetId - the dataset id.
 * @param descriptor - the validated descriptor (register entries included).
 * @returns the registry (empty when the descriptor declares no register).
 */
export async function buildRegistry(
  repo: string,
  commit: string,
  datasetId: string,
  descriptor: DatasetDescriptor,
): Promise<DatasetRegistry> {
  const entries = new Map<string, RegisteredFile[]>()
  if (descriptor.register.length === 0) return { entries, registerOnlyItems: [] }
  const prefix = `${datasetDir(datasetId)}/items/`
  const all = await listFiles(repo, commit, `${datasetDir(datasetId)}/items`)
  const registerOnly = new Set<string>()
  const conflicts: string[] = []
  for (const entry of descriptor.register) {
    const base = `${prefix}${entry.item}/`
    const key = registryKey(entry.item, entry.layer)
    const bucket = entries.get(key) ?? []
    let touched = bucket.length > 0
    for (const pattern of entry.files) {
      if (pattern.includes('*')) {
        const matches = all
          .filter(file => file.startsWith(base))
          .map(file => file.slice(base.length))
          .filter(rel => registerPatternMatches(pattern, rel))
        for (const rel of matches) {
          bucket.push({ display: rel, object: `${base}${rel}` })
        }
        touched = true
      } else {
        const object = `${base}${pattern}`
        if (!all.includes(object)) {
          throw new DatasetsError(
            `register: ${JSON.stringify(pattern)} does not exist at ${commit.slice(0, 12)} (expected ${object})`,
            'SHAPE_INVALID',
          )
        }
        bucket.push({ display: pattern, object })
        touched = true
      }
    }
    if (touched && !all.some(file => file.startsWith(base))) registerOnly.add(entry.item)
    bucket.sort((left, right) => left.display.localeCompare(right.display))
    entries.set(key, bucket)
  }
  // Conflict with the layout form: the same display path materialized by the
  // convention layer directory of the same role.
  for (const [key, bucket] of entries) {
    const [item = '', layer = ''] = key.split('\0')
    const conventionBase = `${prefix}${item}/${layer}/`
    const convention = new Set(
      all.filter(file => file.startsWith(conventionBase)).map(file => file.slice(conventionBase.length)),
    )
    for (const file of bucket) {
      if (convention.has(file.display)) conflicts.push(`${item}/${layer}/${file.display}`)
    }
  }
  if (conflicts.length > 0) {
    throw new DatasetsError(
      `register conflicts with the layout form for: ${conflicts.join(', ')} `
      + '(a file may not live both in the convention layer directory and in a register entry of the same role)',
      'SHAPE_INVALID',
    )
  }
  return { entries, registerOnlyItems: [...registerOnly].sort() }
}

/** One role's registered files, or undefined when none. */
export function registeredFiles(registry: DatasetRegistry, item: string, layer: string): RegisteredFile[] | undefined {
  return registry.entries.get(registryKey(item, layer))
}

/**
 * Compute the passthrough file list of one dataset at a commit: every file
 * under the dataset directory that is NOT dataset.json, NOT an item.json, NOT
 * covered by a declared layer directory (either level), and NOT claimed by a
 * register entry. The passthrough zone is readable by every bound session —
 * it is the one unprotected area, so it must be enumerable (the tab shows it,
 * validate warns on it).
 * @returns dataset-relative paths, sorted.
 */
export async function computePassthrough(
  repo: string,
  commit: string,
  datasetId: string,
  descriptor: DatasetDescriptor,
  registry: DatasetRegistry,
): Promise<string[]> {
  const base = `${datasetDir(datasetId)}/`
  const all = await listFiles(repo, commit, datasetDir(datasetId))
  const declared = new Set(descriptor.layers.map(layer => layer.name))
  const claimed = new Set<string>()
  for (const bucket of registry.entries.values()) {
    for (const file of bucket) claimed.add(file.object)
  }
  const passthrough: string[] = []
  for (const file of all) {
    const rel = file.slice(base.length)
    if (rel === DATASET_DESCRIPTOR) continue
    if (claimed.has(file)) continue
    if (rel.startsWith('items/')) {
      const rest = rel.slice('items/'.length)
      const segments = rest.split('/')
      if (segments.length < 2) continue
      if (segments[1] === ITEM_METADATA && segments.length === 2) continue
      if (segments.length >= 3 && declared.has(segments[1] ?? '')) continue // item-level layer content
      // Item-root strays and undeclared item subdirectories fall through.
    } else {
      const top = rel.split('/')[0] ?? ''
      if (declared.has(top)) continue // dataset-level layer content
    }
    passthrough.push(rel)
  }
  return passthrough.sort()
}

/**
 * List dataset ids (directories carrying a descriptor) at a commit.
 * @param repo - repository path.
 * @param commit - commit to list.
 * @returns sorted dataset ids.
 */
export async function listDatasetIds(repo: string, commit: string): Promise<string[]> {
  const files = await listFiles(repo, commit, DATASETS_DIR)
  const ids = new Set<string>()
  for (const file of files) {
    const rest = file.slice(DATASETS_DIR.length + 1)
    const slash = rest.indexOf('/')
    if (slash < 0) continue
    if (rest.slice(slash + 1) === DATASET_DESCRIPTOR) ids.add(rest.slice(0, slash))
  }
  return [...ids].sort()
}

/**
 * Summarize one dataset at a commit.
 * @param repo - repository path.
 * @param commit - commit to read from.
 * @param datasetId - the dataset id.
 * @returns id, declared layers (with visibility classes), and the item count.
 */
export async function summarizeDataset(repo: string, commit: string, datasetId: string): Promise<DatasetSummary> {
  const descriptor = await loadDescriptor(repo, commit, datasetId)
  const files = await listFiles(repo, commit, `${datasetDir(datasetId)}/items`)
  const items = new Set<string>()
  for (const file of files) {
    const rest = file.slice(`${datasetDir(datasetId)}/items/`.length)
    const slash = rest.indexOf('/')
    if (slash > 0) items.add(rest.slice(0, slash))
  }
  // Items may exist purely through register entries (no items/<id>/ directory).
  for (const entry of descriptor.register) items.add(entry.item)
  return {
    id: descriptor.id,
    ...(descriptor.name !== undefined ? { name: descriptor.name } : {}),
    layers: descriptor.layers.map(layer => layer.name),
    nonModelFacingLayers: descriptor.layers.filter(layer => !layer.modelFacing).map(layer => layer.name),
    itemCount: items.size,
    warnings: descriptorWarnings(descriptor),
  }
}

/**
 * List the dataset-level layer content at a commit: for each DECLARED layer
 * name, the files under `datasets/<id>/<layer>/` (layer-relative, sorted).
 * Only declared names qualify — any other top-level directory is descriptor
 * passthrough and never becomes a layer. Declared layers absent at this
 * commit are omitted.
 * @param repo - repository path.
 * @param commit - commit to read from.
 * @param datasetId - the dataset id.
 * @param declared - the descriptor's declared layer names.
 * @returns layer name → layer-relative file paths, for layers with content.
 */
export async function listDatasetLayers(
  repo: string,
  commit: string,
  datasetId: string,
  declared: readonly string[],
): Promise<Record<string, string[]>> {
  const layers: Record<string, string[]> = {}
  for (const layer of declared) {
    const dir = `${datasetDir(datasetId)}/${layer}`
    const files = (await listFiles(repo, commit, dir))
      .filter(file => file.startsWith(`${dir}/`))
      .map(file => file.slice(dir.length + 1))
      .sort()
    if (files.length > 0) layers[layer] = files
  }
  return layers
}

/**
 * Load one item's record (metadata + files grouped by layer) at a commit.
 * @param repo - repository path.
 * @param commit - commit to read from.
 * @param datasetId - owning dataset id.
 * @param itemId - the item id.
 * @returns the item record.
 */
export async function loadItem(
  repo: string,
  commit: string,
  datasetId: string,
  itemId: string,
  registry?: DatasetRegistry,
): Promise<ItemRecord> {
  assertValidName('item id', itemId)
  const dir = itemDir(datasetId, itemId)
  const files = await listFiles(repo, commit, dir)
  const owned = files.filter(file => file.startsWith(`${dir}/`)).map(file => file.slice(dir.length + 1))
  const layers: Record<string, string[]> = {}
  for (const rel of owned) {
    if (rel === ITEM_METADATA) continue
    const slash = rel.indexOf('/')
    if (slash < 0) continue // stray file at the item root: not a layer, ignored by convention
    const layer = rel.slice(0, slash)
    ;(layers[layer] ??= []).push(rel.slice(slash + 1))
  }
  // Registered files join their declared role (display = item-relative path);
  // the registry build already rejected convention collisions.
  if (registry !== undefined) {
    for (const [key, bucket] of registry.entries) {
      const [item] = key.split('\0')
      if (item !== itemId) continue
      const layer = key.split('\0')[1] ?? ''
      ;(layers[layer] ??= []).push(...bucket.map(file => file.display))
    }
  }
  if (owned.length === 0 && Object.keys(layers).length === 0) {
    throw new DatasetsError(`item ${JSON.stringify(itemId)} not found in dataset ${JSON.stringify(datasetId)} at ${commit.slice(0, 12)}`, 'ITEM_NOT_FOUND')
  }
  for (const paths of Object.values(layers)) paths.sort()
  let metadata: JsonObject | undefined
  if (owned.includes(ITEM_METADATA)) {
    const origin = `${dir}/${ITEM_METADATA}`
    const text = await showFile(repo, commit, origin)
    if (text !== undefined) {
      try {
        const parsed: unknown = JSON.parse(text)
        if (!isPlainObject(parsed)) throw new Error('item metadata must be a JSON object')
        metadata = parsed as JsonObject
      } catch (error) {
        throw new DatasetsError(`${origin}: ${String(error)}`, 'SHAPE_INVALID')
      }
    }
  }
  return { id: itemId, ...(metadata !== undefined ? { metadata } : {}), layers }
}

/**
 * List every item of a dataset at a commit.
 * @param repo - repository path.
 * @param commit - commit to read from.
 * @param datasetId - the dataset id.
 * @returns item records sorted by id.
 */
export async function listItems(
  repo: string,
  commit: string,
  datasetId: string,
  registry?: DatasetRegistry,
): Promise<ItemRecord[]> {
  const files = await listFiles(repo, commit, `${datasetDir(datasetId)}/items`)
  const prefix = `${datasetDir(datasetId)}/items/`
  const ids = new Set<string>()
  for (const file of files) {
    const rest = file.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash > 0) ids.add(rest.slice(0, slash))
  }
  for (const id of registry?.registerOnlyItems ?? []) ids.add(id)
  const items: ItemRecord[] = []
  for (const id of [...ids].sort()) items.push(await loadItem(repo, commit, datasetId, id, registry))
  return items
}
