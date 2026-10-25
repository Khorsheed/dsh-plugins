/**
 * 「请求明细」: the session-header utility (`conversation.session.header.
 * utilities`, the worktrees badge's seat). One click opens the inspector tab
 * at the session's latest turn.
 *
 * @module @khorsheed/dsh-context-lens/client
 */
import type { ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InspectorUtilityProps } from './contract.ts'
import { IconRequestInspectorOutlineMedium } from './icons-local.tsx'
import css from './EntryIcon.module.css'

/** The session-header utility icon. */
export function HeaderInspectUtility({ sessionId, openLatest, t }: InspectorUtilityProps): ReactNode {
  return (
    <Tooltip label={t('action.inspect')} side="bottom">
      <button
        type="button"
        className={css.action}
        aria-label={t('action.inspect')}
        onClick={() => { openLatest(sessionId) }}
      >
        <IconRequestInspectorOutlineMedium />
      </button>
    </Tooltip>
  )
}
