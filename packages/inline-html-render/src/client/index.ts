/**
 * Inline HTML card client plugin, browser half. Installs a DOM-layer renderer
 * that swaps rendered ` ```dsh-card ```` fenced blocks for sandboxed iframes
 * running the authored HTML, inline in the conversation flow.
 *
 * It owns no slot and no Remote service — the browser half only mutates the
 * already-rendered DOM (the repo-accepted last-resort pattern, like
 * message-tools' dom-hider), so it composes as an independent package with no
 * edits to core packages. Card links open in the right-Sidebar Browser tab
 * when the host ships that type (0.1.6-alpha.2's ui-sidebar-browser), else in
 * a new window — a probe, not a dependency. Without this plugin the fenced
 * block simply renders as a normal code block: it degrades, never crashes.
 * @module @khorsheed/dsh-inline-html-render/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { installCardRenderer, type CardRenderer } from './renderer.ts'

/** The client half requires no service: every host capability is probed, never injected. */
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

/**
 * Plugin body: install the card renderer for the browser lifetime.
 * @param ctx - client root context (probed for the optional Sidebar Browser route).
 * @returns a disposer tearing the renderer down.
 */
export function apply(ctx: Context): () => void {
  let renderer: CardRenderer | undefined
  // Effect so teardown/re-composition unwinds cleanly; a re-apply replaces the
  // previous renderer.
  const install = (): void => {
    renderer = installCardRenderer({ openLink: createLinkOpener(ctx) })
  }
  install()
  return () => {
    renderer?.dispose()
    renderer = undefined
  }
}
