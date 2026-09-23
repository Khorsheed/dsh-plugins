/**
 * The datasets service core. `ctx.datasets` exposes this; the model tools,
 * the CLI, and the slash command are thin adapters over it. The service owns
 * the repository layout knowledge, the layer-whitelist enforcement (on EVERY
 * read path, worktree included), and the managed-worktree mechanics.
 *
 * Single-storage rule: content lives only in the git repository. Single-file
 * reads come straight from git objects; whole-layer consumption goes through
 * deduplicated sparse-checkout worktrees. No path produces a second copy.
 */
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  assertSafeRelativePath, assertValidName, buildRegistry, canaryWarnings, computePassthrough, datasetDir,
  DATASET_DESCRIPTOR, DatasetsError,
  descriptorWarnings, fieldNameWarnings, itemDir, ITEM_METADATA,
  listDatasetIds, listDatasetLayers, listItems, loadDescriptor, loadItem, registeredFiles, summarizeDataset,
  validateDescriptor, type DatasetDescriptor, type DatasetRegistry, type DatasetSummary, type DescriptorWarning,
  type ItemRecord, type JsonObject,
} from './dataset.ts'
import {
  itemBrief as computeItemBrief, overviewRow, type DatasetOverview, type ItemBrief,
} from './brief.ts'
import { git, GitError, gitCommonDir, listFiles, repoToplevel, resolveCommit, showFile } from './git.ts'
import { judgeabilityIssues } from './rubric.ts'
import {
  planDatasetSkeleton, planItemSkeleton, type SkeletonResult,
} from './scaffold.ts'
import { layerPaths, materializePaths, type ManagedWorktree } from './materialize.ts'
import { notRegistered, openRegistry, type LatestCommit, type RegistryEntry, type RepoRegistry } from './registry.ts'
import { normalizeRepoPath } from './repo-path.ts'

/**
 * The effective visibility scope of one call: the resolved repository plus
 * the whitelists. Tools and slash build it from a registry reference
 * (`registryScope`), the CLI from the registry or an explicit `--repo`.
 */
export interface DatasetScope {
  /** Repository path (as given; resolved per call) — a checkout, or a git common dir for read verbs. */
  repo: string
  /**
   * The commit-ish a read resolves when the call names none (default HEAD).
   * A registry scope pins it to the registration's tracked-branch tip, so an
   * agent reads «latest» and never whatever branch a shared checkout has out.
   */
  ref?: string
  /** Dataset-id whitelist (a registry reference's one set); absent = all. */
  datasets?: readonly string[]
  /** Layer whitelist (the registration's layers); absent = the modelFacing floor (see effectiveLayers). */
  layers?: readonly string[]
  /**
   * The human/operator view (the web tab, CLI read verbs): bypasses BOTH the
   * whitelists and the modelFacing default floor. The whitelist
   * constrains the agent (tools + worktree materialization), never the human
   * looking at their own machine.
   */
  operator?: true
}

/**
 * The effective layer ceiling of one call against one dataset:
 * - operator scope: unfiltered (undefined) — the human looking at their own
 *   machine is never the party this constrains;
 * - an explicit whitelist: exactly it (sensitive layers listed on
 *   purpose are deliberately included);
 * - no whitelist: the modelFacing floor, the dataset's `modelFacing: true`
 *   layers and nothing else.
 *
 * The floor used to apply only to a dataset that declared at least one
 * sensitive layer, and to answer `undefined` — unfiltered — for every other
 * one. That made "no whitelist" mean two different things depending on a
 * descriptor the binder never read, and the unfiltered branch also admitted
 * item-level directories no `register` entry claims, which are precisely the
 * ones nobody has declared a sensitivity for. `/datasets bind` with no
 * `--layers` is the common case and it printed "(all layers)" while this
 * function quietly applied a floor to some datasets and not others (I5·T39 ·
 * G3). Now the default is one sentence in both places: the model-facing layers,
 * and widening it is something a person writes down.
 */
export function effectiveLayers(scope: DatasetScope, descriptor: DatasetDescriptor): readonly string[] | undefined {
  if (scope.operator === true) return undefined
  if (scope.layers !== undefined) return scope.layers
  return descriptor.layers.filter(layer => layer.modelFacing).map(layer => layer.name)
}

/**
 * Resolve the HUMAN faces' scope (the CLI's read verbs) from the deployment's
 * registry — there is no session binding and no configured default any more
 * (T73): which repository a call reads is the registry's answer or the
 * operator's explicit `--repo`.
 *
 * - `repo` naming a registration id: that registration, read at its
 *   tracked-branch tip through the common dir (no checkout's HEAD in play);
 * - any other `repo`: a path the operator typed at their own machine,
 *   normalized (`~` expanded) and read as given;
 * - no `repo`: the only registration when there is exactly one; otherwise one
 *   of the two refusals — nothing registered, or several candidates.
 * @param registry - the deployment's dataset registry.
 * @param repo - the explicit `--repo` (a registry id or a path), if any.
 * @returns the scope (the caller adds `operator` where it applies).
 */
export async function resolveOperatorScope(registry: RepoRegistry, repo: string | undefined): Promise<DatasetScope> {
  const asked = repo?.trim()
  if (asked !== undefined && asked !== '') {
    const entry = registry.get(asked)
    if (entry === undefined) return { repo: normalizeRepoPath(asked) }
    return { repo: entry.commonDir, ref: (await registry.latest(entry)).commit }
  }
  const entries = registry.entries()
  const only = entries[0]
  if (entries.length === 1 && only !== undefined) {
    return { repo: only.commonDir, ref: (await registry.latest(only)).commit }
  }
  if (entries.length === 0) {
    throw new DatasetsError(
      'no dataset repository is registered in this deployment; register one (Datasets tab → Register repository, '
      + 'or `dsh-datasets register --repo <path>`), or pass --repo <path>',
      'NOT_REGISTERED',
    )
  }
  throw new DatasetsError(
    `several dataset repositories are registered (${entries.map(entry => entry.id).join(', ')}); `
    + 'pass --repo <id> to pick one',
    'NOT_UNIQUE',
  )
}

