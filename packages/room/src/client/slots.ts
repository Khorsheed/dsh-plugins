/**
 * Slot-facing types of the room client half: the injected action face and the
 * composed props of its three spike slot entries.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge ('sidebar.footer.action').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls ui-conversation's SlotMap merges ('conversation.composer', 'conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'

/** Injected action face of the sidebar footer action. */
export interface NewRoomInjected {
  /** Create a room session through the Remote and open it. */
  createRoom: () => Promise<void>
}

/** Full props of the 'sidebar.footer.action' entry. */
export type NewRoomActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & InjectFace<NewRoomInjected>
  & PropsLocale<'room'>

/**
 * Full props of the 'conversation.composer' chain entry. The Step 0 selector
 * never claims the composer, so `matched` is null and the component never
 * renders; Step 5 narrows the match to a dispatch payload.
 */
export type RoomComposerProps =
  PropsRuntime<'conversation.composer'>
  & { matched: null }
  & PropsLocale<'room'>

/** Full props of the 'conversation.view' members-tab entry. */
export type MembersViewProps =
  PropsRuntime<'conversation.view'>
  & PropsLocale<'room'>
