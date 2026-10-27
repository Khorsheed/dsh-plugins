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
  private pending: string | undefined
  private readonly listeners = new Set<() => void>()

  /** Ask the pane to open this project; a mounted pane is told at once. */
  reveal(projectId: string): void {
    this.pending = projectId
    for (const listener of [...this.listeners]) listener()
  }

  /** The project to open, cleared as it is taken; undefined when nothing waits. */
  take(): string | undefined {
    const projectId = this.pending
    this.pending = undefined
    return projectId
  }

  /** Be told when a reveal arrives. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