/** `datasets_list` result with a dataset selector: one dataset's items. */
export interface ListItemsResult {
  kind: 'items'
  dataset: DatasetSummary
  /** Dataset-level (shared) layer content, layer name → layer-relative paths, filtered to the call's ceiling. */
  datasetLayers: Record<string, string[]>
  items: ItemRecord[]
  /**
   * The passthrough zone: dataset-relative paths of files covered by NO
   * declared layer directory and NO register entry (plus item.json's stray
   * siblings). Never filtered — it is the one unprotected area and must be
   * visible exactly because it is unprotected.
   */
  passthrough: string[]
}

/** `datasets_list` result without a dataset selector: dataset summaries. */
export interface ListDatasetsResult {
  kind: 'datasets'
  datasets: DatasetSummary[]
}

/** `datasets_show` result. */
export interface ShowResult {
  dataset: DatasetSummary
  /** The whole descriptor, passthrough. */
  descriptor: JsonObject
  /** Dataset-level (shared) layer content, layer name → layer-relative paths, whitelist-filtered. */
  datasetLayers: Record<string, string[]>
  /** One item when `item` was given, else every item (layer-filtered). */
  items: ItemRecord[]
  commit: string
}

/** `datasets_snapshot` result — the pin a consumer reuses for stable reads. */
export interface DatasetSnapshot {
  repoPath: string
  commit: string
  datasetId: string
}

/** `datasets_read` query. */
export interface ReadQuery {
  dataset: string
  /** Item id; omit to read a DATASET-LEVEL (shared) layer file. */
  item?: string
  layer: string
  /** Layer-relative file path. */
  path: string
  /** Pinned commit (default HEAD). */
  commit?: string
}

/** `datasets/readPassthrough` query — the OPERATOR channel into the passthrough zone. */
export interface ReadPassthroughRequest {
  dataset: string
  /** Dataset-relative file path (manifest.yml, docs/x.md, items/<item>/item.json, …). */
  path: string
  /** Pinned commit (default HEAD). */
  commit?: string
}

/** `datasets_read` result: the file content and the commit it was read from. */
export interface ReadResult {
  content: string
  commit: string
}

/**
 * `datasets/list` Remote request. Optional fields ride INSIDE the object on
 * purpose: the gateway's client proxy forwards exactly as many values as the
 * caller passed and requires exact descriptor arity, so optional positional
 * parameters are a runtime trap (the type marks them optional, the wire does
 * not) — object fields are genuinely optional.
 */
export interface ListRequest {
  /** When given, list this dataset's items instead of datasets. */
  dataset?: string
  /** Pinned commit (default HEAD). */
  commit?: string
}

/**
 * `datasets/previewRepo` request: one candidate repository path (normalized
 * host-side) and, optionally, the branch the register form has selected.
 * The answer is the registry's {@link RegisterPreview}.
 */
export interface PreviewRepoRequest {
  path: string
  trackedRef?: string
}

/** One structural error found by `datasets_validate` (the DatasetsError code is preserved). */
export interface ValidateError {
  code: string
  message: string
}

/** One dataset's validation outcome. */
export interface ValidateDatasetResult {
  id: string
  errors: ValidateError[]
  warnings: DescriptorWarning[]
}

/** `datasets_validate` result. */
export interface ValidateResult {
  datasets: ValidateDatasetResult[]
}

/** `datasets/show` Remote request (same optional-fields-in-object rule as ListRequest). */
export interface ShowRequest {
  dataset: string
  /** When given, show just this item. */
  item?: string
  /** Pinned commit (default HEAD). */
  commit?: string
}

/** `datasets_put_item` input. `metadata` replaces item.json; files upsert. */
export interface PutItemInput {
  dataset: string
  item: string
  metadata?: Record<string, unknown>
  files?: { layer: string; path: string; content: string }[]
}

/** `datasets_put_item` result. */
export interface PutItemResult {
  /** Repo-relative paths written into the working tree (commit stays the human's). */
  written: string[]
}

/** `datasets/itemBrief` request: which item the tab is showing. */
export interface ItemBriefRequest {
  dataset: string
  item: string
  /** Pinned commit (default HEAD). */
  commit?: string
}

/** `datasets/validate` request: one dataset, or every dataset when absent. */
export interface ValidateRequest {
  dataset?: string
}

/** `datasets/scaffoldDataset` input — the «新建题集» gesture. */
export interface ScaffoldDatasetInput {
  /** The new dataset's id, which is also its directory name under `datasets/`. */
  id: string
  /** Display name for the descriptor, when the author gave one. */
  name?: string
}

/** `datasets/scaffoldItem` input — the «题目骨架» gesture. */
export interface ScaffoldItemInput {
  dataset: string
  item: string
}

/** `datasets/importItem` input — the «导入题目» gesture. */
export interface ImportItemInput {
  dataset: string
  /** The item id to create (the directory name under `items/`). */
  item: string
  /** An existing item directory on this machine, copied in verbatim. */
  sourceDir: string
}

/** At most this many files may be imported in one gesture. */
export const IMPORT_FILE_LIMIT = 500
/** At most this many bytes per imported file. */
export const IMPORT_BYTE_LIMIT = 4 * 1024 * 1024

