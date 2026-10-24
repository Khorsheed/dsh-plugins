/**
 * The canvas Remote service: the pad's data face on the wire, mounted under
 * the `canvas` namespace. A thin adapter over the same `ctx.canvasStore`
 * service core — no logic is copied, and the browser half builds no path of
 * its own (every call takes the workspace root plus a pad-relative name, and
 * every receipt carries the resolved absolute and workspace-relative
 * spellings back).
 *
 * The MUTATING methods take the calling session's id first, resolved with
 * {@link panelSession} (subagent sessions included): the pad writes are fenced
 * by the caller's own file policy and workspace, which only the session
 * knows. Reads take no session — a fence is a
 * write fence, so a pad stays browsable for a session that is only being read.
 *
 * @module @khorsheed/dsh-canvas
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { panelSession } from './panel-session.ts'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CanvasService } from './service.ts'
import type { CanvasBoardService } from './store.ts'
import type {
  BoardAddCommentRequest, BoardArchiveRequest, BoardWorkspaceRequest,
  BoardDeleteCanvasRequest, BoardDeleteCanvasResult, BoardDeleteCardRequest,
  BoardAttachImageOutcome, BoardAttachImageRequest,
  BoardBindRequest, BoardBindResult, BoardSelectGenreRequest, CanvasGenreSummary,
  BoardCreateRequest, BoardDecideTypeRequest, BoardFocusRequest, BoardFocusResult, BoardSetTypeBriefRequest,
  BoardImageBytesOutcome, BoardImageBytesRequest,
  BoardListResult, BoardMarkSeenRequest, BoardMutationResult, BoardPatchCardRequest,
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
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - workspace root, kind, title, and initial body.
   * @returns the new item's receipt, or the failure code.
   */
  @Remote('create')
  async create(sessionId: SessionId, request: CanvasCreateRequest): Promise<CanvasWriteResult> {
    return this.store.create(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Overwrite one item under the version guard from the last read.
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - workspace root, name, body, and the version last read.
   * @returns the write receipt, or the failure code.
   */
  @Remote('write')
  async write(sessionId: SessionId, request: CanvasWriteRequest): Promise<CanvasWriteResult> {
    return this.store.write(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Hide one item from the list, or restore it — the file is never touched.
   * @param sessionId - the calling session (see panel-session.ts); it fences the index write.
   * @param request - workspace root, name, and the target archived state.
   * @returns the receipt, or the failure code.
   */
  @Remote('setArchived')
  async setArchived(sessionId: SessionId, request: CanvasArchiveRequest): Promise<CanvasArchiveResult> {
    return this.store.setArchived(request, await panelSession(this.ctx, sessionId))
  }

  /* ------------------------------------------------------ the canvas space (v2, M1) */

  /** List every canvas the deployment holds (archived included; the client groups). */
  @Remote('listCanvases')
  listCanvases(): Promise<BoardListResult> {
    return this.board.listCanvases()
  }

  /**
   * Create one canvas (a topic, optionally with workspaces attached).
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - topic title and optional attached workspace paths.
   * @returns the new board and its first freshness token, or the failure code.
   */
  @Remote('createCanvas')
  async createCanvas(sessionId: SessionId, request: BoardCreateRequest): Promise<BoardMutationResult> {
    return this.board.createCanvas(request, await panelSession(this.ctx, sessionId))
  }

  /** Read one board with the freshness token a later mutation must present. */
  @Remote('readBoard')
  readBoard(request: BoardReadRequest): Promise<BoardReadOutcome> {
    return this.board.readBoard(request)
  }

  /**
   * Add one user card (createdBy user, straight to kept).
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id, kind, text, and optional source.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('putCard')
  async putCard(sessionId: SessionId, request: BoardPutCardRequest): Promise<BoardMutationResult> {
    return this.board.putCard(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Edit one card: text, a status transition, or a question-state transition.
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id, card id, and the fields to change.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('patchCard')
  async patchCard(sessionId: SessionId, request: BoardPatchCardRequest): Promise<BoardMutationResult> {
    return this.board.patchCard(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Clear the 「新」 mark: the given cards, or every unseen card.
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id and, optionally, the card ids.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('markSeen')
  async markSeen(sessionId: SessionId, request: BoardMarkSeenRequest): Promise<BoardMutationResult> {
    return this.board.markSeen(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Comment on one card.
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id, card id, text, and the author (default user).
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('addComment')
  async addComment(sessionId: SessionId, request: BoardAddCommentRequest): Promise<BoardMutationResult> {
    return this.board.addComment(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Archive a canvas from the space list, or restore it (the reversible half).
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id and the target archived state.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('setWorkspace')
  async setWorkspace(sessionId: SessionId, request: BoardWorkspaceRequest): Promise<BoardMutationResult> {
    return this.board.setWorkspace(request, await panelSession(this.ctx, sessionId))
  }

  @Remote('archiveCanvas')
  async archiveCanvas(sessionId: SessionId, request: BoardArchiveRequest): Promise<BoardMutationResult> {
    return this.board.archiveCanvas(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Delete one canvas for good (the operator's confirmed gesture; no agent
   * tool is built over this verb).
   * @param sessionId - the calling session (see panel-session.ts); it supplies the mode.
   * @param request - the canvas id.
   * @returns the receipt, or the failure code.
   */
  @Remote('deleteCanvas')
  async deleteCanvas(sessionId: SessionId, request: BoardDeleteCanvasRequest): Promise<BoardDeleteCanvasResult> {
    return this.board.deleteCanvas(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Delete one card for good, with every line touching it (operator-only).
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id and card id.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('deleteCard')
  async deleteCard(sessionId: SessionId, request: BoardDeleteCardRequest): Promise<BoardMutationResult> {
    return this.board.deleteCard(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Write one canvas's category catalog (rename / add / retire), archiving the
   * cards the caller filed away in the same rewrite.
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id, the desired catalog, the cards to archive.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('setCategories')
  async setCategories(sessionId: SessionId, request: BoardSetCategoriesRequest): Promise<BoardMutationResult> {
    return this.board.setCategories(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Write one type's brief — the type page's reference draft, text and drawings.
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id, category id, the brief and its drawings.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('setTypeBrief')
  async setTypeBrief(sessionId: SessionId, request: BoardSetTypeBriefRequest): Promise<BoardMutationResult> {
    return this.board.setTypeBrief(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Adopt or reject the agent's pending type proposal.
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id, category id, the decision.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('decideType')
  async decideType(sessionId: SessionId, request: BoardDecideTypeRequest): Promise<BoardMutationResult> {
    return this.board.decideType(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Write one canvas's layout — the places, the lanes and the lines, each part
   * optional (`[]` clears, absent leaves alone).
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id and the layout parts that changed.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('setLayout')
  async setLayout(sessionId: SessionId, request: BoardSetLayoutRequest): Promise<BoardMutationResult> {
    return this.board.setLayout(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Mark the canvas this session's tab has open (the main-session tools' target).
   * @param sessionId - the calling session (see panel-session.ts); it records the focus.
   * @param request - the canvas id.
   * @returns the receipt, or the failure code.
   */
  @Remote('focusCanvas')
  async focusCanvas(sessionId: SessionId, request: BoardFocusRequest): Promise<BoardFocusResult> {
    return this.board.focusCanvas(request, await panelSession(this.ctx, sessionId))
  }

  /* ---------------------------------------------------------------- genres (创作体裁) */

  /** Every registered genre (an empty list when no genre plugin is installed). */
  @Remote('listGenres')
  listGenres(): CanvasGenreSummary[] {
    return this.board.listGenres()
  }

  /**
   * Select a genre for one canvas, or clear it with `null`.
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id and genre id.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('selectGenre')
  async selectGenre(sessionId: SessionId, request: BoardSelectGenreRequest): Promise<BoardMutationResult> {
    return this.board.selectGenre(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * The canvas the calling session is bound to, or null.
   * @param sessionId - the calling session (see panel-session.ts).
   * @returns the canvas id, or null.
   */
  @Remote('boundCanvas')
  async boundCanvas(sessionId: SessionId): Promise<string | null> {
    return (await this.board.boundCanvasId(String(sessionId))) ?? null
  }

  /**
   * Bind the calling session to a canvas with a genre (`null` unbinds).
   * @param sessionId - the calling session (see panel-session.ts); it is the one bound.
   * @param request - the canvas id, or null.
   * @returns the canvas now bound, or the failure code.
   */
  @Remote('bindCanvas')
  async bindCanvas(sessionId: SessionId, request: BoardBindRequest): Promise<BoardBindResult> {
    return this.board.bindSession(request, await panelSession(this.ctx, sessionId))
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
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - the body, and for a rewrite the id and base version.
   * @returns the manuscript, the fresh board and token, or the failure code.
   */
  @Remote('writeManuscript')
  async writeManuscript(sessionId: SessionId, request: ManuscriptWriteRequest): Promise<ManuscriptWriteResult> {
    return this.board.writeManuscript(request, await panelSession(this.ctx, sessionId), 'user')
  }

  /**
   * Rename a manuscript or move it between 「写作中」 and 「定稿」.
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id, manuscript id, the fields that changed.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('patchManuscript')
  async patchManuscript(sessionId: SessionId, request: ManuscriptPatchRequest): Promise<BoardMutationResult> {
    return this.board.patchManuscript(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Delete a manuscript and its body files for good.
   * @param sessionId - the calling session (see panel-session.ts); it fences the write.
   * @param request - canvas id and manuscript id.
   * @returns the fresh board and token, or the failure code.
   */
  @Remote('deleteManuscript')
  async deleteManuscript(sessionId: SessionId, request: ManuscriptDeleteRequest): Promise<BoardMutationResult> {
    return this.board.deleteManuscript(request, await panelSession(this.ctx, sessionId))
  }

  /**
   * Save a manuscript into an attached workspace as `<title>.md` plus
   * `<title>.assets/`; `exists` / `changed` ask the caller to confirm with
   * `overwrite`.
   * @param sessionId - the calling session (see panel-session.ts); it names the attached workspaces.
   * @param request - canvas id, manuscript id, the workspace, the overwrite flag.
   * @returns the saved path and image counts, or the failure code.
   */
  @Remote('exportManuscript')
  async exportManuscript(sessionId: SessionId, request: ManuscriptExportRequest): Promise<ManuscriptExportResult> {
    return this.board.exportManuscript(request, await panelSession(this.ctx, sessionId))
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
