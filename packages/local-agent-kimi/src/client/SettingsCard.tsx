import { useState } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings.plugin.item keyed-slot SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { IconChevronDownOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
// The shared auth block is bundled from the family core's source — the
// sanctioned core/companion edge (the host half already depends on the core);
// the block carries no runtime identity to share.
import {
  ProviderAuthBlock, type ProviderAuthBlockProps, type ProviderAuthInjected,
} from '@khorsheed/dsh-local-agent/src/client/ProviderAuthBlock.tsx'
import { AuthStatusDot } from '@khorsheed/dsh-local-agent/src/client/AuthStatusDot.tsx'
import { useHarnessAuthStatus } from '@khorsheed/dsh-local-agent/src/client/auth-status.ts'
import { NS } from './locales.ts'
import css from './SettingsCard.module.css'

/** The `local-agent-kimi` settings namespace section the card edits. */
export interface KimiLiveSettings {
  /** Resident (live) mode: one resident `kimi acp` process per member. */
  live?: boolean
  /** Live mirror granularity: folded events or per-chunk streaming. */
  liveMirrorGranularity?: 'event' | 'token'
}

/** Injected face of the kimi settings card. */
export interface KimiSettingsCardInjected {
  /** Bound settings scope for the local-agent-kimi namespace. */
  scope: SettingsScope<KimiLiveSettings>
  /** The auth block's query/command faces, backed by the family core Remote. */
  auth: ProviderAuthInjected
  /** Translate bound to the family core's `local-agent` namespace (the auth block's copy lives there). */
  authT: ProviderAuthBlockProps['t']
  hooks: {
    /** The same scope as a hooks source, so the card reacts to external writes. */
    settings: SettingsScope<KimiLiveSettings>
  }
}

/** Full props of the settings.plugin.item card entry. */
export type KimiSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<KimiSettingsCardInjected>
  & PropsLocale<typeof NS>

/**
 * The kimi harness settings card in the plugin configuration tab: the same
 * collapsible chrome the official plugin cards use, re-implemented locally
 * (the bundle-purity gate forbids value-importing the official chrome — the
 * context-guard pattern). The body carries the family core's shared
 * ProviderAuthBlock and the resident-mode block; both writes go through the
 * bound settingsScope immediately (revision-fenced), so a flip takes effect
 * on the next delegation round without a reload. Explanation copy lives in
 * hover/focus bubbles behind ⓘ anchors — the card's rows stay one line each.
 * @param props - runtime slot currency, the injected scope/auth faces, and copy.
 * @returns the card.
 */
export function KimiSettingsCard({ useSettings, scope, auth, authT, useSessions, t }: KimiSettingsCardProps) {
  const snapshot: SettingsScopeSnapshot<KimiLiveSettings> = useSettings(value => value)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  const ready = snapshot.status === 'ready' && snapshot.writable
  const live = snapshot.value?.live ?? false
  const granularity = snapshot.value?.liveMirrorGranularity ?? 'event'

  const write = (field: string, value: unknown): void => {
    setSaved(false)
    setError(false)
    void scope.set(field, value).then(() => { setSaved(true) }, () => { setError(true) })
  }

  const title = t('card.title')
  // The at-a-glance credential dot in the collapsed header: every mount
  // re-probes (a credential expiring mid-session must flip the dot at the
  // next view); the bus dedupes identical results, so no re-render storm.
  const authStatus = useHarnessAuthStatus('kimi', auth.status)
  const dotLabel = authT(
    authStatus === 'authenticated' ? 'settings.authenticated'
      : authStatus === 'anonymous' ? 'settings.notAuthenticated'
        : authStatus === 'checking' ? 'loading' : 'error',
  )
  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'card.collapse' : 'card.expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.nameRow}>
            <span className={css.name}>{title}</span>
            <AuthStatusDot status={authStatus} label={dotLabel} />
          </span>
          <span className={css.description}>{t('card.description')}</span>
        </span>
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open && (
        <div className={css.body}>
          <section className={css.block}>
            <h3 className={css.blockTitle}>{t('auth.title')}</h3>
            <ProviderAuthBlock
              harness={{ id: 'kimi', label: 'Kimi Code' }}
              useSessions={useSessions}
              status={auth.status}
              runCommand={auth.runCommand}
              t={authT}
            />
          </section>
          <section className={css.block}>
            <div className={css.row}>
              <span className={css.rowLabel}>
                {t('live.title')}
                <Tooltip label={t('live.info')} side="bottom" maxWidth={360}>
                  <button type="button" className={css.info} aria-label={t('live.info.aria')}>ⓘ</button>
                </Tooltip>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={live}
                aria-label={t('live.title')}
                className={live ? `${css.switch} ${css.switchOn}` : css.switch}
                disabled={!ready}
                onClick={() => { write('live', !live) }}
              >
                <span className={css.knob} />
              </button>
            </div>
            <div className={css.row}>
              <span className={css.rowLabel}>
                {t('live.granularity')}
                <Tooltip label={t('live.granularity.info')} side="bottom" maxWidth={360}>
                  <button type="button" className={css.info} aria-label={t('live.granularity.info.aria')}>ⓘ</button>
                </Tooltip>
              </span>
              <label className={css.option}>
                <input
                  type="radio"
                  name="local-agent-kimi-granularity"
                  checked={granularity === 'event'}
                  disabled={!ready}
                  onChange={() => { write('liveMirrorGranularity', 'event') }}
                />
                {t('live.granularity.event')}
              </label>
              <label className={css.option}>
                <input
                  type="radio"
                  name="local-agent-kimi-granularity"
                  checked={granularity === 'token'}
                  disabled={!ready}
                  onChange={() => { write('liveMirrorGranularity', 'token') }}
                />
                {t('live.granularity.token')}
              </label>
            </div>
            {saved && <span className={css.saved}>{t('live.applied')}</span>}
            {error && <span className={css.errorText}>{t('live.error')}</span>}
            {snapshot.status === 'unavailable' && (
              <span className={css.hint}>{t('live.unavailable')}</span>
            )}
          </section>
        </div>
      )}
    </li>
  )
}
