/**
 * Inline HTML card client plugin, browser half. Renders settled ` ```dsh-card `
 * fences as sandboxed iframes through the Chat fence slot when available, or
 * the legacy DOM renderer on older hosts.
 *
 * Card links open in the right-Sidebar Browser tab when the host ships that
 * type, else in a new window. Without this plugin the fenced block renders as
 * an ordinary code block.
 * @module @khorsheed/dsh-inline-html-render/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { installCardRenderer } from './renderer.ts'
import { registerCardFence } from './fence.tsx'

/** Optional services are probed; only the nested fence registration injects slots. */
export const inject: readonly string[] = []

/** The right-Sidebar navigation face, mirrored structurally (the quote package precedent). */
interface SidebarRightMirror {
  openTab(kind: string, options?: { params?: Record<string, unknown> }): void
}

/** The right-Sidebar tab type registry, mirrored structurally. */
interface SidebarRightTabsMirror {
  get(kind: string): unknown
}

/**
 * The card-link route: host 0.1.6-alpha.2's ui-sidebar-browser registers the
 * `browser` right-Sidebar tab kind, so a card link opens as a Sidebar tab
 * there; any older host or missing piece (service, type, or a registry race
 * on open) falls back to a new window. Probed per open, so a hot-added tab
 * type counts and a hot-removed one just falls back.
 * @param ctx - client root context.
 * @returns the bridge's openLink capability.
 */
export function createLinkOpener(ctx: Context): (url: string) => void {
  return (url) => {
    const tabs = ctx.get('sidebarRightTabs') as SidebarRightTabsMirror | undefined
    const sidebarRight = ctx.get('sidebarRight') as SidebarRightMirror | undefined
    if (tabs?.get('browser') !== undefined && sidebarRight !== undefined) {
      try {
        sidebarRight.openTab('browser', { params: { url } })
        return
      } catch {
        // The kind raced out of the registry between probe and open: fall through.
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

function installLegacy(ctx: Context): () => void {
  const renderer = installCardRenderer({ openLink: createLinkOpener(ctx) })
  return () => { renderer.dispose() }
}

/**
 * Plugin body: install the card renderer for the browser lifetime.
 * @param ctx - client root context (probed for optional host capabilities).
 * @returns the legacy renderer disposer, or nothing when a nested scope owns disposal.
 */
export function apply(ctx: Context): (() => void) | void {
  if (ctx.get('slots') === undefined) return installLegacy(ctx)
  void ctx.plugin({
    inject: ['slots'],
    apply: (slotCtx) => {
      let disposeLegacy: (() => void) | undefined = installLegacy(slotCtx)
      registerCardFence(slotCtx, () => {
        disposeLegacy?.()
        disposeLegacy = undefined
      })
      return () => { disposeLegacy?.() }
    },
  })
}
