/**
 * The panel's transient store: which project is open and on which tab. The
 * project data itself is re-read from the host (it is shared with the model).
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

export type VideoTab = 'sources' | 'transcript' | 'export' | 'settings'

export interface VideoStudioState {
  /** null = the project list. */
  projectId: string | null
  tab: VideoTab
  /** Bumped to make the open view re-read the host. */
  rev: number
}

export type VideoStudioActions = {
  open: (draft: VideoStudioState, projectId: string | null) => void
  tab: (draft: VideoStudioState, tab: VideoTab) => void
  refresh: (draft: VideoStudioState) => void
}

export function createVideoStudioStore(): EngineStoreHandle<VideoStudioState, VideoStudioActions> {
  return defineStore({
    init: (): VideoStudioState => ({ projectId: null, tab: 'sources', rev: 0 }),
    actions: {
      open: (d, projectId: string | null) => {
        d.projectId = projectId
      },
      tab: (d, tab: VideoTab) => {
        d.tab = tab
      },
      refresh: (d) => {
        d.rev += 1
      },
    },
  })
}
