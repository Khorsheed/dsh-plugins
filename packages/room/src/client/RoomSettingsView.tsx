/**
 * The members tab's 协作设置, built on the host primitives so it reads like
 * the host's own settings: a full-row DisclosureRow (closed by default, the
 * current values as its collapsed summary), SegmentedControls for the
 * choices and a Switch for pause. Rows: how members message each other, when
 * a report is handed to the member waiting on it, the hop limit of one chain
 * of messages, and pause.
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
  const summary = [
    settings.memberMessages === 'free' ? t('settings.free') : t('settings.confirm'),
    settings.reportTiming === 'judge' ? t('settings.reportJudge') : t('settings.reportEach'),
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
              <b>{t('settings.report')}</b>
              <span>{t('settings.reportHint')}</span>
            </span>
            <SegmentedControl
              id="room-settings-report"
              label={t('settings.report')}
              value={settings.reportTiming}
              options={[{ value: 'judge', label: t('settings.reportJudge') }, { value: 'each', label: t('settings.reportEach') }]}
              onChange={(reportTiming) => { change({ reportTiming }) }}
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
          {error !== null && <p className={css.error} role="alert">{error}</p>}
        </div>
      </DisclosureRow>
    </div>
  )
}
