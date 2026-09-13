/**
 * The canvas Remote service: the pad's data face on the wire, mounted under
 * the `canvas` namespace. A thin adapter over the same `ctx.canvasStore`
 * service core — no logic is copied, and the browser half builds no path of
 * its own (every call takes the workspace root plus a pad-relative name, and
 * every receipt carries the resolved absolute and workspace-relative
 * spellings back).
 *
 * The MUTATING methods take the calling `agent` first (the wire's lookup
 * convention): the pad writes are fenced by the caller's own file policy and
 * workspace, which only the session knows. Reads take no agent — a fence is a
 * write fence, so a pad stays browsable for a session that is only being read.
 *
 * @module @khorsheed/dsh-canvas
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CanvasService } from './service.ts'
import type {
  CanvasArchiveRequest, CanvasArchiveResult, CanvasCreateRequest,
  CanvasListRequest, CanvasListResult, CanvasReadOutcome, CanvasReadRequest,
  CanvasWriteRequest, CanvasWriteResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The inspiration pad's Remote face. */
    canvasRemote: CanvasRemoteService
  }
}

/** Remote construction options (reserved for future config-driven knobs). */
export interface CanvasRemoteConfig {}

/**
 * The pad's wire namespace: the browser calls `remote.canvas.*`.
 */
export class CanvasRemoteService extends TypertRemoteService<CanvasRemoteConfig> {
  static inject = ['canvasStore']

  /**
   * @param ctx - host context carrying the pad service core.
   * @param _config - reserved.
   */
  constructor(ctx: Context, _config: CanvasRemoteConfig = {}) {
    super(ctx, 'canvasRemote', { namespace: 'canvas' })
  }

  private get store(): CanvasService {
    return this.ctx.canvasStore
  }

  /** List one workspace's pad: active items plus the archive set. */
  @Remote('list')
  list(request: CanvasListRequest): Promise<CanvasListResult> {
    return this.store.list(request.dir)
  }

  /** Read one item's text with the freshness token a later write must present. */
  @Remote('read')
  read(request: CanvasReadRequest): Promise<CanvasReadOutcome> {
    return this.store.read(request)
  }

  /**
   * Create one item; an existing title is refused rather than overwritten.
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - workspace root, kind, title, and initial body.
   * @returns the new item's receipt, or the failure code.
   */
  @Remote('create')
  create(agent: Agent, request: CanvasCreateRequest): Promise<CanvasWriteResult> {
    return this.store.create(request, agent.session)
  }

  /**
   * Overwrite one item under the version guard from the last read.
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - workspace root, name, body, and the version last read.
   * @returns the write receipt, or the failure code.
   */
  @Remote('write')
  write(agent: Agent, request: CanvasWriteRequest): Promise<CanvasWriteResult> {
    return this.store.write(request, agent.session)
  }

  /**
   * Hide one item from the list, or restore it — the file is never touched.
   * @param agent - the calling session's agent; its session fences the index write.
   * @param request - workspace root, name, and the target archived state.
   * @returns the receipt, or the failure code.
   */
  @Remote('setArchived')
  setArchived(agent: Agent, request: CanvasArchiveRequest): Promise<CanvasArchiveResult> {
    return this.store.setArchived(request, agent.session)
  }
}

export default CanvasRemoteService
