/**
 * Slot-facing types of the message-timeline client half: the injected action
 * face (jump/loadOlder plus the rail geometry hook) and the composed props of
 * the `conversation.session.header.utilities` entry.
 */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-conversation's SlotMap merge (the header utilities slot)
// and the runtime's SessionStandardProps merge (useSession / sessionId).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'

/**
 * Live rail geometry plus the currently visible user message, published by
 * the apply-world DOM tracker through the reserved hooks compartment.
 */
export interface TimelineRailState {
  /** The session whose scrollport the state describes; undefined while none is current. */
  sessionId: string | undefined
  /** False while the official DOM probe is unanswered (rail hidden). */
  ready: boolean
  /** Viewport x of the rail's left edge. */
  left: number
  /** Viewport y of the rail's top edge (below the session header). */
  top: number
  /**
   * Rail height in px: the scrollport from below the tab strip down to the
   * chat input card top — dock cards (goal/todo/queue) above the input never
   * shorten it, so the timeline stays flush with the chat box.
   */
  height: number
  /** Scrollport width in px (the degraded width cap when the flow probe fails). */
  scrollportWidth: number
  /**
   * Viewport x of the message flow's left edge (the official centered
   * content column), or null while the probe is unanswered. The panel's
   * right edge never crosses it, so the width adapts to the left gutter.
   */
  flowLeft: number | null
  /** Key of the user message row nearest the visible top, or null. */
  activeKey: string | null
  /** Whether the chat view (not trajectory or another tab) is rendered. */
  chatView: boolean
}

/** Injected action face of the header-utilities entry. */
export interface TimelineRailInjected {
  /** Whether steering messages count as rows (config). */
  includeSteering: boolean
  /** Timeline panel width in px (config). */
  panelWidth: number
  /** History pages to prefetch when the panel opens (config). */
  initialPages: number
  /** Pull one older history page for the rendered session. */
  loadOlder: () => Promise<void>
  /** Scroll the transcript to the user message row addressed by `key`. */
  jumpTo: (key: string) => void
  hooks: {
    /** Live panel geometry and active marker for the current session. */
    rail: HostObservable<TimelineRailState>
  }
}

/** One row's data: the addressed node key plus the node itself, for preview. */
export interface TimelineItem {
  /** Stable chat node key (the `data-chat-anchor-key` the jump targets). */
  readonly key: string
  /** The underlying chat node, for content preview. */
  readonly node: ChatConversationViewNode
}

/**
 * Whether a chat node kind produces a timeline row: every visible
 * user-message bubble in the transcript. Beyond the plain `user`/`steering`
 * kinds, message-tools' in-place edit replacement (`message-tools-edited`)
 * and withdraw-then-restore replay (`message-tools-restored`) render as user
 * bubbles — the rail must keep them, or an edit that replaces the surface
 * tail (which hides the withdrawn originals out of the chat order) would
 * drain the whole rail. The edited kind does not record whether its source
 * was a steering message, so `includeSteering` cannot apply to it.
 * @param kind - the chat node kind.
 * @param includeSteering - whether steering messages count as rows.
 * @returns whether the kind belongs on the rail.
 */
export function isTimelineRowKind(kind: string, includeSteering: boolean): boolean {
  return kind === 'user'
    || (includeSteering && kind === 'steering')
    || kind === 'message-tools-edited'
    || kind === 'message-tools-restored'
}

/** Full props of the header-utilities entry. */
export type TimelineRailProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<TimelineRailInjected>
  & PropsLocale<'message-timeline'>
