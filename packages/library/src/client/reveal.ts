/**
 * The project the pane should land on when the library reveals itself next to
 * a conversation that just started using it (a project created, a book
 * shelved). The reveal effect sets it from the session's binding before it
 * opens the tab; the pane takes it once — on mount, or at once when the tab
 * is already open — so closing and reopening the tab later starts from today
 * again instead of being pulled back to the project.
 * @module @khorsheed/dsh-library/client/reveal
 */

/** One-shot hand-off from the reveal effect to the pane. */
export class RevealedProject {
  private pending: { readonly projectId: string; readonly resourceId?: string } | undefined
  private readonly listeners = new Set<() => void>()

  /**
   * Ask the pane to open this project — or this book in it (a room's desk
   * row); a mounted pane is told at once.
   */
  reveal(projectId: string, resourceId?: string): void {
    this.pending = { projectId, ...(resourceId === undefined ? {} : { resourceId }) }
    for (const listener of [...this.listeners]) listener()
  }

  /** The project to open, cleared as it is taken; undefined when nothing waits. */
  take(): string | undefined {
    return this.takeTarget()?.projectId
  }

  /** The project (and book, when one was named) to open, cleared as it is taken. */
  takeTarget(): { readonly projectId: string; readonly resourceId?: string } | undefined {
    const target = this.pending
    this.pending = undefined
    return target
  }

  /** Be told when a reveal arrives. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
