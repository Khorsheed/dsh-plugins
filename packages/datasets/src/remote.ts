/**
 * The datasets Remote service: the web session tab's data face. A thin
 * adapter over the same `ctx.datasets` service core the model tools, the CLI,
 * and the slash command use — no logic is copied here. Every method takes the
 * calling `agent` as its first parameter (the gateway's lookup convention);
 * browsing verbs name a registry id in their request. The cordis service key
 * is `datasetsRemote` (`datasets` is the core service); the WIRE namespace is
 * `datasets`, so the browser calls `remote.datasets.*`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DatasetsError } from './dataset.ts'
import type {
  ImportBindingsResult, RegisterInput, RegisterPreview, RegistryEntry, RegistryRow, RepoSelector, UpdateInput,
} from './registry.ts'
import type { DatasetOverview, ItemBrief } from './brief.ts'
import type { SkeletonResult } from './scaffold.ts'
import {
  type DatasetScope, type DatasetsService,
  type ImportItemInput, type ItemBriefRequest,
  type ListDatasetsResult, type ListItemsResult, type ListRequest,
  type PreviewRepoRequest,
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
 * The web tab's dataset face: the deployment's registry (list, preview,
 * register, edit, remove, import the legacy bindings — all human gestures;
 * agent tools only ever READ the registry) plus browsing one registration.
 * Browsing verbs name the registration by its id (`request.repo`) and read the
 * tracked branch's latest commit; the skeleton/import writes land in the
 * registration's authoring checkout or are refused.
 */
export class DatasetsRemoteService extends TypertRemoteService<DatasetsRemoteConfig> {
  static inject = ['datasets']

  /**
   * @param ctx - owning Cordis Context carrying `datasets` (provided by the
   *   plugin's apply before this service mounts).
   * @param config - the plugin config's default repo, when one is set.
   */
  constructor(ctx: Context, config: DatasetsRemoteConfig = {}) {
    super(ctx, 'datasetsRemote', { namespace: 'datasets' })
    void config
  }

  private get datasets(): DatasetsService {
    return this.ctx.datasets
  }

  /** The registration a request names, or the not-registered refusal. */
  private entry(selector: RepoSelector): RegistryEntry {
    const entry = this.datasets.registry.get(selector.repo)
    if (entry === undefined) {
      throw new DatasetsError(`${JSON.stringify(selector.repo)} is not registered in this deployment`, 'NOT_REGISTERED')
    }
    return entry
  }

  /**
   * The OPERATOR read scope of one registration: its common dir at the
   * tracked branch's latest commit. The registration's layers constrain the
   * agent, never the human reading their own repository through the tab.
   */
  private async scope(selector: RepoSelector): Promise<DatasetScope> {
    const entry = this.entry(selector)
    const latest = await this.datasets.registry.latest(entry)
    return { repo: entry.commonDir, ref: latest.commit, operator: true }
  }

  /** The operator WRITE scope: the registration's authoring checkout, or a refusal. */
  private writeScope(selector: RepoSelector): DatasetScope {
    const entry = this.entry(selector)
    if (entry.authoringCheckout === null) {
      throw new DatasetsError(
        `${JSON.stringify(entry.id)} has no authoring checkout — name one in the registration before writing`,
        'NO_AUTHORING_CHECKOUT',
      )
    }
    return { repo: entry.authoringCheckout, operator: true }
  }

  /**
   * Every registration with its latest commit and sets — the tab's grouped list.
   * @param agent - owning live agent (lookup convention; the registry is per deployment).
   * @returns one row per registration.
   */
  @Remote('registry')
  async registry(agent: Agent): Promise<RegistryRow[]> {
    void agent
    return await this.datasets.registry.rows()
  }

  /**
   * The register form's live verdict on a candidate path: its identity, the
   * id it would get, the local branches, and the sets at the chosen branch.
   * A missing path and a non-repository fail loud with different codes.
   * @param agent - owning live agent (lookup convention).
   * @param request - the candidate path and an optional branch to preview.
   * @returns the verdict.
   */
  @Remote('previewRepo')
  async previewRepo(agent: Agent, request: PreviewRepoRequest): Promise<RegisterPreview> {
    void agent
    return await this.datasets.registry.preview(request.path, request.trackedRef)
  }

