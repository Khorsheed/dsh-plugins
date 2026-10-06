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
import type { BoardCard, CanvasBoard, CanvasGenreFaces } from '../types.ts'
import type { CanvasTabProps } from './contract.ts'
import { genreKey, type CanvasCardScope, type CanvasGenreOwnerProps, type CanvasNavigate } from './slots.ts'

/** What the canvas tab hands down. */
export interface GenreSeats {
  readonly renderSlot: CanvasTabProps['renderSlot']
  /** The board freshness counter, passed on to every seat. */
  readonly rev: number
  /** The navigation face for one canvas. */
  readonly navigateFor: (canvasId: string) => CanvasNavigate
  /** The tab's session (undefined: a read-only tab). */
  readonly sessionId: SessionId | undefined
  /** Whether a genre's own surfaces are the 成稿 (`CanvasGenreDefinition.ownsManuscripts`). */
  readonly ownsManuscripts: (genreId: string) => boolean
  /** A genre's own top faces (`CanvasGenreDefinition.faces`), when it names them. */
  readonly facesOf: (genreId: string) => CanvasGenreFaces | undefined
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

/**
 * Whether this canvas's genre owns its 成稿. False without a genre or outside
 * a canvas tab, so a plain canvas keeps every manuscript gesture.
 */
export function manuscriptsOwned(seats: GenreSeats | null, board: CanvasBoard): boolean {
  return seats !== null && board.genre !== undefined && seats.ownsManuscripts(board.genre.id)
}

/** The 成稿 face: the owning genre's entry, else `list` (the canvas's own manuscript list). */
export function boardManuscriptsOf(
  seats: GenreSeats | null, board: CanvasBoard, list: ReactNode, onEmpty?: () => void,
): ReactNode {
  if (!manuscriptsOwned(seats, board)) return list
  return seats!.renderSlot('canvas.board.manuscripts', { ...ownerOf(seats!, board), onEmpty }, { entryKey: board.genre!.id, fallback: list })
}

/**
 * The genre's own top faces on this canvas, or undefined: no genre, a genre
 * without them, or one that does not own the 成稿 (faces ride that ownership).
 */
export function genreFacesOf(seats: GenreSeats | null, board: CanvasBoard): CanvasGenreFaces | undefined {
  if (!manuscriptsOwned(seats, board)) return undefined
  return seats!.facesOf(board.genre!.id)
}

/** A top-face label on a genre canvas with faces: the genre's entry, else `label`. */
export function boardTabLabelOf(seats: GenreSeats | null, board: CanvasBoard, face: string, label: string): ReactNode {
  if (genreFacesOf(seats, board) === undefined) return label
  return seats!.renderSlot('canvas.board.tab', { ...ownerOf(seats!, board), face, label }, {
    entryKey: genreKey(board.genre!.id, face),
    fallback: label,
  })
}

/** The genre's own face; `missing` stands in when no entry serves it. */
export function boardViewOf(seats: GenreSeats | null, board: CanvasBoard, missing: ReactNode): ReactNode {
  const faces = genreFacesOf(seats, board)
  if (faces === undefined) return missing
  return seats!.renderSlot('canvas.board.view', ownerOf(seats!, board), { entryKey: genreKey(board.genre!.id, faces.view), fallback: missing })
}

/** The genre's card-scope reader for the 卡板 face (nothing without a genre). */
export function boardScopesOf(
  seats: GenreSeats | null, board: CanvasBoard, onScopes: (scopes: readonly CanvasCardScope[]) => void,
): ReactNode {
  if (seats === null || board.genre === undefined) return null
  return seats.renderSlot('canvas.board.scopes', { ...ownerOf(seats, board), onScopes }, { entryKey: board.genre.id, fallback: null })
}

/** The 连线 layout: the genre's graph on a canvas with faces, else `links` (the canvas's own). */
export function boardGraphOf(seats: GenreSeats | null, board: CanvasBoard, links: ReactNode): ReactNode {
  if (genreFacesOf(seats, board) === undefined) return links
  return seats!.renderSlot('canvas.board.graph', ownerOf(seats!, board), { entryKey: board.genre!.id, fallback: links })
}

/** What the genre adds to one card's delete question (nothing without a genre). */
export function cardDeleteNoteOf(seats: GenreSeats | null, board: CanvasBoard, card: BoardCard): ReactNode {
  if (seats === null || board.genre === undefined) return null
  const category = board.categories.find(row => row.id === card.kind)
  if (category === undefined) return null
  return seats.renderSlot('canvas.card.deleteNote', { ...ownerOf(seats, board), card, category }, { entryKey: board.genre.id, fallback: null })
}

/** A genre page; `missing` stands in when no entry serves the key (the genre was unloaded, say). */
export function genrePageOf(
  seats: GenreSeats | null, board: CanvasBoard, page: string, param: string | undefined, missing: ReactNode,
): ReactNode {
  if (seats === null || board.genre === undefined) return missing
  return seats.renderSlot('canvas.page', { ...ownerOf(seats, board), page, param }, { entryKey: page, fallback: missing })
}
