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
import type { DatasetBinding } from './binding.ts'
import {
  resolveScope, type DatasetScope, type DatasetsService,
  type ListDatasetsResult, type ListItemsResult, type ReadQuery, type ReadResult, type ShowResult,
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
   * The effective scope of one call: the session binding's whitelists plus the
   * configured default repo. No binding and no default fails loud inside the
   * service core (the tab renders the error and offers the bind form).
   */
  private scope(agent: Agent): DatasetScope {
    return resolveScope({}, this.datasets.binding(agent.session), this.defaultRepo)
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
   * Record a binding for the session (a human gesture from the tab).
   * @param agent - owning live agent.
   * @param binding - the new binding; absent fields mean "everything".
   * @returns the validated binding as recorded.
   */
  @Remote('bind')
  bind(agent: Agent, binding: DatasetBinding): DatasetBinding {
    return this.datasets.bind(agent.session, binding)
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
   * List the bound scope's datasets, or one dataset's items with their
   * metadata and whitelist-filtered layer files.
   * @param agent - owning live agent; its session binding resolves the scope.
   * @param dataset - when given, list this dataset's items instead of datasets.
   * @param commit - pinned commit (default: the repository HEAD).
   * @returns dataset summaries or one dataset's item records.
   */
  @Remote('list')
  async list(agent: Agent, dataset?: string, commit?: string): Promise<ListDatasetsResult | ListItemsResult> {
    return await this.datasets.list(this.scope(agent), dataset, commit)
  }

  /**
   * Show one item (or every item) of a dataset: summary, descriptor
   * passthrough, and the whitelist-filtered layer-file listing.
   * @param agent - owning live agent; its session binding resolves the scope.
   * @param dataset - the dataset id.
   * @param item - when given, show just this item.
   * @param commit - pinned commit (default: the repository HEAD).
   * @returns the dataset detail at the resolved commit.
   */
  @Remote('show')
  async show(agent: Agent, dataset: string, item?: string, commit?: string): Promise<ShowResult> {
    return await this.datasets.show(this.scope(agent), dataset, item, commit)
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
