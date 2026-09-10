/**
 * The worktrees panel controller: the cross-plugin face the session-scoped
 * badge entries call to open the right-Sidebar tab or the local-files
 * browser. The tab open routes to the official `ctx.sidebarRight.openTab`
 * face (bound at apply); the local-files browser's store actions are attached
 * by its shell.overlay entry's inject; a gesture that lands before that
 * surface ever mounted is a no-op (the surface opens on the next real open).
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLocalFilesStore } from './store-local.ts'
import type { DrawerMode } from './store.ts'

/** The local-files browser store's bound action set (framework-baked, draft params peeled). */
export type LocalFilesActions = BoundActions<ReturnType<typeof createLocalFilesStore>>

/** The outward worktrees panel face. */
export interface IWorktreesPanel {
  /** Open the worktrees right-Sidebar tab in one mode. */
  open(mode: DrawerMode): void
  /** Open the local-files browser from a starting directory for one session. */
  openLocalFiles(sessionId: string, start: string): void
}

/** Cross-plugin panel-action face (ctx.worktreesPanel). */
export class WorktreesController implements IWorktreesPanel {
  #localFiles: LocalFilesActions | undefined
  #version = 0
  #listeners = new Set<() => void>()

  /**
   * @param openTab - routes a mode open to the right Sidebar (bound at apply;
   *   a throw — no mounted surface — degrades to nothing).
   */
  constructor(private readonly openTab: (mode: DrawerMode) => void) {}

  /**
   * Adopt the local-files browser's store actions. Called from that entry's
   * inject (a sanctioned assembly side effect), so the face is live from the
   * entry's first render.
   * @param actions - bound actions of the local-files store instance.
   */
  attachLocalFiles(actions: LocalFilesActions): void {
    this.#localFiles = actions
  }

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

  /** Open the local-files browser from a starting directory for one session. */
  openLocalFiles(sessionId: string, start: string): void {
    this.#localFiles?.open(sessionId, start)
  }
}
