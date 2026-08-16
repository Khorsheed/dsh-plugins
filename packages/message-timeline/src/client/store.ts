/**
 * Per-session rail viewing state: whether the floating rail is expanded. A
 * declared store survives header remounts and session switches, so the
 * expansion choice survives re-renders that would reset component state. The
 * highlighted message is not stored: it derives from the live reading
 * position the rail tracker publishes.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Rail viewing state for one session. */
export interface TimelineStoreState {
  /** Whether the floating rail is expanded. */
  open: boolean
}

/** Declared action shape of the rail store. */
type TimelineActions = {
  setOpen: (draft: TimelineStoreState, open: boolean) => void
}

/**
 * Declares the per-session rail visibility state and its write surface.
 * @returns the store handle.
 */
export function createTimelineStore(): EngineStoreHandle<TimelineStoreState, TimelineActions> {
  return defineStore({
    init: (): TimelineStoreState => ({ open: true }),
    actions: {
      setOpen: (draft, open) => { draft.open = open },
    },
  })
}
