/**
 * The per-comment 追问 affordance (agent comments only), shared by the board's
 * comment thread and the detail page's: one button, one glyph. The trailing
 * arrow used to be a bare `→` character — the one "icon" in the package that
 * was not one; it is the host's open-elsewhere glyph now, the same one the
 * attachment link wears.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import { IconRightUpOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

/** 追问 on one agent comment: the words plus the go-there glyph. */
export function FollowUp({ t, className, onFollowUp }: {
  readonly t: TranslateNS<'canvas'>
  /** The caller's own module class — the two call sites style it their own way. */
  readonly className: string | undefined
  readonly onFollowUp: () => void
}): ReactNode {
  return (
    <button type="button" className={className} onClick={onFollowUp}>
      {t('chat.followup')}
      <IconRightUpOutlineMedium size={10} />
    </button>
  )
}
