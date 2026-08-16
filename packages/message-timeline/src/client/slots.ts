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
  /** Rail height in px (scrollport minus the composer seat). */
  height: number
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

/** Full props of the header-utilities entry. */
export type TimelineRailProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<TimelineRailInjected>
  & PropsLocale<'message-timeline'>
