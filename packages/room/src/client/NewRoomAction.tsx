/**
 * Sidebar footer action: the「新建 Room」button beside Settings, wearing the
 * official New Session button's chrome (SidebarRoot's `.newSession` register:
 * elevated fill, l2 hairline, r12, floating hover fill, 14px leading glyph +
 * 14/22/500 label; the 56px rail collapses it to the icon-only 36px
 * transparent button) with the multi-agent glyph (IconAgentPresetOutline16)
 * in the icon seat. Creates the room through the Remote with the inherited
 * workspace cwd (see inheritCwd in client/index.ts) and opens it; a refusal
 * (no workspace to inherit from, or a transport failure) shows as a brief
 * error line under the button.
 */
import { useState, type ReactNode } from 'react'
import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NewRoomActionProps } from './slots.ts'
import css from './NewRoomAction.module.css'

/** The fade-out lifetime of the creation error line. */
const ERROR_MS = 4_000

/** The New room footer action button. */
export function NewRoomAction({ wide, createRoom, t }: NewRoomActionProps): ReactNode {
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
    <div className={css.root}>
      <button
        type="button"
        className={css.action}
        data-collapsed={!wide || undefined}
        aria-label={t('action.newRoom')}
        onClick={() => { void onClick() }}
      >
        <IconAgentPresetOutline16 size={wide ? 14 : 18} />
        {wide && <span className={css.label}>{t('action.newRoom')}</span>}
      </button>
      {error !== null && <div className={css.error} role="alert">{error}</div>}
    </div>
  )
}
