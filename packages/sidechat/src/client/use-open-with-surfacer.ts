/**
 * The openWith surfacer: how the client notices that a consumer called
 * `ctx.sideChat.openWith` and surfaces that context by itself.
 *
 * The host→client direction rides the Remote wire, never shared memory: a
 * lightweight poll of `surfaceHints` (memory-only host read) diffs each
 * context's openWith revision against this component's baseline, and a bump
 * means "a consumer just opened this context". The first poll only seeds
 * the baseline — a reload never re-surfaces what was opened before it.
 *
 * The presentation rule (the M3 contract):
 *
 * - conversation panel active (`activePanelId === null`, the RightbarRoot
 *   visibility condition) → the right-Sidebar tab (`openTab`), the one place
 *   the tab is visible at all;
 * - a custom main panel active → the floating dock (`openDock`), which
 *   renders above every panel by construction;
 * - either fallback tier fails (no dock seat, or a narrow viewport) → still
 *   `openTab`: invisible now, but the navigation is RECORDED, so returning
 *   to the conversation panel finds the tab already on the right context.
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import { useEffect, useRef } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SideChatSurfaceHints } from '../types.ts'

/** The surfacer's poll cadence (the room live-feed's own interval territory). */
export const SURFACE_POLL_MS = 2500

/** Below this viewport width the dock step is skipped (the frame would crowd the content). */
export const SURFACE_NARROW_WIDTH = 720

/** What the surfacer needs, all injected (component-testable). */
export interface OpenWithSurfacerOptions {
  /** The Remote verb (the wire read). */
  readonly surfaceHints: () => Promise<RemoteResult<SideChatSurfaceHints>>
  /** The active main panel (`null` = the conversation panel, ui-layout's PanelInfo). */
  readonly activePanelId: string | null
  /** Surface on the right-Sidebar tab. */
  readonly openTab: (contextKey: string) => void
  /** Surface on the floating dock; undefined when the overlay seat is absent. */
  readonly openDock: ((contextKey: string) => void) | undefined
  /**
   * Master switch: false mounts the hook without polling (the tab uses it to
   * stay silent while the always-mounted dock is the primary surfacer, so
   * the two never double-fire).
   */
  readonly enabled: boolean
}

/**
 * Subscribe one mounted surface to openWith revisions. The effect restarts
 * when the panel selection changes (the decision reads the freshest value);
 * the baseline survives restarts in a ref.
 */
export function useOpenWithSurfacer({
  surfaceHints, activePanelId, openTab, openDock, enabled,
}: OpenWithSurfacerOptions): void {
  const baseline = useRef<Map<string, number> | null>(null)
  useEffect(() => {
    if (!enabled) return
    let stale = false
    const poll = async (): Promise<void> => {
      const carried = await surfaceHints().catch(() => undefined)
      if (stale || carried === undefined || !carried.ok) return
      const known = baseline.current
      if (known === null) {
        // First poll seeds only: nothing that predates this mount surfaces.
        baseline.current = new Map(carried.value.items.map(item => [item.contextKey, item.rev]))
        return
      }
      for (const item of carried.value.items) {
        const previous = known.get(item.contextKey) ?? 0
        if (item.rev <= previous) continue
        known.set(item.contextKey, item.rev)
        const narrow = window.innerWidth < SURFACE_NARROW_WIDTH
        if (activePanelId === null || openDock === undefined || narrow) {
          openTab(item.contextKey)
        } else {
          openDock(item.contextKey)
        }
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, SURFACE_POLL_MS)
    return () => {
      stale = true
      window.clearInterval(timer)
    }
  }, [surfaceHints, activePanelId, openTab, openDock, enabled])
}
