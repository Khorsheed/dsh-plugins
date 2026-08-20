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
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  readBinding, validateBinding, writeBinding, type BindingSession, type DatasetBinding,
} from './binding.ts'
import {
  assertSafeRelativePath, assertValidName, datasetDir, DatasetsError, itemDir, ITEM_METADATA,
  listDatasetIds, listDatasetLayers, listItems, loadDescriptor, loadItem, summarizeDataset,
  validateDescriptor, type DatasetSummary, type ItemRecord, type JsonObject,
} from './dataset.ts'
import { repoToplevel, resolveCommit, showFile } from './git.ts'
import { ensureWorktree, type ManagedWorktree } from './worktree.ts'

/**
 * The effective visibility scope of one call: the resolved repository plus
 * the binding's whitelists. Tools build it from explicit arguments or the
 * session binding; the CLI from flags; slash from the session binding.
 */
export interface DatasetScope {
  /** Repository path (as given; resolved per call). */
  repo: string
  /** Dataset-id whitelist from the binding; absent = all. */
  datasets?: readonly string[]
  /** Layer whitelist from the binding; absent = all. Enforced everywhere. */
  layers?: readonly string[]
}

/** Explicit-selector input shared by the tool/CLI/slash adapters. */
export interface ScopeSelectors {
  repo?: string
}

/**
 * Resolve the effective scope: an explicit `repo` wins, then the session
 * binding, then the plugin config's default repo. The binding's whitelists
 * apply whenever a binding exists — including alongside an explicit repo
 * (the binding human owns what the session's agent may see). No repo source
 * at all fails loud instead of guessing.
 * @param selectors - explicit per-call selectors.
 * @param binding - the session binding, when one exists.
 * @param defaultRepo - the plugin config's default repo ('' / undefined = none).
 * @returns the effective scope.
 */
export function resolveScope(
  selectors: ScopeSelectors,
  binding: DatasetBinding | undefined,
  defaultRepo: string | undefined,
): DatasetScope {
  const explicit = selectors.repo?.trim()
  const repo = explicit !== undefined && explicit !== ''
    ? explicit
    : binding?.repoPath ?? (defaultRepo !== undefined && defaultRepo !== '' ? defaultRepo : undefined)
  if (repo === undefined) {
    throw new DatasetsError(
      'no dataset repository: pass `repo` explicitly, or bind one first (/datasets bind or `dsh-datasets bind`)',
      'NO_REPO',
    )
  }
  return {
    repo,
    ...(binding?.datasets !== undefined ? { datasets: binding.datasets } : {}),
    ...(binding?.layers !== undefined ? { layers: binding.layers } : {}),
  }
}

