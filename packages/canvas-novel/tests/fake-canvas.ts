/**
 * An in-memory stand-in for the canvas service's slice the engine reads
 * (`readBoard` / `boundCanvasId` / `registerGenre`): boards by id, session
 * bindings, the registered genres. A work is a board whose genre is `novel`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CanvasBoardSlice, NovelBoardView, NovelGenreDefinition } from '../src/genre.ts'
import { DREAM } from './seed-dream.ts'

export class FakeCanvas implements CanvasBoardSlice {
  readonly boards = new Map<string, NovelBoardView>()
  readonly bindings = new Map<string, string>()
  readonly genres: NovelGenreDefinition[] = []

  /** Add (or replace) one board; `genre: null` makes it a plain canvas. */
  addBoard(board: { id: string; title: string; workspace?: string; genre?: string | null }): this {
    const genre = board.genre === undefined ? 'novel' : board.genre
    this.boards.set(board.id, {
      id: board.id,
      title: board.title,
      attachedWorkspaces: board.workspace === undefined ? [] : [board.workspace],
      ...(genre === null ? {} : { genre: { id: genre } }),
    })
    return this
  }

  /** Bind a session to a canvas (or unbind with null). */
  bind(sessionId: string, canvasId: string | null): this {
    if (canvasId === null) this.bindings.delete(sessionId)
    else this.bindings.set(sessionId, canvasId)
    return this
  }

  async readBoard(request: { readonly canvasId: string }) {
    const board = this.boards.get(request.canvasId)
    return board === undefined ? { ok: false as const, error: 'missing' } : { ok: true as const, board }
  }

  async boundCanvasId(sessionId: string): Promise<string | undefined> {
    return this.bindings.get(sessionId)
  }

  registerGenre(definition: NovelGenreDefinition): () => void {
    this.genres.push(definition)
    return () => { this.genres.splice(this.genres.indexOf(definition), 1) }
  }
}

/** The《梦境监护者》canvas (novel genre, workspace attached). */
export function dreamCanvas(): FakeCanvas {
  return new FakeCanvas().addBoard({ id: DREAM.workId, title: DREAM.title, workspace: DREAM.workspace })
}

/**
 * Provide a canvas on a context the store reads through.
 * @returns the canvas, for binding and adding boards.
 */
export function provideCanvas(ctx: Context, canvas: FakeCanvas = dreamCanvas()): FakeCanvas {
  ctx.provide('canvasBoard' as never, canvas as never)
  return canvas
}
