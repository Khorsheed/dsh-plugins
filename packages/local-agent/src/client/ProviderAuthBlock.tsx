import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCheckOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import { publishAuthStatus } from './auth-status.ts'
import type { LocalAgentHarnessView } from './LocalAgentRecordsAction.tsx'
import css from './LocalAgentSettingsSection.module.css'

/** Known harnesses the family plans to support; unregistered ones render as pending. */
export const KNOWN_HARNESSES: readonly LocalAgentHarnessView[] = [
  { id: 'kimi', label: 'Kimi Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude-code', label: 'Claude Code' },
]

/** How often a pending login's status is re-probed after the prompt surfaces. */
export const LOGIN_POLL_MS = 4_000

/** How long a pending login keeps being polled before the section gives up. */
export const LOGIN_POLL_LIMIT_MS = 5 * 60_000

/** The first http(s) URL in a login prompt, if any. */
export function parseLoginUrl(text: string): string | undefined {
  return /https?:\/\/\S+/.exec(text)?.[0]
}

/** Resolve a harness id to its display label for toast text. */
function harnessLabel(id: string): string {
  return KNOWN_HARNESSES.find(harness => harness.id === id)?.label ?? id
}

/** Per-harness view state: the last status, its capability flags, and the login prompt. */
interface HarnessView {
  status: 'checking' | 'authenticated' | 'anonymous' | 'unavailable'
  /** Whether the harness declares a login flow; absent keeps the current behavior. */
  loginable?: boolean
  /** Whether the harness declares a logout path; absent keeps the current behavior. */
  logoutable?: boolean
  loginText?: string
  loginUrl?: string
  /** A pty login waits for the user to paste the OAuth code. */
  loginAwaitingCode?: boolean
}

/**
 * Injected business face of the shared auth block — the subset of the
 * settings section's injected face one harness row consumes.
 */
