/**
 * The worktrees panel controller: the cross-plugin face the session-scoped
 * badge entry calls to open the root-scoped drawer. The drawer's store actions
 * are attached by its shell.overlay entry's inject; a gesture that lands before
 * the surface ever mounted is a no-op (the surface opens on the next real open).
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createWorktreesStore, DrawerMode } from './store.ts'

/** The drawer store's bound action set (framework-baked, draft params peeled). */
export type WorktreesActions = BoundActions<ReturnType<typeof createWorktreesStore>>

/** The outward worktrees panel face. */
export interface IWorktreesPanel {
  /** Open the drawer in one mode (no-op when already open). */
  open(mode: DrawerMode): void
}

/** Cross-plugin panel-action face (ctx.worktreesPanel). */
export class WorktreesController implements IWorktreesPanel {
  #drawer: WorktreesActions | undefined
  #version = 0
  #listeners = new Set<() => void>()

  /**
   * Adopt the root overlay drawer's store actions. Called from that entry's
   * inject (a sanctioned assembly side effect), so the face is live from the
   * entry's first render.
   * @param actions - bound actions of the drawer's store instance.
   */
  attachDrawer(actions: WorktreesActions): void {
    this.#drawer = actions
  }

  /** Open the drawer in one mode. */
  open(mode: DrawerMode): void {
    this.#drawer?.open(mode)
  }

  /** Monotonic version, bumped whenever the active worktree changes. */
  getVersion(): number {
    return this.#version
  }

  /** Subscribe to version changes (an active-worktree switch). */
  subscribeVersion(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Bump the version — the badge re-fetches its summary (active worktree changed). */
  bumpVersion(): void {
    this.#version += 1
    for (const listener of this.#listeners) listener()
  }
}
