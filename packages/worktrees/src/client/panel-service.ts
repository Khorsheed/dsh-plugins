/**
 * The worktrees panel controller: the cross-plugin face the session-scoped
 * badge entries call to open the root-scoped drawer. The drawer's store
 * actions are attached by the shell.overlay entry's inject; a gesture that
 * lands before the drawer ever mounted is a no-op (the drawer opens on the
 * next real open).
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
}
