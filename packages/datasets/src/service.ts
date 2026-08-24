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
  assertSafeRelativePath, assertValidName, buildRegistry, computePassthrough, datasetDir, DatasetsError,
  descriptorWarnings, fieldNameWarnings, itemDir, ITEM_METADATA,
  listDatasetIds, listDatasetLayers, listItems, loadDescriptor, loadItem, registeredFiles, summarizeDataset,
  validateDescriptor, type DatasetDescriptor, type DatasetRegistry, type DatasetSummary, type DescriptorWarning,
  type ItemRecord, type JsonObject,
} from './dataset.ts'
import { listFiles, repoToplevel, resolveCommit, showFile } from './git.ts'
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
  /** Layer whitelist from the binding; absent = the modelFacing floor (see effectiveLayers). */
  layers?: readonly string[]
  /**
   * The human/operator view (the web tab, CLI read verbs): bypasses BOTH the
   * binding whitelists and the modelFacing default floor. The whitelist
   * constrains the agent (tools + worktree materialization), never the human
   * looking at their own machine.
   */
  operator?: true
}

/**
 * The effective layer ceiling of one call against one dataset:
 * - operator scope: unfiltered (undefined);
 * - an explicit binding whitelist: exactly it (sensitive layers listed on
 *   purpose are deliberately included);
 * - no whitelist: the modelFacing floor — when the dataset declares any
 *   sensitive layer, only its modelFacing:true layers; when it declares none,
 *   behavior is unchanged (undefined = unfiltered, undeclared item-level
 *   directories included).
 */
export function effectiveLayers(scope: DatasetScope, descriptor: DatasetDescriptor): readonly string[] | undefined {
  if (scope.operator === true) return undefined
  if (scope.layers !== undefined) return scope.layers
  if (!descriptor.layers.some(layer => !layer.modelFacing)) return undefined
  return descriptor.layers.filter(layer => layer.modelFacing).map(layer => layer.name)
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

/** `datasets/previewRepo` request: one candidate repository path (normalized host-side). */
export interface PreviewRepoRequest {
  path: string
}

/**
 * `datasets/previewRepo` result: the canonical repository path plus its
 * dataset summaries (with declared layers, visibility classes, and warnings).
 * A non-repository path fails loud (NOT_A_REPO); a valid repository with no
 * `datasets/` content answers an empty list — the bind form tells those apart.
 * The preview ignores any session binding: the binder is choosing the
 * whitelist, so it must see everything.
 */
export interface PreviewRepoResult {
  /** The resolved repository toplevel (what a bind should record). */
  repo: string
  datasets: DatasetSummary[]
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
  /** Fail loud unless `repo` is inside a git work tree; resolves to the canonical toplevel. */
  assertRepository(repo: string): Promise<string>
  /**
   * Validate one dataset (or all) of a repository: shape errors fail loud per
   * dataset, warnings never block. Author-facing — sees everything
   * (operator semantics), including the passthrough zone it reports on.
   */
  validate(scope: DatasetScope, datasetId?: string): Promise<ValidateResult>
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
      // Registered paths of the effective layers join the sparse pattern set.
      const registry = await buildRegistry(repo, sha, datasetId, descriptor)
      const registerPatterns = descriptor.register
        .filter(entry => effective.includes(entry.layer))
        .flatMap(entry => {
          const bucket = registeredFiles(registry, entry.item, entry.layer) ?? []
          return bucket.map(file => `/${file.object}`)
        })
      return await ensureWorktree(repo, sha, datasetId, effective, options.worktreeRoot, registerPatterns)
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
        let registry: DatasetRegistry = { entries: new Map(), registerOnlyItems: [] }
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

    async assertRepository(repo) {
      return await toplevelOf(repo)
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
