/**
 * Drawer push-layout math: how much layout space the open job drawer claims
 * from the conversation column.
 *
 * The drawer is a fixed right overlay. While open it marks the document and
 * pushes the conversation column — the chat scroll region and, inside it, the
 * composer seat — left by the drawer width, so nothing sits underneath the
 * drawer. On narrow viewports the claimed inset falls back to 0: pushing
 * would leave the conversation column too cramped, so the drawer overlays as
 * before. Pure, so the responsive decision is unit-testable without a DOM.
 *
 * @module dsh-taskpilot/client/drawer-inset
 */

/** Drawer width on wide viewports (the drawer CSS is `min(520px, 100vw)`). */
export const DRAWER_MAX_WIDTH = 520

/** Smallest remaining conversation-column width a push may leave behind. */
export const MIN_CENTER_WIDTH = 640

/**
 * The inset (px) the open drawer claims from the conversation column, or 0
 * when pushing would leave the column below `minCenterWidth`.
 * @param viewportWidth - current viewport width.
 * @param drawerMaxWidth - drawer width cap (defaults to the drawer's own).
 * @param minCenterWidth - smallest remaining center column that stays usable.
 */
export function computeDrawerInset(
  viewportWidth: number,
  drawerMaxWidth: number = DRAWER_MAX_WIDTH,
  minCenterWidth: number = MIN_CENTER_WIDTH,
): number {
  const drawerWidth = Math.min(drawerMaxWidth, viewportWidth)
  return viewportWidth - drawerWidth >= minCenterWidth ? drawerWidth : 0
}
