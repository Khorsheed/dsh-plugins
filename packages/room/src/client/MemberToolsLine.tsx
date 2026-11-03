/**
 * The edit dialog's 模式工具 line (one line under Provider / 模式): how many
 * of the member's mode tools its CURRENT process holds, read from
 * local-agent's member-tools status, with 重新载入 when they are missing,
 * and 立即载入 when the member has no process yet but one can be started
 * (a resumed process lists its tools without a round).
 * Normal is one quiet line (`游戏开发 5 ✓ 查看▾`); missing turns amber with
 * the button inline and one plain sentence of why and when; a process that
 * never reported is neutral, never shown as broken. A reload on an idle
 * member happens now (a fresh process resumes the same conversation, no
 * model call); on a running member it waits for the round to end. The line
 * polls while the dialog is open, faster while a reload is in flight.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LocalAgentMemberToolsReload, LocalAgentMemberToolsStatus } from '@khorsheed/dsh-local-agent/types'
import type { MembersViewProps } from './slots.ts'
import { clock, count, memberToolsLine } from './member-tools-view.ts'
import css from './MemberToolsLine.module.css'

/** Poll intervals: while a reload is in flight (or was just asked for), and otherwise. */
const FAST_POLL_MS = 1_500
const SLOW_POLL_MS = 5_000
/** How long after a click the line keeps polling fast (the reload's result shows in place). */
const CLICK_WINDOW_MS = 30_000

export interface MemberToolsLineProps {
  readonly childSessionId: string
  /** The mode's short display name ("游戏开发"). */
  readonly modeName: string
  /** The member's CLI, named in the expanded footnote. */
  readonly provider: string
  /** The member is running a round: a reload waits for it to end. */
  readonly running: boolean
  readonly read: (childSessionId: string) => Promise<LocalAgentMemberToolsStatus | null | undefined>
  readonly reload: (childSessionId: string) => Promise<LocalAgentMemberToolsReload | undefined>
  readonly t: MembersViewProps['t']
}

