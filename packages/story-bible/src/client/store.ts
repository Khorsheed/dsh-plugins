/**
 * The surface's shared store: one instance in the client bundle's apply
 * closure, published into both tabs' faces (`hooks.story`, which the slot
 * runtime materializes into the `useStory` prop).
 *
 * It holds two things. The `rev` field is the cross-tab freshness channel:
 * whichever seat mutates the work touches the store (the apply-level face
 * wrappers do it centrally), and every reader re-reads — the main session's
 * agent writes through its story_* tools unannounced, so a visible tab also
 * bumps it on a slow beat. The rest is the surface's own layout state: which
 * fragments view is showing, which character the 角色记忆 pane stands on and
 * its chapter cursor, and which chapter the reader shows. Focus itself is
 * NOT here — it is host-side per session (the store's `focusWork` Remote),
 * and the tabs mirror it.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The five fragments views (proposal §6). */
export type FragmentsView = 'wall' | 'sets' | 'characters' | 'world' | 'info'

/** What the tabs share. */
export interface StoryUiState {
  /** Bumped on every work mutation from either seat (a re-read trigger). */
  readonly rev: number
  /** The fragments tab's active view. */
  readonly fragmentsView: FragmentsView
  /** The 角色记忆 pane's selected character id. */
  readonly cmCharacterId: string | null
  /** The 心智时间游标: show only what was true截至第 N 章 (null = the latest). */
  readonly cmCursor: number | null
  /** The chapter the reader shows (null = auto: the planning chapter, else the newest). */
  readonly readerN: number | null
  /** Bumped by the extract row's 「去处理」 so the pending queue pulses into view. */
  readonly pendingPulse: number
}

/** The shared feed's published shape. */
export type StoryUiSource = SnapshotStore<StoryUiState>

/** The empty surface. */
const EMPTY: StoryUiState = {
  rev: 0, fragmentsView: 'wall', cmCharacterId: null, cmCursor: null, readerN: null, pendingPulse: 0,
}

/** The shared store: `touch` notes a mutation; the rest are layout writes. */
export class StoryUiStore {
  /** The published feed. */
  readonly source: StoryUiSource = createSnapshotStore<StoryUiState>(EMPTY)

  /** Note that the work changed under the open tabs (any seat's mutation). */
  touch(): void {
    const current = this.source.getSnapshot()
    this.source.set({ ...current, rev: current.rev + 1 })
  }

  /** Switch the fragments tab's view. */
  setFragmentsView(view: FragmentsView): void {
    const current = this.source.getSnapshot()
    if (current.fragmentsView === view) return
    this.source.set({ ...current, fragmentsView: view })
  }

  /** Select the 角色记忆 pane's character (and reset nothing else). */
  setCmCharacter(id: string | null): void {
    const current = this.source.getSnapshot()
    if (current.cmCharacterId === id) return
    this.source.set({ ...current, cmCharacterId: id })
  }

  /** Move the 心智时间游标 (null = latest). */
  setCmCursor(n: number | null): void {
    const current = this.source.getSnapshot()
    if (current.cmCursor === n) return
    this.source.set({ ...current, cmCursor: n })
  }

  /** Point the reader at one chapter (the toolview plan row's 「去确认」). */
  openReaderAt(n: number | null): void {
    const current = this.source.getSnapshot()
    if (current.readerN === n) return
    this.source.set({ ...current, readerN: n })
  }

  /** Pulse the pending queue (the extract row's 「去处理」). */
  pulsePending(): void {
    const current = this.source.getSnapshot()
    this.source.set({ ...current, pendingPulse: current.pendingPulse + 1, fragmentsView: 'wall' })
  }
}
