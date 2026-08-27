/**
 * Harness auth-status bus for the settings cards: the ProviderAuthBlock
 * publishes every probe result, and card headers subscribe for the at-a-glance
 * credential dot — one probe feeds both the block and the header, a login or
 * logout inside any card flips every dot immediately, and every header mount
 * re-probes so a mid-session credential loss cannot leave a stale green dot.
 * @module @khorsheed/dsh-local-agent/client — auth status bus
 */

import { useEffect, useSyncExternalStore } from 'react'
import type { LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'

/** The probe-result kinds the credential dot distinguishes. */
export type HarnessAuthStatusKind = 'checking' | 'authenticated' | 'anonymous' | 'unavailable'

const statuses = new Map<string, HarnessAuthStatusKind>()
const listeners = new Set<() => void>()

/** Record one harness's latest probe result and notify subscribers. */
export function publishAuthStatus(harnessId: string, status: HarnessAuthStatusKind): void {
  if (statuses.get(harnessId) === status) return
  statuses.set(harnessId, status)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test hook: clear every published status so specs start with an empty bus. */
export function resetAuthStatuses(): void {
  statuses.clear()
}

/** Read one harness's latest published status without subscribing (tests, non-React callers). */
export function readAuthStatus(harnessId: string): HarnessAuthStatusKind | undefined {
  return statuses.get(harnessId)
}

/**
 * Read one harness's latest known auth status. Every mount probes once and
 * publishes — a published value only snapshots the past (a credential expiring
 * mid-session must flip the dot at the next view, not stay green forever);
 * the bus dedupes identical values, so repeat probes never re-render.
 * @param harnessId - the harness to read.
 * @param probe - the card's injected status face (read-only Remote channel).
 * @returns the latest known status kind.
 */
export function useHarnessAuthStatus(
  harnessId: string,
  probe: (name: string) => Promise<LocalAgentStatus | undefined>,
): HarnessAuthStatusKind {
  const status = useSyncExternalStore(subscribe, () => statuses.get(harnessId) ?? 'checking')
  useEffect(() => {
    let cancelled = false
    void probe(harnessId).then((result) => {
      if (cancelled) return
      publishAuthStatus(harnessId, result === undefined ? 'unavailable' : result.authenticated ? 'authenticated' : 'anonymous')
    }).catch(() => {
      if (!cancelled) publishAuthStatus(harnessId, 'unavailable')
    })
    return () => { cancelled = true }
  }, [harnessId, probe])
  return status
}
