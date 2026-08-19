/**
 * Sidebar footer action: the「+ New room」button beside Settings. Creates the
 * room through the Remote with the inherited workspace cwd (see inheritCwd in
 * client/index.ts) and opens it; a refusal (no workspace to inherit from, or
 * a transport failure) shows as a brief error line under the button.
 */
import { useState, type ReactNode } from 'react'
import type { NewRoomActionProps } from './slots.ts'

/** The fade-out lifetime of the creation error line. */
const ERROR_MS = 4_000

/** The New room footer action button. */
export function NewRoomAction({ createRoom, t }: NewRoomActionProps): ReactNode {
  const [error, setError] = useState<string | null>(null)

  const onClick = async (): Promise<void> => {
    setError(null)
    const outcome = await createRoom()
    if (!outcome.ok) {
      setError(outcome.message)
      setTimeout(() => { setError(null) }, ERROR_MS)
    }
  }

  return (
    <div>
      <button type="button" onClick={() => { void onClick() }}>
        {t('action.newRoom')}
      </button>
      {error !== null && <div role="alert">{error}</div>}
    </div>
  )
}
