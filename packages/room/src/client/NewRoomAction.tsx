/**
 * Sidebar footer action: the「+ New room」button beside Settings. Step 0
 * spike: creates the room through the Remote and opens it; workspace/cwd
 * inheritance arrives with the real creation flow.
 */
import type { ReactNode } from 'react'
import type { NewRoomActionProps } from './slots.ts'

/** The New room footer action button. */
export function NewRoomAction({ createRoom, t }: NewRoomActionProps): ReactNode {
  return (
    <button type="button" onClick={() => { void createRoom() }}>
      {t('action.newRoom')}
    </button>
  )
}
