/** Test-time stand-in for the store engine (defineStore). */
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
