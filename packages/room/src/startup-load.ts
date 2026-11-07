/**
 * 重启后自动继续 for rooms nobody opens (member-self-started-rounds M10,
 * user decision 7): the room's auto-continue pass runs on a room's live
 * access, so a room nobody opens after a restart would never continue. Once
 * after the host starts, the room asks the local-agent core which parent
 * sessions have a member whose ledger a restart left running/uncertain, and
 * loads each of those that is a room with rounds to continue — the same
 * live access opening it would be, so the setting and every M9 guard apply
 * unchanged. Cheap: ledger files and the room's own log, no model call.
 * @module @khorsheed/dsh-room/startup-load
 */

/** How long after the room service starts the load runs (providers register, ledgers become readable). */
export const STARTUP_ROOM_LOAD_DELAY_MS = 5_000

/** Rooms loaded at once (each load may resume a room agent and dispatch). */
export const STARTUP_ROOM_LOAD_CONCURRENCY = 2

/**
 * Visit each candidate once, at most `concurrency` at a time, in order.
 * @param candidates - parent session ids (duplicates are visited once).
 * @param visit - loads one candidate; resolves whether it was loaded. A
 *   throw counts as not loaded and is handed to `onError`.
 * @param options - the bound, a stop check (plugin disposed), the error sink.
 * @returns the candidates `visit` loaded, in completion order.
 */
export async function loadEach(
  candidates: readonly string[],
  visit: (id: string) => Promise<boolean>,
  options: { readonly concurrency?: number; readonly stopped?: () => boolean; readonly onError?: (id: string, error: unknown) => void } = {},
): Promise<string[]> {
  const queue = [...new Set(candidates)]
  const loaded: string[] = []
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (options.stopped?.() === true) return
      try {
        if (await visit(id)) loaded.push(id)
      } catch (error) {
        options.onError?.(id, error)
      }
    }
  }
  const workers = Math.max(1, Math.min(options.concurrency ?? STARTUP_ROOM_LOAD_CONCURRENCY, queue.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return loaded
}
