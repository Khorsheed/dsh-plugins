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
  /** Open the local-files browser from a starting directory (no-op when not mounted). */
  openLocalFiles(start: string): void
}

/** Cross-plugin panel-action face (ctx.worktreesPanel). */
export class WorktreesController implements IWorktreesPanel {
  #drawer: WorktreesActions | undefined
  #localFiles: LocalFilesActions | undefined

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

  /** Open the local-files browser from a starting directory. */
  openLocalFiles(start: string): void {
    this.#localFiles?.open(start)
  }
}
