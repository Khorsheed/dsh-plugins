/** Test-time stand-in for the runtime store engine (defineStore). */
export interface EngineStoreHandle<T, A extends Record<string, (state: T, ...args: never[]) => void>> {
  get: () => T
  actions: { [K in keyof A]: (...args: Parameters<A[K]>) => void }
}

export function defineStore<T, A extends Record<string, (state: T, ...args: never[]) => void>>(
  spec: { init: () => T; actions: A },
): EngineStoreHandle<T, A> {
  let state = spec.init()
  const actions = {} as { [K in keyof A]: (...args: Parameters<A[K]>) => void }
  for (const [key, fn] of Object.entries(spec.actions)) {
    actions[key as keyof A] = (...args: Parameters<A[string]>) => {
      ;(fn as (s: T, ...a: unknown[]) => void)(state, ...args)
    }
  }
  return { get: () => state, actions }
}

/**
 * Test-time stand-in for the runtime subagent-lineage index: counts every
 * subagent-origin descendant per ancestor (same walk as the product helper).
 */
export function indexSubagentDescendants(
  summaries: Readonly<Record<string, { origin?: 'subagent'; parentId?: string; id?: string; running?: boolean }>>,
): ReadonlyMap<string, { count: number; runningCount: number }> {
  const indexed = new Map<string, { count: number; runningCount: number }>()
  for (const descendant of Object.values(summaries)) {
    if (descendant.origin !== 'subagent' || descendant.parentId === undefined) continue
    const seen = new Set<string>()
    let current: (typeof summaries)[string] | undefined = descendant
    while (current !== undefined && current.origin === 'subagent'
      && current.parentId !== undefined && !seen.has(current.id ?? '')) {
      seen.add(current.id ?? '')
      const aggregate = indexed.get(current.parentId) ?? { count: 0, runningCount: 0 }
      aggregate.count += 1
      if (descendant.running === true) aggregate.runningCount += 1
      indexed.set(current.parentId, aggregate)
      current = summaries[current.parentId]
    }
  }
  return indexed
}