  /**
   * Register a repository (a human gesture from the tab).
   * @param agent - owning live agent (lookup convention).
   * @param input - path, id, tracked branch, per-set layers, authoring checkout.
   * @returns the new registration.
   */
  @Remote('register')
  async register(agent: Agent, input: RegisterInput): Promise<RegistryEntry> {
    void agent
    return await this.datasets.registry.register(input)
  }

  /**
   * Edit a registration's layers, tracked branch, or authoring checkout.
   * @param agent - owning live agent (lookup convention).
   * @param input - the id plus the fields to change.
   * @returns the edited registration.
   */
  @Remote('updateRegistration')
  async updateRegistration(agent: Agent, input: UpdateInput): Promise<RegistryEntry> {
    void agent
    return await this.datasets.registry.update(input)
  }

  /**
   * Remove a registration (the repository itself is untouched).
   * @param agent - owning live agent (lookup convention).
   * @param request - the registration id.
   * @returns whether one was removed.
   */
  @Remote('unregister')
  unregister(agent: Agent, request: { id: string }): boolean {
    void agent
    return this.datasets.registry.remove(request.id)
  }

  /**
   * 「从旧绑定登记」: fold the legacy per-session bindings into registrations,
   * one per repository; bindings whose path is gone come back as dangling.
   * The binding files themselves are never touched.
   * @param agent - owning live agent (lookup convention).
   * @returns what was imported and what was skipped.
   */
  @Remote('importBindings')
  async importBindings(agent: Agent): Promise<ImportBindingsResult> {
    void agent
    return await this.datasets.registry.importBindings(this.datasets.bindingsRoot)
  }

  /**
   * Read one dataset-relative file from the git object — the operator channel
   * into the passthrough zone (manifest/docs/item.json). Deliberately NOT a
   * model tool: agent access to dataset content stays layer-gated through the
   * datasets_* tools.
   * @param agent - owning live agent; `request.repo` names the registration.
   * @param request - dataset id, dataset-relative path, optional commit pin.
   * @returns the file content and the commit it was read from.
   */
  @Remote('readPassthrough')
  async readPassthrough(agent: Agent, request: ReadPassthroughRequest & RepoSelector): Promise<ReadResult> {
    void agent
    return await this.datasets.readPassthrough(await this.scope(request), request.dataset, request.path, request.commit)
  }

  /**
   * List the bound scope's datasets, or one dataset's items with their
   * metadata and whitelist-filtered layer files. The selectors ride in a
   * request object: the gateway's client proxy enforces exact positional
   * arity, so optional fields belong inside an object, never in the
   * positional tail.
   * @param agent - owning live agent; `request.repo` names the registration.
   * @param request - optional dataset selector and commit pin.
   * @returns dataset summaries or one dataset's item records.
   */
  @Remote('list')
  async list(agent: Agent, request: ListRequest & RepoSelector): Promise<ListDatasetsResult | ListItemsResult> {
    void agent
    return await this.datasets.list(await this.scope(request), request.dataset, request.commit)
  }

  /**
   * Show one item (or every item) of a dataset: summary, descriptor
   * passthrough, and the whitelist-filtered layer-file listing.
   * @param agent - owning live agent; `request.repo` names the registration.
   * @param request - the dataset id, an optional item selector, and a commit pin.
   * @returns the dataset detail at the resolved commit.
   */
  @Remote('show')
  async show(agent: Agent, request: ShowRequest & RepoSelector): Promise<ShowResult> {
    void agent
    return await this.datasets.show(await this.scope(request), request.dataset, request.item, request.commit)
  }

  /**
   * The 题集 tab's list page: the repository, the commit, and one row per
   * dataset — the slot ← layer mapping, whether a canary is declared, and the
   * `validate` outcome. One call rather than three per dataset: the
   * projection is the host's job (ui-spec §八), and a list page that fired an
   * RPC storm would answer in a different order every time.
   * @param agent - owning live agent; `request.repo` names the registration.
   * @returns the list page's rows.
   */
  @Remote('overview')
  async overview(agent: Agent, request: RepoSelector): Promise<DatasetOverview> {
    void agent
    return await this.datasets.overview(await this.scope(request))
  }

