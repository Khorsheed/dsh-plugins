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
import type { CanvasBoardService } from './store.ts'
import type {
  BoardAddCommentRequest, BoardArchiveRequest, BoardAskAgentOutcome, BoardAskAgentRequest,
  BoardAttachImageOutcome, BoardAttachImageRequest,
  BoardChatStatusResult, BoardCreateRequest, BoardFocusRequest, BoardFocusResult,
  BoardImageBytesOutcome, BoardImageBytesRequest,
  BoardListResult, BoardMutationResult, BoardPatchCardRequest,
  BoardPutCardRequest, BoardReadDraftOutcome, BoardReadDraftRequest, BoardReadOutcome,
  BoardReadRequest, BoardWriteDraftRequest, BoardWriteDraftResult,
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
  static inject = ['canvasStore', 'canvasBoard']

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

  private get board(): CanvasBoardService {
    return this.ctx.canvasBoard
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

  /* ------------------------------------------------------ the canvas space (v2, M1) */

  /** List every canvas the deployment holds (archived included; the client groups). */
  @Remote('listCanvases')
  listCanvases(): Promise<BoardListResult> {
    return this.board.listCanvases()
  }

  /**
   * Create one canvas (a topic, optionally with workspaces attached).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - topic title and optional attached workspace paths.
   * @returns the new board and its first freshness token, or the failure code.
   */
  @Remote('createCanvas')
  createCanvas(agent: Agent, request: BoardCreateRequest): Promise<BoardMutationResult> {
    return this.board.createCanvas(request, agent.session)
  }

  /** Read one board with the freshness token a later mutation must present. */
  @Remote('readBoard')
  readBoard(request: BoardReadRequest): Promise<BoardReadOutcome> {
    return this.board.readBoard(request)
  }

  /**
   * Add one user card (createdBy user, straight to kept).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id, kind, text, and optional source.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('putCard')
  putCard(agent: Agent, request: BoardPutCardRequest): Promise<BoardMutationResult> {
    return this.board.putCard(request, agent.session)
  }

  /**
   * Edit one card: text, a status transition, or a question-state transition.
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id, card id, and the fields to change.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('patchCard')
  patchCard(agent: Agent, request: BoardPatchCardRequest): Promise<BoardMutationResult> {
    return this.board.patchCard(request, agent.session)
  }

  /**
   * Comment on one card.
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id, card id, text, and the author (default user).
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('addComment')
  addComment(agent: Agent, request: BoardAddCommentRequest): Promise<BoardMutationResult> {
    return this.board.addComment(request, agent.session)
  }

  /**
   * Archive a canvas from the space list, or restore it (never a delete).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id and the target archived state.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('archiveCanvas')
  archiveCanvas(agent: Agent, request: BoardArchiveRequest): Promise<BoardMutationResult> {
    return this.board.archiveCanvas(request, agent.session)
  }

  /**
   * Ask the canvas's agent through the side-chat seam (prime the context, and
   * send when there is a text to send).
   * @param agent - the calling session's agent; its session primes the context.
   * @param request - canvas id, optional lens, selected card ids, free text, extra refs.
   * @returns the contextKey and whether a message was sent, or the failure code.
   */
  @Remote('askAgent')
  askAgent(agent: Agent, request: BoardAskAgentRequest): Promise<BoardAskAgentOutcome> {
    return this.board.askAgent(request, agent.session)
  }

  /** The chat seam's availability probe (the client's chat-entry gate). */
  @Remote('chatStatus')
  chatStatus(): Promise<BoardChatStatusResult> {
    return Promise.resolve(this.board.chatAvailable())
  }

  /**
   * Mark the canvas this session's tab has open (the main-session tools' target).
   * @param agent - the calling session's agent; its session records the focus.
   * @param request - the canvas id.
   * @returns the receipt, or the failure code.
   */
  @Remote('focusCanvas')
  focusCanvas(agent: Agent, request: BoardFocusRequest): Promise<BoardFocusResult> {
    return this.board.focusCanvas(request, agent.session)
  }

  /** Read the canvas's draft (an absent draft reads as empty with a null token). */
  @Remote('readDraft')
  readDraft(request: BoardReadDraftRequest): Promise<BoardReadDraftOutcome> {
    return this.board.readDraft(request)
  }

  /**
   * Write the canvas's draft (null token creates; else version-guarded).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id, content, and the token the caller holds.
   * @returns the new freshness token, or the failure code.
   */
  @Remote('writeDraft')
  writeDraft(agent: Agent, request: BoardWriteDraftRequest): Promise<BoardWriteDraftResult> {
    return this.board.writeDraft(request, agent.session)
  }

  /* ---------------------------------------------------------------- images (§10.3) */

  /**
   * Commit one pasted image to the host's attachment store. This is the ONLY
   * call that carries image bytes, and it takes no agent: there is no board
   * file to fence — the store is content-addressed outside every workspace and
   * admits (or refuses) the bytes on its own gates.
   * @param request - canonical base64, the declared media type, and a display name.
   * @returns the pointer to write into the card, or one image code.
   */
  @Remote('attachImage')
  attachImage(request: BoardAttachImageRequest): Promise<BoardAttachImageOutcome> {
    return this.board.attachImage(request)
  }

  /** The stored image behind one card pointer, as base64 for the browser's object URL. */
  @Remote('imageBytes')
  imageBytes(request: BoardImageBytesRequest): Promise<BoardImageBytesOutcome> {
    return this.board.imageBytes(request)
  }
}

export default CanvasRemoteService
