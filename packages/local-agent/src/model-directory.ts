import type { LocalAgentModelDirectory, LocalAgentModelDirectoryData } from './types.ts'
import { statSync } from 'node:fs'
import { cliExecutableIdentity } from './cli-version.ts'

/** File metadata only: credential bytes and URL credentials never enter cache keys. */
export function modelDirectoryContextKey(context: {
  provider: string
  homeDir: string
  cwd: string
  cli: readonly string[]
  files: readonly string[]
  endpoint?: string
}): string {
  const files = context.files.map(path => {
    try {
      const stat = statSync(path)
      return [path, stat.ino, stat.mtimeMs, stat.ctimeMs, stat.size]
    } catch { return [path, 'absent'] }
  })
  let endpoint: string | undefined
  if (context.endpoint !== undefined) {
    try { const url = new URL(context.endpoint); endpoint = url.origin + url.pathname } catch { endpoint = 'invalid-endpoint' }
  }
  return JSON.stringify({ provider: context.provider, homeDir: context.homeDir, cwd: context.cwd, cli: cliExecutableIdentity(context.cli), files, endpoint })
}

/** Native facts win; configured candidates and historical suggestions retain provenance. */
export function extendModelDirectory(
  directory: LocalAgentModelDirectory,
  configuration: readonly (string | undefined)[],
  history: readonly (string | undefined)[],
): LocalAgentModelDirectory {
  const entries = new Map(directory.entries.map(entry => [entry.value, entry]))
  for (const [source, values] of [['configuration', configuration], ['history', history]] as const) {
    for (const candidate of values) {
      const value = candidate?.trim()
      if (value !== undefined && value !== '' && !entries.has(value)) entries.set(value, { value, label: value, source })
    }
  }
  return { ...directory, entries: [...entries.values()] }
}

interface Entry {
  snapshot: LocalAgentModelDirectory
  nextAttemptAt: number
  generation: number
  pending?: Promise<LocalAgentModelDirectory>
  controller?: AbortController
  listeners: Set<() => void>
}

/**
 * Shared mechanics only: providers own discovery and supply a non-secret
 * context key covering scope, endpoint, configuration, cwd and CLI identity.
 * Failed refreshes keep the last successful data. Invalidation fences stale
 * in-flight replies, including account changes while a probe is running.
 */
export class ModelDirectoryCache {
  private readonly entries = new Map<string, Entry>()
  private revision = 0
  private disposed = false

  constructor(private readonly options: {
    load: (context: string, signal: AbortSignal) => Promise<LocalAgentModelDirectoryData>
    ttlMs?: number
    retryMs?: number
    now?: () => number
    onError?: (error: unknown) => void
  }) {}

  private now(): number { return (this.options.now ?? Date.now)() }

  private entry(key: string): Entry {
    let entry = this.entries.get(key)
    if (entry === undefined) {
      entry = {
        snapshot: { entries: [], complete: false, customInput: true, status: 'loading', refreshing: false, revision: ++this.revision },
        nextAttemptAt: 0, generation: 0, listeners: new Set(),
      }
      this.entries.set(key, entry)
    }
    return entry
  }

  private publish(entry: Entry, snapshot: Omit<LocalAgentModelDirectory, 'revision'>): void {
    entry.snapshot = { ...snapshot, revision: ++this.revision }
    for (const listener of entry.listeners) listener()
  }

  read(key: string): LocalAgentModelDirectory {
    const entry = this.entry(key)
    if (!this.disposed && this.now() >= entry.nextAttemptAt) void this.refresh(key)
    return entry.snapshot
  }

  refresh(key: string): Promise<LocalAgentModelDirectory> {
    const entry = this.entry(key)
    if (this.disposed) return Promise.resolve(entry.snapshot)
    if (entry.pending !== undefined) return entry.pending
    const generation = ++entry.generation
    const controller = new AbortController()
    entry.controller = controller
    this.publish(entry, {
      ...entry.snapshot, refreshing: true,
      status: entry.snapshot.refreshedAt === undefined ? 'loading' : 'stale',
    })
    const pending = Promise.resolve().then(() => this.options.load(key, controller.signal)).then(data => {
      if (this.disposed || generation !== entry.generation) return entry.snapshot
      entry.nextAttemptAt = this.now() + (this.options.ttlMs ?? 300_000)
      this.publish(entry, {
        ...data, status: data.unsupported === true ? 'unsupported' : 'ready',
        refreshing: false, refreshedAt: this.now(),
      })
      return entry.snapshot
    }, error => {
      if (this.disposed || generation !== entry.generation) return entry.snapshot
      this.options.onError?.(error)
      entry.nextAttemptAt = this.now() + (this.options.retryMs ?? this.options.ttlMs ?? 30_000)
      this.publish(entry, {
        ...entry.snapshot, status: entry.snapshot.refreshedAt === undefined ? 'error' : 'stale',
        refreshing: false, reason: error instanceof Error ? error.message : 'Model discovery failed',
      })
      return entry.snapshot
    }).finally(() => {
      if (generation === entry.generation) {
        delete entry.pending
        delete entry.controller
      }
    })
    entry.pending = pending
    return pending
  }

  /** Same context changed on disk. New identities should use a different key. */
  invalidate(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined || this.disposed) return
    entry.generation++
    entry.controller?.abort()
    delete entry.pending
    delete entry.controller
    entry.nextAttemptAt = 0
    this.publish(entry, {
      ...entry.snapshot, refreshing: false,
      status: entry.snapshot.refreshedAt === undefined ? 'loading' : 'stale',
    })
    if (entry.listeners.size > 0) void this.refresh(key)
  }

  /** Initial snapshot plus coalesced updates; no retained event queue. */
  async *follow(key: string | (() => string), signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory> {
    if (signal.aborted || this.disposed) return
    const currentKey = (): string => typeof key === 'string' ? key : key()
    let entry = this.entry(currentKey())
    let wake: (() => void) | undefined
    const notify = (): void => { wake?.(); wake = undefined }
    entry.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    // Re-check native config/auth file identities and TTL while a picker stays open.
    const timer = setInterval(notify, 1_000)
    timer.unref()
    let revision = -1
    try {
      while (!signal.aborted && !this.disposed) {
        const activeKey = currentKey()
        const active = this.entry(activeKey)
        if (active !== entry) {
          entry.listeners.delete(notify)
          entry = active
          entry.listeners.add(notify)
        }
        const snapshot = this.read(activeKey)
        if (snapshot.revision !== revision) {
          revision = snapshot.revision
          yield snapshot
        } else {
          await new Promise<void>(resolve => { wake = resolve })
        }
      }
    } finally {
      entry.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
      clearInterval(timer)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.entries.values()) {
      entry.generation++
      entry.controller?.abort()
      for (const listener of entry.listeners) listener()
    }
    this.entries.clear()
  }
}
