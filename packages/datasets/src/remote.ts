/**
 * The datasets Remote service: the web session tab's data face. A thin
 * adapter over the same `ctx.datasets` service core the model tools, the CLI,
 * and the slash command use — no logic is copied here. Every method takes the
 * calling `agent` as its first parameter, resolves the session binding from
 * it, and lets the service core enforce the binding's layer whitelist, so the
 * Remote path is exactly as strong as the tool path. The cordis service key
 * is `datasetsRemote` (`datasets` is the core service); the WIRE namespace is
 * `datasets`, so the browser calls `remote.datasets.*`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { validateBinding, type DatasetBinding } from './binding.ts'
import { normalizeRepoPath } from './repo-path.ts'
import type { DatasetOverview, ItemBrief } from './brief.ts'
import type { SkeletonResult } from './scaffold.ts'
import {
  resolveScope, type DatasetScope, type DatasetsService,
  type ImportItemInput, type ItemBriefRequest,
  type ListDatasetsResult, type ListItemsResult, type ListRequest,
  type PreviewRepoRequest, type PreviewRepoResult,
  type ReadPassthroughRequest, type ReadQuery, type ReadResult,
  type ScaffoldDatasetInput, type ScaffoldItemInput,
  type ShowRequest, type ShowResult, type ValidateRequest, type ValidateResult,
} from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    datasetsRemote: DatasetsRemoteService
  }
}

/** Remote construction options (mirrors the plugin config's resolution inputs). */
export interface DatasetsRemoteConfig {
  /** The plugin config's default repo — the last resort of scope resolution. */
  defaultRepo?: string
}

/**
 * Session-scoped dataset browsing for web surfaces. `binding`/`bind`/`unbind`
 * read and write the session binding (writes stay human operations — the tab
 * buttons call these; agent tools never do); `list`/`show`/`read` serve the
 * tree and the preview, whitelist-enforced by the service core.
 */
export class DatasetsRemoteService extends TypertRemoteService<DatasetsRemoteConfig> {
  static inject = ['datasets']

  private readonly defaultRepo: string

  /**
   * @param ctx - owning Cordis Context carrying `datasets` (provided by the
   *   plugin's apply before this service mounts).
   * @param config - the plugin config's default repo, when one is set.
   */
  constructor(ctx: Context, config: DatasetsRemoteConfig = {}) {
    super(ctx, 'datasetsRemote', { namespace: 'datasets' })
    this.defaultRepo = config.defaultRepo ?? ''
  }

  private get datasets(): DatasetsService {
    return this.ctx.datasets
  }

  /**
   * The effective scope of one call: the OPERATOR view. The binding supplies
   * the repository path only — the layer/dataset whitelists constrain the
   * agent (tools + worktree materialization), never the human reading their
   * own repository through the tab. No binding and no default fails loud
   * inside the service core (the tab renders the error and offers the bind
   * form).
   */
  private scope(agent: Agent): DatasetScope {
    const binding = this.datasets.binding(agent.session)
    const base = resolveScope({}, binding === undefined ? undefined : { repoPath: binding.repoPath }, this.defaultRepo)
    return { repo: base.repo, operator: true }
  }

  /**
   * Read the session's current binding (null when unbound).
   * @param agent - owning live agent; its session log holds the binding.
   * @returns the binding in effect.
   */
  @Remote('binding')
  binding(agent: Agent): DatasetBinding | null {
    return this.datasets.binding(agent.session) ?? null
  }

  /**
   * Record a binding for the session (a human gesture from the tab). Fails
   * loud BEFORE recording when the path is not a git repository, so the form
   * surfaces a readable error instead of discovering it on the next list.
   * @param agent - owning live agent.
   * @param binding - the new binding; absent fields mean "everything".
   * @returns the validated binding as recorded.
   */
  @Remote('bind')
  async bind(agent: Agent, binding: DatasetBinding): Promise<DatasetBinding> {
    const validated = validateBinding(binding)
    await this.datasets.assertRepository(validated.repoPath)
    return this.datasets.bind(agent.session, validated)
  }

  /**
   * Clear the session's binding.
   * @param agent - owning live agent.
   * @returns the binding now in effect (always null).
   */
  @Remote('unbind')
  unbind(agent: Agent): DatasetBinding | null {
    this.datasets.unbind(agent.session)
    return null
  }

  /**
   * Preview a candidate repository BEFORE binding: the canonical path plus
   * its dataset summaries (declared layers, visibility classes, warnings).
   * Deliberately ignores the session binding — the binder is choosing the
   * whitelist, so the preview must show everything. A non-repository path
   * fails loud (NOT_A_REPO); a repository with no datasets/ answers an
   * empty list.
   * @param agent - owning live agent (lookup convention; the session binding is not consulted).
   * @param request - the candidate path (`~`/whitespace/trailing-slash normalized).
   * @returns the canonical repo path and its dataset summaries.
   */
  @Remote('previewRepo')
  async previewRepo(agent: Agent, request: PreviewRepoRequest): Promise<PreviewRepoResult> {
    void agent
    // The binder sees the canonical toplevel (a `~`, a trailing slash, or a
    // nested path binds what was previewed).
    const repo = await this.datasets.assertRepository(normalizeRepoPath(request.path))
    const result = await this.datasets.list({ repo, operator: true })
    if (result.kind !== 'datasets') throw new Error('previewRepo: list without a dataset selector must list datasets')
    return { repo, datasets: result.datasets }
  }

