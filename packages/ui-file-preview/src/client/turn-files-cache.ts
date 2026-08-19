/**
 * Session-level cache in front of the `filePreview.turnFiles` RPC. One fetch
 * warms every turn the response carries (the host returns the whole per-turn
 * map up to its watermark, and the host itself caches the fold by that
 * watermark), and every requested turn — including one the response reports
 * empty — is pinned so a re-mount of the same card never refetches. A card for
 * a newer, not-yet-seen turn triggers one refetch, which the host answers
 * without refolding. Errors resolve to an empty list — the card just shows
 * nothing.
 * @module @khorsheed/dsh-client-ui-file-preview
 */

import type { FilePreviewTurnFile } from '@khorsheed/dsh-file-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { FilePreviewRemote } from './contract.ts'

/**
 * Build a turn-files loader bound to one mounted Remote (created per apply, so
 * the cache never pins module-level identity across plugin reloads).
 * @param remote - the mounted filePreview Remote handle.
 * @returns a loader resolving one session's files for one turn.
 */
export function createTurnFilesLoader(remote: FilePreviewRemote) {
  const cache = new Map<string, Map<number, readonly FilePreviewTurnFile[]>>()
  return (sessionId: SessionId, turn: number): Promise<readonly FilePreviewTurnFile[]> => {
    const sessionCache = cache.get(sessionId)
    if (sessionCache !== undefined && sessionCache.has(turn)) {
      return Promise.resolve(sessionCache.get(turn) ?? [])
    }
    return remote.turnFiles(sessionId).then((result) => {
      const merged = cache.get(sessionId) ?? new Map<number, readonly FilePreviewTurnFile[]>()
      if (result.ok) {
        for (const group of result.value.turns) merged.set(group.turn, group.files)
      }
      // Pin the requested turn's resolution (possibly empty) so the same card
      // never refetches; newer turns still trigger one refetch each.
      if (!merged.has(turn)) merged.set(turn, [])
      cache.set(sessionId, merged)
      return merged.get(turn) ?? []
    })
  }
}

/** The loader's function shape, shared with the inject face. */
export type TurnFilesLoader = ReturnType<typeof createTurnFilesLoader>
