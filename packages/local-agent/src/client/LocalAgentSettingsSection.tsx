import { useEffect, useState } from 'react'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { LocalAgentRosterRow, LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type { LocalAgentHarnessView } from './LocalAgentRecordsAction.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './LocalAgentSettingsSection.module.css'

/** Known harnesses the family plans to support; unregistered ones render as pending. */
const KNOWN_HARNESSES: readonly LocalAgentHarnessView[] = [
  { id: 'kimi', label: 'Kimi Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude-code', label: 'Claude Code' },
]

/** How often a pending login's status is re-probed after the prompt surfaces. */
export const LOGIN_POLL_MS = 4_000

/** How long a pending login keeps being polled before the section gives up. */
export const LOGIN_POLL_LIMIT_MS = 5 * 60_000

/** Injected business face of the settings section. */
export interface LocalAgentSettingsInjected {
  /** Registered harnesses, in registration order. */
  roster: () => Promise<readonly LocalAgentRosterRow[] | undefined>
  /** One harness's auth status. */
  status: (name: string) => Promise<LocalAgentStatus | undefined>
  /**
   * Run one user-initiated slash-command line (login/logout) against the
   * session's agent and return the command result text, or undefined when
   * unavailable.
   * @param sessionId - the target session.
   * @param line - the full command line.
   */
  runCommand: (sessionId: SessionId, line: string) => Promise<string | undefined>
}

/** Full props for the settings section. */
export type LocalAgentSettingsProps =
  PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & LocalAgentSettingsInjected

/** Per-harness view state: the last status and the login prompt. */
interface HarnessView {
  status: 'checking' | 'authenticated' | 'anonymous' | 'unavailable'
  loginText?: string
  loginUrl?: string
}

/** The first http(s) URL in a login prompt, if any. */
export function parseLoginUrl(text: string): string | undefined {
  return /https?:\/\/\S+/.exec(text)?.[0]
}

/**
 * Settings section managing the registered local-agent harnesses: per-harness
 * auth status through the read-only Remote channel and a web-login action
 * that runs `/<harness> login`, surfaces the device-code prompt, and offers a
 * link to the authorization page. The login command returns at prompt time
 * while the CLI polls in the background, so a pending login's status keeps
 * being re-probed until credentials land or the poll window expires. Status
 * polls ride the Remote channel and emit no session events; only the
 * user-initiated login/logout commands leave command nodes in the log.
 * @param props - runtime slot currency plus the injected query and command faces.
 * @returns the section content.
 */
export function LocalAgentSettingsSection({ useSessions, runCommand, roster, status, t }: LocalAgentSettingsProps) {
  const sessionId = useSessions((state: SessionListState) => state.current)
  const [registered, setRegistered] = useState<readonly LocalAgentHarnessView[]>([])
  const [views, setViews] = useState<Readonly<Record<string, HarnessView>>>({})
  /** Harness ids whose device-code login is still pending, keyed by start time. */
  const [pendingLogins, setPendingLogins] = useState<Readonly<Record<string, number>>>({})
  /** Whether the last roster fetch failed; the retry button bumps the tick. */
  const [rosterFailed, setRosterFailed] = useState(false)
  const [retryTick, setRetryTick] = useState(0)

  const refresh = (id: string): void => {
    setViews((prev) => {
      const current = prev[id]
      return { ...prev, [id]: { ...current, status: 'checking' } }
    })
    void status(id).then((probe) => {
      const statusKind = probe === undefined ? 'unavailable'
        : probe.authenticated ? 'authenticated' : 'anonymous'
      setViews((prev) => {
        const current = prev[id]
        // A completed login drops the stale device prompt.
        return { ...prev, [id]: statusKind === 'authenticated' ? { status: statusKind } : { ...current, status: statusKind } }
      })
      if (statusKind === 'authenticated') {
        setPendingLogins((prev) => {
          if (prev[id] === undefined) return prev
          return Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id))
        })
      }
    }).catch(() => {
      setViews((prev) => {
        const current = prev[id]
        return { ...prev, [id]: { ...current, status: 'unavailable' } }
      })
    })
  }

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
      for (const harness of harnesses) refresh(harness.id)
    }).catch(() => {
      // A failed roster fetch leaves the section empty; surface it as an
      // explicit error with a retry instead of silently greying every row.
      if (!cancelled) setRosterFailed(true)
    })
    return () => { cancelled = true }
  }, [roster, retryTick, sessionId])

  useEffect(() => {
    if (sessionId === undefined) return
    const pending = Object.entries(pendingLogins)
    if (pending.length === 0) return
    const timers = pending.map(([id, startedAt]) =>
      window.setInterval(() => {
        if (Date.now() - startedAt > LOGIN_POLL_LIMIT_MS) {
          setPendingLogins((prev) => {
            if (prev[id] === undefined) return prev
            return Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id))
          })
          return
        }
        refresh(id)
      }, LOGIN_POLL_MS))
    return () => { for (const timer of timers) window.clearInterval(timer) }
  }, [pendingLogins, status])

  const startLogin = (id: string): void => {
    if (sessionId === undefined) return
    void runCommand(sessionId, `/${id} login`).then((text) => {
      const text2 = text ?? ''
      const loginUrl = parseLoginUrl(text2)
      setViews(prev => ({ ...prev, [id]: {
        status: 'checking',
        loginText: text2,
        ...loginUrl !== undefined && { loginUrl },
      } }))
      setPendingLogins(prev => ({ ...prev, [id]: Date.now() }))
    }).catch(() => {
      setViews(prev => ({ ...prev, [id]: { status: 'unavailable' } }))
    })
  }

  const signOut = (id: string): void => {
    if (sessionId === undefined) return
    void runCommand(sessionId, `/${id} logout`).then((text) => {
      // Show the sign-out reply where the device prompt renders (a missing
      // logout path is visible as its error text), then re-probe so the row
      // flips to not authenticated.
      setViews(prev => ({ ...prev, [id]: {
        status: 'checking',
        loginText: text !== undefined && text.trim() !== '' ? text : t('settings.loggedOut'),
      } }))
      refresh(id)
    }).catch(() => {
      setViews(prev => ({ ...prev, [id]: { status: 'unavailable' } }))
    })
  }

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
          const view = views[harness.id]
          const status = view?.status ?? 'checking'
          const authenticated = status === 'authenticated'
          const pending = !registeredIds.has(harness.id)
          const loginPending = pendingLogins[harness.id] !== undefined
          return (
            <li key={harness.id} className={pending ? `${css.rowCard} ${css.rowPending}` : css.rowCard}>
              <div className={css.rowHead}>
                <span className={css.rowIdentity}>
                  <span className={css.rowName}>{harness.label}</span>
                  <span
                    className={`${css.credentialDot} ${pending ? css.dotPending : (authenticated ? css.dotOn : css.dotOff)}`}
                    role="img"
                    aria-label={pending ? t('settings.unsupported') : t(authenticated ? 'settings.authenticated' : 'settings.notAuthenticated')}
                  />
                  <span className={css.rowTag}>{harness.id}</span>
                </span>
                <span className={css.status}>
                  {pending && t('settings.unsupported')}
                  {!pending && status === 'checking' && t('loading')}
                  {!pending && status === 'authenticated' && t('settings.authenticated')}
                  {!pending && status === 'anonymous' && t('settings.notAuthenticated')}
                  {!pending && status === 'unavailable' && t('error')}
                </span>
                <span className={css.rowActions}>
                  {authenticated && (
                    <button
                      type="button"
                      className={css.logoutButton}
                      onClick={() => { signOut(harness.id) }}
                    >
                      {t('settings.logout')}
                    </button>
                  )}
                  <button
                    type="button"
                    className={css.loginButton}
                    disabled={pending || loginPending}
                    onClick={() => { startLogin(harness.id) }}
                  >
                    {pending
                      ? t('settings.unsupported')
                      : authenticated ? t('settings.reauthorize') : t('settings.login')}
                  </button>
                </span>
              </div>
              {view?.loginText !== undefined && (
                <div className={css.loginPrompt}>
                  <span className={css.promptText}>{view.loginText}</span>
                  {view.loginUrl !== undefined && (
                    <a className={css.openPage} href={view.loginUrl} target="_blank" rel="noreferrer">
                      {t('settings.openPage')}
                    </a>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
