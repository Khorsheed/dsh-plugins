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
  BoardAddCommentRequest, BoardArchiveRequest,
  BoardDeleteCanvasRequest, BoardDeleteCanvasResult, BoardDeleteCardRequest,
  BoardAttachImageOutcome, BoardAttachImageRequest,
  BoardCreateRequest, BoardDecideTypeRequest, BoardFocusRequest, BoardFocusResult, BoardSetTypeBriefRequest,
  BoardImageBytesOutcome, BoardImageBytesRequest,
  BoardListResult, BoardMutationResult, BoardPatchCardRequest,
  BoardPutCardRequest, BoardReadOutcome,
  BoardReadRequest, BoardSetCategoriesRequest, BoardSetLayoutRequest,
  CanvasArchiveRequest, CanvasArchiveResult, CanvasCreateRequest,
  CanvasListRequest, CanvasListResult, CanvasReadOutcome, CanvasReadRequest,
  CanvasWriteRequest, CanvasWriteResult,
  ManuscriptDeleteRequest, ManuscriptExportRequest, ManuscriptExportResult,
  ManuscriptPatchRequest, ManuscriptReadOutcome, ManuscriptReadRequest,
  ManuscriptWriteRequest, ManuscriptWriteResult,
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
   * Archive a canvas from the space list, or restore it (the reversible half).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id and the target archived state.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('archiveCanvas')
  archiveCanvas(agent: Agent, request: BoardArchiveRequest): Promise<BoardMutationResult> {
    return this.board.archiveCanvas(request, agent.session)
  }

  /**
   * Delete one canvas for good (the operator's confirmed gesture; no agent
   * tool is built over this verb).
   * @param agent - the calling session's agent; its session supplies the mode.
   * @param request - the canvas id.
   * @returns the receipt, or the failure code.
   */
  @Remote('deleteCanvas')
  deleteCanvas(agent: Agent, request: BoardDeleteCanvasRequest): Promise<BoardDeleteCanvasResult> {
    return this.board.deleteCanvas(request, agent.session)
  }

  /**
   * Delete one card for good, with every line touching it (operator-only).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id and card id.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('deleteCard')
  deleteCard(agent: Agent, request: BoardDeleteCardRequest): Promise<BoardMutationResult> {
    return this.board.deleteCard(request, agent.session)
  }

  /**
   * Write one canvas's category catalog (rename / add / retire), archiving the
   * cards the caller filed away in the same rewrite.
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id, the desired catalog, the cards to archive.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('setCategories')
  setCategories(agent: Agent, request: BoardSetCategoriesRequest): Promise<BoardMutationResult> {
    return this.board.setCategories(request, agent.session)
  }

  /**
   * Write one type's brief — the type page's reference draft, text and drawings.
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id, category id, the brief and its drawings.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('setTypeBrief')
  setTypeBrief(agent: Agent, request: BoardSetTypeBriefRequest): Promise<BoardMutationResult> {
    return this.board.setTypeBrief(request, agent.session)
  }

  /**
   * Adopt or reject the agent's pending type proposal.
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id, category id, the decision.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('decideType')
  decideType(agent: Agent, request: BoardDecideTypeRequest): Promise<BoardMutationResult> {
    return this.board.decideType(request, agent.session)
  }

  /**
   * Write one canvas's layout — the places, the lanes and the lines, each part
   * optional (`[]` clears, absent leaves alone).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id and the layout parts that changed.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('setLayout')
  setLayout(agent: Agent, request: BoardSetLayoutRequest): Promise<BoardMutationResult> {
    return this.board.setLayout(request, agent.session)
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

  /* ---------------------------------------------------------------- manuscripts */

  /** One manuscript's metadata and body (a body file gone missing reads as empty). */
  @Remote('readManuscript')
  readManuscript(request: ManuscriptReadRequest): Promise<ManuscriptReadOutcome> {
    return this.board.readManuscript(request)
  }

  /**
   * Create a manuscript, or rewrite one at the version the editor loaded
   * (`stale` with the current version when someone wrote in between).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - the body, and for a rewrite the id and base version.
   * @returns the manuscript, the fresh board and token, or the failure code.
   */
  @Remote('writeManuscript')
  writeManuscript(agent: Agent, request: ManuscriptWriteRequest): Promise<ManuscriptWriteResult> {
    return this.board.writeManuscript(request, agent.session, 'user')
  }

  /**
   * Rename a manuscript or move it between 「写作中」 and 「定稿」.
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id, manuscript id, the fields that changed.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('patchManuscript')
  patchManuscript(agent: Agent, request: ManuscriptPatchRequest): Promise<BoardMutationResult> {
    return this.board.patchManuscript(request, agent.session)
  }

  /**
   * Delete a manuscript and its body files for good.
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - canvas id and manuscript id.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('deleteManuscript')
  deleteManuscript(agent: Agent, request: ManuscriptDeleteRequest): Promise<BoardMutationResult> {
    return this.board.deleteManuscript(request, agent.session)
  }

  /**
   * Save a manuscript into an attached workspace as `<title>.md` plus
   * `<title>.assets/`; `exists` / `changed` ask the caller to confirm with
   * `overwrite`.
   * @param agent - the calling session's agent; its session names the attached workspaces.
   * @param request - canvas id, manuscript id, the workspace, the overwrite flag.
   * @returns the saved path and image counts, or the failure code.
   */
  @Remote('exportManuscript')
  exportManuscript(agent: Agent, request: ManuscriptExportRequest): Promise<ManuscriptExportResult> {
    return this.board.exportManuscript(request, agent.session)
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
