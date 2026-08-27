/**
 * The at-a-glance credential dot for the settings-card headers: the same
 * visual as the family settings section's per-harness row dot (green =
 * authenticated, red = not, grey = checking/unavailable).
 * @module @khorsheed/dsh-local-agent/client — auth status dot
 */

import type { HarnessAuthStatusKind } from './auth-status.ts'
import css from './AuthStatusDot.module.css'

/** Props for the credential dot. */
export interface AuthStatusDotProps {
  /** The latest known status kind. */
  status: HarnessAuthStatusKind
  /** The localized aria label (the card's auth copy namespace). */
  label: string
}

/** One 8px status dot with an accessible label. */
export function AuthStatusDot({ status, label }: AuthStatusDotProps) {
  const modifier = status === 'authenticated' ? css.dotOn
    : status === 'anonymous' ? css.dotOff
    : css.dotPending
  return <span className={`${css.credentialDot} ${modifier}`} role="img" aria-label={label} data-auth-status={status} />
}
