/**
 * The restart surfaces that are not a round's own card (restart-recovery
 * consolidation, prototype restart-recovery.html ①③):
 * - the composer line, the one place the room asks the human after a host
 *   restart — 「N 位成员被重启打断：A、B · 停止 · 全部继续」 (or 「这个目标被重启
 *   打断」), shown only when the room did not continue on its own;
 * - the timeline node of the room's own 「全部继续」: 「房间 · 自动」, the
 *   message itself, and 「设置」.
 *
 * 「设置」 opens the 重启后自动继续 switch in place: a chat row cannot switch
 * the conversation to the members tab (the host hands `openView` to
 * conversation views only).
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RoomSettings, RoomState } from '../types.ts'
import type { InterruptedRound } from '../restart-continue.ts'
import { autoContinueOn } from '../restart-continue.ts'
import { restartBanner } from './restart-view.ts'
import type { RoomMutationOutcome, RoomAutoContinueViewProps } from './slots.ts'
import css from './RoomRestart.module.css'

type T = TranslateNS<'room'>
type SetSettings = (patch: Partial<RoomSettings>) => Promise<RoomMutationOutcome>

/** The 「设置」 link. */
function SettingsLink({ setSettings, open, onOpen, t }: {
  readonly setSettings: SetSettings | undefined
  readonly open: boolean
  readonly onOpen: (open: boolean) => void
  readonly t: T
}): ReactNode {
  if (setSettings === undefined) return null
  return (
    <button type="button" className={css.link} aria-expanded={open} onClick={() => { onOpen(!open) }}>{t('restart.settings')}</button>
  )
}

function SettingsPanel({ settings, setSettings, t }: { readonly settings: RoomSettings | undefined; readonly setSettings: SetSettings; readonly t: T }): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const on = autoContinueOn(settings)
  return (
    <div className={css.panel} data-testid="restart-settings">
      <span className={css.panelText}>
        <b>{t('settings.autoContinue')}</b>
        <span>{t('settings.autoContinueHint')}</span>
        {error !== null && <span className={css.error} role="alert">{error}</span>}
      </span>
      <Switch checked={on} label={t('settings.autoContinue')} onChange={(autoContinueAfterRestart) => {
        void setSettings({ autoContinueAfterRestart }).then(outcome => { setError(outcome.ok ? null : outcome.message) })
      }} />
    </div>
  )
}

/** One round's reason, when the human cannot see it elsewhere. */
function reasonOf(round: InterruptedRound, t: T): string | undefined {
  return round.blocked === undefined ? undefined : t(`restart.blocked.${round.blocked}`)
}

/**
 * The composer line. `onContinue` is the human's 「全部继续」 (the same
 * action the room's auto-continue takes; a goal resumes), `onStop` its
 * 「停止」 (not continued; what queued behind goes out).
 */
export function RoomRestartBanner({ state, busy, onContinue, onStop, t }: {
  readonly state: RoomState | undefined
  readonly busy: boolean
  readonly onContinue: (rounds: readonly InterruptedRound[], goal: boolean) => void
  readonly onStop?: ((rounds: readonly InterruptedRound[], goal: boolean) => void) | undefined
  readonly t: T
}): ReactNode {
  const { manual, goal } = restartBanner(state)
  if (manual.length === 0 && goal === undefined) return null
  const names = manual.map(round => round.member)
  const reasons = manual.flatMap(round => {
    const reason = reasonOf(round, t)
    return reason === undefined ? [] : [manual.length === 1 ? reason : `${round.member}：${reason}`]
  })
  const text = manual.length === 0 ? t('composer.goalInterrupted')
    : manual.length === 1 ? t('composer.interruptedOne', { name: names[0]! })
      : t('composer.interrupted', { count: manual.length, names: names.join('、') })
  return (
    <div className={css.banner} role="status" data-testid="restart-manual-banner">
      <span className={css.bannerText}>{text}</span>
      {onStop !== undefined && <button type="button" className={css.stop} disabled={busy} onClick={() => { onStop(manual, goal !== undefined) }}>{t('composer.stopInterrupted')}</button>}
      <button type="button" className={css.continueAll} disabled={busy} onClick={() => { onContinue(manual, goal !== undefined) }}>{t('composer.continueAll')}</button>
      {reasons.map(reason => <span key={reason} className={css.why}>{reason}</span>)}
    </div>
  )
}

/** A restart continuation's own timeline message, attributed to the room's automatic action or the human's button. */
export function RoomAutoContinueView({ node, sessionId, roomStore, setSettings, t }: RoomAutoContinueViewProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const data = node.data
  const save = setSettings === undefined ? undefined : (patch: Partial<RoomSettings>) => setSettings(sessionId, patch)
  return (
    <div className={css.auto} data-room-dispatch={data.seq} data-testid="restart-auto-row">
      <span className={css.who}>{t(data.manual === true ? 'restart.manual.who' : 'restart.auto.who')}</span>
      <p className={css.message}>{data.text}</p>
      {save !== undefined && <span className={css.autoLink}><SettingsLink setSettings={save} open={settingsOpen} onOpen={setSettingsOpen} t={t} /></span>}
      {settingsOpen && save !== undefined && <SettingsPanel settings={state?.settings} setSettings={save} t={t} />}
    </div>
  )
}
