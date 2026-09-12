import { useEffect, useRef, useState } from 'react'
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
import type { LocalAgentModelInfo } from '@khorsheed/dsh-local-agent/types'
import { NS } from './locales.ts'
import css from './SettingsCard.module.css'

/** How many previously-saved model identifiers the input suggests. */
const RECENT_MODEL_LIMIT = 5

/** The `local-agent-codex` settings namespace section the card edits. */
export interface CodexLiveSettings {
  /** Resident (live) mode: one resident `codex app-server` process per member. */
  live?: boolean
  /**
   * The model every delegation round starts the CLI with. Absent (the field
   * cleared) means the plugin passes no model at all — the scoped `config.toml`'s own `model` decides,
   * exactly as before the key existed.
   */
  model?: string
  /** Model identifiers saved before; the input's suggestions, capped at five. */
  recentModels?: readonly string[]
}

/** Injected face of the codex settings card. */
export interface CodexSettingsCardInjected {
  /** Bound settings scope for the local-agent-codex namespace. */
  scope: SettingsScope<CodexLiveSettings>
  /** The auth block's query/command faces, backed by the family core Remote. */
  auth: ProviderAuthInjected
  /** Translate bound to the family core's `local-agent` namespace (the auth block's copy lives there). */
  authT: ProviderAuthBlockProps['t']
  /**
   * The harness's memberless model surface (the core gateway's `harnessModel`
   * Remote): the effective-model line and the datalist vocabulary. Undefined
   * or null when the gateway or the broker is absent — the card then keeps the
   * bare input exactly as before brokers existed.
   */
  harnessModel: () => Promise<LocalAgentModelInfo | null | undefined>
  hooks: {
    /** The same scope as a hooks source, so the card reacts to external writes. */
    settings: SettingsScope<CodexLiveSettings>
  }
}

/** Full props of the settings.plugin.item card entry. */
export type CodexSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<CodexSettingsCardInjected>
  & PropsLocale<typeof NS>

