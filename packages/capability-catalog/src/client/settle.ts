/**
 * Re-query the catalog until a mutation is visible in it.
 *
 * The host skill registry is not invalidated by our own writes. The catalog
 * installs and deletes skills with `node:fs`, while the host's only synchronous
 * invalidation path is the `fs/observed` event, which the model-facing
 * filesystem tools raise — a plugin write raises nothing. The registry therefore
 * catches up when its watcher notices the change (chokidar, 200 ms stability
 * threshold), a moment AFTER the write resolves. A single refresh fired right
 * after an install or delete thus returns the pre-change snapshot, and the grid
 * keeps its stale rows until the panel is reopened.
 * @module @khorsheed/dsh-capability-catalog/client/settle
 */

/** Delays between attempts: past the watcher's ~200 ms settle, bounded so the UI never spins. */
const DEFAULT_DELAYS_MS: readonly number[] = [250, 500, 1000, 1500]

/** Await a real delay; tests inject their own so they never touch the clock. */
const realSleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

/** Delay schedule and sleep seam of {@link refreshUntilSettled}. */
export interface SettleOptions {
  /** One attempt per entry, plus the immediate one. */
  readonly delaysMs?: readonly number[]
  /** How to wait between attempts. */
  readonly sleep?: (ms: number) => Promise<void>
}

/**
 * Refresh once immediately, then keep re-querying until `settled` accepts the
 * snapshot or the schedule runs out. The immediate attempt is deliberate: it
 * preserves the single-refresh behaviour for every mutation the registry
 * already knows about, and it is the only attempt that can beat the watcher.
 * @param read - the newest snapshot, or undefined before one lands.
 * @param refresh - one query; resolves once the store holds its result.
 * @param settled - accepts the snapshot when the mutation is visible in it.
 * @param options - delay schedule and sleep seam.
 * @returns whether the snapshot settled before the schedule ran out.
 */
export async function refreshUntilSettled<T>(
  read: () => T | undefined,
  refresh: () => Promise<void>,
  settled: (value: T) => boolean,
  options: SettleOptions = {},
): Promise<boolean> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS
  const sleep = options.sleep ?? realSleep
  const accepts = (): boolean => {
    const value = read()
    return value !== undefined && settled(value)
  }
  await refresh()
  if (accepts()) return true
  for (const delay of delays) {
    await sleep(delay)
    await refresh()
    if (accepts()) return true
  }
  return false
}

/**
 * The skill names an add-skill result reported. The host joins a multi-skill
 * install with `', '` (e.g. `--skill '*'`), so the caller cannot treat it as one
 * name.
 * @param name - the result's `name` field.
 */
export function installedNames(name: string | undefined): readonly string[] {
  return (name ?? '').split(',').map(part => part.trim()).filter(part => part !== '')
}