/** The 模式工具 line. Renders nothing for a member without a mode (or without the family). */
export function MemberToolsLine({ childSessionId, modeName, provider, running, read, reload, t }: MemberToolsLineProps): ReactNode {
  const [status, setStatus] = useState<LocalAgentMemberToolsStatus | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [clickedAt, setClickedAt] = useState<number | undefined>(undefined)
  const [refusal, setRefusal] = useState<'no-process' | 'unsupported' | 'busy' | undefined>(undefined)
  // What the last click asked for: replace the process (重新载入) or start
  // one where there was none (立即载入); the in-place states word it.
  const [action, setAction] = useState<'reload' | 'start'>('reload')
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const refresh = useCallback(async () => {
    const next = await read(childSessionId).catch(() => undefined)
    if (alive.current) setStatus(next)
  }, [read, childSessionId])

  const pending = status?.reload !== undefined || (clickedAt !== undefined && Date.now() - clickedAt < CLICK_WINDOW_MS)
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, pending ? FAST_POLL_MS : SLOW_POLL_MS)
    return () => { clearInterval(timer) }
  }, [refresh, pending])

  const state = memberToolsLine(status, clickedAt)
  if (state.kind === 'hidden') return null

  const ask = async (kind: 'reload' | 'start' = 'reload'): Promise<void> => {
    setClickedAt(Date.now())
    setAction(kind)
    setRefusal(undefined)
    // 立即载入 goes through the same request: with no process, the host
    // starts one instead of replacing it.
    const answer = await reload(childSessionId).catch(() => undefined)
    if (!alive.current) return
    if (answer !== undefined && !answer.ok && (answer.reason === 'no-process' || answer.reason === 'unsupported' || answer.reason === 'busy')) setRefusal(answer.reason)
    await refresh()
  }
  const starting = action === 'start'
  const reloadLabel = running ? t('tools.reloadAfterRound') : t('tools.reload')
  // A member whose harness cannot replace its process (or that has none) gets no button.
  const canReload = status?.reloadable !== false
  const button = (tone: 'warn' | 'neutral'): ReactNode => !canReload ? null : (
    <button type="button" className={`${css.button} ${tone === 'warn' ? css.warnButton : ''}`} onClick={() => { void ask() }}>{reloadLabel}</button>
  )
  const chips = (received: readonly string[], missing: readonly string[]): ReactNode => (
    <div className={css.chips}>
      <div className={css.group}>
        <span className={css.groupName}>{modeName}</span>
        <span className={css.chipList}>
          {received.map(name => <span key={name} className={css.chip}>{name}</span>)}
          {missing.map(name => <span key={name} className={`${css.chip} ${css.missingChip}`}>{name}</span>)}
        </span>
      </div>
      <div className={css.group}>
        <span className={css.groupName} />
        <span className={css.foot}>{t('tools.footnote', { provider })}</span>
      </div>
    </div>
  )
  const refused = refusal === undefined ? null : <div className={css.hint}>{t(refusal === 'no-process' ? 'tools.refused.noProcess' : refusal === 'busy' ? 'tools.refused.busy' : 'tools.refused.unsupported')}</div>

  let row: ReactNode
  let below: ReactNode = null
  switch (state.kind) {
    case 'ok':
      row = <>
        <span className={css.count}>{modeName} {state.names.length}</span>
        <span className={css.ok} aria-label={t('tools.allLoaded')}>✓</span>
        <span className={css.actions}>
          <button type="button" className={css.link} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
            {open ? t('tools.collapse') : t('tools.view')}
          </button>
          {open && button('neutral')}
        </span>
      </>
      below = <>
        {open && chips(state.names, [])}
        {open && state.loadedAt !== undefined && <div className={css.hint}>{t('tools.loadedAt', { time: clock(state.loadedAt) })}</div>}
        {state.note?.kind === 'reloaded' && <div className={css.hint}>{t(starting ? 'tools.started' : 'tools.reloaded')}</div>}
        {state.note?.kind === 'auto' && <div className={css.hint}>{t('tools.autoReloaded', { time: clock(state.note.at), mode: modeName })}</div>}
      </>
      break
    case 'missing':
      row = <>
        <span className={css.count}>{modeName} {state.received.length}/{count(state.total)}</span>
        <span className={css.warn}>⚠ {state.cause === 'partial' ? t('tools.partlyMissing') : t('tools.missing')}</span>
        <span className={css.actions}>{button('warn')}</span>
      </>
      below = running
        ? <div className={`${css.hint} ${css.warnHint}`}>{t('tools.missingRunning')}</div>
        : <>
          <div className={`${css.hint} ${css.warnHint}`}>{missingReason(state, modeName, t, starting)}</div>
          {chips(state.received, state.missing)}
        </>
      break
    case 'reloading':
      row = <>
        <span className={css.count}>{modeName} <span className={css.muted}>{t(starting ? 'tools.starting' : 'tools.reloading')}</span></span>
        <span className={css.actions}><button type="button" className={css.button} disabled>{t(starting ? 'tools.start' : 'tools.reload')}</button></span>
      </>
      below = <div className={css.hint}>{t(starting ? 'tools.startHint' : 'tools.reloadingHint')}</div>
      break
    case 'scheduled':
      row = <>
        <span className={css.count}>{modeName} {state.received === state.total ? state.total : `${state.received}/${count(state.total)}`}</span>
        {state.received === state.total
          ? <span className={css.ok}>✓</span>
          : <span className={css.warn}>⚠ {t('tools.missing')}</span>}
        <span className={css.actions}><span className={css.muted}>{t('tools.scheduled')}</span></span>
      </>
      below = <div className={css.hint}>{t('tools.scheduledHint')}</div>
      break
    case 'unknown':
      if (state.hint === 'no-process') {
        row = <>
          <span className={css.count}>{modeName} {count(state.total)} <span className={css.muted}>· {t('tools.nextMessage')}</span></span>
          {state.startable === true && <span className={css.actions}>
            <button type="button" className={css.button} onClick={() => { void ask('start') }}>{t('tools.start')}</button>
          </span>}
        </>
        // Only a member whose process can be started now gets the button;
        // the others load with the next message, as the line says.
        if (state.startFailed === true) below = <div className={`${css.hint} ${css.warnHint}`}>{t('tools.startFailed')}</div>
        else if (state.startable === true) below = <div className={css.hint}>{t('tools.startHint')}</div>
        break
      }
      row = <>
        <span className={css.count}>{modeName} <span className={css.muted}>{state.hint === 'old' ? t('tools.unreported') : t('tools.notListedYet')}</span></span>
        <span className={css.actions}>{button('neutral')}</span>
      </>
      below = <div className={css.hint}>{state.hint === 'old' ? t('tools.unreportedHint') : t('tools.notListedYetHint')}</div>
      break
  }
  return (
    <div className={css.tools} data-state={state.kind}>
      <div className={css.row}>
        <span className={css.label}>{t('tools.label')}</span>
        {row}
      </div>
      {below}
      {refused}
    </div>
  )
}

/** The amber sentence under a missing line: when, and what it means, in plain words. */
function missingReason(state: Extract<ReturnType<typeof memberToolsLine>, { kind: 'missing' }>, mode: string, t: MembersViewProps['t'], started = false): string {
  const time = state.at === undefined ? '' : clock(state.at)
  if (state.afterReload) return t(started ? 'tools.stillMissingAfterStart' : 'tools.stillMissing', { time })
  switch (state.cause) {
    case 'failed': return t('tools.reason.failed', { time, mode })
    case 'empty': return t('tools.reason.empty', { time, mode })
    case 'partial': return t('tools.reason.partial', { time, count: state.missing.length })
  }
}
