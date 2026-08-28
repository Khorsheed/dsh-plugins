/**
 * Per-session local-files browser root: which directory each session's browser
 * points at and the browser opens to. The browser's store is root-scoped
 * (mounted once on the workspace tab) while each session keeps its own root,
 * so a small externally-readable store carries the "current root for this
 * session" that both sides read. It is remembered per session (localStorage
 * key `<base>:<sessionId>`) so each session keeps its own workspace: switching
 * workspace in one session does not move another's, and reopening stays where
 * that session left off.
 *
 * @module @khorsheed/dsh-local-files/client
 */
import { useSyncExternalStore } from 'react'

/** localStorage key base for a session's remembered root. */
const ROOT_KEY_BASE = 'dsh-local-files-root'

/** In-memory mirror of the last-published root per session (for the live UI). */
const published = new Map<string, string>()

/** Listeners notified on any publish. */
const listeners = new Set<() => void>()

/** The localStorage key for one session's remembered root. */
function keyFor(sessionId: string): string {
  return `${ROOT_KEY_BASE}:${sessionId}`
}

/** Read a session's remembered root from localStorage ('' when unset). */
function readRoot(sessionId: string): string {
  try { return localStorage.getItem(keyFor(sessionId)) ?? '' } catch { return '' }
}

/** Get the current root for a session (memory first, then localStorage). */
export function localRootOf(sessionId: string): string {
  return published.get(sessionId) ?? readRoot(sessionId)
}

/** Record a session's root: persist to localStorage and notify live subscribers. */
export function rememberLocalRoot(sessionId: string, root: string): void {
  try { localStorage.setItem(keyFor(sessionId), root) } catch { /* non-fatal */ }
  published.set(sessionId, root)
  for (const listener of listeners) listener()
}

/** Clear a session's remembered root ('' / nonexistent). */
export function clearLocalRoot(sessionId: string): void {
  try { localStorage.removeItem(keyFor(sessionId)) } catch { /* non-fatal */ }
  published.delete(sessionId)
  for (const listener of listeners) listener()
}

/** Subscribe to any session-root change (useSyncExternalStore contract). */
export function subscribeLocalRoot(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** React hook: the current root for one session ('' when never set). */
export function useLocalRoot(sessionId: string): string {
  return useSyncExternalStore(subscribeLocalRoot, () => localRootOf(sessionId))
}
