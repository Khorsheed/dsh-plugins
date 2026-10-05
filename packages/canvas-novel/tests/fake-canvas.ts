/**
 * An in-memory stand-in for the canvas service's slice the engine reads and
 * writes: boards by id (categories carry their genre role, cards their
 * fields and status), session bindings, the registered genres, and the four
 * card verbs. Minted card ids follow the real canvas shape `c_<…>` — never
 * `c<n>`, which is a character ref.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  CanvasBoardSlice, NovelBoardMutation, NovelBoardView, NovelCardSource, NovelCardStatus, NovelCardView,
  NovelFieldValue, NovelGenreDefinition,
} from '../src/genre.ts'
import { DREAM, dreamCards } from './seed-dream.ts'

/** The category id the fake gives a role. */
export const categoryIdOf = (role: string): string => `cat_${role}`

const NOVEL_ROLE_LIST = ['character', 'world', 'principle', 'foreshadow'] as const

export class FakeCanvas implements CanvasBoardSlice {
  readonly boards = new Map<string, NovelBoardView>()
  readonly bindings = new Map<string, string>()
  readonly genres: NovelGenreDefinition[] = []
  private seq = 0

  /** Add (or replace) one board; `genre: null` makes it a plain canvas (no role categories). */
  addBoard(board: { id: string; title: string; workspace?: string; genre?: string | null; cards?: readonly NovelCardView[] }): this {
    const genre = board.genre === undefined ? 'novel' : board.genre
    this.boards.set(board.id, {
      id: board.id,
      title: board.title,
      attachedWorkspaces: board.workspace === undefined ? [] : [board.workspace],
      ...(genre === null ? {} : { genre: { id: genre } }),
      categories: genre === 'novel' ? NOVEL_ROLE_LIST.map(role => ({ id: categoryIdOf(role), role })) : [],
      cards: board.cards ?? this.boards.get(board.id)?.cards ?? [],
    })
    return this
  }

  /** Bind a session to a canvas (or unbind with null). */
  bind(sessionId: string, canvasId: string | null): this {
    if (canvasId === null) this.bindings.delete(sessionId)
    else this.bindings.set(sessionId, canvasId)
    return this
  }

  /** One card by id (test convenience). */
  card(canvasId: string, cardId: string): NovelCardView | undefined {
    return this.boards.get(canvasId)?.cards.find(card => card.id === cardId)
  }

  async readBoard(request: { readonly canvasId: string }): Promise<NovelBoardMutation> {
    const board = this.boards.get(request.canvasId)
    return board === undefined ? { ok: false, error: 'missing' } : { ok: true, board }
  }

  async boundCanvasId(sessionId: string): Promise<string | undefined> {
    return this.bindings.get(sessionId)
  }

  async listCanvases(): Promise<{ items: { id: string; title: string; archivedAt: string | null; genre?: string }[] }> {
    return {
      items: [...this.boards.values()].map(board => ({
        id: board.id, title: board.title, archivedAt: null,
        ...(board.genre === undefined ? {} : { genre: board.genre.id }),
      })),
    }
  }

  async bindSession(request: { readonly canvasId: string | null }, session: object): Promise<
    { ok: true; canvasId: string | null } | { ok: false; error: string }
  > {
    const sessionId = String((session as { id: unknown }).id)
    if (request.canvasId !== null) {
      const board = this.boards.get(request.canvasId)
      if (board === undefined) return { ok: false, error: 'missing' }
      if (board.genre === undefined) return { ok: false, error: 'no-genre' }
    }
    this.bind(sessionId, request.canvasId)
    return { ok: true, canvasId: request.canvasId }
  }

  registerGenre(definition: NovelGenreDefinition): () => void {
    this.genres.push(definition)
    return () => { this.genres.splice(this.genres.indexOf(definition), 1) }
  }

  async putCard(request: CardCreate): Promise<NovelBoardMutation> {
    return this.create(request, 'kept', 'user')
  }

  async proposeCard(request: CardCreate & { readonly comment?: string }): Promise<NovelBoardMutation> {
    return this.create(request, 'proposed', 'agent', request.comment)
  }

  async patchCard(request: {
    readonly canvasId: string
    readonly cardId: string
    readonly status?: NovelCardStatus
    readonly fields?: Readonly<Record<string, NovelFieldValue>>
  }): Promise<NovelBoardMutation> {
    return this.update(request.canvasId, request.cardId, card => ({
      ...card,
      ...(request.status === undefined ? {} : { status: request.status }),
      ...(request.fields === undefined ? {} : { fields: request.fields }),
    }))
  }

  async addComment(request: { readonly canvasId: string; readonly cardId: string; readonly text: string; readonly author?: 'user' | 'agent' }): Promise<NovelBoardMutation> {
    return this.update(request.canvasId, request.cardId, card => ({
      ...card,
      comments: [...card.comments, { author: request.author ?? 'agent', text: request.text }],
    }))
  }

  private create(request: CardCreate, status: NovelCardStatus, createdBy: 'user' | 'agent', comment?: string): NovelBoardMutation {
    const board = this.boards.get(request.canvasId)
    if (board === undefined) return { ok: false, error: 'missing' }
    if (!board.categories.some(category => category.id === request.kind)) return { ok: false, error: 'invalid-name' }
    const card: NovelCardView = {
      id: `c_${++this.seq}`,
      kind: request.kind,
      text: request.text,
      status,
      ...(request.fields === undefined ? {} : { fields: request.fields }),
      ...(request.source === undefined ? {} : { source: request.source }),
      comments: comment === undefined ? [] : [{ author: 'agent', text: comment }],
      createdBy,
    }
    const next = { ...board, cards: [...board.cards, card] }
    this.boards.set(board.id, next)
    return { ok: true, board: next }
  }

  private update(canvasId: string, cardId: string, change: (card: NovelCardView) => NovelCardView): NovelBoardMutation {
    const board = this.boards.get(canvasId)
    if (board === undefined || !board.cards.some(card => card.id === cardId)) return { ok: false, error: 'missing' }
    const next = { ...board, cards: board.cards.map(card => card.id === cardId ? change(card) : card) }
    this.boards.set(canvasId, next)
    return { ok: true, board: next }
  }
}

interface CardCreate {
  readonly canvasId: string
  readonly kind: string
  readonly text: string
  readonly source?: NovelCardSource
  readonly fields?: Readonly<Record<string, NovelFieldValue>>
}

/** The《梦境监护者》canvas (novel genre, workspace attached, its seeded cards). */
export function dreamCanvas(): FakeCanvas {
  return new FakeCanvas().addBoard({ id: DREAM.workId, title: DREAM.title, workspace: DREAM.workspace, cards: dreamCards() })
}

/**
 * Provide a canvas on a context the store reads through.
 * @returns the canvas, for binding and adding boards.
 */
export function provideCanvas(ctx: Context, canvas: FakeCanvas = dreamCanvas()): FakeCanvas {
  ctx.provide('canvasBoard' as never, canvas as never)
  return canvas
}
