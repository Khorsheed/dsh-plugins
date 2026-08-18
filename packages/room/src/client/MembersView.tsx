/**
 * Members view: the room session's 成员 conversation-view tab. Step 0 spike:
 * a placeholder roster body proving the tab registration; the real roster
 * (color dot, name capsule, provider, per-row actions) lands in Step 7.
 */
import type { ReactNode } from 'react'
import type { MembersViewProps } from './slots.ts'

/** The placeholder members roster. */
export function MembersView({ t }: MembersViewProps): ReactNode {
  return <div data-room-members="">{t('members.empty')}</div>
}
