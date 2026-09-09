/**
 * The worktrees panel controller: the cross-plugin face the session-scoped
 * badge entries call to open the root-scoped drawer or the local-files
 * browser. The surfaces' store actions are attached by their shell.overlay
 * entries' inject; a gesture that lands before the surface ever mounted is a
 * no-op (the surface opens on the next real open).
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLocalFilesStore } from './store-local.ts'
import type { createWorktreesStore, DrawerMode } from './store.ts'

/** The drawer store's bound action set (framework-baked, draft params peeled). */
export type WorktreesActions = BoundActions<ReturnType<typeof createWorktreesStore>>

/** The local-files browser store's bound action set. */
export type LocalFilesActions = BoundActions<ReturnType<typeof createLocalFilesStore>>

/** The outward worktrees panel face. */
export interface IWorktreesPanel {
  /** Open the drawer in one mode (no-op when already open). */
  open(mode: DrawerMode): void
  /** Open the local-files browser from a starting directory for one session. */
  openLocalFiles(sessionId: string, start: string): void
}

/** Cross-plugin panel-action face (ctx.worktreesPanel). */
export class WorktreesController implements IWorktreesPanel {
  #drawer: WorktreesActions | undefined
  #localFiles: LocalFilesActions | undefined
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

  /**
   * Adopt the local-files browser's store actions. Called from that entry's
   * inject, same assembly contract as {@link attachDrawer}.
   * @param actions - bound actions of the local-files store instance.
   */
  attachLocalFiles(actions: LocalFilesActions): void {
    this.#localFiles = actions
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

  /** Open the local-files browser from a starting directory for one session. */
  openLocalFiles(sessionId: string, start: string): void {
    this.#localFiles?.open(sessionId, start)
  }
}
