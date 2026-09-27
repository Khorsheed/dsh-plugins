/**
 * The dock chip's live text for the canvas tab (round 3, item ⑥).
 *
 * The surface holds a strip of its own now, so the chip has one job left: say
 * where in it you are from outside. A row on its board answers with the
 * registry's own label (that is what it has always said, and the row IS the
 * canvas); a row on a card or a draft answers with `画布 · <heading>`, because a chip
 * reading only 画布 over an open card told you nothing about the tab you were
 * in — and the prefix keeps the card attached to the surface it came from.
 *
 * Registered on `sidebar.right.pane.tab.title` under this package's id. Without
 * it the chip shows the definition's `title`, which the host freezes at open
 * time and never refreshes.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { CanvasTabTitleProps } from '../contract.ts'

/** The canvas tab's chip, for whichever row the surface is showing. */
export function CanvasTabTitle({ useTabInfo, useSelection }: CanvasTabTitleProps): ReactNode {
  const { tab } = useTabInfo()
  const selection = useSelection(current => current)
  const row = selection.tabs.find(candidate => candidate.id === selection.active)
  const heading = row === undefined || row.at.kind === 'board' ? '' : row.at.heading
  return <>{heading === '' ? tab.title : `${tab.title} · ${heading}`}</>
}