/** `datasets_worktree_path` options. */
export interface WorktreeOptions {
  commit?: string
  layers?: readonly string[]
}

/** The public service face (`ctx.datasets`). */
export interface DatasetsService {
  /** The legacy per-session binding store (read by the registry's one-click import). */
  readonly bindingsRoot: string
  list(scope: DatasetScope, datasetId?: string, commit?: string): Promise<ListDatasetsResult | ListItemsResult>
  show(scope: DatasetScope, datasetId: string, itemId?: string, commit?: string): Promise<ShowResult>
  describe(scope: DatasetScope, datasetId: string, commit?: string): Promise<JsonObject>
  read(scope: DatasetScope, query: ReadQuery): Promise<ReadResult>
  /**
   * Read one dataset-relative file from the git object — the OPERATOR channel
   * into the passthrough zone (dataset-root files, docs, item.json, item-root
   * strays). No layer ceiling and no declaration guard: it exists for the
   * human's tab, and is deliberately NOT exposed as a model tool.
   */
  readPassthrough(scope: DatasetScope, datasetId: string, path: string, commit?: string): Promise<ReadResult>
  snapshot(scope: DatasetScope, datasetId: string, commit?: string): Promise<DatasetSnapshot>
  worktreePath(scope: DatasetScope, datasetId: string, options?: WorktreeOptions): Promise<ManagedWorktree>
  putItem(scope: DatasetScope, input: PutItemInput): Promise<PutItemResult>
  /**
   * The 题集 tab's list page in one call: the repository, the commit every row
   * was read at, and one row per dataset (slot ← layer mapping, canary,
   * validate outcome). Always reads HEAD — the list is about the working
   * repository's current state, and a pinned commit would disagree with the
   * `validate` cell, which has no pin of its own.
   */
  overview(scope: DatasetScope): Promise<DatasetOverview>
  /**
   * One item's «选手将看到» and «可判性». The two judging reads carry an
   * EXPLICIT single-layer scope, never the operator bypass — the page needs
   * the answer key's shape, not its bytes.
   */
  itemBrief(scope: DatasetScope, datasetId: string, itemId: string, commit?: string): Promise<ItemBrief>
  /**
   * Write a new dataset's skeleton into the working tree (descriptor, one
   * stage prompt, one stage schema, the item container). A HUMAN gesture: it
   * requires the operator scope, because a brand-new id cannot be inside any
   * session's whitelist and an agent's authoring path is `putItem`.
   */
  scaffoldDataset(scope: DatasetScope, input: ScaffoldDatasetInput): Promise<SkeletonResult>
  /**
   * Write one item's placeholder files into the working tree, homed by the
   * dataset's own layers and `register`. Existing files are never overwritten.
   * Operator-only, for the same reason as {@link DatasetsService.scaffoldDataset}.
   */
  scaffoldItem(scope: DatasetScope, input: ScaffoldItemInput): Promise<SkeletonResult>
  /**
   * Copy an existing item directory into the dataset verbatim. The dataset's
   * own layers and `register` decide what each copied file becomes — this
   * never re-homes anything, so what the author had is what the author gets.
   * Operator-only.
   */
  importItem(scope: DatasetScope, input: ImportItemInput): Promise<SkeletonResult>
  /** The deployment's dataset registry (human-written; agents resolve `<id>/<set>` through it). */
  readonly registry: RepoRegistry
  /** Fail loud unless `repo` is inside a git work tree; resolves to the canonical toplevel. */
  assertRepository(repo: string): Promise<string>
  /**
   * Validate one dataset (or all) of a repository: shape errors fail loud per
   * dataset, warnings never block. Author-facing — sees everything
   * (operator semantics), including the passthrough zone it reports on. It is
   * also the only path that reads file CONTENT (the canary check and the
   * judgeability rules over an item's rubric).
   */
  validate(scope: DatasetScope, datasetId?: string): Promise<ValidateResult>
  /*
   * Operator-level registry reads. In-process only — not model tools, not
   * Remote verbs: eval's experiment layer calls them structurally (it pins a
   * dataset as {registry, set, commit} and reads contract files from it).
   * Every one addresses a registration by id and only runs git
   * show / ls-tree / rev-parse / archive against its common dir — never a
   * worktree, never a checkout, never a HEAD move.
   */
  /** A registration as eval's experiment layer reads it. Throws DatasetsError NOT_REGISTERED for an unknown id. */
  registration(id: string): Promise<{ id: string; commonDir: string; trackedRef: string; latest: LatestCommit }>
  /** Resolve a commit-ish (branch, tag, full or short sha) inside the registered repository to a full sha; GIT_ERROR when unknown. */
  resolveRegistryCommit(id: string, ref: string): Promise<string>
  /** The git tree/blob oid at `<commit>:<repo-relative path>`, or null when the path is absent at that commit. */
  registryObjectId(id: string, commit: string, path: string): Promise<string | null>
  /** Repo-relative file paths under a repo-relative prefix at a commit (empty when absent). */
  registryListFiles(id: string, commit: string, prefix: string): Promise<string[]>
  /** A file's exact bytes at a commit, or undefined when absent. */
  registryShowFile(id: string, commit: string, path: string): Promise<Buffer | undefined>
  /**
   * The operator's full read-only view of `datasets/<set>/` at one full commit
   * sha (descriptor, schemas, every item layer, plans, conditions …),
   * materialized content-addressed under the materialized root with the
   * reserved view key {@link FULL_VIEW_KEY}. Host-side only — validation
   * and the run loop read contract files from it; it is never handed to an
   * agent. `path` is the materialized `datasets/<set>` directory.
   */
  datasetView(id: string, set: string, commit: string): Promise<{ path: string; commit: string }>
}

