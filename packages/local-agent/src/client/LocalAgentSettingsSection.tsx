import { useEffect, useState } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { LocalAgentRosterRow } from '@khorsheed/dsh-local-agent/types'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type { LocalAgentHarnessView } from './LocalAgentRecordsAction.tsx'
import {
  KNOWN_HARNESSES, ProviderAuthBlock, type ProviderAuthInjected,
} from './ProviderAuthBlock.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from './slot-contract.ts'
import css from './LocalAgentSettingsSection.module.css'

// The auth block owns the constants/helpers; the section re-exports them so
// existing imports (tests included) keep working.
export { LOGIN_POLL_LIMIT_MS, LOGIN_POLL_MS, parseLoginUrl } from './ProviderAuthBlock.tsx'

/** Injected business face of the settings section. */
export interface LocalAgentSettingsInjected extends ProviderAuthInjected {
  /** Registered harnesses, in registration order. */
  roster: () => Promise<readonly LocalAgentRosterRow[] | undefined>
}

/** Full props for the settings section. */
export type LocalAgentSettingsProps =
  PropsRuntime<'settings.section'> & PropsLocale<typeof NS>
  & PropsRenderSlots<'local-agent.settings.row' | 'local-agent.settings.row-action'>
  & LocalAgentSettingsInjected

/**
 * Settings section managing the registered local-agent harnesses: one
 * ProviderAuthBlock per registered harness (auth status, web login,
 * device-code prompt, OAuth code paste — the same block the per-provider
 * settings cards embed) plus placeholder rows for known-but-unregistered
 * harnesses. Roster and status ride the read-only Remote channel (no session
 * events); only the user-initiated login/logout commands leave command nodes
 * in the log.
 * @param props - runtime slot currency plus the injected query and command faces.
 * @returns the section content.
 */
export function LocalAgentSettingsSection({ useSessions, runCommand, roster, status, t, renderSlot }: LocalAgentSettingsProps) {
  const sessionId = useSessions((state: SessionListState) => state.current)
  const [registered, setRegistered] = useState<readonly LocalAgentHarnessView[]>([])
  /** Whether the last roster fetch failed; the retry button bumps the tick. */
  const [rosterFailed, setRosterFailed] = useState(false)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (sessionId === undefined) return
    let cancelled = false
    void roster().then((rows) => {
      if (cancelled) return
      if (rows === undefined) {
        setRosterFailed(true)
        return
      }
      setRosterFailed(false)
      const harnesses = rows.map(row => ({ id: row.name, label: row.displayName }))
      setRegistered(harnesses)
    }).catch(() => {
      // A failed roster fetch leaves the section empty; surface it as an
      // explicit error with a retry instead of silently greying every row.
      if (!cancelled) setRosterFailed(true)
    })
    return () => { cancelled = true }
  }, [roster, retryTick, sessionId])

  if (sessionId === undefined) {
    return (
      <div className={css.section}>
        <h2 className={css.title}>{t('settings.nav')}</h2>
        <p className={css.intro}>{t('settings.noSession')}</p>
      </div>
    )
  }

  const registeredIds = new Set(registered.map(harness => harness.id))
  const harnesses = [
    ...registered,
    ...KNOWN_HARNESSES.filter(harness => !registeredIds.has(harness.id)),
  ]

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('settings.nav')}</h2>
      <p className={css.intro}>{t('settings.intro')}</p>
      {rosterFailed && (
        <p className={css.rosterError} role="alert">
          <span>{t('settings.rosterFailed')}</span>
          <button type="button" className={css.retryButton} onClick={() => { setRetryTick(tick => tick + 1) }}>
            {t('settings.retry')}
          </button>
        </p>
      )}
      <ul className={css.rows}>
        {harnesses.map((harness) => {
          const pending = !registeredIds.has(harness.id)
          return (
            <li key={harness.id} className={pending ? `${css.rowCard} ${css.rowPending}` : css.rowCard}>
              {pending
                ? (
                  <div className={css.rowHead}>
                    <span className={css.rowIdentity}>
                      <span className={css.rowName}>{harness.label}</span>
                      <span
                        className={`${css.credentialDot} ${css.dotPending}`}
                        role="img"
                        aria-label={t('settings.unsupported')}
                      />
                      <span className={css.rowTag}>{harness.id}</span>
                    </span>
                    <span className={css.status}>{t('settings.unsupported')}</span>
                    <span className={css.rowActions}>
                      <button type="button" className={css.loginButton} disabled>
                        {t('settings.unsupported')}
                      </button>
                      {/* Harness-owned per-row actions (e.g. the dsh
                          enable/disable toggle), keyed to this harness id. */}
                      {renderSlot('local-agent.settings.row-action', {}, { only: harness.id })}
                    </span>
                  </div>
                )
                : (
                  <ProviderAuthBlock
                    harness={harness}
                    useSessions={useSessions}
                    status={status}
                    runCommand={runCommand}
                    t={t}
                    actions={renderSlot('local-agent.settings.row-action', {}, { only: harness.id })}
                  />
                )}
            </li>
          )
        })}
      </ul>
      {/* Harness-owned extra rows (e.g. the dsh enable/disable toggle), drawn
          below the harness list; the section never knows which harness they
          belong to. */}
      {renderSlot('local-agent.settings.row', {})}
    </div>
  )
}
