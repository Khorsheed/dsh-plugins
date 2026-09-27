/**
 * The canvas space service core (`ctx.canvasBoard`): the v2 board's data
 * face. One canvas is one directory under the deployment state root holding a
 * single `canvas.json` — metadata, every card, and the counters — so the
 * whole board is read and written as one version-guarded document (the pad's
 * own `.index.json` pattern, scaled up to the whole board).
 *
 * The state root is deployment-level state, NOT a session workspace, and the
 * fence reflects that. The probe (package Agent Note): under the stock
 * `workspace-write` deployment a session-stamped policy (`resolve({ session })`
 * → boundary = the session's cwd) DENIES every write to `$DSH_HOME/state/…`
 * with `FS_SANDBOX_DENIED` — the v1 fence cannot address the state dir by
 * construction. The chosen path keeps the mounted `ctx.fs` (version guards,
 * atomic writes, the observation trail) and re-roots the fence: the CALLING
 * session still resolves the MODE (a read-only deployment stays read-only)
 * and lends its id to the write, while the `workspace-write` boundary becomes
 * the plugin's own state dir. That is a fence around exactly
 * `$DSH_HOME/state/canvas` — never bare `node:fs`, never a mode bypass, and
 * never anywhere a session was not already allowed to be.
 *
 * @module @khorsheed/dsh-canvas
 */
import { randomBytes } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentIdType, AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { FsError, FsVersion } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import { exportBaseNameOf, rewriteImagesForExport } from './manuscript.ts'
import { canvasErrorOf } from './service.ts'
import {
  CANVAS_FILE_NAME, CANVAS_STATE_DIR_NAME, computeKindCounts, defaultCategories, documentHeadingOf,
  emptyStats, isBoardCardStatus, isCardCategoryId, isManuscriptId, isManuscriptStatus, isQuestionState, makeBoardId,
  manuscriptFileName, MANUSCRIPT_DIR_NAME, MAX_BOARD_MANUSCRIPTS, MAX_MANUSCRIPT_TEXT_LENGTH,
  MAX_CARD_TEXT_LENGTH, MAX_COMMENT_TEXT_LENGTH, normalizeBoard, normalizeCanvasId, normalizeManuscriptSources,
  normalizeCategories, normalizeDraw, normalizeLanes, normalizeLinks, normalizePositions,
  reconcileCategories,
  sanitizeCanvasTitle, summarizeBoard,
  type BoardAddCommentRequest, type BoardArchiveRequest,
  type BoardAttachImageOutcome, type BoardAttachImageRequest,
  type BoardCard, type BoardCreateRequest,
  type BoardDeleteCanvasRequest, type BoardDeleteCanvasResult, type BoardDeleteCardRequest,
  type BoardFocusRequest, type BoardFocusResult,
  type BoardImageBytesOutcome, type BoardImageBytesRequest,
  type BoardListResult, type BoardMutationResult,
  type BoardPatchCardRequest, type BoardProposeCardRequest, type BoardPutCardRequest,
  type BoardReadOutcome, type BoardReadRequest, type BoardSetCategoriesRequest,
  type BoardSetLayoutRequest,
  type BoardManuscript, type CanvasBoard, type CanvasError, type CanvasImageError, type CanvasSummary,
  type ManuscriptDeleteRequest, type ManuscriptExportRequest, type ManuscriptExportResult,
  type ManuscriptPatchRequest, type ManuscriptReadOutcome, type ManuscriptReadRequest,
  type ManuscriptWriteRequest, type ManuscriptWriteResult,
} from './types.ts'

/**
 * Resolve the board state root (the datasets `defaults.ts` precedent): an
 * explicit value wins, then `$DSH_HOME/state/canvas`, then
 * `<cwd>/.dsh-canvas`.
 * @param configured - plugin-provided override, or ''/undefined.
 * @returns the board state root directory.
 */
export function resolveCanvasStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', CANVAS_STATE_DIR_NAME)
  return join(process.cwd(), '.dsh-canvas')
}

/** Lowercase base36 randomness for one id (time already orders the prefix). */
function randomSuffix(): string {
  return randomBytes(8).readBigUInt64BE().toString(36).slice(0, 10).padStart(10, '0')
}

/** The board as one JSON document (the pad index's trailing-newline shape). */
function serializeBoard(board: CanvasBoard): string {
  return `${JSON.stringify(board, null, 2)}\n`
}

/**
 * The attachment store's failure codes, read STRUCTURALLY: the host's own
 * contract is "consumers route on `code`, never on the prototype chain"
 * (`dsh-attachment/error`), so nothing is imported from that package at
 * runtime and the image arm degrades on a deployment that mounts no store.
 * Twelve admission codes fold into the four the client can say something about.
 */
const IMAGE_TOO_LARGE_CODES = new Set([
  'TOO_MANY_IMAGES', 'IMAGES_TOO_LARGE', 'IMAGE_TOO_LARGE', 'IMAGE_TOO_MANY_PIXELS', 'IMAGE_DIMENSION_TOO_LARGE',
])
const IMAGE_NOT_IMAGE_CODES = new Set([
  'UNSUPPORTED_IMAGE_TYPE', 'INVALID_IMAGE', 'IMAGE_TYPE_MISMATCH', 'INVALID_IMAGE_BASE64', 'INVALID_FILE_BASE64',
])
const IMAGE_UNREADABLE_CODES = new Set([
  'INVALID_ATTACHMENT_REF', 'ATTACHMENT_CORRUPT', 'ATTACHMENT_NOT_FOUND', 'ATTACHMENT_READ_FAILED',
  'ATTACHMENT_PROJECTION_UNSUPPORTED', 'ATTACHMENT_FILES_UNSUPPORTED',
])

