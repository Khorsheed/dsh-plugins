/**
 * The genre seats' render share, handed from the canvas tab down to the board
 * and the card page through a context: the faces and sections render deep in
 * the tree, and threading `renderSlot` through every view between would make
 * each of them part of the genre contract.
 *
 * Every helper here answers "nothing" for a canvas without a genre, so the
 * no-genre path never touches a slot — not even a fallback dispatch. Outside a
 * canvas tab (the space panel, a test mount) there is no provider and the
 * answer is the same.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardCard, CanvasBoard } from '../types.ts'
import type { CanvasTabProps } from './contract.ts'
import { genreKey, type CanvasGenreOwnerProps, type CanvasNavigate } from './slots.ts'

/** What the canvas tab hands down. */
export interface GenreSeats {
  readonly renderSlot: CanvasTabProps['renderSlot']
  /** The board freshness counter, passed on to every seat. */
  readonly rev: number
  /** The navigation face for one canvas. */
  readonly navigateFor: (canvasId: string) => CanvasNavigate
  /** The tab's session (undefined: a read-only tab). */
  readonly sessionId: SessionId | undefined
}

export const GenreSeatsContext = createContext<GenreSeats | null>(null)

/** The seats, or null outside a canvas tab. */
export function useGenreSeats(): GenreSeats | null {
  return useContext(GenreSeatsContext)
}

/** The shared owner share of one canvas. */
function ownerOf(seats: GenreSeats, board: CanvasBoard): CanvasGenreOwnerProps {
  return {
    canvasId: board.id,
    board,
    rev: seats.rev,
    navigate: seats.navigateFor(board.id),
    // An archived canvas is read-only for its genre too.
    sessionId: board.archivedAt === null ? seats.sessionId : undefined,
  }
}

/**
 * A card's face: the genre's entry for its category's role, else `plain`.
 * A card whose category carries no role, or a canvas without a genre, gets
 * `plain` without a dispatch.
 */
export function cardFaceOf(seats: GenreSeats | null, board: CanvasBoard, card: BoardCard, plain: ReactNode): ReactNode {
  const genre = board.genre
  if (seats === null || genre === undefined) return plain
  const category = board.categories.find(row => row.id === card.kind)
  if (category?.role === undefined) return plain
  return seats.renderSlot('canvas.card.face', { ...ownerOf(seats, board), card, category }, {
    entryKey: genreKey(genre.id, category.role),
    fallback: plain,
  })
}

/** The genre's sections of one card page (none without a genre). */
export function cardSectionsOf(seats: GenreSeats | null, board: CanvasBoard, card: BoardCard): ReactNode {
  if (seats === null || board.genre === undefined) return null
  const category = board.categories.find(row => row.id === card.kind)
  if (category === undefined) return null
  return seats.renderSlot('canvas.card.section', { ...ownerOf(seats, board), card, category })
}

/** The strips pinned under a board's header (none without a genre). */
export function boardStripsOf(seats: GenreSeats | null, board: CanvasBoard): ReactNode {
  if (seats === null || board.genre === undefined) return null
  return seats.renderSlot('canvas.board.strip', ownerOf(seats, board))
}

/** A genre page; `missing` stands in when no entry serves the key (the genre was unloaded, say). */
export function genrePageOf(
  seats: GenreSeats | null, board: CanvasBoard, page: string, param: string | undefined, missing: ReactNode,
): ReactNode {
  if (seats === null || board.genre === undefined) return missing
  return seats.renderSlot('canvas.page', { ...ownerOf(seats, board), page, param }, { entryKey: page, fallback: missing })
}
