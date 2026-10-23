/**
 * The composer's task tag, per room session: the task page's 「追问」 and
 * 「＋ 新任务」 put a removable 「任务 N」 / 「新任务」 chip on the main
 * composer (the page has no input of its own), the next send carries it as
 * postMessage's `task`, and removing the chip leaves the filing to dsh.
 * Every set bumps a revision so the composer takes focus even when the
 * same tag is set twice.
 */

/** A tag on the composer. */
export interface RoomTaskTag {
  /** `new`, or the task's root id. */
  readonly task: string
  /** The chip text (「任务 3」 / 「新任务」). */
  readonly label: string
  readonly revision: number
}

/** The shared tag store; one per client plugin. */
export class RoomTaskTags {
  private readonly tags = new Map<string, RoomTaskTag>()
  private readonly listeners = new Set<() => void>()
  private revision = 0

  /** Subscribe to tag changes (useSyncExternalStore shape). */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The session's current tag. */
  readonly get = (sessionId: string): RoomTaskTag | undefined => this.tags.get(sessionId)

  /** Put a tag on the session's composer, or clear it. */
  set(sessionId: string, tag: { readonly task: string; readonly label: string } | undefined): void {
    if (tag === undefined) {
      if (!this.tags.delete(sessionId)) return
    } else {
      this.tags.set(sessionId, { ...tag, revision: ++this.revision })
    }
    for (const listener of this.listeners) listener()
  }
}
