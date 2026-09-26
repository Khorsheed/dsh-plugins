/**
 * 「引用到侧边对话」: the side chat's entry in the finalized assistant
 * message's IconActions row (`conversation.chat.assistant-actions`, the
 * ui-message-feedback precedent). One click lands the message as a pending
 * ref on the side chat bound to THIS session (contextKey = the session id;
 * the host folds the message text from its journal by messageId, so the wire
 * carries no body), then surfaces the tab focused on that context.
 *
 * The seat is assistant-only: the user-message row has no actions extension
 * point upstream (MessageIconActions takes no extraActions there), and the
 * only user-message precedent — message-tools' full node shadow — would
 * collide with that plugin's own shadow. The gap is recorded as an upstream
 * candidate in the package's Agent Note.
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconRightUpOutlineMedium } from './icons.tsx'
import type { QuoteActionProps } from './contract.ts'
import css from './QuoteAction.module.css'

/** How long the「已引用」confirmation stays before the button resets. */
const DONE_MS = 1800

/** One message's quote-to-side-chat control. */
export function QuoteAction({ messageId, sessionId, useSessions, quote, openSideChat, t }: QuoteActionProps): ReactNode {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  // The source session's display name, recorded as the context label on a first quote.
  const sessionName = useSessions(sessions => sessions.byId[sessionId]?.displayTitle)

  const onClick = useCallback(() => {
    if (phase === 'busy') return
    setPhase('busy')
    void quote(sessionId, {
      messageId: String(messageId),
      ...sessionName === undefined ? {} : { label: sessionName },
    }).then((carried) => {
      if (!alive.current) return
      if (carried.ok && carried.value.ok) {
        setPhase('done')
        openSideChat(carried.value.contextKey)
        window.setTimeout(() => { if (alive.current) setPhase('idle') }, DONE_MS)
      } else {
        setPhase('error')
      }
    }, () => { if (alive.current) setPhase('error') })
  }, [phase, quote, openSideChat, sessionId, messageId, sessionName])

  return (
    <span className={css.root}>
      <Tooltip label={t('action.quote')} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={t('action.quote')}
          data-phase={phase}
          onClick={onClick}
        >
          <IconRightUpOutlineMedium />
        </button>
      </Tooltip>
      {phase === 'done' && <span className={css.notice}>{t('action.quoted')}</span>}
      {phase === 'error' && <span className={css.notice} data-tone="error">{t('action.quoteFailed')}</span>}
    </span>
  )
}