/** `datasets_list` result with a dataset selector: one dataset's items. */
export interface ListItemsResult {
  kind: 'items'
  dataset: DatasetSummary
  /** Dataset-level (shared) layer content, layer name → layer-relative paths, whitelist-filtered. */
  datasetLayers: Record<string, string[]>
  items: ItemRecord[]
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

/** `datasets_worktree_path` options. */
export interface WorktreeOptions {
  commit?: string
  layers?: readonly string[]
}

/** The public service face (`ctx.datasets`). */
export interface DatasetsService {
  list(scope: DatasetScope, datasetId?: string, commit?: string): Promise<ListDatasetsResult | ListItemsResult>
  show(scope: DatasetScope, datasetId: string, itemId?: string, commit?: string): Promise<ShowResult>
  describe(scope: DatasetScope, datasetId: string, commit?: string): Promise<JsonObject>
  read(scope: DatasetScope, query: ReadQuery): Promise<ReadResult>
  snapshot(scope: DatasetScope, datasetId: string, commit?: string): Promise<DatasetSnapshot>
  worktreePath(scope: DatasetScope, datasetId: string, options?: WorktreeOptions): Promise<ManagedWorktree>
  putItem(scope: DatasetScope, input: PutItemInput): Promise<PutItemResult>
  /** Record a binding for a live session (slash/tab path). */
  bind(session: BindingSession, binding: DatasetBinding): DatasetBinding
  /** Clear a live session's binding. */
  unbind(session: BindingSession): void
  /** Fold a session's current binding. */
  binding(session: BindingSession): DatasetBinding | undefined
}

/** Service construction options (roots already resolved by the caller). */
export interface DatasetsServiceOptions {
  /** Managed worktree root. */
  worktreeRoot: string
  /** Binding store root (`<stateRoot>/bindings`). */
  bindingsRoot: string
}

/** Wrap a git failure as a domain error where the cause is clear. */
async function toplevelOf(repo: string): Promise<string> {
  try {
    return await repoToplevel(repo)
  } catch (error) {
    throw new DatasetsError(`${repo} is not a git repository: ${String(error)}`, 'NOT_A_REPO')
  }
}

function assertDatasetAllowed(scope: DatasetScope, datasetId: string): void {
  assertValidName('dataset id', datasetId)
  if (scope.datasets !== undefined && !scope.datasets.includes(datasetId)) {
    throw new DatasetsError(
      `dataset ${JSON.stringify(datasetId)} is outside this session's bound datasets [${scope.datasets.join(', ')}]`,
      'DATASET_NOT_FOUND',
    )
  }
}

/** Throw when a single layer is outside the scope whitelist. */
function assertLayerAllowed(scope: DatasetScope, layer: string): void {
  if (scope.layers !== undefined && !scope.layers.includes(layer)) {
    throw new DatasetsError(
      `layer ${JSON.stringify(layer)} is outside this session's layers whitelist [${scope.layers.join(', ')}]`,
      'LAYER_NOT_ALLOWED',
    )
  }
}

/** Filter one item's layer map to the scope whitelist. */
function filterItemLayers(scope: DatasetScope, item: ItemRecord): ItemRecord {
  const whitelist = scope.layers
  if (whitelist === undefined) return item
  const layers: Record<string, string[]> = {}
  for (const [layer, files] of Object.entries(item.layers)) {
    if (whitelist.includes(layer)) layers[layer] = files
  }
  return { ...item, layers }
}

/** Filter a layer → files map (dataset-level shared content) to the scope whitelist. */
function filterLayerMap(scope: DatasetScope, map: Record<string, string[]>): Record<string, string[]> {
  const whitelist = scope.layers
  if (whitelist === undefined) return map
  const filtered: Record<string, string[]> = {}
  for (const [layer, files] of Object.entries(map)) {
    if (whitelist.includes(layer)) filtered[layer] = files
  }
  return filtered
}

/** Filter a summary's declared layer lists to the scope whitelist. */
function filterSummaryLayers(scope: DatasetScope, summary: DatasetSummary): DatasetSummary {
  const whitelist = scope.layers
  if (whitelist === undefined) return summary
  return {
    ...summary,
    layers: summary.layers.filter(layer => whitelist.includes(layer)),
    nonModelFacingLayers: summary.nonModelFacingLayers.filter(layer => whitelist.includes(layer)),
  }
}

/**
 * Create the datasets service.
 * @param options - resolved construction options.
 * @returns the service instance.
 */
export function createDatasetsService(options: DatasetsServiceOptions): DatasetsService {
  const resolveCommitAt = async (scope: DatasetScope, commit?: string): Promise<{ repo: string; sha: string }> => {
    const repo = await toplevelOf(scope.repo)
    let sha: string
    try {
      sha = await resolveCommit(repo, commit ?? 'HEAD')
    } catch (error) {
      throw new DatasetsError(`cannot resolve ${commit ?? 'HEAD'} in ${repo}: ${String(error)}`, 'GIT_ERROR')
    }
    return { repo, sha }
  }

  return {
    async list(scope, datasetId, commit) {
      const { repo, sha } = await resolveCommitAt(scope, commit)
      if (datasetId !== undefined) {
        assertDatasetAllowed(scope, datasetId)
        const descriptor = await loadDescriptor(repo, sha, datasetId)
        const summary = filterSummaryLayers(scope, await summarizeDataset(repo, sha, datasetId))
        const shared = await listDatasetLayers(repo, sha, datasetId, descriptor.layers.map(layer => layer.name))
        const items = (await listItems(repo, sha, datasetId)).map(item => filterItemLayers(scope, item))
        return { kind: 'items', dataset: summary, datasetLayers: filterLayerMap(scope, shared), items }
      }
      const ids = (await listDatasetIds(repo, sha))
        .filter(id => scope.datasets === undefined || scope.datasets.includes(id))
      const datasets: DatasetSummary[] = []
      for (const id of ids) datasets.push(filterSummaryLayers(scope, await summarizeDataset(repo, sha, id)))
      return { kind: 'datasets', datasets }
    },

    async show(scope, datasetId, itemId, commit) {
      assertDatasetAllowed(scope, datasetId)
      const { repo, sha } = await resolveCommitAt(scope, commit)
      const descriptor = await loadDescriptor(repo, sha, datasetId)
      const summary = filterSummaryLayers(scope, await summarizeDataset(repo, sha, datasetId))
      const shared = await listDatasetLayers(repo, sha, datasetId, descriptor.layers.map(layer => layer.name))
      const items = itemId !== undefined
        ? [await loadItem(repo, sha, datasetId, itemId)]
        : await listItems(repo, sha, datasetId)
      return {
        dataset: summary,
        descriptor: descriptor.raw,
        datasetLayers: filterLayerMap(scope, shared),
        items: items.map(item => filterItemLayers(scope, item)),
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
      assertLayerAllowed(scope, query.layer)
      const rel = assertSafeRelativePath(query.path)
      const { repo, sha } = await resolveCommitAt(scope, query.commit)
      // Item omitted: the layer directory at the DATASET level (shared
      // content). That path can address ANY top-level directory, so the
      // dataset level additionally requires the layer to be DECLARED —
      // undeclared top-level directories are descriptor passthrough and stay
      // unreachable here exactly as before.
      if (query.item === undefined) {
        const descriptor = await loadDescriptor(repo, sha, query.dataset)
        if (!descriptor.layers.some(layer => layer.name === query.layer)) {
          throw new DatasetsError(
            `layer ${JSON.stringify(query.layer)} is not declared by dataset ${JSON.stringify(query.dataset)}`,
            'LAYER_UNDECLARED',
          )
        }
      }
      const objectPath = query.item === undefined
        ? `${datasetDir(query.dataset)}/${query.layer}/${rel}`
        : `${itemDir(query.dataset, query.item)}/${query.layer}/${rel}`
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
      const requested = worktreeOptions?.layers ?? declared
      for (const layer of requested) {
        if (!declared.includes(layer)) {
          throw new DatasetsError(
            `layer ${JSON.stringify(layer)} is not declared by dataset ${JSON.stringify(datasetId)} (declared: ${declared.join(', ')})`,
            'LAYER_UNDECLARED',
          )
        }
      }
      const effective = scope.layers === undefined
        ? requested
        : requested.filter(layer => scope.layers?.includes(layer))
      if (effective.length === 0) {
        throw new DatasetsError(
          `no requested layer survives this session's layers whitelist [${(scope.layers ?? []).join(', ')}]`,
          'LAYER_NOT_ALLOWED',
        )
      }
      return await ensureWorktree(repo, sha, datasetId, effective, options.worktreeRoot)
    },

    async putItem(scope, input) {
      assertDatasetAllowed(scope, input.dataset)
      assertValidName('item id', input.item)
      const repo = await toplevelOf(scope.repo)
      const dir = join(repo, datasetDir(input.dataset))
      const descriptorPath = join(dir, 'dataset.json')
      if (!existsSync(descriptorPath)) {
        throw new DatasetsError(`dataset ${JSON.stringify(input.dataset)} not found in the working tree of ${repo}`, 'DATASET_NOT_FOUND')
      }
      let descriptor
      try {
        descriptor = validateDescriptor(JSON.parse(await readFile(descriptorPath, 'utf8')), descriptorPath)
      } catch (error) {
        if (error instanceof DatasetsError) throw error
        throw new DatasetsError(`${descriptorPath}: invalid JSON — ${String(error)}`, 'SHAPE_INVALID')
      }
      const declared = descriptor.layers.map(layer => layer.name)
      const written: string[] = []
      const writeOne = async (rel: string, content: string): Promise<void> => {
        const target = resolve(repo, rel)
        if (target !== repo && !target.startsWith(`${repo}${sep}`)) {
          throw new DatasetsError(`refusing to write outside the repository: ${rel}`, 'INVALID_NAME')
        }
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content, 'utf8')
        written.push(rel)
      }
      if (input.metadata !== undefined) {
        await writeOne(`${itemDir(input.dataset, input.item)}/${ITEM_METADATA}`, `${JSON.stringify(input.metadata, null, 2)}\n`)
      }
      for (const file of input.files ?? []) {
        assertValidName('layer name', file.layer)
        assertLayerAllowed(scope, file.layer)
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

    bind(session, binding) {
      const validated = validateBinding(binding)
      writeBinding(options.bindingsRoot, session.id, validated)
      return validated
    },

    unbind(session) {
      writeBinding(options.bindingsRoot, session.id, null)
    },

    binding(session) {
      return readBinding(options.bindingsRoot, session.id)
    },
  }
}
