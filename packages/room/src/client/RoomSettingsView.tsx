/**
 * The members tab's 协作设置: how members may message each other (freely,
 * or held for the human's confirmation), how long one causal chain may run
 * before the room stops relaying automatically, and a pause switch that
 * holds every agent message until resumed. Folded by default; the summary
 * line states the current values so the closed state is still informative.
 */
import { useState, type ReactNode } from 'react'
import type { RoomSettings } from '../types.ts'
import type { MembersViewProps, RoomMutationOutcome } from './slots.ts'
import css from './RoomSettingsView.module.css'

/** The settings block. */
export function RoomSettingsView({ settings, onChange, t }: {
  readonly settings: RoomSettings
  readonly onChange: (patch: Partial<RoomSettings>) => Promise<RoomMutationOutcome>
  readonly t: MembersViewProps['t']
}): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const change = (patch: Partial<RoomSettings>): void => {
    void onChange(patch).then(outcome => { setError(outcome.ok ? null : outcome.message) })
  }
  const summary = [
    settings.memberMessages === 'free' ? t('settings.free') : t('settings.confirm'),
    t('settings.hopSummary', { count: settings.hopLimit }),
    ...settings.paused ? [t('settings.pausedSummary')] : [],
  ].join(' · ')
  return (
    <details className={css.settings}>
      <summary className={css.summary}>
        <span className={css.title}>{t('settings.title')}</span>
        <span className={settings.paused ? css.valuesPaused : css.values}>{summary}</span>
      </summary>
      <div className={css.rows}>
        <div className={css.row}>
          <span className={css.label}>
            <b>{t('settings.messages')}</b>
            <span>{t('settings.messagesHint')}</span>
          </span>
          <span className={css.segment} role="radiogroup" aria-label={t('settings.messages')}>
            {(['free', 'confirm'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={settings.memberMessages === mode}
                className={settings.memberMessages === mode ? css.segmentOn : css.segmentOff}
                onClick={() => { if (settings.memberMessages !== mode) change({ memberMessages: mode }) }}
              >
                {mode === 'free' ? t('settings.free') : t('settings.confirm')}
              </button>
            ))}
          </span>
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
          <button
            type="button"
            role="switch"
            aria-checked={settings.paused}
            aria-label={t('settings.pause')}
            className={settings.paused ? css.switchOn : css.switchOff}
            onClick={() => { change({ paused: !settings.paused }) }}
          />
        </div>
        {error !== null && <p className={css.error} role="alert">{error}</p>}
      </div>
    </details>
  )
}