/**
 * The layers-key segment of an operator full view ({@link DatasetsService.datasetView}).
 * The leading underscore keeps it apart from every declared layer name in
 * practice; a set that declares a layer literally named `_full` would share
 * the key, which is why descriptors should not.
 */
export const FULL_VIEW_KEY = '_full'

/** Service construction options (roots already resolved by the caller). */
export interface DatasetsServiceOptions {
  /** Materialized-layer root (`<stateRoot>/materialized`). */
  materializedRoot: string
  /** The registry file (`<stateRoot>/registry.json`). */
  registryPath: string
  /** The legacy binding store root (`<stateRoot>/bindings`), read only by the registry's import. */
  bindingsRoot: string
}

/**
 * Wrap a git failure as a domain error where the cause is clear.
 *
 * A path that is not on disk is answered BEFORE git runs. git's own complaint
 * about a cwd it cannot enter is "not a git repository" with an empty stderr,
 * which sends the reader off to check a repository that was never there —
 * the tab's error seat maps each cause to its own fix, and this one's fix is
 * not the same as a real non-repository's (I5·T62).
 */
async function toplevelOf(repo: string): Promise<string> {
  if (!existsSync(repo)) {
    throw new DatasetsError(`${repo} does not exist — no such file or directory`, 'FILE_NOT_FOUND')
  }
  try {
    return await repoToplevel(repo)
  } catch (error) {
    throw new DatasetsError(`${repo} is not a git repository: ${String(error)}`, 'NOT_A_REPO')
  }
}

/**
 * The repository a READ resolves against: a work tree's toplevel, or — for a
 * registry scope, which names the git common dir so no checkout's HEAD is in
 * play — the git dir itself. Reads only touch git objects, so a git dir is
 * enough; write verbs keep {@link toplevelOf}.
 */
async function readRepoOf(repo: string): Promise<string> {
  try {
    return await toplevelOf(repo)
  } catch (error) {
    if (!(error instanceof DatasetsError && error.code === 'NOT_A_REPO')) throw error
    let common: string
    try {
      common = await gitCommonDir(repo)
    } catch {
      throw error
    }
    if (common !== realpathSync(repo)) throw error
    return common
  }
}

/**
 * Read and validate a dataset's descriptor from the WORKING TREE (not from a
 * git object): every write verb targets the working tree, so the shape it
 * writes against must be the shape on disk.
 * @param repo - the resolved repository toplevel.
 * @param datasetId - the dataset id.
 * @returns the validated descriptor.
 */
async function readWorkingDescriptor(repo: string, datasetId: string): Promise<DatasetDescriptor> {
  const descriptorPath = join(repo, datasetDir(datasetId), DATASET_DESCRIPTOR)
  if (!existsSync(descriptorPath)) {
    throw new DatasetsError(`dataset ${JSON.stringify(datasetId)} not found in the working tree of ${repo}`, 'DATASET_NOT_FOUND')
  }
  try {
    return validateDescriptor(JSON.parse(await readFile(descriptorPath, 'utf8')), descriptorPath)
  } catch (error) {
    if (error instanceof DatasetsError) throw error
    throw new DatasetsError(`${descriptorPath}: invalid JSON — ${String(error)}`, 'SHAPE_INVALID')
  }
}

/**
 * Every file under an imported item directory, as source-relative paths.
 * Symlinks are skipped rather than followed (an import must not reach outside
 * the directory the human pointed at) and `.git` is skipped whole; the file
 * count is capped, because this walks a directory chosen in a UI.
 * @param source - the absolute source directory.
 * @returns the relative paths, sorted, and one note per skipped entry class.
 */
async function collectImportFiles(source: string): Promise<{ paths: string[]; notes: string[] }> {
  const paths: string[] = []
  const notes: string[] = []
  let links = 0
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(source, relative), { withFileTypes: true })) {
      const rel = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isSymbolicLink()) {
        links += 1
        continue
      }
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue
        await walk(rel)
        continue
      }
      if (!entry.isFile()) continue
      if (paths.length >= IMPORT_FILE_LIMIT) {
        throw new DatasetsError(
          `${source} holds more than ${IMPORT_FILE_LIMIT} files — import a single item directory, not a tree`,
          'SHAPE_INVALID',
        )
      }
      paths.push(rel)
    }
  }
  await walk('')
  if (links > 0) notes.push(`${links} symlink(s) skipped: an import copies regular files only`)
  if (paths.length === 0) notes.push(`${source} holds no regular file to import`)
  paths.sort()
  return { paths, notes }
}

function assertDatasetAllowed(scope: DatasetScope, datasetId: string): void {
  assertValidName('dataset id', datasetId)
  if (scope.operator === true) return
  if (scope.datasets !== undefined && !scope.datasets.includes(datasetId)) {
    throw new DatasetsError(
      `dataset ${JSON.stringify(datasetId)} is outside this session's bound datasets [${scope.datasets.join(', ')}]`,
      'DATASET_NOT_FOUND',
    )
  }
}

/** Throw when a single layer is outside the call's effective ceiling. */
function assertLayerAllowed(ceiling: readonly string[] | undefined, layer: string): void {
  if (ceiling !== undefined && !ceiling.includes(layer)) {
    throw new DatasetsError(
      `layer ${JSON.stringify(layer)} is outside the allowed layers [${ceiling.join(', ')}]`,
      'LAYER_NOT_ALLOWED',
    )
  }
}

