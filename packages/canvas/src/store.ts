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
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentIdType, AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { FsError, FsVersion } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { cardToRef, lensSendText, renderCanvasPrompt } from './prompt.ts'
import { canvasToolDefinitions } from './tools.ts'
import { canvasErrorOf } from './service.ts'
import {
  CANVAS_FILE_NAME, CANVAS_STATE_DIR_NAME, computeKindCounts, DRAFT_FILE_NAME, emptyStats,
  isBoardCardKind, isBoardCardStatus, isCanvasLensId, isQuestionState, makeBoardId,
  MAX_CARD_TEXT_LENGTH, MAX_COMMENT_TEXT_LENGTH, normalizeBoard, normalizeCanvasId,
  sanitizeCanvasTitle, summarizeBoard,
  type BoardAddCommentRequest, type BoardArchiveRequest, type BoardAskAgentOutcome,
  type BoardAskAgentRequest, type BoardAttachImageOutcome, type BoardAttachImageRequest,
  type BoardCard, type BoardChatStatusResult, type BoardCreateRequest,
  type BoardFocusRequest, type BoardFocusResult,
  type BoardImageBytesOutcome, type BoardImageBytesRequest,
  type BoardListResult, type BoardMutationResult,
  type BoardPatchCardRequest, type BoardProposeCardRequest, type BoardPutCardRequest,
  type BoardReadDraftOutcome, type BoardReadDraftRequest, type BoardReadOutcome, type BoardReadRequest,
  type BoardRef, type BoardWriteDraftRequest, type BoardWriteDraftResult,
  type CanvasBoard, type CanvasError, type CanvasImageError, type CanvasSummary,
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
 * The probed side-chat seam, mirrored STRUCTURALLY — the side-chat package
 * itself is never imported (this package's one cross-plugin edge is the
 * probed service name, declared in the manifest's `dsh.references`). `send`
 * is optional: a seam that cannot send still primes the context.
 */
export interface SideChatMirror {
  /** Open (or update) one chat context: label, per-turn prompt segment, caller tools, queued refs. */
  openWith(input: {
    readonly contextKey: string
    readonly label: string
    readonly systemPrompt?: string
    readonly tools?: readonly ToolDefinition[]
    readonly refs?: readonly BoardRef[]
  }): Promise<void>
  /** Send one message into the context (pending refs fold in). Optional on the mirror. */
  send?(
    calling: { readonly session: Session },
    request: {
      readonly contextKey: string
      readonly text: string
      readonly label?: string
      readonly refs?: readonly BoardRef[]
    },
  ): Promise<unknown>
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
   */
  constructor(private readonly ctx: Context, config: CanvasBoardConfig = {}) {
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

  /** The `draft.md` target of one canvas. */
  private async draftTarget(canvasId: string) {
    return this.fs.resolve(DRAFT_FILE_NAME, { cwd: this.canvasDir(canvasId) })
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
      cards: [],
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
   * agent's entrance, M3). A question card starts its lifecycle open.
   * @param request - canvas id, kind, text, and optional source.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh board and token, or the failure code.
   */
  async putCard(request: BoardPutCardRequest, session: Session): Promise<BoardMutationResult> {
    if (!isBoardCardKind(request.kind)) return { ok: false, error: 'invalid-name' }
    const text = request.text.trim().slice(0, MAX_CARD_TEXT_LENGTH)
    if (text.length === 0) return { ok: false, error: 'invalid-name' }
    return this.mutate(request.canvasId, session, (board, now) => {
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
        ...(request.source === undefined ? {} : { source: request.source }),
      }
      board.cards.push(card)
      return board
    })
  }

  /**
   * Edit one card: text, a status transition, or a question-state transition.
   * The proposed → kept/archived transitions feed the acceptance counters
   * (the ghost's ✓/✗); archiving never deletes, exactly the pad's semantics.
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
      if (request.text !== undefined) {
        card.text = request.text.trim().slice(0, MAX_CARD_TEXT_LENGTH)
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
   * its file are never touched beyond the flag — archive is hide, not delete.
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
    if (!isBoardCardKind(request.kind)) return { ok: false, error: 'invalid-name' }
    const text = request.text.trim().slice(0, MAX_CARD_TEXT_LENGTH)
    if (text.length === 0) return { ok: false, error: 'invalid-name' }
    const comment = request.comment?.trim().slice(0, MAX_COMMENT_TEXT_LENGTH)
    return this.mutate(request.canvasId, session, (board, now) => {
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

  /** Whether a sideChat-shaped service answered the probe (the client's chat-entry gate). */
  chatAvailable(): BoardChatStatusResult {
    return { available: this.ctx.get('sideChat') !== undefined }
  }

  /**
   * Ask the canvas's agent through the side-chat seam: prime the canvas's
   * context (topic label, per-turn prompt segment, the two canvas tools, the
   * selected cards as opaque refs), then SEND when there is a text to send —
   * the gesture's free text, else the lens's prompt template; `ask` and
   * text-less gestures prime only. The seam is probed: without it the answer
   * is `unavailable` and the board keeps working without any chat.
   * @param request - canvas id, optional lens, selected card ids, free text, extra refs.
   * @param session - the session that owns the gesture (its agent primes the context).
   * @returns the contextKey and whether a message was sent, or the failure code.
   */
  async askAgent(request: BoardAskAgentRequest, session: Session): Promise<BoardAskAgentOutcome> {
    const id = normalizeCanvasId(request.canvasId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    if (request.lens !== undefined && !isCanvasLensId(request.lens)) return { ok: false, error: 'invalid-name' }
    const sideChat = this.ctx.get('sideChat') as SideChatMirror | undefined
    if (sideChat === undefined) return { ok: false, error: 'unavailable' }
    const raw = await this.readRaw(id)
    if (raw === 'missing') return { ok: false, error: 'missing' }
    if (raw === 'corrupt') return { ok: false, error: 'io' }
    const { board } = raw
    const refs: BoardRef[] = []
    for (const cardId of request.cardIds ?? []) {
      const card = board.cards.find(candidate => candidate.id === cardId)
      if (card !== undefined) refs.push(cardToRef(card))
    }
    refs.push(...(request.refs ?? []))
    const contextKey = `canvas:${id}`
    try {
      await sideChat.openWith({
        contextKey,
        label: board.title,
        systemPrompt: renderCanvasPrompt(board, request.lens),
        tools: canvasToolDefinitions(this, id, session),
        refs,
      })
      const text = request.text?.trim()
      const sendText = text !== undefined && text !== '' ? text : lensSendText(request.lens)
      let sent = false
      if (sendText !== undefined && sendText !== '' && sideChat.send !== undefined) {
        await sideChat.send({ session }, { contextKey, text: sendText })
        sent = true
      }
      return { ok: true, contextKey, sent }
    } catch {
      return { ok: false, error: 'io' }
    }
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

  /**
   * Read one canvas's draft (`draft.md` beside `canvas.json`). An absent
   * draft reads as EMPTY with a null token — the first write creates it;
   * a canvas that does not exist is an error, not an empty draft.
   * @param request - the canvas id.
   * @returns the draft and its freshness token (null for absent), or the code.
   */
  async readDraft(request: BoardReadDraftRequest): Promise<BoardReadDraftOutcome> {
    const id = normalizeCanvasId(request.canvasId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    const raw = await this.readRaw(id)
    if (raw === 'missing') return { ok: false, error: 'missing' }
    if (raw === 'corrupt') return { ok: false, error: 'io' }
    try {
      const target = await this.draftTarget(id)
      const info = await this.fs.stat(target)
      if (info === undefined) return { ok: true, content: '', version: null }
      return { ok: true, content: await this.fs.readText(target), version: info.version }
    } catch (error) {
      if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return { ok: true, content: '', version: null }
      return { ok: false, error: canvasErrorOf(error) }
    }
  }

  /**
   * Write one canvas's draft: a null token creates it (`createIfAbsent`),
   * anything else must match the last read's token — the draft is the user's
   * own manuscript, so a stale write is refused, never silently overwritten.
   * @param request - canvas id, content, and the token the caller holds (null for create).
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the new freshness token, or the failure code.
   */
  async writeDraft(request: BoardWriteDraftRequest, session: Session): Promise<BoardWriteDraftResult> {
    const id = normalizeCanvasId(request.canvasId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    const raw = await this.readRaw(id)
    if (raw === 'missing') return { ok: false, error: 'missing' }
    if (raw === 'corrupt') return { ok: false, error: 'io' }
    const policy = this.policyOf(session)
    try {
      const target = await this.draftTarget(id)
      const expected = request.version === null
        ? { kind: 'createIfAbsent' as const }
        : { kind: 'replaceIfVersion' as const, version: FsVersion(request.version) }
      const outcome = await this.fs.writeText(target, request.content, expected, undefined, policy)
      return { ok: true, version: outcome.version }
    } catch (error) {
      return { ok: false, error: canvasErrorOf(error) }
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
