/**
 * Browser-side config sync: fetch the plugin's resolved config from the host
 * anchor's `GET /whalesong/config` and keep it fresh with a restrained poll
 * (cordis hot config updates re-apply the host entry, so the route always
 * serves the latest values; the poll is what makes updates reach a live
 * browser without a refresh). Failures and malformed payloads keep the last
 * known config — a flaky route must never flap the UX. A surface without
 * fetch (jsdom benches, exotic embeds) keeps the default config and never
 * polls.
 * @module @khorsheed/dsh-whalesong/client/config
 */

/** The config the browser half runs on (mirrors the host's ResolvedConfig). */
export interface WhalesongClientConfig {
  readonly enabled: boolean
  readonly volume: number
}

/** Pre-first-response config: v1 behavior (enabled, full loudness). */
export const DEFAULT_CLIENT_CONFIG: WhalesongClientConfig = { enabled: true, volume: 1 }

/** Host route path (kept in sync with src/index.ts WHALESONG_CONFIG_PATH). */
export const WHALESONG_CONFIG_PATH = '/whalesong/config'

/** Sync creation options. */
export interface ConfigSyncOptions {
  /** Route path override (tests). */
  readonly path?: string
  /** Poll interval in ms (default 3000 — restrained; config rarely changes). */
  readonly pollMs?: number
  /** fetch override (tests). */
  readonly fetchImpl?: typeof fetch
}

/** Sync lifecycle handle. */
export interface WhalesongConfigSync {
  /** Current config (the default until the first successful response). */
  get(): WhalesongClientConfig
  /** Subscribe to changes; fires only when the config actually changed. */
  subscribe(fn: (config: WhalesongClientConfig) => void): () => void
  /** Stop the poll loop. */
  dispose(): void
}

/** Normalize an unknown route payload; undefined = unusable response. */
function normalize(payload: unknown): WhalesongClientConfig | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const raw = payload as Record<string, unknown>
  if (typeof raw.enabled !== 'boolean') return undefined
  const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume)
    ? Math.min(1, Math.max(0, raw.volume))
    : 1
  return { enabled: raw.enabled, volume }
}

function same(a: WhalesongClientConfig, b: WhalesongClientConfig): boolean {
  return a.enabled === b.enabled && a.volume === b.volume
}

/**
 * Create the config sync bound to a window's fetch/timer.
 * @param win - target window (defaults to the global one).
 * @param options - path/poll/fetch overrides.
 * @returns the sync handle.
 */
export function createConfigSync(win: Window = window, options: ConfigSyncOptions = {}): WhalesongConfigSync {
  const path = options.path ?? WHALESONG_CONFIG_PATH
  const pollMs = options.pollMs ?? 3000
  // Absent fetch (jsdom, non-browser surfaces): keep the default config and
  // never poll — a missing route must not throw or flap the UX.
  const fetchImpl = options.fetchImpl ?? (typeof win.fetch === 'function' ? win.fetch.bind(win) : undefined)

  let current = DEFAULT_CLIENT_CONFIG
  const listeners = new Set<(config: WhalesongClientConfig) => void>()

  if (fetchImpl === undefined) {
    return {
      get: () => current,
      subscribe(fn) {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
      dispose() {
        listeners.clear()
      },
    }
  }

  const refresh = async (): Promise<void> => {
    let payload: unknown
    try {
      const res = await fetchImpl(path)
      if (!res.ok) return
      payload = await res.json()
    } catch {
      return // network/parse failure: keep the last known config
    }
    const next = normalize(payload)
    if (next === undefined || same(next, current)) return
    current = next
    for (const fn of [...listeners]) fn(current)
  }

  void refresh()
  const timer = win.setInterval(() => { void refresh() }, pollMs)

  return {
    get: () => current,
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    dispose() {
      win.clearInterval(timer)
      listeners.clear()
    },
  }
}
