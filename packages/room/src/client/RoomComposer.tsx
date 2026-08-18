/**
 * Room composer takeover (Step 0 placeholder): registered into the
 * `conversation.composer` chain with a never-claiming selector, so this
 * component never renders — the entry proves the chain registration shape
 * only. Step 5 makes the selector parse @-mentions and take over dispatch.
 */
import type { ReactNode } from 'react'
import type { RoomComposerProps } from './slots.ts'

/** Never rendered while the selector returns null. */
export function RoomComposer(_props: RoomComposerProps): ReactNode {
  return null
}
