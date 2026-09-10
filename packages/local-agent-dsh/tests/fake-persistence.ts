/**
 * A handle-based sessionPersistence fake (the host 0.1.5 API): per-id event
 * store behind create/open handles. The legacy-shaped `append` spy keeps the
 * `(id, events)` call signature — reporting the full per-id store AFTER each
 * handle append merged — so existing "the mirrored batch reaches persistence"
 * assertions read unchanged (the real backend appends contiguous suffixes).
 */
import { vi } from 'vitest'

/** One fake handle over the store's per-id event list. */
interface FakeHandle {
  readonly id: string
  readonly header: unknown
  readonly inheritedEventCount: number
  read(offset?: number): Promise<{ events: unknown[]; eventState: 'detached' }>
  append(events: readonly unknown[]): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

/** The fake service: stat/create/open plus the legacy-shaped append spy. */
export interface FakeSessionPersistence {
  /** Legacy-shaped spy: (id, the full stored events after the append). */
  readonly append: ReturnType<typeof vi.fn>
  /** The per-id stored events. */
  readonly stored: Map<string, unknown[]>
  stat(id: string): Promise<{ eventCount: number } | undefined>
  create(header: { id: string }): Promise<FakeHandle>
  open(id: string, access?: string): Promise<FakeHandle>
}

/** Create the fake. */
export function fakeSessionPersistence(): FakeSessionPersistence {
  const stored = new Map<string, unknown[]>()
  const append = vi.fn(async (_id: string, _events: readonly unknown[]) => {})
  const makeHandle = (id: string, header: unknown = {}): FakeHandle => ({
    id,
    header,
    inheritedEventCount: 0,
    read: async (offset = 0) => ({ events: (stored.get(id) ?? []).slice(offset), eventState: 'detached' }),
    append: async (events) => {
      stored.set(id, [...(stored.get(id) ?? []), ...events])
      // Report the merged store so a spy assertion names the full content.
      await append(id, [...(stored.get(id) ?? [])])
    },
    flush: async () => {},
    close: async () => {},
  })
  return {
    append,
    stored,
    stat: async (id) => stored.has(id) ? { eventCount: stored.get(id)!.length } : undefined,
    create: async (header) => makeHandle(header.id, header),
    open: async (id) => makeHandle(id),
  }
}