export interface ProviderAuthInjected {
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

/** Full props for the shared per-harness auth block. */
export interface ProviderAuthBlockProps extends ProviderAuthInjected, PropsLocale<typeof NS> {
  /** The harness this block manages. */
  harness: LocalAgentHarnessView
  /** Global sessions hook (the slot runtime share, delivered to every slot). */
  useSessions: <T>(select: (state: SessionListState) => T) => T
  /**
   * Extra actions rendered at the end of the action row — the settings
   * section passes its `local-agent.settings.row-action` seat here.
   */
  actions?: ReactNode
}

/**
 * One harness's auth interactions, shared between the core settings section
 * row and the per-provider `settings.plugin.item` cards: auth status through
 * the read-only Remote channel and a web-login action that runs
 * `/<harness> login`, surfaces the device-code prompt, and offers a link to
 * the authorization page. The login command returns at prompt time while the
 * CLI polls in the background, so a pending login's status keeps being
 * re-probed until credentials land or the poll window expires. Status polls
 * ride the Remote channel and emit no session events; only the user-initiated
 * login/logout commands leave command nodes in the log.
 * @param props - the harness, the injected query/command faces, and copy.
 * @returns the block content (head row, prompts, and the login toast).
 */
export function ProviderAuthBlock({ harness, useSessions, status, runCommand, actions, t }: ProviderAuthBlockProps) {
  const sessionId = useSessions((state: SessionListState) => state.current)
  const [view, setView] = useState<HarnessView>({ status: 'checking' })
  /** The login start time while the device-code login is still pending. */
  const [pendingSince, setPendingSince] = useState<number | undefined>(undefined)
  /** A login-completion toast awaiting mount; seq forces a re-show for repeats. */
  const [loginToast, setLoginToast] = useState<{ seq: number } | null>(null)
  const toastSeq = useRef(0)
  /** OAuth code draft for a pty login awaiting a paste. */
  const [codeDraft, setCodeDraft] = useState('')

  const refresh = (): void => {
    const id = harness.id
    setView(prev => ({ ...prev, status: 'checking' }))
    void status(id).then((probe) => {
      const statusKind = probe === undefined ? 'unavailable'
        : probe.authenticated ? 'authenticated' : 'anonymous'
      // Card headers read the same probe through the status bus (the dot
      // flips the moment a login/logout lands, in every mounted card).
      publishAuthStatus(id, statusKind)
      const capabilities = probe === undefined
        ? {}
        : {
          loginable: probe.loginable ?? true,
          logoutable: probe.logoutable ?? true,
          ...probe.loginAwaitingCode === true ? { loginAwaitingCode: true } : {},
        }
      setView(prev =>
        // A completed login drops the stale device prompt.
        statusKind === 'authenticated'
          ? { status: statusKind, ...capabilities }
          : { ...prev, status: statusKind, ...capabilities })
      if (statusKind === 'authenticated') {
        setPendingSince((prev) => {
          // A pending→authenticated transition (a start time was tracked) is
          // the authorization-complete moment; surface it as a success toast.
          if (prev !== undefined) {
            toastSeq.current += 1
            setLoginToast({ seq: toastSeq.current })
          }
          return undefined
        })
      }
    }).catch(() => {
      publishAuthStatus(id, 'unavailable')
      setView(prev => ({ ...prev, status: 'unavailable' }))
    })
  }

  useEffect(() => {
    refresh()
  }, [harness.id, status, sessionId])

  useEffect(() => {
    if (sessionId === undefined || pendingSince === undefined) return
    const timer = window.setInterval(() => {
      if (Date.now() - pendingSince > LOGIN_POLL_LIMIT_MS) {
        setPendingSince(undefined)
        return
      }
      refresh()
    }, LOGIN_POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [pendingSince, status, sessionId, harness.id])

  const startLogin = (): void => {
    if (sessionId === undefined) return
    void runCommand(sessionId, `/${harness.id} login`).then((text) => {
      const text2 = text ?? ''
      const loginUrl = parseLoginUrl(text2)
      setView({
        status: 'checking',
        loginText: text2,
        ...loginUrl !== undefined && { loginUrl },
      })
      setPendingSince(Date.now())
    }).catch(() => {
      setView({ status: 'unavailable' })
    })
  }

  const signOut = (): void => {
    if (sessionId === undefined) return
    void runCommand(sessionId, `/${harness.id} logout`).then((text) => {
      // Show the sign-out reply where the device prompt renders (a missing
      // logout path is visible as its error text), then re-probe so the row
      // flips to not authenticated.
      setView({
        status: 'checking',
        loginText: text !== undefined && text.trim() !== '' ? text : t('settings.loggedOut'),
      })
      refresh()
    }).catch(() => {
      setView({ status: 'unavailable' })
    })
  }

  const statusKind = view.status
  const authenticated = statusKind === 'authenticated'
  const loginPending = pendingSince !== undefined
  // A harness without a login/logout flow (dsh authenticates through the host
  // credentials) must not offer the actions its command family would answer
  // with an error.
  const loginable = view.loginable ?? true
  const logoutable = view.logoutable ?? true

  return (
    <>
      <div className={css.rowHead}>
        <span className={css.rowIdentity}>
          <span className={css.rowName}>{harness.label}</span>
          <span
            className={`${css.credentialDot} ${authenticated ? css.dotOn : css.dotOff}`}
            role="img"
            aria-label={t(authenticated ? 'settings.authenticated' : 'settings.notAuthenticated')}
          />
          <span className={css.rowTag}>{harness.id}</span>
        </span>
        <span className={css.status}>
          {statusKind === 'checking' && t('loading')}
          {statusKind === 'authenticated' && t('settings.authenticated')}
          {statusKind === 'anonymous' && t('settings.notAuthenticated')}
          {statusKind === 'unavailable' && t('error')}
        </span>
        <span className={css.rowActions}>
          {authenticated && logoutable && (
            <button
              type="button"
              className={css.logoutButton}
              onClick={() => { signOut() }}
            >
              {t('settings.logout')}
            </button>
          )}
          {loginable && (
            <button
              type="button"
              className={css.loginButton}
              disabled={loginPending || sessionId === undefined}
              onClick={() => { startLogin() }}
            >
              {authenticated ? t('settings.reauthorize') : t('settings.login')}
            </button>
          )}
          {actions}
        </span>
      </div>
      {view.loginText !== undefined && (
        <div className={css.loginPrompt}>
          <span className={css.promptText}>{view.loginText}</span>
          {view.loginUrl !== undefined && (
            <a className={css.openPage} href={view.loginUrl} target="_blank" rel="noreferrer">
              {t('settings.openPage')}
            </a>
          )}
        </div>
      )}
      {view.loginAwaitingCode === true && (
        <div className={css.loginPrompt}>
          <input
            className={css.codeInput}
            value={codeDraft}
            placeholder={t('settings.pasteCode')}
            onChange={(event) => {
              setCodeDraft(event.currentTarget.value)
            }}
          />
          <button
            type="button"
            className={css.loginButton}
            disabled={codeDraft.trim() === ''}
            onClick={() => {
              const code = codeDraft.trim()
              if (code === '' || sessionId === undefined) return
              void runCommand(sessionId, `/${harness.id} code ${code}`).then((text) => {
                setView((prev) => {
                  // Drop the awaiting flag; the command reply becomes the prompt text.
                  const { loginAwaitingCode: _cleared, ...rest } = prev
                  return { ...rest, loginText: text ?? '' }
                })
                setCodeDraft('')
              })
            }}
          >
            {t('settings.submitCode')}
          </button>
        </div>
      )}
      {loginToast !== null && (
        <Toast
          key={loginToast.seq}
          text={t('settings.loginSuccess', { harness: harnessLabel(harness.id) })}
          icon={<IconCheckOutline16 />}
          onDone={() => { setLoginToast(null) }}
        />
      )}
    </>
  )
}
