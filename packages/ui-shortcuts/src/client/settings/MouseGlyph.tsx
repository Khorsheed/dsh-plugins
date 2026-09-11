/**
 * Inline top-view mouse diagram for a mouse-bound keycap. Silhouette, button
 * split, and wheel are identical for every binding; only the button the
 * binding claims is filled with the accent, so the keycap answers "which
 * button on the device" without the `MOUSE3`-style numbering a game engine
 * would use — the numbering differs per engine and per platform, while the
 * device picture does not.
 *
 * The diagram is decorative: the keycap's own localized word is the accessible
 * name, so the SVG is `aria-hidden`. There is no clip path and no id anywhere —
 * the lit caps are drawn as arcs that reuse the body's corner geometry, which
 * keeps a page full of these diagrams from colliding on fragment ids.
 */
import type { ShortcutMouseButton } from '../../settings.ts'
import css from './MouseGlyph.module.css'

/** Props of the mouse diagram. */
export interface MouseGlyphProps {
  /** DOM `MouseEvent.button` the binding claims (1 = middle, 2 = secondary). */
  button: ShortcutMouseButton
}

/**
 * Draw the mouse with the bound button lit.
 * @param props - the button the binding claims.
 * @returns the decorative diagram.
 */
export function MouseGlyph({ button }: MouseGlyphProps) {
  return (
    <svg
      className={css.mouse}
      viewBox="0 0 16 22"
      data-gesture="mouse"
      data-button={button}
      aria-hidden="true"
      focusable="false"
    >
      {/* The secondary cap is filled under the outline so the body stroke stays crisp on top. */}
      {button === 2 && <path className={css.lit} d="M8 1.5 A6.5 6.5 0 0 1 14.5 8 L14.5 9.2 L8 9.2 Z" />}
      <rect className={css.body} x="1.5" y="1.5" width="13" height="19" rx="6.5" />
      <path className={css.split} d="M8 1.5 V9.2" />
      <rect
        className={button === 1 ? `${css.wheel} ${css.lit}` : css.wheel}
        x="6.4"
        y="3.6"
        width="3.2"
        height="6.2"
        rx="1.6"
      />
    </svg>
  )
}
