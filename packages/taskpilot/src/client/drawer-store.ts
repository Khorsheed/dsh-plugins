/**
 * TaskPilot drawer store: open state plus the selected job address. One
 * handle is shared by the dock and the drawer registrations (the dock opens,
 * the drawer renders), so the two surfaces stay in lockstep without a module
 * singleton.
 *
 * @module dsh-taskpilot/client/drawer-store
 */

// Store engine value import: the engine rehomed out of client-runtime in
// 0.1.2-alpha.1; the bundle inlines dsh-client-store so the artifact boots on
// both host lines. EngineStoreHandle comes from the same package, type-only
// (erased at build).
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

export interface DrawerState {
  /** Whether the job detail drawer is open. */
  open: boolean
  /** The session owning the selected job, or null while closed. */
  sessionId: SessionId | null
  /** The selected job id, or null while closed. */
  jobId: string | null
}

/** Annotation twin of the actions literal below (drift fails at defineStore). */
export type DrawerActions = {
  openJob: (state: DrawerState, sessionId: SessionId, jobId: string) => void
  close: (state: DrawerState) => void
}

const INITIAL: DrawerState = {
  open: false,
  sessionId: null,
  jobId: null,
}

export type DrawerStoreHandle = EngineStoreHandle<DrawerState, DrawerActions>

export function createDrawerStore(): DrawerStoreHandle {
  return defineStore({
    init: (): DrawerState => ({ ...INITIAL }),
    actions: {
      openJob: (state, sessionId: SessionId, jobId: string) => {
        state.open = true
        state.sessionId = sessionId
        state.jobId = jobId
      },
      close: (state) => {
        state.open = false
        state.sessionId = null
        state.jobId = null
      },
    },
  })
}