/**
 * The codex harness settings card in the plugin configuration tab: the same
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
export function CodexSettingsCard({ useSettings, scope, auth, authT, harnessModel, useSessions, t }: CodexSettingsCardProps) {
  const snapshot: SettingsScopeSnapshot<CodexLiveSettings> = useSettings(value => value)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  const ready = snapshot.status === 'ready' && snapshot.writable
  const live = snapshot.value?.live ?? false
  // The model input is a DRAFT until saved: `null` means "showing whatever the
  // scope holds", so an external write (another tab, a YAML reload) still
  // reaches the field while the user is not typing in it.
  const storedModel = snapshot.value?.model ?? ''
  const recentModels = snapshot.value?.recentModels ?? []
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [modelSaved, setModelSaved] = useState(false)
  const [modelError, setModelError] = useState(false)
  const modelValue = modelDraft ?? storedModel
  // The harness's model surface, fetched while the card is open (and re-fetched
  // after a save): undefined until the first answer, null when the gateway or
  // the broker is absent — the card then keeps the bare input with its
  // recent-models suggestions, exactly as before brokers existed.
  const [modelInfo, setModelInfo] = useState<LocalAgentModelInfo | null | undefined>(undefined)
  useEffect(() => {
    if (!open) return
    let stale = false
    void harnessModel().then((info) => {
      if (!stale) setModelInfo(info ?? null)
    })
    return () => { stale = true }
  }, [open, harnessModel, modelSaved])
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
  // The suggestion vocabulary: the broker's deduped union (settings + scoped
  // config + discovered + recent) when the surface answered, the card's own
  // recent-models memory when it did not. Never a hardcoded catalog. A
  // non-empty list turns the field into a select-like control: the
  // always-visible chevron opens the same vocabulary as a menu.
  const choices = modelInfo?.choices ?? recentModels
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelMenuUp, setModelMenuUp] = useState(false)
  const modelFieldRef = useRef<HTMLDivElement | null>(null)
  // Click-outside and Esc close the model menu (the member composer's picker
  // pattern); the upward flip is measured when the menu opens.
  useEffect(() => {
    if (!modelMenuOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      if (modelFieldRef.current?.contains(event.target as Node) === true) return
      setModelMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setModelMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [modelMenuOpen])
  const toggleModelMenu = (): void => {
    if (!modelMenuOpen) {
      const rect = modelFieldRef.current?.getBoundingClientRect()
      if (rect !== undefined) {
        const spaceBelow = window.innerHeight - rect.bottom
        setModelMenuUp(spaceBelow < 260 && rect.top > spaceBelow)
      }
    }
    setModelMenuOpen(open => !open)
  }
  // An empty field names the effective default it will follow, when the
  // broker knows one — the placeholder answers "what does blank mean".
  const modelPlaceholder = modelInfo != null && modelInfo.cliDefault !== undefined && modelInfo.cliDefault !== ''
    ? t('model.placeholder.cli-config', { model: modelInfo.cliDefault })
    : t('model.placeholder')

  const title = t('card.title')
  // The at-a-glance credential dot in the collapsed header: every mount
  // re-probes (a credential expiring mid-session must flip the dot at the
  // next view); the bus dedupes identical results, so no re-render storm.
  const authStatus = useHarnessAuthStatus('codex', auth.status)
  const dotLabel = authT(
    authStatus === 'authenticated' ? 'settings.authenticated'
      : authStatus === 'anonymous' ? 'settings.notAuthenticated'
        : authStatus === 'checking' ? 'loading' : 'error',
  )
  // The free-text input, single-sourced for both presentations: bare when no
  // vocabulary exists (a fresh install degrades to exactly the pre-picker
  // field), or inside the select-like field next to its chevron.
  const modelInputElement = (
    <input
      type="text"
      className={css.modelInput}
      list={`${NS}-recent-models`}
      value={modelValue}
      placeholder={modelPlaceholder}
      aria-label={t('model.title')}
      disabled={!ready}
      onChange={(event) => { setModelDraft(event.target.value) }}
    />
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
              harness={{ id: 'codex', label: 'Codex' }}
              useSessions={useSessions}
              status={auth.status}
              runCommand={auth.runCommand}
              t={authT}
            />
          </section>
          <section className={css.block}>
            <h3 className={css.blockTitle}>
              {t('model.title')}
              <Tooltip label={t('model.info')} side="bottom" maxWidth={360}>
                <button type="button" className={css.info} aria-label={t('model.info.aria')}>ⓘ</button>
              </Tooltip>
            </h3>
            <div className={css.row}>
              {choices.length > 0 ? (
                <div className={css.modelField} ref={modelFieldRef}>
                  {modelInputElement}
                  <button
                    type="button"
                    className={css.modelMenuButton}
                    aria-label={t('model.menu')}
                    aria-haspopup="menu"
                    aria-expanded={modelMenuOpen}
                    disabled={!ready}
                    onClick={() => { toggleModelMenu() }}
                  >
                    <IconChevronDownOutline14 className={modelMenuOpen ? `${css.modelMenuChevron} ${css.modelMenuChevronOpen}` : css.modelMenuChevron} />
                  </button>
                  {modelMenuOpen && (
                    <div
                      className={modelMenuUp ? `${css.modelMenu} ${css.modelMenuUp}` : css.modelMenu}
                      role="menu"
                      aria-label={t('model.menu')}
                    >
                      {choices.map(choice => (
                        <button
                          key={choice}
                          type="button"
                          role="menuitemradio"
                          aria-checked={choice === modelValue}
                          className={choice === modelValue ? css.modelItemCurrent : css.modelItem}
                          onClick={() => { setModelDraft(choice); setModelMenuOpen(false) }}
                        >
                          {choice}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : modelInputElement}
              <datalist id={`${NS}-recent-models`}>
                {choices.map(value => <option key={value} value={value} />)}
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
            {modelInfo != null && (
              <span className={css.modelEffective}>
                {modelInfo.settings !== undefined && modelInfo.settings !== ''
                  ? t('model.effective.set', { model: modelInfo.settings })
                  : modelInfo.cliDefault !== undefined && modelInfo.cliDefault !== ''
                    ? t('model.effective.cli-config', { model: modelInfo.cliDefault })
                    : t('model.effective.cli-builtin')}
              </span>
            )}
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