/** Map one thrown value onto the image arm's four codes. */
function imageErrorOf(error: unknown): CanvasImageError {
  const code = typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined
  if (typeof code !== 'string') return 'unavailable'
  if (IMAGE_TOO_LARGE_CODES.has(code)) return 'too-large'
  if (IMAGE_NOT_IMAGE_CODES.has(code)) return 'not-image'
  if (IMAGE_UNREADABLE_CODES.has(code)) return 'unreadable'
  return 'unavailable'
}

/** Plugin config for the board service; every key is optional. */
export interface CanvasBoardConfig {
  /** State root override (defaults to `$DSH_HOME/state/canvas`). */
  stateRoot?: string
}

/**
 * Remove one directory tree. `ctx.fs` has no delete verb (read, list, write
 * and edit only), so the canvas delete reaches the state root through node
 * directly — legitimate only because that root is this plugin's own
 * deployment-level directory (`$DSH_HOME/state/canvas`), never a workspace.
 * The seam exists so the in-memory specs can stand in for the disk.
 */
export type RemoveTree = (path: string) => Promise<void>

/** The default remover: the whole tree, a missing one included. */
const removeTreeOnDisk: RemoveTree = path => rm(path, { recursive: true, force: true })

/**
 * Write one binary file, creating its directory. `ctx.fs` writes text only, so
 * 「保存到工作区」 puts a manuscript's images beside it through node — behind the
 * store's own checks (the calling session's mode is not read-only, the path
 * sits inside an attached workspace), which is the fence the host would apply
 * if it had a binary write. The seam exists so the specs can stand in for the disk.
 */
export type WriteBytes = (path: string, data: Uint8Array) => Promise<void>

/** The default binary writer. */
const writeBytesOnDisk: WriteBytes = async (path, data) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, data)
}

/**
 * The canvas space's service core. Stateless apart from the context it
 * borrows for `ctx.fs`/`ctx.canvasStore` and the policy home it resolves each
 * caller's mode through.
 */
export class CanvasBoardService {
  static inject = ['fs']

  /** The resolved board state root (also the writable boundary of every fence). */
  readonly stateRoot: string

  /**
   * The per-session policy home, captured only when the mounted filesystem
   * actually confines (the bare local backend writes unfenced by
   * construction — the pad service's own rule).
   */
  private readonly sandboxPolicy: SandboxPolicyService | undefined

  /**
   * @param ctx - host context carrying the mounted filesystem and the pad core.
   * @param config - optional state-root override.
   * @param removeTree - the directory remover the canvas delete uses (specs swap it).
   * @param writeBytes - the binary writer a manuscript save's images use (specs swap it).
   */
  constructor(
    private readonly ctx: Context,
    config: CanvasBoardConfig = {},
    private readonly removeTree: RemoveTree = removeTreeOnDisk,
    private readonly writeBytes: WriteBytes = writeBytesOnDisk,
  ) {
    this.stateRoot = resolveCanvasStateRoot(config.stateRoot)
    this.sandboxPolicy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  }

  private get fs(): Context['fs'] {
    return this.ctx.fs
  }

  /**
   * The policy one board mutation carries: the caller's session resolves the
   * MODE and stamps its id, but the writable boundary is the plugin's state
   * root — a session's own workspace can never hold deployment-level state,
   * so the v1 boundary is re-rooted here instead of stamping a policy that
   * would deny every board write. `undefined` means the mounted backend does
   * not confine.
   * @param session - the session that owns the gesture.
   * @returns the policy to stamp onto the call.
   */
  private policyOf(session: Session): SandboxExecutionPolicy | undefined {
    const resolved = this.sandboxPolicy?.resolve({ session })
    if (resolved === undefined) return undefined
    return { ...resolved, workspaceRoot: this.stateRoot }
  }

  /** One canvas's directory under the state root. */
  private canvasDir(canvasId: string): string {
    return join(this.stateRoot, canvasId)
  }

  /** The `canvas.json` target of one canvas. */
  private async fileTarget(canvasId: string) {
    return this.fs.resolve(CANVAS_FILE_NAME, { cwd: this.canvasDir(canvasId) })
  }

  /** The per-session focus map (which canvas each session's tab has open). */
  private readonly focused = new Map<string, string>()

  /**
   * Read one canvas file: the board plus the freshness token, or which way it
   * failed. A corrupt or foreign file is NEVER rewritten from this read —
   * mutations refuse it rather than clobber something they cannot understand.
   */
  private async readRaw(canvasId: string): Promise<{ board: CanvasBoard; version: string } | 'missing' | 'corrupt'> {
    try {
      const target = await this.fileTarget(canvasId)
      const info = await this.fs.stat(target)
      if (info === undefined) return 'missing'
      let parsed: unknown
      try {
        parsed = JSON.parse(await this.fs.readText(target))
      } catch {
        return 'corrupt'
      }
      const board = normalizeBoard(parsed, canvasId, new Date().toISOString())
      return board === undefined ? 'corrupt' : { board, version: info.version }
    } catch (error) {
      if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return 'missing'
      return 'corrupt'
    }
  }

