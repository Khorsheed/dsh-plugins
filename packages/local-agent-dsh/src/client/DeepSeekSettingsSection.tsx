import { useEffect, useState } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './DeepSeekSettingsSection.module.css'

/** The namespace section the toggle writes. */
export interface DeepSeekSettingsValue {
  /** Whether the dsh harness, provider, and delegation tool are registered. */
  enabled: boolean
}

/** Injected business face of the DeepSeek settings section. */
export interface DeepSeekSettingsInjected {
  /** Bound settings scope for the local-agent-dsh namespace. */
  scope: SettingsScope<DeepSeekSettingsValue>
  /**
   * Observe snapshot replacements of the bound scope.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe: (listener: () => void) => () => void
}

/** Full props for the DeepSeek settings section. */
export type DeepSeekSettingsProps = PropsLocale<typeof NS> & DeepSeekSettingsInjected

/**
 * The DeepSeek delegation toggle. One mutually-exclusive switch: ON registers
 * the dsh harness, the dsh-cli provider, and the subagent_dsh tool on the
 * host; OFF (default) leaves the official in-process subagent tools as the
 * only delegation path. The write goes through the bound settings scope, so
 * the host watcher flips the composition live.
 * @param props - locale text plus the bound scope and its subscription.
 */
export function DeepSeekSettingsSection(props: DeepSeekSettingsProps): JSX.Element {
  const { scope, subscribe, t } = props
  const [snapshot, setSnapshot] = useState<SettingsScopeSnapshot<DeepSeekSettingsValue>>(() => scope.getSnapshot())
  useEffect(() => subscribe(() => setSnapshot(scope.getSnapshot())), [scope, subscribe])
  const ready = snapshot.status === 'ready' && snapshot.writable
  const enabled = snapshot.value?.enabled ?? false
  const toggle = (): void => { void scope.set('enabled', !enabled) }
  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('settings.nav')}</h2>
      <p className={css.intro}>{t('settings.intro')}</p>
      <ul className={css.rows}>
        <li className={css.rowCard}>
          <div className={css.rowHead}>
            <span className={css.rowIdentity}>
              <span className={css.rowName}>DeepSeek</span>
              <span className={css.rowTag}>dsh</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={t('settings.switch')}
              className={`${css.switch} ${enabled ? css.switchOn : ''}`}
              disabled={!ready}
              onClick={toggle}
            >
              <span className={css.knob} />
            </button>
          </div>
          <p className={css.hint}>
            {!ready ? t('settings.unavailable') : t(enabled ? 'settings.on' : 'settings.off')}
          </p>
        </li>
      </ul>
    </div>
  )
}
