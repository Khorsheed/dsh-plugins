import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LocalAgentRosterRow, LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent/types'
import { IconChevronDownOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './LocalAgentRecordsAction.module.css'

/** One harness the family renders a trigger for. */
export interface LocalAgentHarnessView {
  /** Harness command prefix, e.g. `kimi`. */
  id: string
  /** Trigger label, e.g. `Kimi`. */
  label: string
}

/** Injected business face of the session-header records action. */
export interface LocalAgentRecordsActionInjected {
  /** Registered harnesses, in registration order. */
  roster: () => Promise<readonly LocalAgentRosterRow[] | undefined>
  /**
   * One harness's scoped sessions, narrowed to the given dsh session's cwd.
   * @param name - the harness name.
   * @param sessionId - the dsh session whose workspace the records must match.
   */
  sessions: (name: string, sessionId: SessionId) => Promise<readonly LocalAgentSessionRecord[] | undefined>
}

/** Full props for the session-header records action. */
export type LocalAgentRecordsActionProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS> & LocalAgentRecordsActionInjected

/** Load phases of the on-demand listing fetch. */
type LoadState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'unavailable' }
  | { phase: 'error' }
  | { phase: 'loaded'; records: readonly LocalAgentSessionRecord[] }

/** One harness's records dropdown: trigger and popover. */
export function RecordsDropdown({ harness, sessionId, listRecords, t }: {
  harness: LocalAgentHarnessView
  sessionId: SessionId
  listRecords: (sessionId: SessionId) => Promise<readonly LocalAgentSessionRecord[] | undefined>
  t: LocalAgentRecordsActionProps['t']
}) {
  const [open, setOpen] = useState(false)
  const [load, setLoad] = useState<LoadState>({ phase: 'idle' })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    setLoad({ phase: 'loading' })
    let cancelled = false
    void listRecords(sessionId).then((records) => {
      if (cancelled) return
      setLoad(records === undefined
        ? { phase: 'unavailable' }
        : { phase: 'loaded', records })
    }).catch(() => {
      if (!cancelled) setLoad({ phase: 'error' })
    })
    return () => { cancelled = true }
  }, [open, listRecords, sessionId])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  const rows = useMemo(() => (load.phase === 'loaded' ? load.records : []), [load])
  const empty = load.phase === 'loaded' && rows.length === 0

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('list.aria', { harness: harness.label })}
        onClick={() => { setOpen(value => !value) }}
      >
        {harness.label}
        <IconChevronDownOutlineMedium className={open ? css.triggerOpen : undefined} />
      </button>
      {open && (
        <ul className={css.menu} role="listbox" aria-label={t('list.title', { harness: harness.label })}>
          {load.phase === 'loading' && <li className={css.row}>{t('loading')}</li>}
          {load.phase === 'unavailable' && <li className={css.row}>{t('unknown.command', { harness: harness.label, command: harness.id })}</li>}
          {load.phase === 'error' && <li className={css.row}>{t('error', { harness: harness.label })}</li>}
          {empty && (
            <li className={css.row}>
              <span className={css.label}>{t('empty', { harness: harness.label })}</span>
            </li>
          )}
          {empty && <li className={css.row}>{t('login.hint', { command: harness.id })}</li>}
          {rows.map(row => (
            <li key={row.id} className={css.row} role="option" aria-label={t('row.aria', { harness: harness.label, sessionId: row.id })}>
              <span className={css.label} title={row.id}>{row.id}</span>
              <span className={css.kind}>{t('workdir')}</span>
              <span className={css.status} title={row.workDir}>{row.workDir}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Session-header entry point for the local-agent family: fetches the harness
 * roster through the local-agent Remote channel on mount and renders one
 * records dropdown per harness. The Remote channel is read-only and emits no
 * session events, so these UI refreshes never leave command nodes in the log.
 * @param props - runtime slot currency plus the injected query face.
 * @returns the per-harness triggers and their popovers.
 */
export function LocalAgentRecordsAction({ sessionId, roster, sessions, t }: LocalAgentRecordsActionProps) {
  const [harnesses, setHarnesses] = useState<readonly LocalAgentHarnessView[]>([])

  useEffect(() => {
    let cancelled = false
    void roster().then((rows) => {
      if (cancelled || rows === undefined) return
      setHarnesses(rows.map(row => ({ id: row.name, label: row.displayName })))
    }).catch(() => {
      // A failed roster fetch leaves the header without triggers; the settings
      // section surfaces the failure with a retry instead.
    })
    return () => { cancelled = true }
  }, [roster])

  const listRecords = (id: string) => (target: SessionId): Promise<readonly LocalAgentSessionRecord[] | undefined> =>
    sessions(id, target)

  return (
    <div className={css.family}>
      {harnesses.map(harness => (
        <RecordsDropdown
          key={harness.id}
          harness={harness}
          sessionId={sessionId}
          listRecords={listRecords(harness.id)}
          t={t}
        />
      ))}
    </div>
  )
}