  /**
   * The one place a board is mutated: read, apply, write back under the
   * version from the read. Two writers can race the board (two browser tabs,
   * a tool call beside the operator), so a stale write re-reads and re-applies
   * exactly once before reporting the conflict — never an unconditional
   * overwrite.
   * @param canvasId - the board to change (id-validated before any path).
   * @param session - the session that owns the gesture; supplies the fence.
   * @param change - the pure board-to-board edit, or an error code to refuse.
   */
  private async mutate(
    canvasId: string,
    session: Session,
    change: (board: CanvasBoard, now: string) => CanvasBoard | CanvasError,
  ): Promise<BoardMutationResult> {
    const id = normalizeCanvasId(canvasId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    const policy = this.policyOf(session)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.readRaw(id)
      if (current === 'missing') return { ok: false, error: 'missing' }
      if (current === 'corrupt') return { ok: false, error: 'io' }
      const now = new Date().toISOString()
      const next = change(current.board, now)
      if (typeof next === 'string') return { ok: false, error: next }
      next.stats.kindCounts = computeKindCounts(next.cards)
      next.stats.lastActiveAt = now
      next.updatedAt = now
      try {
        const target = await this.fileTarget(id)
        const outcome = await this.fs.writeText(
          target, serializeBoard(next),
          { kind: 'replaceIfVersion', version: FsVersion(current.version) },
          undefined, policy,
        )
        return { ok: true, board: next, version: outcome.version }
      } catch (error) {
        const code = canvasErrorOf(error)
        if (code === 'stale' && attempt === 0) continue
        return { ok: false, error: code }
      }
    }
    /* v8 ignore next -- the loop's second iteration always returns */
    return { ok: false, error: 'stale' }
  }

  /** Write a brand-new board; an id collision is reported, never overwritten. */
  private async writeNew(board: CanvasBoard, session: Session): Promise<BoardMutationResult> {
    const policy = this.policyOf(session)
    try {
      const target = await this.fileTarget(board.id)
      const outcome = await this.fs.writeText(target, serializeBoard(board), { kind: 'createIfAbsent' }, undefined, policy)
      return { ok: true, board, version: outcome.version }
    } catch (error) {
      return { ok: false, error: canvasErrorOf(error) }
    }
  }

  /**
   * List every canvas the deployment holds. A missing state root is an empty
   * list, not an error; a canvas whose file cannot be understood drops out of
   * the list rather than breaking it. Rows order by last activity, archived
   * or not — the client groups them.
   */
  async listCanvases(): Promise<BoardListResult> {
    const root = await this.fs.resolve(this.stateRoot)
    const entries = await this.fs.listDir(root).catch(() => [])
    const items: CanvasSummary[] = []
    for (const entry of entries) {
      if (entry.type !== 'directory') continue
      const id = normalizeCanvasId(entry.name)
      if (id === undefined) continue
      const raw = await this.readRaw(id)
      if (typeof raw !== 'object') continue
      items.push(summarizeBoard(raw.board))
    }
    items.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    return { items }
  }