/** Filter one item's layer map to the call's effective ceiling. */
function filterItemLayers(ceiling: readonly string[] | undefined, item: ItemRecord): ItemRecord {
  if (ceiling === undefined) return item
  const layers: Record<string, string[]> = {}
  for (const [layer, files] of Object.entries(item.layers)) {
    if (ceiling.includes(layer)) layers[layer] = files
  }
  return { ...item, layers }
}

/** Filter a layer → files map (dataset-level shared content) to the call's effective ceiling. */
function filterLayerMap(ceiling: readonly string[] | undefined, map: Record<string, string[]>): Record<string, string[]> {
  if (ceiling === undefined) return map
  const filtered: Record<string, string[]> = {}
  for (const [layer, files] of Object.entries(map)) {
    if (ceiling.includes(layer)) filtered[layer] = files
  }
  return filtered
}

/** Filter a summary's declared layer lists to the call's effective ceiling. */
function filterSummaryLayers(ceiling: readonly string[] | undefined, summary: DatasetSummary): DatasetSummary {
  if (ceiling === undefined) return summary
  return {
    ...summary,
    layers: summary.layers.filter(layer => ceiling.includes(layer)),
    nonModelFacingLayers: summary.nonModelFacingLayers.filter(layer => ceiling.includes(layer)),
  }
}

/**
 * Create the datasets service.
 * @param options - resolved construction options.
 * @returns the service instance.
 */
