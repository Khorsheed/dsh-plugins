/**
 * The floating dock's slot store: open state, the context it serves, and its
 * frame position. Persisted through the framework's own store persistence
 * (`persist` key), so the dock reopens where the user left it — the position
 * memory is the client store's, not a hand-rolled localStorage mirror.
 *
 * The store is ROOT-scoped (mounted once on `shell.overlay`) while the tab
 * that opens the dock is session-scoped, so the two meet through the
 * apply-closure controller (the worktrees panel-service pattern): the tab's
 * `openDock` reaches these actions, the dock's close reaches the tab's
 * `openTab`.
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** The dock's persisted state. */
export interface SideChatDockState {
  /** Whether the dock frame is open. */
  open: boolean
  /** The context the dock serves (null while never opened). */
  contextKey: string | null
  /** Frame position (px from the viewport's top-left, clamped on move). */
  x: number
  y: number
}

/** Annotation twin of the actions literal below. */
export type SideChatDockActions = {
  open: (draft: SideChatDockState, contextKey: string) => void
  close: (draft: SideChatDockState) => void
  setContext: (draft: SideChatDockState, contextKey: string) => void
  move: (draft: SideChatDockState, x: number, y: number) => void
}

/** The dock frame's home position before the first drag. */
const HOME_X = 96
const HOME_Y = 96

/**
 * Create the dock store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createSideChatDockStore(): EngineStoreHandle<SideChatDockState, SideChatDockActions> {
  return defineStore({
    persist: 'dsh.sidechat.dock',
    init: (): SideChatDockState => ({ open: false, contextKey: null, x: HOME_X, y: HOME_Y }),
    actions: {
      open: (d, contextKey: string) => {
        d.open = true
        d.contextKey = contextKey
      },
      close: (d) => {
        d.open = false
      },
      setContext: (d, contextKey: string) => {
        d.contextKey = contextKey
      },
      move: (d, x: number, y: number) => {
        d.x = x
        d.y = y
      },
    },
  })
}