  /**
   * One item's «选手将看到» and «可判性» (ui-spec §四). The judging reads
   * behind it name their one layer explicitly — the page shows the answer
   * key's SHAPE (how many leaves, of which kind) and never its bytes.
   * @param agent - owning live agent; `request.repo` names the registration.
   * @param request - the dataset, the item, and an optional commit pin.
   * @returns the item's brief.
   */
  @Remote('itemBrief')
  async itemBrief(agent: Agent, request: ItemBriefRequest & RepoSelector): Promise<ItemBrief> {
    void agent
    return await this.datasets.itemBrief(await this.scope(request), request.dataset, request.item, request.commit)
  }

  /**
   * Validate one dataset, or every dataset of the bound repository — the
   * list page's cell and the item page's button. Author-facing, so it sees
   * everything (the same operator semantics the rest of this face carries).
   * @param agent - owning live agent; `request.repo` names the registration.
   * @param request - an optional dataset selector.
   * @returns the per-dataset errors and warnings.
   */
  @Remote('validate')
  async validate(agent: Agent, request: ValidateRequest & RepoSelector): Promise<ValidateResult> {
    void agent
    return await this.datasets.validate(await this.scope(request), request.dataset)
  }

  /**
   * «新建题集»: write a new dataset's skeleton into the WORKING TREE — the
   * descriptor with its three layers declared, one stage prompt, one stage
   * schema, the item container. The commit stays the human's; this plugin
   * never makes one.
   * @param agent - owning live agent; `request.repo` names the registration.
   * @param input - the new dataset's id and optional display name.
   * @returns what was written.
   */
  @Remote('scaffoldDataset')
  async scaffoldDataset(agent: Agent, input: ScaffoldDatasetInput & RepoSelector): Promise<SkeletonResult> {
    void agent
    const { repo, ...rest } = input
    return await this.datasets.scaffoldDataset(this.writeScope({ repo }), rest)
  }

  /**
   * «题目骨架»: write one item's placeholder files, homed by this dataset's
   * own layers and `register`. Existing files are left alone — a skeleton
   * never overwrites what an author already wrote.
   * @param agent - owning live agent; `request.repo` names the registration.
   * @param input - the dataset and the new item id.
   * @returns what was written, what was left alone, and what could not be planned.
   */
  @Remote('scaffoldItem')
  async scaffoldItem(agent: Agent, input: ScaffoldItemInput & RepoSelector): Promise<SkeletonResult> {
    void agent
    const { repo, ...rest } = input
    return await this.datasets.scaffoldItem(this.writeScope({ repo }), rest)
  }

  /**
   * «导入题目»: copy an existing item directory in verbatim. The dataset's
   * layers and `register` decide what each file becomes — the import re-homes
   * nothing, so `validate` reports honestly what landed outside every layer.
   * @param agent - owning live agent; `request.repo` names the registration.
   * @param input - the dataset, the new item id, and the source directory.
   * @returns what was written and one note per skipped entry class.
   */
  @Remote('importItem')
  async importItem(agent: Agent, input: ImportItemInput & RepoSelector): Promise<SkeletonResult> {
    void agent
    const { repo, ...rest } = input
    return await this.datasets.importItem(this.writeScope({ repo }), rest)
  }

  /**
   * Read one file of one item layer, straight from the git object at the
   * pinned commit — no copy materializes outside the repository. The layer
   * must survive the session binding's whitelist.
   * @param agent - owning live agent; `request.repo` names the registration.
   * @param query - dataset/item/layer/layer-relative path, plus an optional pin.
   * @returns the file content and the commit it was read from.
   */
  @Remote('read')
  async read(agent: Agent, query: ReadQuery & RepoSelector): Promise<ReadResult> {
    void agent
    const { repo, ...rest } = query
    return await this.datasets.read(await this.scope({ repo }), rest)
  }
}
