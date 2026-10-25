/**
 * The members tab's 协作设置, built on the host primitives so it reads like
 * the host's own settings: a full-row DisclosureRow (closed by default, the
 * current values as its collapsed summary), SegmentedControls for the
 * choices and Switches. Two groups: 协作 (how members message each other,
 * the hop limit of one chain of messages, pause) and 自动判断 — the room's
 * decision scenarios (decisions.ts), one switch each; report timing carries
 * its threshold and longest wait in a box of its own.
 */
import { useState, type ReactNode } from 'react'
import { DisclosureRow, SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RoomSettings } from '../types.ts'
import { IconAgentPresetOutlineMedium } from './icons.tsx'
import type { MembersViewProps, RoomMutationOutcome } from './slots.ts'
import css from './RoomSettingsView.module.css'

/** The settings block. */
export function RoomSettingsView({ settings, onChange, t }: {
  readonly settings: RoomSettings
  readonly onChange: (patch: Partial<RoomSettings>) => Promise<RoomMutationOutcome>
  readonly t: MembersViewProps['t']
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const change = (patch: Partial<RoomSettings>): void => {
    void onChange(patch).then(outcome => { setError(outcome.ok ? null : outcome.message) })
  }
  const judged = settings.reportTiming === 'judge'
  const step = (value: number, delta: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round((value + delta) * 10) / 10))
  const summary = [
    settings.memberMessages === 'free' ? t('settings.free') : t('settings.confirm'),
    t('settings.hopSummary', { count: settings.hopLimit }),
    ...settings.paused ? [t('settings.pausedSummary')] : [],
  ].join(' · ')
  return (
    <div className={css.settings}>
      <DisclosureRow
        icon={<IconAgentPresetOutlineMedium />}
        title={t('settings.title')}
        open={open}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setOpen(value => !value) }}
        collapsedContent={<span className={settings.paused ? css.valuesPaused : css.values}>{summary}</span>}
      >
        <div className={css.rows}>
          <div className={css.group}>{t('settings.groupCollab')}</div>
          <div className={css.row}>
            <span className={css.label}>
              <b>{t('settings.messages')}</b>
              <span>{t('settings.messagesHint')}</span>
            </span>
            <SegmentedControl
              id="room-settings-messages"
              label={t('settings.messages')}
              value={settings.memberMessages}
              options={[{ value: 'free', label: t('settings.free') }, { value: 'confirm', label: t('settings.confirm') }]}
              onChange={(memberMessages) => { change({ memberMessages }) }}
            />
          </div>
          <div className={css.row}>
            <span className={css.label}>
              <b>{t('settings.hops')}</b>
              <span>{t('settings.hopsHint')}</span>
            </span>
            <span className={css.stepper}>
              <button type="button" aria-label={t('settings.hopsLess')} disabled={settings.hopLimit <= 2}
                onClick={() => { change({ hopLimit: settings.hopLimit - 1 }) }}>−</button>
              <b aria-live="polite">{settings.hopLimit}</b>
              <button type="button" aria-label={t('settings.hopsMore')} disabled={settings.hopLimit >= 50}
                onClick={() => { change({ hopLimit: settings.hopLimit + 1 }) }}>＋</button>
            </span>
          </div>
          <div className={css.row}>
            <span className={css.label}>
              <b>{t('settings.pause')}</b>
              <span>{t('settings.pauseHint')}</span>
            </span>
            <Switch checked={settings.paused} label={t('settings.pause')} onChange={(paused) => { change({ paused }) }} />
          </div>
          <div className={css.row}>
            <span className={css.label}>
              <b>{t('settings.helpReminder')}</b>
              <span>{t('settings.helpReminderHint')}</span>
            </span>
            <span className={css.stepper}>
              <button type="button" aria-label={t('settings.less')} disabled={settings.helpReminderMinutes <= 10}
                onClick={() => { change({ helpReminderMinutes: settings.helpReminderMinutes - 10 }) }}>−</button>
              <b aria-live="polite">{t('settings.minutes', { count: settings.helpReminderMinutes })}</b>
              <button type="button" aria-label={t('settings.more')} disabled={settings.helpReminderMinutes >= 120}
                onClick={() => { change({ helpReminderMinutes: settings.helpReminderMinutes + 10 }) }}>＋</button>
            </span>
          </div>
          <div className={css.group}>{t('settings.groupAuto')}</div>
          <div className={css.row}>
            <span className={css.label}>
              <b>{t('settings.autoFiling')}</b>
              <span>{t('settings.autoFilingHint')}</span>
            </span>
            <Switch checked={settings.autoTaskFiling} label={t('settings.autoFiling')} onChange={(autoTaskFiling) => { change({ autoTaskFiling }) }} />
          </div>
          <div className={css.row}>
            <span className={css.label}>
              <b>{t('settings.autoReport')}</b>
              <span>{t('settings.autoReportHint')}</span>
            </span>
            <Switch checked={judged} label={t('settings.autoReport')} onChange={(on) => { change({ reportTiming: on ? 'judge' : 'each' }) }} />
          </div>
          {judged && (
            <div className={css.subbox}>
              <div className={css.subrow}>
                <span className={css.label}>
                  <b>{t('settings.reportThreshold')}</b>
                  <span>{t('settings.reportThresholdHint')}</span>
                </span>
                <span className={css.stepper}>
                  <button type="button" aria-label={t('settings.less')} disabled={settings.reportThreshold <= 0.1}
                    onClick={() => { change({ reportThreshold: step(settings.reportThreshold, -0.1, 0.1, 0.9) }) }}>−</button>
                  <b aria-live="polite">{settings.reportThreshold.toFixed(1)}</b>
                  <button type="button" aria-label={t('settings.more')} disabled={settings.reportThreshold >= 0.9}
                    onClick={() => { change({ reportThreshold: step(settings.reportThreshold, 0.1, 0.1, 0.9) }) }}>＋</button>
                </span>
              </div>
              <div className={css.subrow}>
                <span className={css.label}>
                  <b>{t('settings.reportWait')}</b>
                  <span>{t('settings.reportWaitHint')}</span>
                </span>
                <span className={css.stepper}>
                  <button type="button" aria-label={t('settings.less')} disabled={settings.reportWaitMinutes <= 1}
                    onClick={() => { change({ reportWaitMinutes: settings.reportWaitMinutes - 1 }) }}>−</button>
                  <b aria-live="polite">{t('settings.minutes', { count: settings.reportWaitMinutes })}</b>
                  <button type="button" aria-label={t('settings.more')} disabled={settings.reportWaitMinutes >= 30}
                    onClick={() => { change({ reportWaitMinutes: settings.reportWaitMinutes + 1 }) }}>＋</button>
                </span>
              </div>
            </div>
          )}
          {error !== null && <p className={css.error} role="alert">{error}</p>}
        </div>
      </DisclosureRow>
    </div>
  )
}
