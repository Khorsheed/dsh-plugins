/**
 * Inline HTML card client plugin, browser half. Installs a DOM-layer renderer
 * that swaps rendered ` ```dsh-card ```` fenced blocks for sandboxed iframes
 * running the authored HTML, inline in the conversation flow.
 *
 * It owns no slot and no Remote service — the browser half only mutates the
 * already-rendered DOM (the repo-accepted last-resort pattern, like
 * message-tools' dom-hider), so it composes as an independent package with no
 * edits to core packages. Without this plugin the fenced block simply renders
 * as a normal code block: it degrades, never crashes.
 * @module @khorsheed/dsh-inline-html-render/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { installCardRenderer, type CardRenderer } from './renderer.ts'

/** The client half requires no service: it only reads/writes the DOM. */
export const inject: readonly string[] = []

/**
 * Plugin body: install the card renderer for the browser lifetime.
 * @param _ctx - client root context (unused; the renderer is DOM-only).
 * @returns a disposer tearing the renderer down.
 */
export function apply(_ctx: Context): () => void {
  let renderer: CardRenderer | undefined
  // Effect so teardown/re-composition unwinds cleanly; a re-apply replaces the
  // previous renderer.
  const install = (): void => {
    renderer = installCardRenderer()
  }
  install()
  return () => {
    renderer?.dispose()
    renderer = undefined
  }
}
