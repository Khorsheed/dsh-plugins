/**
 * The canvas space's rail entry: the panel id shared by the `main` key and
 * the `sidebar.panellist` row, plus the icon the row renders. The row button
 * (active state, tooltip, label) is the sidebar shell's own — the icon just
 * draws the glyph at the requested size.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconLightOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * The panel id: the `main` slot key AND the panellist row id (the shell
 * matches them). 'canvas' is this package's loader entry id too — the
 * identity triangle extends to the panel, one name everywhere.
 */
export const CANVAS_PANEL_ID = 'canvas' as MainPanelId

/** The rail icon (the pad's own light-bulb, at the shell's requested size). */
export function CanvasNavIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconLightOutline16 size={size} />
}