  /**
   * Create one canvas. The title is sanitized; workspaces attach by their
   * absolute paths as given (the client offers the registered ones).
   * @param request - topic title and optional attached workspace paths.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the new board and its first freshness token, or the failure code.
   */
  async createCanvas(request: BoardCreateRequest, session: Session): Promise<BoardMutationResult> {
    const title = sanitizeCanvasTitle(request.title)
    if (title === undefined) return { ok: false, error: 'invalid-name' }
    const now = new Date().toISOString()
    const board: CanvasBoard = {
      id: makeBoardId('canvas', Date.now(), randomSuffix()),
      title,
      attachedWorkspaces: (request.attachedWorkspaces ?? []).filter(w => typeof w === 'string' && w.length > 0),
      chat: { sessionId: null },
      categories: defaultCategories(),
      cards: [],
      links: [],
      lanes: [],
      manuscripts: [],
      stats: emptyStats(now),
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    return this.writeNew(board, session)
  }

  /**
   * Read one board with the freshness token a later mutation must present.
   * @param request - the canvas id.
   * @returns the board and token, or the failure code.
   */
  async readBoard(request: BoardReadRequest): Promise<BoardReadOutcome> {
    const id = normalizeCanvasId(request.canvasId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    const raw = await this.readRaw(id)
    if (raw === 'missing') return { ok: false, error: 'missing' }
    if (raw === 'corrupt') return { ok: false, error: 'io' }
    return { ok: true, board: raw.board, version: raw.version }
  }

  /**
   * Add one user card: createdBy user, straight to kept (proposed is the
   * agent's entrance, M3). A question card starts its lifecycle open. The text
   * may be empty only when the card arrives with a drawing — a picture is the
   * content then, not a card missing its caption.
   * @param request - canvas id, kind, text, optional drawing and source.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async putCard(request: BoardPutCardRequest, session: Session): Promise<BoardMutationResult> {
    if (!isCardCategoryId(request.kind)) return { ok: false, error: 'invalid-name' }
    const text = request.text.trim().slice(0, MAX_CARD_TEXT_LENGTH)
    const draw = normalizeDraw(request.draw)
    if (text.length === 0 && draw.length === 0) return { ok: false, error: 'invalid-name' }
    return this.mutate(request.canvasId, session, (board, now) => {
      // The catalog is per canvas, so "is this a category" can only be asked of
      // the board the card is landing on — and a retired row refuses writes
      // while still showing the cards filed under it.
      const category = board.categories.find(candidate => candidate.id === request.kind)
      if (category === undefined || !category.enabled) return 'invalid-name'
      const card: BoardCard = {
        id: makeBoardId('c', Date.now(), randomSuffix()),
        kind: request.kind,
        text,
        status: 'kept',
        comments: [],
        createdBy: 'user',
        createdAt: now,
        updatedAt: now,
        ...(request.kind === 'question' ? { question: { state: 'open' as const } } : {}),
        ...(draw.length === 0 ? {} : { draw }),
        ...(request.source === undefined ? {} : { source: request.source }),
      }
      board.cards.push(card)
      return board
    })
  }

  /**
   * Edit one card: text, its drawing, a status transition, or a question-state
   * transition. The proposed → kept/archived transitions feed the acceptance
   * counters (the ghost's ✓/✗); archiving never deletes, exactly the pad's
   * semantics. A drawing arrives whole (the pad owns the stroke list, so the
   * fence covers a lost write the same way it covers a lost keystroke); `[]`
   * clears it, `undefined` leaves it alone.
   * @param request - canvas id, card id, and the fields to change.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async patchCard(request: BoardPatchCardRequest, session: Session): Promise<BoardMutationResult> {
    if (request.status !== undefined && !isBoardCardStatus(request.status)) return { ok: false, error: 'invalid-name' }
    if (request.question !== undefined && !isQuestionState(request.question.state)) return { ok: false, error: 'invalid-name' }
    if (request.text !== undefined && request.text.trim().length === 0) return { ok: false, error: 'invalid-name' }
    return this.mutate(request.canvasId, session, (board, now) => {
      const card = board.cards.find(candidate => candidate.id === request.cardId)
      if (card === undefined) return 'missing'
      if (request.kind !== undefined) {
        const category = board.categories.find(candidate => candidate.id === request.kind)
        if (category === undefined || !category.enabled) return 'invalid-name'
        if (category.id !== card.kind) {
          card.kind = category.id
          // The question lifecycle rides the built-in, so it moves with the card.
          if (category.id === 'question') card.question = card.question ?? { state: 'open' }
          else delete card.question
        }
      }
      if (request.text !== undefined) {
        card.text = request.text.trim().slice(0, MAX_CARD_TEXT_LENGTH)
      }
      if (request.draw !== undefined) {
        const draw = normalizeDraw(request.draw)
        if (draw.length === 0) delete card.draw
        else card.draw = draw
      }
      if (request.status !== undefined && request.status !== card.status) {
        if (card.status === 'proposed') {
          if (request.status === 'kept') board.stats.proposed.accepted += 1
          if (request.status === 'archived') board.stats.proposed.rejected += 1
        }
        card.status = request.status
      }
      if (request.question !== undefined && card.kind === 'question' && card.question !== undefined) {
        card.question.state = request.question.state
      }
      card.updatedAt = now
      return board
    })
  }

  /**
   * Comment on one card. An agent comment moves an open question card to
   * exploring (the §4 self-tuning rule; `answered` is only ever user-settled).
   * @param request - canvas id, card id, text, and the author (default user).
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async addComment(request: BoardAddCommentRequest, session: Session): Promise<BoardMutationResult> {
    const text = request.text.trim().slice(0, MAX_COMMENT_TEXT_LENGTH)
    if (text.length === 0) return { ok: false, error: 'invalid-name' }
    return this.mutate(request.canvasId, session, (board, now) => {
      const card = board.cards.find(candidate => candidate.id === request.cardId)
      if (card === undefined) return 'missing'
      const author = request.author === 'agent' ? 'agent' : 'user'
      card.comments.push({ id: makeBoardId('m', Date.now(), randomSuffix()), author, text, createdAt: now })
      if (author === 'agent' && card.kind === 'question' && card.question?.state === 'open') {
        card.question.state = 'exploring'
      }
      card.updatedAt = now
      return board
    })
  }

  /**
   * Archive a canvas from the space list, or restore it. The directory and
   * its file are never touched beyond the flag — archive is hide; deleting is
   * `deleteCanvas`, a separate and irreversible verb.
   * @param request - canvas id and the target archived state.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async archiveCanvas(request: BoardArchiveRequest, session: Session): Promise<BoardMutationResult> {
    return this.mutate(request.canvasId, session, (board, now) => {
      board.archivedAt = request.archived ? (board.archivedAt ?? now) : null
      return board
    })
  }

  /**
   * Delete one canvas for good: its whole directory. Operator-only — no agent
   * tool reaches it, the client puts a confirmation in front of it. A
   * read-only session is refused like any other write; a canvas that is not
   * there reports `missing`; and the delete is verified through `ctx.fs`
   * afterwards, so a backend whose files do not live where node looks (a
   * remote mount) reports `io` instead of claiming a delete that did not
   * happen. Pasted images stay in the host's attachment store (it has no
   * delete verb; the store owns their lifetime) — only the pointers go.
   * @param request - the canvas id (validated before any path is built).
   * @param session - the session that owns the gesture; supplies the mode.
   * @returns the receipt, or the failure code.
   */
  async deleteCanvas(request: BoardDeleteCanvasRequest, session: Session): Promise<BoardDeleteCanvasResult> {
    const id = normalizeCanvasId(request.canvasId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    if (this.policyOf(session)?.mode === 'read-only') return { ok: false, error: 'denied' }
    if (await this.readRaw(id) === 'missing') return { ok: false, error: 'missing' }
    try {
      await this.removeTree(this.canvasDir(id))
    } catch {
      return { ok: false, error: 'io' }
    }
    if (await this.readRaw(id) !== 'missing') return { ok: false, error: 'io' }
    for (const [sessionId, focused] of this.focused) {
      if (focused === id) this.focused.delete(sessionId)
    }
    return { ok: true }
  }

  /**
   * Delete one card for good: the card and every line touching it leave in
   * one rewrite (a line to nowhere would otherwise survive until the next
   * read normalized it away). Operator-only, like the canvas delete.
   * @param request - canvas id and card id.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async deleteCard(request: BoardDeleteCardRequest, session: Session): Promise<BoardMutationResult> {
    return this.mutate(request.canvasId, session, board => {
      const index = board.cards.findIndex(card => card.id === request.cardId)
      if (index < 0) return 'missing'
      board.cards.splice(index, 1)
      board.links = board.links.filter(link => link.from !== request.cardId && link.to !== request.cardId)
      for (const manuscript of board.manuscripts) {
        manuscript.sources.used = manuscript.sources.used.filter(id => id !== request.cardId)
        manuscript.sources.unused = manuscript.sources.unused.filter(id => id !== request.cardId)
      }
      return board
    })
  }

  /**
   * Write this canvas's category catalog (stage ⑤). The whole list arrives
   * because rename / add / retire are all "here is the new catalog" — and
   * because the store, not the caller, owns the guarantees: the five built-ins
   * come back if a hand-made list dropped them, and a card never outlives its
   * own row (`reconcileCategories` files an orphan back into the strip).
   * `archiveCardIds` rides along so retiring a category and filing away its
   * cards is ONE rewrite: as two calls, the second could lose the version race
   * and leave a retired chip with live cards under it.
   * @param request - canvas id, the desired catalog, the cards to file away.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async setCategories(request: BoardSetCategoriesRequest, session: Session): Promise<BoardMutationResult> {
    const wanted = normalizeCategories(request.categories)
    return this.mutate(request.canvasId, session, (board, now) => {
      board.categories = reconcileCategories(wanted, board.cards.map(card => card.kind))
      const retiring = new Set(request.archiveCardIds ?? [])
      for (const card of board.cards) {
        if (!retiring.has(card.id) || card.status === 'archived') continue
        if (card.status === 'proposed') board.stats.proposed.rejected += 1
        card.status = 'archived'
        card.updatedAt = now
      }
      return board
    })
  }

  /**
   * Write this canvas's layout (stage ⑥): card places, lanes, lines. Each field
   * is optional and `[]` means *clear it* while an absent one means *leave it
   * alone* — the pair that lets 「清空」 be saved at all, learned from the
   * drawing field (§11.4). Everything arrives through the tolerant reads, so a
   * line to a card the board does not have simply is not stored, and one drag
   * of a lane (which moves the cards parked in it) is ONE version-guarded
   * rewrite rather than a race against itself.
   * @param request - canvas id and whichever parts of the layout changed.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async setLayout(request: BoardSetLayoutRequest, session: Session): Promise<BoardMutationResult> {
    const positions = request.positions === undefined ? undefined : normalizePositions(request.positions)
    const lanes = request.lanes === undefined ? undefined : normalizeLanes(request.lanes)
    return this.mutate(request.canvasId, session, (board, now) => {
      if (request.links !== undefined) {
        board.links = normalizeLinks(request.links, board.cards.map(card => card.id))
      }
      if (lanes !== undefined) board.lanes = lanes
      if (positions !== undefined) {
        for (const position of positions) {
          const card = board.cards.find(candidate => candidate.id === position.id)
          if (card === undefined) continue
          card.x = position.x
          card.y = position.y
          card.updatedAt = now
        }
      }
      return board
    })
  }

  /**
   * The agent's card entrance (`canvas_propose_card`): proposed and awaiting
   * the user's ✓/✗, createdBy agent. A question card starts OPEN even when
   * the proposal carries a rationale comment — exploring means work the user
   * has seen, not the proposal's arrival (the §4 rule applies to comments on
   * cards already on the board).
   * @param request - canvas id, kind, text, optional source and rationale comment.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async proposeCard(request: BoardProposeCardRequest, session: Session): Promise<BoardMutationResult> {
    if (!isCardCategoryId(request.kind)) return { ok: false, error: 'invalid-name' }
    const text = request.text.trim().slice(0, MAX_CARD_TEXT_LENGTH)
    if (text.length === 0) return { ok: false, error: 'invalid-name' }
    const comment = request.comment?.trim().slice(0, MAX_COMMENT_TEXT_LENGTH)
    return this.mutate(request.canvasId, session, (board, now) => {
      const category = board.categories.find(candidate => candidate.id === request.kind)
      if (category === undefined || !category.enabled) return 'invalid-name'
      const card: BoardCard = {
        id: makeBoardId('c', Date.now(), randomSuffix()),
        kind: request.kind,
        text,
        status: 'proposed',
        comments: [],
        createdBy: 'agent',
        createdAt: now,
        updatedAt: now,
        ...(request.kind === 'question' ? { question: { state: 'open' as const } } : {}),
        ...(request.source === undefined ? {} : { source: request.source }),
      }
      if (comment !== undefined && comment.length > 0) {
        card.comments.push({ id: makeBoardId('m', Date.now(), randomSuffix()), author: 'agent', text: comment, createdAt: now })
      }
      board.cards.push(card)
      return board
    })
  }

  /**
   * Mark the canvas one session's tab has open: the main-session tools'
   * target. In-memory only — a restart simply means "nothing open yet",
   * which the tools answer honestly. The focus validates the canvas exists.
   * @param request - the canvas id.
   * @param session - the session whose tab reports the open canvas.
   * @returns the receipt, or the failure code.
   */
  async focusCanvas(request: BoardFocusRequest, session: Session): Promise<BoardFocusResult> {
    const id = normalizeCanvasId(request.canvasId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    const raw = await this.readRaw(id)
    if (raw === 'missing') return { ok: false, error: 'missing' }
    if (raw === 'corrupt') return { ok: false, error: 'io' }
    this.focused.set(String(session.id), id)
    return { ok: true }
  }

  /**
   * The canvas one session's tab last reported open (the main-session tools'
   * target), or undefined when none was reported this process lifetime.
   * @param session - the calling session.
   * @returns the canvas id, or undefined.
   */
  focusedCanvasId(session: Session): string | undefined {
    return this.focused.get(String(session.id))
  }

  /* ------------------------------------------------------------ manuscripts (成稿) */

  /** One manuscript's body directory (every version file it has lives here). */
  private manuscriptDir(canvasId: string, manuscriptId: string): string {
    return join(this.canvasDir(canvasId), MANUSCRIPT_DIR_NAME, manuscriptId)
  }

  /** One body file's target. */
  private async bodyTarget(canvasId: string, manuscriptId: string, file: string) {
    return this.fs.resolve(file, { cwd: this.manuscriptDir(canvasId, manuscriptId) })
  }

  /**
   * Read one manuscript: its metadata off the board and its body file. A body
   * file that has gone missing reads as an empty body — the metadata is still
   * the user's to rename, rewrite or delete, so the entry must stay openable.
   * @param request - canvas id and manuscript id (both shape-checked before any path).
   * @returns both halves, or the failure code.
   */
  async readManuscript(request: ManuscriptReadRequest): Promise<ManuscriptReadOutcome> {
    const id = normalizeCanvasId(request.canvasId)
    if (id === undefined || !isManuscriptId(request.manuscriptId)) return { ok: false, error: 'invalid-name' }
    const raw = await this.readRaw(id)
    if (raw === 'missing') return { ok: false, error: 'missing' }
    if (raw === 'corrupt') return { ok: false, error: 'io' }
    const manuscript = raw.board.manuscripts.find(candidate => candidate.id === request.manuscriptId)
    if (manuscript === undefined) return { ok: false, error: 'missing' }
    let body = ''
    try {
      body = await this.fs.readText(await this.bodyTarget(id, manuscript.id, manuscript.file))
    } catch {
      body = ''
    }
    return { ok: true, manuscript, body }
  }

  /**
   * Write one manuscript's body: create it (no id), or rewrite it (an id plus
   * the version the writer read). The body goes to a FRESH file first — its
   * name carries the new version and randomness, so it is created, never
   * overwritten — and only then does the board's metadata move to it, under
   * the board's own version guard, re-checking the base version inside the
   * guarded change. Two writers racing from the same base therefore both write
   * a file, and exactly one of them becomes the manuscript; the loser's file
   * is removed and it is told `stale` with the version it lost to. The
   * superseded body file goes once the new one is in.
   * @param request - the canvas, the manuscript (or a title to create one), the body, the base version, sources.
   * @param session - the session that owns the gesture; supplies the fence.
   * @param author - who wrote this version (an agent write reopens a final manuscript).
   * @returns the fresh board plus the written manuscript, or the failure code.
   */
  async writeManuscript(
    request: ManuscriptWriteRequest,
    session: Session,
    author: 'user' | 'agent' = 'user',
  ): Promise<ManuscriptWriteResult> {
    const id = normalizeCanvasId(request.canvasId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    const creating = request.manuscriptId === undefined
    if (!creating && !isManuscriptId(request.manuscriptId)) return { ok: false, error: 'invalid-name' }
    const body = request.body.slice(0, MAX_MANUSCRIPT_TEXT_LENGTH)
    if (creating && body.trim().length === 0) return { ok: false, error: 'invalid-name' }
    const title = request.title === undefined ? undefined : sanitizeCanvasTitle(request.title)
    if (request.title !== undefined && title === undefined) return { ok: false, error: 'invalid-name' }

    const raw = await this.readRaw(id)
    if (raw === 'missing') return { ok: false, error: 'missing' }
    if (raw === 'corrupt') return { ok: false, error: 'io' }
    const existing = creating ? undefined : raw.board.manuscripts.find(candidate => candidate.id === request.manuscriptId)
    if (!creating && existing === undefined) return { ok: false, error: 'missing' }
    if (existing !== undefined && request.baseVersion !== existing.version) {
      return { ok: false, error: 'stale', currentVersion: existing.version }
    }
    if (creating && raw.board.manuscripts.length >= MAX_BOARD_MANUSCRIPTS) return { ok: false, error: 'invalid-name' }

    const manuscriptId = existing?.id ?? makeBoardId('ms', Date.now(), randomSuffix())
    const version = existing === undefined ? 1 : existing.version + 1
    const file = manuscriptFileName(version, randomSuffix())
    const policy = this.policyOf(session)
    try {
      await this.fs.writeText(
        await this.bodyTarget(id, manuscriptId, file), body, { kind: 'createIfAbsent' }, undefined, policy,
      )
    } catch (error) {
      return { ok: false, error: canvasErrorOf(error) }
    }

    let lostTo: number | undefined
    let superseded: string | undefined
    const result = await this.mutate(id, session, (board, now) => {
      if (existing === undefined) {
        if (board.manuscripts.length >= MAX_BOARD_MANUSCRIPTS) return 'invalid-name'
        const fromCard = request.fromCardId === undefined
          ? undefined
          : board.cards.find(card => card.id === request.fromCardId)
        const derived = title ?? documentHeadingOf(body)?.title
        const named = derived === undefined ? undefined : sanitizeCanvasTitle(derived)
        if (named === undefined) return 'invalid-name'
        const created: BoardManuscript = {
          id: manuscriptId,
          title: named,
          status: 'writing',
          version,
          file,
          sources: normalizeManuscriptSources({
            used: [...(request.sources?.used ?? []), ...(fromCard === undefined ? [] : [fromCard.id])],
            unused: request.sources?.unused ?? [],
          }, board.cards.map(card => card.id)),
          createdBy: author,
          lastWrittenBy: author,
          createdAt: now,
          updatedAt: now,
          ...(fromCard === undefined ? {} : { fromCardId: fromCard.id }),
        }
        board.manuscripts.push(created)
        return board
      }
      const manuscript = board.manuscripts.find(candidate => candidate.id === manuscriptId)
      if (manuscript === undefined) return 'missing'
      if (manuscript.version !== existing.version) {
        lostTo = manuscript.version
        return 'stale'
      }
      superseded = manuscript.file
      manuscript.version = version
      manuscript.file = file
      manuscript.lastWrittenBy = author
      manuscript.updatedAt = now
      if (author === 'agent') manuscript.status = 'writing'
      if (title !== undefined) manuscript.title = title
      if (request.sources !== undefined) {
        manuscript.sources = normalizeManuscriptSources(
          { used: request.sources.used ?? [], unused: request.sources.unused ?? [] },
          board.cards.map(card => card.id),
        )
      }
      return board
    })

    if (!result.ok) {
      await this.removeTree(join(this.manuscriptDir(id, manuscriptId), file)).catch(() => undefined)
      if (creating) await this.removeTree(this.manuscriptDir(id, manuscriptId)).catch(() => undefined)
      return { ok: false, error: result.error, ...(lostTo === undefined ? {} : { currentVersion: lostTo }) }
    }
    if (superseded !== undefined && superseded !== file) {
      await this.removeTree(join(this.manuscriptDir(id, manuscriptId), superseded)).catch(() => undefined)
    }
    const written = result.board.manuscripts.find(candidate => candidate.id === manuscriptId)!
    return { ok: true, board: result.board, version: result.version, manuscript: written }
  }

  /**
   * Rename a manuscript, or move it between writing and final. The body and
   * its version are untouched — a label is not a new draft.
   * @param request - canvas id, manuscript id, and the fields to change.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async patchManuscript(request: ManuscriptPatchRequest, session: Session): Promise<BoardMutationResult> {
    if (!isManuscriptId(request.manuscriptId)) return { ok: false, error: 'invalid-name' }
    if (request.status !== undefined && !isManuscriptStatus(request.status)) return { ok: false, error: 'invalid-name' }
    const title = request.title === undefined ? undefined : sanitizeCanvasTitle(request.title)
    if (request.title !== undefined && title === undefined) return { ok: false, error: 'invalid-name' }
    return this.mutate(request.canvasId, session, (board, now) => {
      const manuscript = board.manuscripts.find(candidate => candidate.id === request.manuscriptId)
      if (manuscript === undefined) return 'missing'
      if (title !== undefined) manuscript.title = title
      if (request.status !== undefined) manuscript.status = request.status
      manuscript.updatedAt = now
      return board
    })
  }

  /**
   * Delete one manuscript for good: the metadata leaves the board, then its
   * body directory goes. Operator-only, like every delete; a file saved into a
   * workspace is the user's and stays.
   * @param request - canvas id and manuscript id.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async deleteManuscript(request: ManuscriptDeleteRequest, session: Session): Promise<BoardMutationResult> {
    if (!isManuscriptId(request.manuscriptId)) return { ok: false, error: 'invalid-name' }
    const result = await this.mutate(request.canvasId, session, board => {
      const index = board.manuscripts.findIndex(candidate => candidate.id === request.manuscriptId)
      if (index < 0) return 'missing'
      board.manuscripts.splice(index, 1)
      return board
    })
    if (result.ok) {
      await this.removeTree(this.manuscriptDir(result.board.id, request.manuscriptId)).catch(() => undefined)
    }
    return result
  }

  /**
   * Save one manuscript into an attached workspace: `<title>.md`, its images
   * as files in `<title>.assets/` beside it, the pointers rewritten into
   * relative links. The path is remembered with the file's token, so the next
   * save goes to the same file — and stops with `changed` when that file was
   * edited since, or `exists` when a first save would land on a file the
   * canvas never wrote, until the user confirms (`overwrite`). Even then the
   * write stays version-guarded against the file as just observed.
   *
   * The fence: the calling session resolves the MODE (read-only refuses), and
   * the writable boundary is the workspace the user attached to this canvas —
   * a directory the operator put in front of it on purpose, never one a
   * request names on its own (an unattached path is `denied`).
   * @param request - canvas, manuscript, the target workspace, and the overwrite confirmation.
   * @param session - the session that owns the gesture; supplies the mode.
   * @returns where the file went and how the images fared, or why it stopped.
   */
  async exportManuscript(request: ManuscriptExportRequest, session: Session): Promise<ManuscriptExportResult> {
    const read = await this.readManuscript(request)
    if (!read.ok) return read
    const { manuscript, body } = read
    const raw = await this.readRaw(request.canvasId)
    if (typeof raw !== 'object') return { ok: false, error: raw === 'missing' ? 'missing' : 'io' }
    if (!raw.board.attachedWorkspaces.includes(request.workspace)) return { ok: false, error: 'denied' }
    const resolved = this.sandboxPolicy?.resolve({ session })
    if (resolved?.mode === 'read-only') return { ok: false, error: 'denied' }
    const policy = resolved === undefined ? undefined : { ...resolved, workspaceRoot: request.workspace }

    const remembered = manuscript.exported?.workspace === request.workspace ? manuscript.exported : undefined
    const mdPath = remembered?.path ?? join(request.workspace, `${exportBaseNameOf(manuscript.title)}.md`)
    const root = await this.fs.resolve(request.workspace)
    const target = await this.fs.resolve(mdPath)
    if (!this.fs.contains(root, target)) return { ok: false, error: 'denied' }
    const assetsName = `${basename(mdPath, '.md')}.assets`
    const assetsPath = join(dirname(mdPath), assetsName)

    let info: Awaited<ReturnType<Context['fs']['stat']>>
    try {
      info = await this.fs.stat(target)
    } catch (error) {
      return { ok: false, error: canvasErrorOf(error), path: mdPath }
    }
    if (info !== undefined && request.overwrite !== true && remembered?.version !== info.version) {
      return { ok: false, error: remembered === undefined ? 'exists' : 'changed', path: mdPath }
    }

    // Images first: the markdown must never point at a file that is not there.
    const planned = rewriteImagesForExport(body, assetsName)
    const written = new Set<string>()
    const attachments = this.attachments
    for (const image of planned.images) {
      const path = join(assetsPath, image.file)
      if (attachments === undefined || !this.fs.contains(root, await this.fs.resolve(path))) continue
      try {
        const stored = await attachments.readImage({
          attachmentId: image.ref.attachmentId as AttachmentIdType,
          mediaType: image.ref.mediaType,
          bytes: image.ref.bytes,
          width: image.ref.width,
          height: image.ref.height,
        } satisfies ImageAttachmentRef)
        await this.writeBytes(path, stored.data)
        written.add(image.file)
      } catch {
        // Counted below: the pointer stays in the text as it was.
      }
    }
    const text = rewriteImagesForExport(body, assetsName, file => written.has(file)).text

    let savedVersion: string
    try {
      const outcome = await this.fs.writeText(
        target, text,
        info === undefined ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version: FsVersion(info.version) },
        undefined, policy,
      )
      savedVersion = outcome.version
    } catch (error) {
      const code = canvasErrorOf(error)
      return { ok: false, error: code === 'stale' ? 'changed' : code, path: mdPath }
    }

    const saved = await this.mutate(request.canvasId, session, (board, now) => {
      const current = board.manuscripts.find(candidate => candidate.id === manuscript.id)
      if (current === undefined) return 'missing'
      current.exported = { workspace: request.workspace, path: mdPath, version: savedVersion, savedAt: now }
      return board
    })
    if (!saved.ok) return { ok: false, error: saved.error, path: mdPath }
    return {
      ok: true, board: saved.board, version: saved.version, path: mdPath,
      images: written.size, missingImages: planned.images.length - written.size,
    }
  }

  /* ---------------------------------------------------------------- images (§10.3) */

  /** The attachment store, when this deployment mounts one (the image arm's probe). */
  private get attachments(): AttachmentStore | undefined {
    return this.ctx.get('attachments')
  }

  /**
   * Commit one pasted image to the host's attachment store and hand back the
   * pointer a card may hold. Bytes ride THIS call and never card text (§10.3
   * is deliberate: the board is read whole, so pixels in `card.text` would be
   * paid for on every turn); the store's own admission — media type verified
   * against the decoded bytes, the byte and pixel gates — is the only size
   * check here, because inventing a second one would disagree with the host's.
   * @param request - canonical base64, the declared media type, and a display name.
   * @returns the five-field reference to store in the card, or one image code.
   */
  async attachImage(request: BoardAttachImageRequest): Promise<BoardAttachImageOutcome> {
    const attachments = this.attachments
    if (attachments === undefined) return { ok: false, error: 'unavailable' }
    const bytes = Buffer.from(request.data, 'base64')
    if (bytes.byteLength === 0) return { ok: false, error: 'not-image' }
    try {
      const stored = await attachments.saveImage({
        data: new Uint8Array(bytes),
        mediaType: request.mediaType,
        ...(request.name === undefined ? {} : { name: request.name }),
      })
      return {
        ok: true,
        ref: {
          attachmentId: String(stored.attachmentId),
          mediaType: stored.mediaType,
          bytes: stored.bytes,
          width: stored.width,
          height: stored.height,
        },
      }
    } catch (error) {
      return { ok: false, error: imageErrorOf(error) }
    }
  }

  /**
   * Read one stored image back for display, as canonical base64. The pointer
   * carries the four fields the host re-derives from the object and compares
   * (`mediaType`/`bytes`/`width`/`height`), so a card written by another
   * deployment, or a hand-edited one, fails the comparison rather than
   * rendering something else — the digest check is what makes a forged
   * pointer harmless (§10.3's read side).
   * @param request - the reference as the card holds it.
   * @returns base64 bytes and the verified media type, or one image code.
   */
  async imageBytes(request: BoardImageBytesRequest): Promise<BoardImageBytesOutcome> {
    const attachments = this.attachments
    if (attachments === undefined) return { ok: false, error: 'unavailable' }
    const { ref } = request
    try {
      const stored = await attachments.readImage({
        attachmentId: ref.attachmentId as AttachmentIdType,
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
      } satisfies ImageAttachmentRef)
      return { ok: true, data: Buffer.from(stored.data).toString('base64'), mediaType: stored.ref.mediaType }
    } catch (error) {
      return { ok: false, error: imageErrorOf(error) }
    }
  }
}

export default CanvasBoardService
