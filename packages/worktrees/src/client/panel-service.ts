/**
 * The worktrees panel controller: the face the session-scoped badge entries
 * call to open the right-Sidebar tab. The open routes to the official
 * `ctx.sidebarRight.openTab` face (bound at apply). The local-files browser
 * this controller used to front was removed 2026-09-23: its only opener (the
 * badge's folder capsule) had already gone, so the surface was unreachable
 * deck — file browsing now lives in @khorsheed/dsh-local-files alone.
 */
import type { DrawerMode } from './store.ts'

/** The outward worktrees panel face. */
export interface IWorktreesPanel {
  /** Open the worktrees right-Sidebar tab in one mode. */
  open(mode: DrawerMode): void
}

/** Panel-action face. */
export class WorktreesController implements IWorktreesPanel {
  #version = 0
  #listeners = new Set<() => void>()

  /**
   * @param openTab - routes a mode open to the right Sidebar (bound at apply;
   *   a throw — no mounted surface — degrades to nothing).
   */
  constructor(private readonly openTab: (mode: DrawerMode) => void) {}

  /** Open the worktrees tab in one mode. */
  open(mode: DrawerMode): void {
    this.openTab(mode)
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
