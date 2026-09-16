/**
 * The last-seen store: per contextKey, the latest assistant-row time the user
 * has actually looked at. The unread marker in the context selector is a
 * plain comparison — a context's `lastAssistantAt` (host, from the journal
 * projection) newer than this mark means it replied while the user was
 * elsewhere. Marks persist in localStorage (survive reloads) and mirror in
 * memory for live subscribers (the worktrees local-root idiom).
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import { useSyncExternalStore } from 'react'

/** localStorage key base for one context's last-seen mark. */
const SEEN_KEY_BASE = 'dsh.sidechat.seen'

/** In-memory mirror of the last-published marks (authoritative between publishes). */
const published = new Map<string, number>()

/** Listeners notified on any mark. */
const listeners = new Set<() => void>()

/** Monotonic version, bumped on every mark (the uSES snapshot for whole-map readers). */
let version = 0

/** The localStorage key for one context's mark. */
function keyFor(contextKey: string): string {
  return `${SEEN_KEY_BASE}:${contextKey}`
}

/** Read a context's mark from localStorage (0 when unset/unreadable). */
function readSeen(contextKey: string): number {
  try {
    const raw = localStorage.getItem(keyFor(contextKey))
    const value = raw === null ? 0 : Number(raw)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

/** Get a context's last-seen mark (memory first, then localStorage). */
export function lastSeenOf(contextKey: string): number {
  return published.get(contextKey) ?? readSeen(contextKey)
}

/**
 * Mark a context seen up to `time` (a no-op backwards: an older mark never
 * overwrites a newer one). Persists and notifies subscribers.
 */
export function markSeen(contextKey: string, time: number): void {
  if (time <= lastSeenOf(contextKey)) return
  try { localStorage.setItem(keyFor(contextKey), String(time)) } catch { /* non-fatal */ }
  published.set(contextKey, time)
  version += 1
  for (const listener of listeners) listener()
}

/** Subscribe to any mark change (useSyncExternalStore contract). */
export function subscribeSeen(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The seen-map version (uSES snapshot for readers comparing many marks at once). */
export function seenVersion(): number {
  return version
}

/** React hook: one context's last-seen mark. */
export function useLastSeen(contextKey: string): number {
  return useSyncExternalStore(subscribeSeen, () => lastSeenOf(contextKey))
}
