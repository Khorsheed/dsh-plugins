/**
 * Whether a session gets the binding chip: some genre is installed AND the
 * session reaches one of the genres' agent rows (the same two grant paths
 * the tab's own criterion reads). The genre half fails CLOSED — a deployment
 * without a genre, or whose answer never came, shows no chip, because the
 * chip exists only for genre work; the preset half fails open, as every
 * composition read does.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CanvasGenreSummary } from '../../types.ts'

/** The slice of the tab's visibility controller the gate reads. */
export interface GenreGrantSource {
  grantsAny(sessionId: SessionId | undefined, modules: readonly string[]): boolean
  subscribe(listener: () => void): () => void
}

export class GenreBindingGate {
  /** The installed genres; null until the one read answers. */
  private genres: readonly CanvasGenreSummary[] | null = null
  private requested = false
  private readonly listeners = new Set<() => void>()

  /**
   * @param load - the genre listing, read once on the first subscriber (genres
   *   register at host boot, so a reload is the only time the answer moves).
   * @param grants - the preset composition criterion.
   */
  constructor(
    private readonly load: () => Promise<RemoteResult<CanvasGenreSummary[]>>,
    private readonly grants: GenreGrantSource,
  ) {}

  /** Whether the session's header carries the chip. */
  offered(sessionId: SessionId): boolean {
    if (this.genres === null || this.genres.length === 0) return false
    const rows: string[] = []
    for (const genre of this.genres) {
      // A genre that names no row gates no tools: every session may bind it.
      if (genre.agentRow === undefined) return true
      rows.push(genre.agentRow)
    }
    return this.grants.grantsAny(sessionId, rows)
  }

  /** Subscribe to the inputs (the genre answer, session switches, the inventory). */
  subscribe(listener: () => void): () => void {
    this.request()
    this.listeners.add(listener)
    const off = this.grants.subscribe(listener)
    return () => { this.listeners.delete(listener); off() }
  }

  private request(): void {
    if (this.requested) return
    this.requested = true
    void this.load().then(result => {
      this.genres = result.ok ? result.value : []
    }, () => {
      this.genres = []
    }).then(() => {
      for (const listener of this.listeners) listener()
    })
  }
}
