/**
 * 重启后继续 surfaces (member-self-started-rounds M9, prototype
 * member-activity.html states 4–7):
 * - the composer banner — 「重启后已自动继续 N 位成员 · 设置 ✕」 while the
 *   room's own continue is under way, and the manual 「… 被重启打断 · 全部继续」
 *   (with the guard's reason when the room held a round back);
 * - the timeline row of the room's auto-continue: the line 「已自动继续：A、B
 *   （重启打断）· 设置」 and the message itself, from 「房间 · 自动」;
 * - the members page's short line (「重启后已继续」 / 「被重启打断」).
 *
 * 「设置」 opens the 重启后自动继续 switch in place: a chat row or the
 * composer cannot switch the conversation to the members tab (the host
 * hands `openView` to conversation views only).
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RoomSettings, RoomState } from '../types.ts'
import type { InterruptedRound } from '../restart-continue.ts'
import { autoContinueOn } from '../restart-continue.ts'
import { memberRestartLine, restartBanner } from './restart-view.ts'
import type { RoomMutationOutcome, RoomAutoContinueViewProps } from './slots.ts'
import css from './RoomRestart.module.css'

type T = TranslateNS<'room'>
type SetSettings = (patch: Partial<RoomSettings>) => Promise<RoomMutationOutcome>

/** The 「设置」 link and, opened, the 重启后自动继续 switch with its explanation. */
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

const DISMISSED_KEY = 'dsh-room:auto-continue-dismissed'

function dismissedSeq(sessionId: string): number | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(`${DISMISSED_KEY}:${sessionId}`)
    return raw === null || raw === undefined ? undefined : Number(raw)
  } catch {
    return undefined
  }
}

function dismiss(sessionId: string, seq: number): void {
  try { globalThis.localStorage?.setItem(`${DISMISSED_KEY}:${sessionId}`, String(seq)) } catch { /* private window: hidden for this render only */ }
}

/** One manual round's reason, as the banner's second line reads it. */
function reasonOf(round: InterruptedRound, t: T): string | undefined {
  return round.blocked === undefined ? undefined : t(`restart.blocked.${round.blocked}`)
}

/**
 * The composer banner(s). `onContinueAll` sends the continue message to the
 * manual rounds (the human's 「全部继续」).
 */
export function RoomRestartBanner({ sessionId, state, busy, onContinueAll, setSettings, t }: {
  readonly sessionId: string
  readonly state: RoomState | undefined
  readonly busy: boolean
  readonly onContinueAll: (rounds: readonly InterruptedRound[]) => void
  readonly setSettings?: SetSettings | undefined
  readonly t: T
}): ReactNode {
  const banner = restartBanner(state)
  const [hidden, setHidden] = useState<number | undefined>(() => dismissedSeq(sessionId))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const auto = banner.auto !== undefined && banner.auto.seq !== hidden ? banner.auto : undefined
  const manual = banner.manual
  if (auto === undefined && manual.length === 0) return null
  const names = manual.map(round => round.member)
  const reasons = manual.flatMap(round => {
    const reason = reasonOf(round, t)
    return reason === undefined ? [] : [manual.length === 1 ? reason : `${round.member}：${reason}`]
  })
  return (
    <div className={css.banners}>
      {auto !== undefined && (
        <div className={css.banner} role="status" data-testid="restart-auto-banner">
          <span className={css.bannerText}>
            {t('restart.auto.banner', { count: auto.names.length })}
            <span className={css.sep} aria-hidden> · </span>
            <SettingsLink setSettings={setSettings} open={settingsOpen} onOpen={setSettingsOpen} t={t} />
          </span>
          <button type="button" className={css.close} aria-label={t('restart.dismiss')} title={t('restart.dismiss')}
            onClick={() => { dismiss(sessionId, auto.seq); setHidden(auto.seq); setSettingsOpen(false) }}>×</button>
        </div>
      )}
      {manual.length > 0 && (
        <div className={css.banner} data-tone="warning" role="status" data-testid="restart-manual-banner">
          <span className={css.bannerText}>
            {manual.length === 1 && reasons.length > 0 ? t('composer.interruptedOne', { name: names[0]! }) : t('composer.interrupted', { count: manual.length, names: names.join('、') })}
            {reasons.map(reason => <span key={reason} className={css.why}>{reason}</span>)}
          </span>
          <button type="button" className={css.continueAll} disabled={busy} onClick={() => { onContinueAll(manual) }}>{t('composer.continueAll')}</button>
        </div>
      )}
      {settingsOpen && setSettings !== undefined && <SettingsPanel settings={state?.settings} setSettings={setSettings} t={t} />}
    </div>
  )
}

/** The timeline row of one auto-continue dispatch: the line and the message. */
export function RoomAutoContinueView({ node, sessionId, roomStore, setSettings, t }: RoomAutoContinueViewProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const data = node.data
  const names = data.targets.join('、')
  const save = setSettings === undefined ? undefined : (patch: Partial<RoomSettings>) => setSettings(sessionId, patch)
  return (
    <div className={css.auto} data-room-dispatch={data.seq} data-testid="restart-auto-row">
      <div className={css.line}>
        <span className={css.lineText}>
          {t('restart.auto.line', { names })}
          {save !== undefined && <><span className={css.sep} aria-hidden> · </span><SettingsLink setSettings={save} open={settingsOpen} onOpen={setSettingsOpen} t={t} /></>}
        </span>
      </div>
      {settingsOpen && save !== undefined && <SettingsPanel settings={state?.settings} setSettings={save} t={t} />}
      <div className={css.message}>
        <div className={css.messageHead}><b>{t('restart.auto.room')}</b><span className={css.tag}>{t('restart.auto.tag')}</span></div>
        <div className={css.cause}>{t('restart.auto.cause', { names })}</div>
        <p className={css.messageText}>{data.text}</p>
      </div>
    </div>
  )
}

/** The members page's restart line for one member (nothing when it does not apply). */
export function MemberRestartLineView({ state, member, t }: { readonly state: RoomState | undefined; readonly member: string; readonly t: T }): ReactNode {
  const line = memberRestartLine(state, member)
  if (line === undefined) return null
  if (line.kind === 'continued') {
    return (
      <div className={css.memberLine} data-testid="member-restart-line">
        <span className={css.pill} data-status="done">{t('restart.member.continued')}</span>
        <span>{t('restart.member.continuedHint')}</span>
      </div>
    )
  }
  return (
    <div className={css.memberLine} data-tone="warning" data-testid="member-restart-line">
      <span className={css.pill} data-status="lost">{t('restart.member.interrupted')}</span>
      <span>{line.blocked === undefined ? t('restart.member.interruptedHint') : t(`restart.blocked.${line.blocked}`)}</span>
    </div>
  )
}
