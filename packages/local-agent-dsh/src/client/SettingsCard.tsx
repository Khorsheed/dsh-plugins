import { useState } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
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

/** How many previously-saved model identifiers the input suggests. */
const RECENT_MODEL_LIMIT = 5

/** The `local-agent-dsh` settings namespace section the card edits. */
export interface DshCardSettings {
  /** Whether the dsh harness, provider, and delegation tool are registered. */
  enabled?: boolean
  /** Resident (live) mode: one resident sub-dsh serve process per member. */
  live?: boolean
  /** Live mirror granularity: folded events or per-chunk streaming. */
  liveMirrorGranularity?: 'event' | 'token'
  /**
   * The model every delegation round starts the sub-dsh with, spelled
   * `provider/model`. Absent (the field cleared) means the plugin passes no
   * `--model` at all — the host instance's own default selection decides.
   */
  model?: string
  /** Model identifiers saved before; the input's suggestions, capped at five. */
  recentModels?: readonly string[]
}

/** Injected face of the dsh settings card. */
export interface DshSettingsCardInjected {
  /** Bound settings scope for the local-agent-dsh namespace. */
  scope: SettingsScope<DshCardSettings>
  /** The auth block's query/command faces, backed by the family core Remote. */
  auth: ProviderAuthInjected
  /** Translate bound to the family core's `local-agent` namespace (the auth block's copy lives there). */
  authT: ProviderAuthBlockProps['t']
  hooks: {
    /** The same scope as a hooks source, so the card reacts to external writes. */
    settings: SettingsScope<DshCardSettings>
  }
}

/** Full props of the settings.plugin.item card entry. */
export type DshSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<DshSettingsCardInjected>
  & PropsLocale<typeof NS>

/**
 * The dsh harness settings card in the plugin configuration tab: the same
 * collapsible chrome the official plugin cards use, re-implemented locally
 * (the bundle-purity gate forbids value-importing the official chrome — the
 * context-guard pattern). The body carries the family core's shared
 * ProviderAuthBlock (dsh authenticates through the host credentials, so the
 * block renders status only — no login action), the DeepSeek delegation
 * switch (migrated from the 本地 Agent section's row-action seat), and the
 * resident-mode block; all writes go through the bound settingsScope
 * immediately (revision-fenced), so a flip takes effect on the next
 * delegation round without a reload. Explanation copy lives in hover/focus
 * bubbles behind ⓘ anchors — the card's rows stay one line each.
 * @param props - runtime slot currency, the injected scope/auth faces, and copy.
 * @returns the card.
 */
export function DshSettingsCard({ useSettings, scope, auth, authT, useSessions, t }: DshSettingsCardProps) {
  const snapshot: SettingsScopeSnapshot<DshCardSettings> = useSettings(value => value)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  const ready = snapshot.status === 'ready' && snapshot.writable
  const enabled = snapshot.value?.enabled ?? false
  const live = snapshot.value?.live ?? false
  const granularity = snapshot.value?.liveMirrorGranularity ?? 'event'
  // The model input is a DRAFT until saved: `null` means "showing whatever the
  // scope holds", so an external write (another tab, a YAML reload) still
  // reaches the field while the user is not typing in it.
  const storedModel = snapshot.value?.model ?? ''
  const recentModels = snapshot.value?.recentModels ?? []
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [modelSaved, setModelSaved] = useState(false)
  const [modelError, setModelError] = useState(false)
  const modelValue = modelDraft ?? storedModel
  /**
   * Commit the model field. A blank value UNSETS the key rather than storing
   * an empty string, so the field re-inherits the YAML composition base — and
   * with no base, the harness is back to passing no model at all.
   */
  const saveModel = (): void => {
    const next = modelValue.trim()
    setModelSaved(false)
    setModelError(false)
    const write = next === '' ? scope.unset('model') : scope.set('model', next)
    void write.then(
      async () => {
        // Most-recent-first, deduplicated, capped: the suggestion list is a
        // memory of what this instance has actually run, never a catalog.
        if (next !== '') {
          await scope.set('recentModels', [next, ...recentModels.filter(value => value !== next)].slice(0, RECENT_MODEL_LIMIT))
        }
        setModelDraft(null)
        setModelSaved(true)
      },
      () => { setModelError(true) },
    )
  }
  const write = (field: string, value: unknown): void => {
    setSaved(false)
    setError(false)
    void scope.set(field, value).then(() => { setSaved(true) }, () => { setError(true) })
  }

  const title = t('card.title')
  // The at-a-glance credential dot in the collapsed header: every mount
  // re-probes (a credential expiring mid-session must flip the dot at the
  // next view); the bus dedupes identical results, so no re-render storm.
  const authStatus = useHarnessAuthStatus('dsh', auth.status)
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
              harness={{ id: 'dsh', label: 'dsh' }}
              useSessions={useSessions}
              status={auth.status}
              runCommand={auth.runCommand}
              t={authT}
            />
            <span className={css.hint}>{t('auth.host')}</span>
          </section>
          <section className={css.block}>
            <h3 className={css.blockTitle}>{t('enable.title')}</h3>
            <div className={css.row}>
              <span className={css.rowLabel}>{t('enable.switch')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={t('enable.switch.aria')}
                className={enabled ? `${css.switch} ${css.switchOn}` : css.switch}
                disabled={!ready}
                onClick={() => { write('enabled', !enabled) }}
              >
                <span className={css.knob} />
              </button>
            </div>
            <span className={css.hint}>{t(enabled ? 'enable.on' : 'enable.off')}</span>
          </section>
          <section className={css.block}>
            <h3 className={css.blockTitle}>
              {t('model.title')}
              <Tooltip label={t('model.info')} side="bottom" maxWidth={360}>
                <button type="button" className={css.info} aria-label={t('model.info.aria')}>ⓘ</button>
              </Tooltip>
            </h3>
            <div className={css.row}>
              <input
                type="text"
                className={css.modelInput}
                list={`${NS}-recent-models`}
                value={modelValue}
                placeholder={t('model.placeholder')}
                aria-label={t('model.title')}
                disabled={!ready}
                onChange={(event) => { setModelDraft(event.target.value) }}
              />
              <datalist id={`${NS}-recent-models`}>
                {recentModels.map(value => <option key={value} value={value} />)}
              </datalist>
              <button
                type="button"
                className={css.modelSave}
                disabled={!ready || modelValue.trim() === storedModel}
                onClick={() => { saveModel() }}
              >
                {t('model.save')}
              </button>
            </div>
            {modelSaved && <span className={css.saved}>{t('model.applied')}</span>}
            {modelError && <span className={css.errorText}>{t('model.error')}</span>}
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
                  name="local-agent-dsh-granularity"
                  checked={granularity === 'event'}
                  disabled={!ready}
                  onChange={() => { write('liveMirrorGranularity', 'event') }}
                />
                {t('live.granularity.event')}
              </label>
              <label className={css.option}>
                <input
                  type="radio"
                  name="local-agent-dsh-granularity"
                  checked={granularity === 'token'}
                  disabled={!ready}
                  onChange={() => { write('liveMirrorGranularity', 'token') }}
                />
                {t('live.granularity.token')}
              </label>
            </div>
            {snapshot.status === 'unavailable' && (
              <span className={css.hint}>{t('live.unavailable')}</span>
            )}
          </section>
          {saved && <span className={css.saved}>{t('live.applied')}</span>}
          {error && <span className={css.errorText}>{t('live.error')}</span>}
        </div>
      )}
    </li>
  )
}