  /**
   * Read one dataset-relative file from the git object — the operator channel
   * into the passthrough zone (manifest/docs/item.json). Deliberately NOT a
   * model tool: agent access to dataset content stays layer-gated through the
   * datasets_* tools.
   * @param agent - owning live agent; its session binding resolves the repo.
   * @param request - dataset id, dataset-relative path, optional commit pin.
   * @returns the file content and the commit it was read from.
   */
  @Remote('readPassthrough')
  async readPassthrough(agent: Agent, request: ReadPassthroughRequest): Promise<ReadResult> {
    return await this.datasets.readPassthrough(this.scope(agent), request.dataset, request.path, request.commit)
  }

  /**
   * List the bound scope's datasets, or one dataset's items with their
   * metadata and whitelist-filtered layer files. The selectors ride in a
   * request object: the gateway's client proxy enforces exact positional
   * arity, so optional fields belong inside an object, never in the
   * positional tail.
   * @param agent - owning live agent; its session binding resolves the scope.
   * @param request - optional dataset selector and commit pin.
   * @returns dataset summaries or one dataset's item records.
   */
  @Remote('list')
  async list(agent: Agent, request: ListRequest): Promise<ListDatasetsResult | ListItemsResult> {
    return await this.datasets.list(this.scope(agent), request.dataset, request.commit)
  }

  /**
   * Show one item (or every item) of a dataset: summary, descriptor
   * passthrough, and the whitelist-filtered layer-file listing.
   * @param agent - owning live agent; its session binding resolves the scope.
   * @param request - the dataset id, an optional item selector, and a commit pin.
   * @returns the dataset detail at the resolved commit.
   */
  @Remote('show')
  async show(agent: Agent, request: ShowRequest): Promise<ShowResult> {
    return await this.datasets.show(this.scope(agent), request.dataset, request.item, request.commit)
  }

  /**
   * The 题集 tab's list page: the repository, the commit, and one row per
   * dataset — the slot ← layer mapping, whether a canary is declared, and the
   * `validate` outcome. One call rather than three per dataset: the
   * projection is the host's job (ui-spec §八), and a list page that fired an
   * RPC storm would answer in a different order every time.
   * @param agent - owning live agent; its session binding resolves the repo.
   * @returns the list page's rows.
   */
  @Remote('overview')
  async overview(agent: Agent): Promise<DatasetOverview> {
    return await this.datasets.overview(this.scope(agent))
  }

  /**
   * One item's «选手将看到» and «可判性» (ui-spec §四). The judging reads
   * behind it name their one layer explicitly — the page shows the answer
   * key's SHAPE (how many leaves, of which kind) and never its bytes.
   * @param agent - owning live agent; its session binding resolves the repo.
   * @param request - the dataset, the item, and an optional commit pin.
   * @returns the item's brief.
   */
  @Remote('itemBrief')
  async itemBrief(agent: Agent, request: ItemBriefRequest): Promise<ItemBrief> {
    return await this.datasets.itemBrief(this.scope(agent), request.dataset, request.item, request.commit)
  }

  /**
   * Validate one dataset, or every dataset of the bound repository — the
   * list page's cell and the item page's button. Author-facing, so it sees
   * everything (the same operator semantics the rest of this face carries).
   * @param agent - owning live agent; its session binding resolves the repo.
   * @param request - an optional dataset selector.
   * @returns the per-dataset errors and warnings.
   */
  @Remote('validate')
  async validate(agent: Agent, request: ValidateRequest): Promise<ValidateResult> {
    return await this.datasets.validate(this.scope(agent), request.dataset)
  }

  /**
   * «新建题集»: write a new dataset's skeleton into the WORKING TREE — the
   * descriptor with its three layers declared, one stage prompt, one stage
   * schema, the item container. The commit stays the human's; this plugin
   * never makes one.
   * @param agent - owning live agent; its session binding resolves the repo.
   * @param input - the new dataset's id and optional display name.
   * @returns what was written.
   */
  @Remote('scaffoldDataset')
  async scaffoldDataset(agent: Agent, input: ScaffoldDatasetInput): Promise<SkeletonResult> {
    return await this.datasets.scaffoldDataset(this.scope(agent), input)
  }

  /**
   * «题目骨架»: write one item's placeholder files, homed by this dataset's
   * own layers and `register`. Existing files are left alone — a skeleton
   * never overwrites what an author already wrote.
   * @param agent - owning live agent; its session binding resolves the repo.
   * @param input - the dataset and the new item id.
   * @returns what was written, what was left alone, and what could not be planned.
   */
  @Remote('scaffoldItem')
  async scaffoldItem(agent: Agent, input: ScaffoldItemInput): Promise<SkeletonResult> {
    return await this.datasets.scaffoldItem(this.scope(agent), input)
  }

  /**
   * «导入题目»: copy an existing item directory in verbatim. The dataset's
   * layers and `register` decide what each file becomes — the import re-homes
   * nothing, so `validate` reports honestly what landed outside every layer.
   * @param agent - owning live agent; its session binding resolves the repo.
   * @param input - the dataset, the new item id, and the source directory.
   * @returns what was written and one note per skipped entry class.
   */
  @Remote('importItem')
  async importItem(agent: Agent, input: ImportItemInput): Promise<SkeletonResult> {
    return await this.datasets.importItem(this.scope(agent), input)
  }

  /**
   * Read one file of one item layer, straight from the git object at the
   * pinned commit — no copy materializes outside the repository. The layer
   * must survive the session binding's whitelist.
   * @param agent - owning live agent; its session binding resolves the scope.
   * @param query - dataset/item/layer/layer-relative path, plus an optional pin.
   * @returns the file content and the commit it was read from.
   */
  @Remote('read')
  async read(agent: Agent, query: ReadQuery): Promise<ReadResult> {
    return await this.datasets.read(this.scope(agent), query)
  }
}
