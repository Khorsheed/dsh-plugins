/**
 * Opening a destination through the host's own navigation: the tab kind with
 * its typed params (`sidebarRight.openTab(kind, { params })`), which the tab
 * body reads as `navigation.params` and re-applies on every revision. Probed,
 * logged, never thrown: a composition whose preset hides the kind has no tab
 * type to open.
 *
 * @module @khorsheed/dsh-client-ui-agent-nav/client
 */
import type { Destination } from '../destination.ts'

/**
 * Open the destination's tab at its params.
 * @param get - the context's `ctx.get`.
 * @param destination - where to go.
 * @param log - the log sink (default `console.warn`).
 * @returns whether the host took the call.
 */
export function openDestination(
  get: (name: string) => unknown,
  destination: Pick<Destination, 'kind' | 'params'> & { readonly id?: string },
  log: (line: string) => void = line => { console.warn(line) },
): boolean {
  try {
    const sidebar = get('sidebarRight') as { openTab?: (kind: string, options?: { params?: unknown }) => void } | undefined
    if (typeof sidebar?.openTab !== 'function') {
      log(`[nav] dest=${destination.id ?? '-'} kind=${destination.kind} failed=no-sidebar`)
      return false
    }
    sidebar.openTab(destination.kind, { params: destination.params })
    return true
  } catch (error) {
    log(`[nav] dest=${destination.id ?? '-'} kind=${destination.kind} failed=${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