export function createDatasetsService(options: DatasetsServiceOptions): DatasetsService {
  const resolveCommitAt = async (scope: DatasetScope, commit?: string): Promise<{ repo: string; sha: string }> => {
    const repo = await readRepoOf(scope.repo)
    const ref = commit ?? scope.ref ?? 'HEAD'
    let sha: string
    try {
      sha = await resolveCommit(repo, ref)
    } catch (error) {
      throw new DatasetsError(`cannot resolve ${ref} in ${repo}: ${String(error)}`, 'GIT_ERROR')
    }
    return { repo, sha }
  }

  /**
   * A working-tree write, containment-checked. Shared by `putItem` and the
   * three skeleton gestures so that one rule decides what «inside the
   * repository» means.
   * @param repo - the resolved repository toplevel.
   * @param rel - the repo-relative path to write.
   * @param content - the bytes.
   * @param keepExisting - true to leave an existing file alone (a skeleton
   *   never overwrites the author's own work; `putItem` upserts).
   * @returns whether the file was written.
   */
  const writeInRepo = async (repo: string, rel: string, content: string | Buffer, keepExisting = false): Promise<boolean> => {
    const target = resolve(repo, rel)
    if (target !== repo && !target.startsWith(`${repo}${sep}`)) {
      throw new DatasetsError(`refusing to write outside the repository: ${rel}`, 'INVALID_NAME')
    }
    if (keepExisting && existsSync(target)) return false
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    return true
  }

  /**
   * The skeleton gestures are the HUMAN's (the tab's buttons): an agent's
   * authoring path is `datasets_put_item`, which the binding's whitelist
   * governs. A brand-new dataset id cannot be inside any whitelist, so rather
   * than inventing an exception the write simply requires the operator view.
   * @param scope - the calling scope.
   * @param gesture - what the caller was trying to do, for the message.
   */
  const assertOperator = (scope: DatasetScope, gesture: string): void => {
    if (scope.operator !== true) {
      throw new DatasetsError(
        `${gesture} is a human gesture from the datasets tab, not an agent verb — `
        + 'an agent drafts items through datasets_put_item, inside its registered set',
        'LAYER_NOT_ALLOWED',
      )
    }
  }

  /** A registration by id, or the unregistered refusal. */
  const registered = (id: string): RegistryEntry => {
    const entry = service.registry.get(id)
    if (entry === undefined) throw notRegistered(id)
    return entry
  }

  const service: DatasetsService = {
    bindingsRoot: options.bindingsRoot,
    registry: openRegistry(options.registryPath),
    async list(scope, datasetId, commit) {
      const { repo, sha } = await resolveCommitAt(scope, commit)
      if (datasetId !== undefined) {
        assertDatasetAllowed(scope, datasetId)
        const descriptor = await loadDescriptor(repo, sha, datasetId)
        const ceiling = effectiveLayers(scope, descriptor)
        const registry = await buildRegistry(repo, sha, datasetId, descriptor)
        const summary = filterSummaryLayers(ceiling, await summarizeDataset(repo, sha, datasetId))
        const shared = await listDatasetLayers(repo, sha, datasetId, descriptor.layers.map(layer => layer.name))
        const items = (await listItems(repo, sha, datasetId, registry)).map(item => filterItemLayers(ceiling, item))
        const passthrough = await computePassthrough(repo, sha, datasetId, descriptor, registry)
        return { kind: 'items', dataset: summary, datasetLayers: filterLayerMap(ceiling, shared), items, passthrough }
      }
      const ids = (await listDatasetIds(repo, sha))
        .filter(id => scope.operator === true || scope.datasets === undefined || scope.datasets.includes(id))
      const datasets: DatasetSummary[] = []
      for (const id of ids) {
        const descriptor = await loadDescriptor(repo, sha, id)
        datasets.push(filterSummaryLayers(effectiveLayers(scope, descriptor), await summarizeDataset(repo, sha, id)))
      }
      return { kind: 'datasets', datasets }
    },

    async show(scope, datasetId, itemId, commit) {
      assertDatasetAllowed(scope, datasetId)
      const { repo, sha } = await resolveCommitAt(scope, commit)
      const descriptor = await loadDescriptor(repo, sha, datasetId)
      const ceiling = effectiveLayers(scope, descriptor)
      const registry = await buildRegistry(repo, sha, datasetId, descriptor)
      const summary = filterSummaryLayers(ceiling, await summarizeDataset(repo, sha, datasetId))
      const shared = await listDatasetLayers(repo, sha, datasetId, descriptor.layers.map(layer => layer.name))
      const items = itemId !== undefined
        ? [await loadItem(repo, sha, datasetId, itemId, registry)]
        : await listItems(repo, sha, datasetId, registry)
      return {
        dataset: summary,
        descriptor: descriptor.raw,
        datasetLayers: filterLayerMap(ceiling, shared),
        items: items.map(item => filterItemLayers(ceiling, item)),
        commit: sha,
      }
    },

    async describe(scope, datasetId, commit) {
      assertDatasetAllowed(scope, datasetId)
      const { repo, sha } = await resolveCommitAt(scope, commit)
      const descriptor = await loadDescriptor(repo, sha, datasetId)
      return descriptor.raw
    },

    async read(scope, query) {
      assertDatasetAllowed(scope, query.dataset)
      if (query.item !== undefined) assertValidName('item id', query.item)
      assertValidName('layer name', query.layer)
      const rel = assertSafeRelativePath(query.path)
      const { repo, sha } = await resolveCommitAt(scope, query.commit)
      // The descriptor loads on EVERY read now: the modelFacing floor needs
      // it, and item-level reads need the register to re-home role paths.
      const descriptor = await loadDescriptor(repo, sha, query.dataset)
      assertLayerAllowed(effectiveLayers(scope, descriptor), query.layer)
      let objectPath: string
      if (query.item === undefined) {
        // The DATASET level (shared content). That path can address ANY
        // top-level directory, so the layer must be DECLARED — undeclared
        // top-level directories are descriptor passthrough and stay
        // unreachable here exactly as before.
        if (!descriptor.layers.some(layer => layer.name === query.layer)) {
          throw new DatasetsError(
            `layer ${JSON.stringify(query.layer)} is not declared by dataset ${JSON.stringify(query.dataset)}`,
            'LAYER_UNDECLARED',
          )
        }
        objectPath = `${datasetDir(query.dataset)}/${query.layer}/${rel}`
      } else {
        // Role first: a registered display path wins; the convention path is
        // the fallback (the registry build already rejected collisions).
        const registry = await buildRegistry(repo, sha, query.dataset, descriptor)
        const registered = registeredFiles(registry, query.item, query.layer)?.find(file => file.display === rel)
        objectPath = registered?.object ?? `${itemDir(query.dataset, query.item)}/${query.layer}/${rel}`
      }
      const content = await showFile(repo, sha, objectPath)
      if (content === undefined) {
        throw new DatasetsError(`no file ${objectPath} at ${sha.slice(0, 12)}`, 'FILE_NOT_FOUND')
      }
      return { content, commit: sha }
    },

    async readPassthrough(scope, datasetId, path, commit) {
      assertDatasetAllowed(scope, datasetId)
      const rel = assertSafeRelativePath(path)
      const { repo, sha } = await resolveCommitAt(scope, commit)
      const objectPath = `${datasetDir(datasetId)}/${rel}`
      const content = await showFile(repo, sha, objectPath)
      if (content === undefined) {
        throw new DatasetsError(`no file ${objectPath} at ${sha.slice(0, 12)}`, 'FILE_NOT_FOUND')
      }
      return { content, commit: sha }
    },

    async snapshot(scope, datasetId, commit) {
      assertDatasetAllowed(scope, datasetId)
      const { repo, sha } = await resolveCommitAt(scope, commit)
      await loadDescriptor(repo, sha, datasetId) // the pin must name a real dataset
      return { repoPath: repo, commit: sha, datasetId }
    },

    async worktreePath(scope, datasetId, worktreeOptions) {
      assertDatasetAllowed(scope, datasetId)
      const { repo, sha } = await resolveCommitAt(scope, worktreeOptions?.commit)
      const descriptor = await loadDescriptor(repo, sha, datasetId)
      const declared = descriptor.layers.map(layer => layer.name)
      const ceiling = effectiveLayers(scope, descriptor)
      // Default = the ceiling: with no explicit binding whitelist, a dataset
      // declaring sensitive layers materializes only its modelFacing:true ones.
      const requested = worktreeOptions?.layers ?? (ceiling ?? declared)
      for (const layer of requested) {
        if (!declared.includes(layer)) {
          throw new DatasetsError(
            `layer ${JSON.stringify(layer)} is not declared by dataset ${JSON.stringify(datasetId)} (declared: ${declared.join(', ')})`,
            'LAYER_UNDECLARED',
          )
        }
      }
      const effective = ceiling === undefined
        ? requested
        : requested.filter(layer => ceiling.includes(layer))
      if (effective.length === 0) {
        throw new DatasetsError(
          `no requested layer survives the allowed layers [${(ceiling ?? []).join(', ')}]`,
          'LAYER_NOT_ALLOWED',
        )
      }
      // Registered paths of the effective layers join the archived paths.
      const registry = await buildRegistry(repo, sha, datasetId, descriptor)
      const registerPatterns = descriptor.register
        .filter(entry => effective.includes(entry.layer))
        .flatMap(entry => {
          const bucket = registeredFiles(registry, entry.item, entry.layer) ?? []
          return bucket.map(file => file.object)
        })
      const files = await listFiles(repo, sha, datasetDir(datasetId))
      return await materializePaths(
        repo, sha, datasetId, effective, layerPaths(datasetId, effective, files, registerPatterns), options.materializedRoot,
      )
    },

    async putItem(scope, input) {
      assertDatasetAllowed(scope, input.dataset)
      assertValidName('item id', input.item)
      const repo = await toplevelOf(scope.repo)
      const descriptor = await readWorkingDescriptor(repo, input.dataset)
      const declared = descriptor.layers.map(layer => layer.name)
      const written: string[] = []
      const writeOne = async (rel: string, content: string): Promise<void> => {
        await writeInRepo(repo, rel, content)
        written.push(rel)
      }
      if (input.metadata !== undefined) {
        await writeOne(`${itemDir(input.dataset, input.item)}/${ITEM_METADATA}`, `${JSON.stringify(input.metadata, null, 2)}\n`)
      }
      for (const file of input.files ?? []) {
        assertValidName('layer name', file.layer)
        assertLayerAllowed(effectiveLayers(scope, descriptor), file.layer)
        if (!declared.includes(file.layer)) {
          throw new DatasetsError(
            `layer ${JSON.stringify(file.layer)} is not declared by dataset ${JSON.stringify(input.dataset)} (declared: ${declared.join(', ')})`,
            'LAYER_UNDECLARED',
          )
        }
        const rel = assertSafeRelativePath(file.path)
        await writeOne(`${itemDir(input.dataset, input.item)}/${file.layer}/${rel}`, file.content)
      }
      return { written }
    },

    async validate(scope, datasetId) {
      const { repo, sha } = await resolveCommitAt(scope, undefined)
      const ids = datasetId !== undefined ? [datasetId] : await listDatasetIds(repo, sha)
      const datasets: ValidateDatasetResult[] = []
      for (const id of ids) {
        const errors: ValidateError[] = []
        const warnings: DescriptorWarning[] = []
        const fail = (error: unknown): void => {
          errors.push(error instanceof DatasetsError
            ? { code: error.code, message: error.message }
            : { code: 'GIT_ERROR', message: String(error) })
        }
        let descriptor: DatasetDescriptor
        try {
          descriptor = await loadDescriptor(repo, sha, id)
        } catch (error) {
          fail(error)
          datasets.push({ id, errors, warnings })
          continue
        }
        warnings.push(...descriptorWarnings(descriptor))
        let registry: DatasetRegistry = { entries: new Map(), registerOnlyItems: [], claimed: new Set() }
        try {
          registry = await buildRegistry(repo, sha, id, descriptor)
        } catch (error) {
          fail(error)
        }
        // Field-name heuristic over every item's metadata (invalid item.json
        // joins the errors).
        const itemFiles = await listFiles(repo, sha, `${datasetDir(id)}/items`)
        const prefix = `${datasetDir(id)}/items/`
        const itemIds = new Set<string>(registry.registerOnlyItems)
        for (const file of itemFiles) {
          const rest = file.slice(prefix.length)
          const slash = rest.indexOf('/')
          if (slash > 0) itemIds.add(rest.slice(0, slash))
        }
        for (const itemId of [...itemIds].sort()) {
          let item: ItemRecord
          try {
            item = await loadItem(repo, sha, id, itemId, registry)
          } catch (error) {
            fail(error)
            continue
          }
          if (item.metadata !== undefined) warnings.push(...fieldNameWarnings(itemId, item.metadata))
          // Judgeability: an item carrying a rubric must carry one that can
          // actually be judged (leaves, their fields, their polarity) and a
          // source for each mechanical kind. Reads rubric content, so it
          // stays on this path only.
          try {
            const judgeable = await judgeabilityIssues(repo, sha, id, item, registry)
            errors.push(...judgeable.errors)
            warnings.push(...judgeable.warnings)
          } catch (error) {
            fail(error)
          }
        }
        // The canary, when the descriptor declares one: every text file of a
        // modelFacing layer must carry it (the leak-detection contract).
        try {
          warnings.push(...await canaryWarnings(repo, sha, id, descriptor, registry))
        } catch (error) {
          fail(error)
        }
        // Files covered by no layer directory and no register entry fall into
        // the always-visible passthrough zone — the author must see that.
        const passthrough = await computePassthrough(repo, sha, id, descriptor, registry)
        for (const file of passthrough) {
          warnings.push({
            code: 'UNREGISTERED_FILES',
            file,
            message: `${file} is covered by no layer directory or register entry; `
              + 'it sits in the passthrough zone, visible to every bound session '
              + '(a single-level glob never covers subdirectories — register those explicitly)',
          })
        }
        datasets.push({ id, errors, warnings })
      }
      return { datasets }
    },

    async overview(scope) {
      const { repo, sha } = await resolveCommitAt(scope, undefined)
      const ids = (await listDatasetIds(repo, sha))
        .filter(id => scope.operator === true || scope.datasets === undefined || scope.datasets.includes(id))
      const datasets = []
      for (const id of ids) {
        const summary = await summarizeDataset(repo, sha, id)
        datasets.push(await overviewRow(repo, sha, summary, async (datasetId) => {
          const result = await service.validate(scope, datasetId)
          const one = result.datasets.find(entry => entry.id === datasetId)
          return { errors: one?.errors ?? [], warnings: one?.warnings ?? [] }
        }))
      }
      return { repo, commit: sha, datasets }
    },

    async itemBrief(scope, datasetId, itemId, commit) {
      assertDatasetAllowed(scope, datasetId)
      assertValidName('item id', itemId)
      const { repo, sha } = await resolveCommitAt(scope, commit)
      // The rubric read names its ONE layer explicitly instead of riding the
      // operator bypass: the brief needs the answer key's shape, and the
      // narrowest scope that reaches it is the honest one to ask with.
      return await computeItemBrief(repo, sha, datasetId, itemId, async (layer, path) => {
        const result = await service.read(
          { repo: scope.repo, layers: [layer] },
          { dataset: datasetId, item: itemId, layer, path, commit: sha },
        )
        return result.content
      })
    },

    async scaffoldDataset(scope, input) {
      assertOperator(scope, 'creating a dataset')
      assertValidName('dataset id', input.id)
      const repo = await toplevelOf(scope.repo)
      const base = datasetDir(input.id)
      if (existsSync(join(repo, base, DATASET_DESCRIPTOR))) {
        throw new DatasetsError(
          `dataset ${JSON.stringify(input.id)} already exists in ${repo} (${base}/${DATASET_DESCRIPTOR})`,
          'SHAPE_INVALID',
        )
      }
      const written: string[] = []
      const skipped: string[] = []
      for (const file of planDatasetSkeleton(input.id, input.name)) {
        const rel = `${base}/${file.path}`
        if (await writeInRepo(repo, rel, file.content, true)) written.push(rel)
        else skipped.push(rel)
      }
      return { written, skipped, notes: [] }
    },

    async scaffoldItem(scope, input) {
      assertOperator(scope, 'drafting an item skeleton')
      assertDatasetAllowed(scope, input.dataset)
      assertValidName('item id', input.item)
      const repo = await toplevelOf(scope.repo)
      const descriptor = await readWorkingDescriptor(repo, input.dataset)
      const plan = planItemSkeleton(descriptor, input.item)
      const written: string[] = []
      const skipped: string[] = []
      for (const file of plan.files) {
        const rel = `${itemDir(input.dataset, input.item)}/${file.itemPath}`
        if (await writeInRepo(repo, rel, file.content, true)) written.push(rel)
        else skipped.push(rel)
      }
      return { written, skipped, notes: plan.notes }
    },

    async importItem(scope, input) {
      assertOperator(scope, 'importing an item')
      assertDatasetAllowed(scope, input.dataset)
      assertValidName('item id', input.item)
      const repo = await toplevelOf(scope.repo)
      await readWorkingDescriptor(repo, input.dataset) // the target must be a real dataset
      const source = resolve(input.sourceDir.trim())
      let sourceStat
      try {
        sourceStat = await stat(source)
      } catch (error) {
        throw new DatasetsError(`cannot read ${source}: ${String(error)}`, 'FILE_NOT_FOUND')
      }
      if (!sourceStat.isDirectory()) {
        throw new DatasetsError(`${source} is not a directory — point at an item directory to copy in`, 'INVALID_NAME')
      }
      const files = await collectImportFiles(source)
      const written: string[] = []
      const notes: string[] = [...files.notes]
      for (const rel of files.paths) {
        const bytes = await readFile(join(source, rel))
        if (bytes.byteLength > IMPORT_BYTE_LIMIT) {
          notes.push(`${rel} skipped: ${bytes.byteLength} bytes is over the ${IMPORT_BYTE_LIMIT}-byte per-file import limit`)
          continue
        }
        const target = `${itemDir(input.dataset, input.item)}/${rel}`
        await writeInRepo(repo, target, bytes)
        written.push(target)
      }
      return { written, skipped: [], notes }
    },

    async assertRepository(repo) {
      return await toplevelOf(repo)
    },

    async registration(id) {
      const entry = registered(id)
      return {
        id: entry.id, commonDir: entry.commonDir, trackedRef: entry.trackedRef,
        latest: await service.registry.latest(entry),
      }
    },

    async resolveRegistryCommit(id, ref) {
      const entry = registered(id)
      try {
        return await resolveCommit(entry.commonDir, ref)
      } catch {
        throw new DatasetsError(`${JSON.stringify(ref)} is not a commit of ${JSON.stringify(id)}`, 'GIT_ERROR')
      }
    },

    async registryObjectId(id, commit, path) {
      const entry = registered(id)
      const rel = path === '' ? '' : assertSafeRelativePath(path)
      try {
        return (await git(entry.commonDir, ['rev-parse', '--verify', '--quiet', `${commit}:${rel}`])).trim() || null
      } catch (error) {
        if (error instanceof GitError) return null
        throw error
      }
    },

    async registryListFiles(id, commit, prefix) {
      const entry = registered(id)
      return await listFiles(entry.commonDir, commit, prefix === '' ? '' : assertSafeRelativePath(prefix))
    },

    async registryShowFile(id, commit, path) {
      const entry = registered(id)
      const rel = assertSafeRelativePath(path)
      try {
        return await git(entry.commonDir, ['show', `${commit}:${rel}`], true)
      } catch (error) {
        if (error instanceof GitError && /does not exist|exists on disk, but not in|bad revision|Not a valid object name/i.test(error.stderr)) {
          return undefined
        }
        throw error
      }
    },

    async datasetView(id, set, commit) {
      const entry = registered(id)
      assertValidName('dataset id', set)
      const base = datasetDir(set)
      const files = await listFiles(entry.commonDir, commit, base)
      if (files.length === 0) {
        throw new DatasetsError(`${JSON.stringify(id)} has no set ${JSON.stringify(set)} at ${commit.slice(0, 7)}`, 'DATASET_NOT_FOUND')
      }
      // One pathspec per first-level child keeps the archive argument list
      // short whatever the set's size; together they are the whole set.
      const children = [...new Set(files.map(file => `${base}/${file.slice(base.length + 1).split('/')[0]}`))]
      const view = await materializePaths(entry.commonDir, commit, set, [], children, options.materializedRoot, FULL_VIEW_KEY)
      return { path: join(view.path, base), commit: view.commit }
    },
  }
  return service
}
