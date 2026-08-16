/**
 * FilePreviewController: the cross-plugin panel-action face behind
 * ctx.filePreviewPanel. The file view's per-session store instances are
 * attached under their session ids by the conversation.view entry's inject
 * (the view mounts per session), so a link gesture routes to the right
 * session's actions; a gesture that lands before the view ever mounted parks
 * a pending path that the next attach applies.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createFilePreviewStore } from './file-preview-store.ts'

/** The file view store's bound action set (framework-baked, draft params peeled). */
export type FilePreviewActions = BoundActions<ReturnType<typeof createFilePreviewStore>>

/** The outward file-preview panel face (`ctx.filePreviewPanel`). */
export interface IFilePreviewPanel {
  /** Open the file view for one session (no-op when already open). */
  open(sessionId: SessionId): void
  /** Open the file view for one session and preview one recorded file path. */
  openPath(sessionId: SessionId, path: string): void
}

/** Cross-plugin panel-action face (ctx.filePreviewPanel). */
export class FilePreviewController implements IFilePreviewPanel {
  #drawer: FilePreviewActions | undefined
  #attached = new Map<SessionId, FilePreviewActions>()
  /** Paths requested before the owning session's view ever mounted. */
  #pending = new Map<SessionId, string>()

  /**
   * Adopt one session's file-view store actions. Called from that session's
   * view entry inject (a sanctioned assembly side effect), so a gesture
   * arriving before the first mount parks a pending path applied here.
   * @param sessionId - the owning session.
   * @param actions - bound actions of that session's file-view store.
   */
  attachSession(sessionId: SessionId, actions: FilePreviewActions): void {
    this.#attached.set(sessionId, actions)
    const pending = this.#pending.get(sessionId)
    if (pending !== undefined) {
      this.#pending.delete(sessionId)
      actions.openPath(pending)
    }
  }

  /**
   * Adopt the root overlay drawer's store actions. Called from that entry's
   * inject (a sanctioned assembly side effect), so the face is live from the
   * entry's first render.
   * @param actions - bound actions of the drawer's store instance.
   */
  attachDrawer(actions: FilePreviewActions): void {
    this.#drawer = actions
  }

  /** Open the preview surface for one session (no-op when already open). */
  open(sessionId: SessionId): void {
    if (this.#drawer !== undefined) {
      this.#drawer.open()
      return
    }
    this.#require(sessionId).open()
  }

  /** Open the preview surface and show one recorded file path. */
  openPath(sessionId: SessionId, path: string): void {
    this.#drawer?.openPath(path)
    const view = this.#attached.get(sessionId)
    if (view !== undefined) {
      // Keep the file view's selection in step when it has mounted, without
      // switching to it — the drawer previews in place.
      view.openPath(path)
    } else {
      // Parked for the session's view to apply on its next mount.
      this.#pending.set(sessionId, path)
    }
  }

  /** Open the drawer for one path (the turn-row gesture; no view sync — the
   * turn row has no session handle, and the drawer needs none). */
  openDrawer(path: string): void {
    this.#drawer?.openPath(path)
  }

  #require(sessionId: SessionId): FilePreviewActions {
    // Callers are UI gestures, which cannot fire before the session's view
    // entry rendered (the inject hook runs in its first render) — reaching
    // this unwired is a boot-order bug, not a race to tolerate.
    const actions = this.#attached.get(sessionId)
    if (actions === undefined) {
      throw new Error(`filePreviewPanel: session "${sessionId}" has no attached file view`)
    }
    return actions
  }
}
