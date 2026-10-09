/**
 * 「请求明细」: the per-turn icon in the finalized assistant message's
 * IconActions row (`conversation.chat.assistant-actions`, the
 * ui-message-feedback seat). One click resolves the message's turn
 * (`TurnListItem.closingMessageId`, latest-turn fallback — the resolution
 * lives in the injected `open`) and opens the inspector tab on it.
 *
 * @module @khorsheed/dsh-request-inspector/client
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InspectorActionProps } from './contract.ts'
import { IconRequestInspectorOutlineMedium } from './icons.tsx'
import css from './EntryIcon.module.css'

/** One message's request-inspector control. */
export function TurnInspectAction({ messageId, sessionId, open, t }: InspectorActionProps): ReactNode {
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  return (
    <Tooltip label={t('action.inspect')} side="bottom">
      <button
        type="button"
        className={css.action}
        aria-label={t('action.inspect')}
        disabled={busy}
        onClick={() => {
          if (busy) return
          setBusy(true)
          // open never throws: resolution failure falls back to the latest
          // turn, a missing tab type logs and no-ops.
          void open(sessionId, String(messageId)).finally(() => {
            if (alive.current) setBusy(false)
          })
        }}
      >
        <IconRequestInspectorOutlineMedium />
      </button>
    </Tooltip>
  )
}
