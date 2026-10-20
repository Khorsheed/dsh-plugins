import type { HarnessModelPickerInput } from '@khorsheed/dsh-local-agent/client'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@khorsheed/dsh-local-agent/src/client/settings-scope.ts'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the plugins.item list-slot SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDownOutlineMedium } from './icons.tsx'
// The shared auth block is bundled from the family core's source — the
// sanctioned core/companion edge (the host half already depends on the core);
// the block carries no runtime identity to share.
import {
  ProviderAuthBlock, type ProviderAuthBlockProps, type ProviderAuthInjected,
} from '@khorsheed/dsh-local-agent/src/client/ProviderAuthBlock.tsx'
import { AuthStatusDot } from '@khorsheed/dsh-local-agent/src/client/AuthStatusDot.tsx'
import { publishAuthStatus, useHarnessAuthStatus } from '@khorsheed/dsh-local-agent/src/client/auth-status.ts'
import type { LocalAgentEndpointAuthFields, LocalAgentEndpointAuthState, LocalAgentModelInfo } from '@khorsheed/dsh-local-agent/types'
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
  renderModelPicker?: ((props: HarnessModelPickerInput) => ReactNode) | undefined
  /** Bound settings scope for the local-agent-codex namespace. */
  scope: SettingsScope<CodexLiveSettings>
  /** The auth block's query/command faces, backed by the family core Remote. */
  auth: ProviderAuthInjected
  /** Translate bound to the family core's `local-agent` namespace (the auth block's copy lives there). */
  authT: ProviderAuthBlockProps['t']
  /**
   * The harness's memberless model surface (the core gateway's `harnessModel`
   * Remote): the inherited default an unset field displays and the menu's
   * choice vocabulary. Undefined or null when the gateway or the broker is
   * absent — the card then keeps the bare input exactly as before brokers
   * existed.
   */
  harnessModel: () => Promise<LocalAgentModelInfo | null | undefined>
  /**
   * The harness's endpoint verification (the family gateway's `checkEndpoint`
   * Remote): a token-free probe of the SAVED endpoint, answered as verdict
   * text. Absent on a core that predates the Remote — the card then hides
   * the verify button.
   */
  checkEndpoint?: () => Promise<string | null | undefined>
  /**
   * The harness's endpoint credential face (the family gateway's
   * `endpointAuth`/`configureEndpoint` Remotes): the card's credential form
   * reads and writes the harness's OWN credential store through it — never
   * the settings scope, so no key ever lands in the profile patch document.
   * Absent on a core that predates the Remotes — the card then hides the
   * form. `write` answers the post-write resolved state.
   */
  endpointAuth?: {
    read(): Promise<LocalAgentEndpointAuthState | null | undefined>
    write(fields: LocalAgentEndpointAuthFields): Promise<LocalAgentEndpointAuthState | null | undefined>
  }
  hooks: {
    /** The same scope as a hooks source, so the card reacts to external writes. */
    settings: SettingsScope<CodexLiveSettings>
  }
}

/**
 * Full props of the retired 0.1.5 settings.plugin.item card. The host removed
 * that seat and client/index.ts no longer registers the component — the live
 * settings surface is the plugins.item entry built on the BundleConfig
 * component below; this export remains for the component spec and direct
 * composers. The removed slot's owner share was intentionally empty and its
 * root scope delivered the global seats; the structural type below is exact
 * about the one seat the auth block consumes.
 */
export type CodexSettingsCardProps =
  InjectFace<CodexSettingsCardInjected>
  & PropsLocale<typeof NS>
  & {
    /** The standing root-scope global seat (ui-session's merge), delivered to the 0.1.5 card by the renderer. */
    useSessions: ProviderAuthBlockProps['useSessions']
  }

/** Full props of the plugins.item entry (owner prop `view`). */
export type CodexBundleConfigProps =
  PropsRuntime<'plugins.item'>
  & InjectFace<CodexSettingsCardInjected>
  & PropsLocale<typeof NS>

/**
 * The staged card state both settings surfaces share: the resident-mode and
 * model edits write through the bound settingsScope immediately
 * (revision-fenced), so a flip takes effect on the next delegation round
 * without a reload; the harness's model surface is fetched while the surface
 * is active (the 0.1.5 card opened, the alpha.2 page mounted) and re-fetched
 * after every save.
 * @param active - whether the surface currently shows the body (gates the model-surface fetch).
 * @param useSettings - the bound settings hook from the inject hooks compartment.
 * @param scope - the bound settings scope the writes go through.
 * @param harnessModel - the harness's memberless model surface read.
 * @param t - copy.
 */
function useCardState(
  active: boolean,
  useSettings: CodexSettingsCardProps['useSettings'],
  scope: CodexSettingsCardProps['scope'],
  harnessModel: CodexSettingsCardInjected['harnessModel'],
  endpointAuth: CodexSettingsCardInjected['endpointAuth'],
  t: CodexSettingsCardProps['t'],
) {
  const snapshot: SettingsScopeSnapshot<CodexLiveSettings> = useSettings(value => value)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  const ready = snapshot.status === 'ready' && snapshot.writable
  const live = snapshot.value?.live ?? false
  // The endpoint credential form talks to the harness's OWN credential store
  // through the endpointAuth face — never the settings scope, so no key ever
  // lands in the profile patch document. baseUrl echoes (it is not a
  // secret); the key never does — a set key shows as a "configured"
  // placeholder and the input holds only the draft of a REPLACEMENT. A blank
  // write clears the field (the web login then answers for the scope again).
  const [endpointState, setEndpointState] = useState<LocalAgentEndpointAuthState | null | 'unavailable'>(null)
  const [baseUrlDraft, setBaseUrlDraft] = useState<string | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState<string | null>(null)
  const [endpointSaved, setEndpointSaved] = useState(false)
  const [endpointError, setEndpointError] = useState(false)
  const endpointDirty = baseUrlDraft !== null || apiKeyDraft !== null
  const endpointUnavailable = endpointAuth === undefined || endpointState === 'unavailable'
  const endpointLoading = !endpointUnavailable && endpointState === null
  const apiKeyConfigured = endpointState !== null && endpointState !== 'unavailable' && endpointState.apiKeySet
  useEffect(() => {
    if (!active || endpointAuth === undefined) return
    let stale = false
    void endpointAuth.read().then(
      (state) => { if (!stale) setEndpointState(state ?? 'unavailable') },
      () => { if (!stale) setEndpointState('unavailable') },
    )
    return () => { stale = true }
  }, [active, endpointAuth, endpointSaved])
  // The credential save: one `configureEndpoint` call carrying only the
  // dirty fields (a blank draft clears its field); the answer is the
  // post-write resolved state, so the chips and the auth probe flip without
  // a re-read.
  const saveEndpoint = (): void => {
    if (endpointAuth === undefined) return
    setEndpointSaved(false)
    setEndpointError(false)
    const fields: LocalAgentEndpointAuthFields = {
      ...baseUrlDraft !== null ? { baseUrl: baseUrlDraft.trim() === '' ? null : baseUrlDraft.trim() } : {},
      ...apiKeyDraft !== null ? { apiKey: apiKeyDraft.trim() === '' ? null : apiKeyDraft.trim() } : {},
    }
    void endpointAuth.write(fields).then(
      (state) => {
        if (state !== undefined && state !== null) {
          setEndpointState(state)
          // Flip the status dot with the write's own answer — but only in
          // the authenticated direction: clearing the key may still leave
          // the web login's auth.json, which the next scheduled probe sees.
          if (state.apiKeySet) publishAuthStatus('codex', 'authenticated')
        }
        setBaseUrlDraft(null)
        setApiKeyDraft(null)
        setEndpointSaved(true)
      },
      () => { setEndpointError(true) },
    )
  }
  // The model input is a DRAFT until saved: `null` means "showing whatever the
  // scope holds", so an external write (another tab, a YAML reload) still
  // reaches the field while the user is not typing in it.
  const storedModel = snapshot.value?.model ?? ''
  const recentModels = snapshot.value?.recentModels ?? []
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [modelSaved, setModelSaved] = useState(false)
  const [modelError, setModelError] = useState(false)
  const modelValue = modelDraft ?? storedModel
  // The harness's model surface, fetched while the surface is active (and
  // re-fetched after a save): undefined until the first answer, null when the
  // gateway or the broker is absent — the card then keeps the bare input with
  // its recent-models suggestions, exactly as before brokers existed.
  const [modelInfo, setModelInfo] = useState<LocalAgentModelInfo | null | undefined>(undefined)
  useEffect(() => {
    if (!active) return
    let stale = false
    void harnessModel().then((info) => {
      if (!stale) setModelInfo(info ?? null)
    })
    return () => { stale = true }
  }, [active, harnessModel, modelSaved])
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
  // An unset field DISPLAYS the default it follows (dimmed, as the input's
  // placeholder — inherited, never pinned), down the chain the broker
  // reports: the scoped config's model, then the account catalog's built-in
  // default (source cli-builtin WITH an effective model — the one case
  // cli-builtin names one), then the last observed model the records know,
  // and last the generic copy.
  const inheritedModel = modelInfo != null && modelInfo.cliDefault !== undefined && modelInfo.cliDefault !== ''
    ? modelInfo.cliDefault
    : modelInfo != null && modelInfo.source === 'cli-builtin' && modelInfo.effective !== undefined && modelInfo.effective !== ''
      ? modelInfo.effective
      : modelInfo != null && modelInfo.lastObserved !== undefined && modelInfo.lastObserved !== ''
        ? modelInfo.lastObserved
        : undefined
  const modelPlaceholder = inheritedModel ?? t('model.placeholder')
  // The menu's leading item: the same chain, spelled as the follow-default
  // choice. It reads checked while the field is unset, and picking it clears
  // the draft back to follow-default (a save then unsets the key).
  const modelDefaultItem = modelInfo != null && modelInfo.cliDefault !== undefined && modelInfo.cliDefault !== ''
    ? t('model.menuDefault.cli-config', { model: modelInfo.cliDefault })
    : modelInfo != null && modelInfo.source === 'cli-builtin' && modelInfo.effective !== undefined && modelInfo.effective !== ''
      ? t('model.menuDefault.cli-builtin', { model: modelInfo.effective })
      : modelInfo != null && modelInfo.lastObserved !== undefined && modelInfo.lastObserved !== ''
        ? t('model.menuDefault.last-observed', { model: modelInfo.lastObserved })
        : t('model.menuDefault')

  return {
    snapshot, saved, error, ready, live, storedModel, modelValue, modelSaved,
    modelError, choices, modelMenuOpen, modelMenuUp, modelFieldRef,
    modelPlaceholder, modelDefaultItem, saveModel, write, toggleModelMenu,
    setModelDraft, setModelMenuOpen,
    endpointState, endpointUnavailable, endpointLoading,
    baseUrlValue: baseUrlDraft ?? (endpointState !== null && endpointState !== 'unavailable' ? endpointState.baseUrl ?? '' : ''),
    apiKeyConfigured, apiKeyDraft,
    endpointSaved, endpointError, endpointDirty,
    saveEndpoint, setBaseUrlDraft, setApiKeyDraft,
  }
}

/** The card body both settings surfaces share: the auth block, the default-model block, and the resident-mode block. */
function CardBody({ state, auth, authT, renderModelPicker, checkEndpoint, useSessions, t }: {
  readonly state: ReturnType<typeof useCardState>
  readonly auth: CodexSettingsCardInjected['auth']
  readonly authT: CodexSettingsCardInjected['authT']
  readonly renderModelPicker: CodexSettingsCardInjected['renderModelPicker']
  readonly checkEndpoint: CodexSettingsCardInjected['checkEndpoint']
  readonly useSessions: CodexSettingsCardProps['useSessions']
  readonly t: CodexSettingsCardProps['t']
}) {
  const {
    snapshot, saved, error, ready, live, storedModel, modelValue, modelSaved,
    modelError, choices, modelMenuOpen, modelMenuUp, modelFieldRef,
    modelPlaceholder, modelDefaultItem, saveModel, write, toggleModelMenu,
    setModelDraft, setModelMenuOpen,
    endpointUnavailable, endpointLoading,
    baseUrlValue, apiKeyConfigured, apiKeyDraft,
    endpointSaved, endpointError, endpointDirty, saveEndpoint,
    setBaseUrlDraft, setApiKeyDraft,
  } = state
  // The verify button: runs the gateway's `checkEndpoint` Remote against the
  // SAVED endpoint (unsaved drafts deliberately disable it — what it verifies
  // is the saved configuration) and shows the verdict inline. Session-less:
  // a settings card may have no main agent session to run a slash command.
  const [checking, setChecking] = useState(false)
  const [checkText, setCheckText] = useState<string | null>(null)
  const runCheck = (): void => {
    if (checkEndpoint === undefined) return
    setChecking(true)
    setCheckText(null)
    void checkEndpoint().then(
      (text) => {
        setCheckText(text ?? t('endpoint.checkUnavailable'))
        setChecking(false)
      },
      () => {
        setCheckText(t('endpoint.checkFailed'))
        setChecking(false)
      },
    )
  }
  // The free-text input, single-sourced for both presentations: bare when no
  // vocabulary exists (a fresh install degrades to exactly the pre-picker
  // field), or inside the select-like field next to its chevron. No datalist:
  // the chevron menu is the single choice list.
  const modelInputElement = (
    <input
      type="text"
      className={css.modelInput}
      value={modelValue}
      placeholder={modelPlaceholder}
      aria-label={t('model.title')}
      disabled={!ready}
      onChange={(event) => { setModelDraft(event.target.value) }}
    />
  )
  return (
    <div className={css.body}>
      <section className={css.block}>
        <h3 className={css.blockTitle}>
          {t('auth.title')}
          <Tooltip label={t('endpoint.info')} side="bottom" maxWidth={360}>
            <button type="button" className={css.info} aria-label={t('endpoint.info.aria')}>ⓘ</button>
          </Tooltip>
        </h3>
        <ProviderAuthBlock
          harness={{ id: 'codex', label: 'Codex' }}
          useSessions={useSessions}
          status={auth.status}
          runCommand={auth.runCommand}
          t={authT}
        />
        {endpointUnavailable && (
          <span className={css.hint}>{t('endpoint.unavailable')}</span>
        )}
        {!endpointUnavailable && (
        <div className={css.endpointFields}>
          <label className={css.endpointField}>
            <span className={css.endpointLabel}>{t('endpoint.baseUrl')}</span>
            <input
              type="text"
              className={css.modelInput}
              value={baseUrlValue}
              placeholder={t('endpoint.baseUrl.placeholder')}
              aria-label={t('endpoint.baseUrl')}
              disabled={endpointLoading}
              onChange={(event) => { setBaseUrlDraft(event.currentTarget.value) }}
            />
          </label>
          <label className={css.endpointField}>
            <span className={css.endpointLabel}>
              {t('endpoint.apiKey')}
              {apiKeyConfigured && <span className={css.configuredChip}>{t('endpoint.configured')}</span>}
            </span>
            <input
              type="password"
              className={css.modelInput}
              value={apiKeyDraft ?? ''}
              placeholder={apiKeyConfigured ? t('endpoint.secret.configured') : t('endpoint.secret.placeholder')}
              aria-label={t('endpoint.apiKey')}
              autoComplete="off"
              disabled={endpointLoading}
              onChange={(event) => { setApiKeyDraft(event.currentTarget.value) }}
            />
          </label>
          <div className={css.row}>
            <button
              type="button"
              className={css.modelSave}
              disabled={endpointLoading || !endpointDirty}
              onClick={() => { saveEndpoint() }}
            >
              {t('endpoint.save')}
            </button>
            {checkEndpoint !== undefined && (
              <button
                type="button"
                className={css.modelSave}
                disabled={endpointLoading || endpointDirty || checking}
                title={endpointDirty ? t('endpoint.checkDirtyHint') : undefined}
                onClick={() => { runCheck() }}
              >
                {checking ? t('endpoint.checking') : t('endpoint.check')}
              </button>
            )}
            {endpointSaved && <span className={css.saved}>{t('endpoint.applied')}</span>}
            {endpointError && <span className={css.errorText}>{t('endpoint.error')}</span>}
          </div>
          {checkText !== null && <span className={css.hint}>{checkText}</span>}
        </div>
        )}
      </section>
      <section className={css.block}>
        <h3 className={css.blockTitle}>
          {t('model.title')}
          <Tooltip label={t('model.info')} side="bottom" maxWidth={360}>
            <button type="button" className={css.info} aria-label={t('model.info.aria')}>ⓘ</button>
          </Tooltip>
        </h3>
        <div className={css.row}>
          {renderModelPicker?.({ value: modelValue, onChange: setModelDraft, disabled: !ready, defaultLabel: modelDefaultItem }) ?? (choices.length > 0 ? (
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
                <IconChevronDownOutlineMedium className={modelMenuOpen ? `${css.modelMenuChevron} ${css.modelMenuChevronOpen}` : css.modelMenuChevron} />
              </button>
              {modelMenuOpen && (
                <div
                  className={modelMenuUp ? `${css.modelMenu} ${css.modelMenuUp}` : css.modelMenu}
                  role="menu"
                  aria-label={t('model.menu')}
                >
                  {/* The leading follow-default item: checked while the
                      field is unset; picking it clears the draft back to
                      follow-default (a save then unsets the key). */}
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={modelValue.trim() === ''}
                    className={modelValue.trim() === '' ? `${css.modelItemDefault} ${css.modelItemCurrent}` : css.modelItemDefault}
                    onClick={() => { setModelDraft(''); setModelMenuOpen(false) }}
                  >
                    <span className={css.modelItemLabel}>{modelDefaultItem}</span>
                    <span className={css.modelItemCheck} aria-hidden>{modelValue.trim() === '' ? '✓' : ''}</span>
                  </button>
                  {choices.map(choice => (
                    <button
                      key={choice}
                      type="button"
                      role="menuitemradio"
                      aria-checked={choice === modelValue}
                      className={choice === modelValue ? css.modelItemCurrent : css.modelItem}
                      onClick={() => { setModelDraft(choice); setModelMenuOpen(false) }}
                    >
                      <span className={css.modelItemLabel}>{choice}</span>
                      <span className={css.modelItemCheck} aria-hidden>{choice === modelValue ? '✓' : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : modelInputElement)}
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
        {saved && <span className={css.saved}>{t('live.applied')}</span>}
        {error && <span className={css.errorText}>{t('live.error')}</span>}
        {snapshot.status === 'unavailable' && (
          <span className={css.hint}>{t('live.unavailable')}</span>
        )}
      </section>
    </div>
  )
}

/**
 * The codex harness settings card of the retired 0.1.5 plugin configuration
 * tab (no longer registered; the live surface is the plugins.item entry
 * below): the same collapsible chrome the official plugin cards use, re-implemented
 * locally (the bundle-purity gate forbids value-importing the official chrome
 * — the context-guard pattern), with the at-a-glance credential dot in the
 * header. Explanation copy lives in hover/focus bubbles behind ⓘ anchors —
 * the card's rows stay one line each.
 * @param props - the injected scope/auth faces and copy.
 * @returns the card.
 */
export function CodexSettingsCard(props: CodexSettingsCardProps) {
  const { useSettings, scope, auth, authT, renderModelPicker, harnessModel, checkEndpoint, endpointAuth, useSessions, t } = props
  const [open, setOpen] = useState(false)
  const state = useCardState(open, useSettings, scope, harnessModel, endpointAuth, t)
  // The at-a-glance credential dot in the collapsed header: every mount
  // re-probes (a credential expiring mid-session must flip the dot at the
  // next view); the bus dedupes identical results, so no re-render storm.
  const authStatus = useHarnessAuthStatus('codex', auth.status)
  const dotLabel = authT(
    authStatus === 'authenticated' ? 'settings.authenticated'
      : authStatus === 'anonymous' ? 'settings.notAuthenticated'
        : authStatus === 'checking' ? 'loading' : 'error',
  )

  const title = t('card.title')
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
        <IconChevronDownOutlineMedium className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open && <CardBody state={state} auth={auth} authT={authT} renderModelPicker={renderModelPicker} checkEndpoint={checkEndpoint} useSessions={useSessions} t={t} />}
    </li>
  )
}

/**
 * The provider's card on the Plugins page (the `plugins.item` entry
 * client/index.ts registers while the Host serves the namespace): the page
 * draws the title, the icon, and the crumb itself, so the entry renders the
 * one-liner for the `summary` view and the bare form — with its own save
 * control — for `page`.
 * @param props - the owner view, the injected scope/auth faces, and copy.
 * @returns the entry.
 */
export function CodexBundleConfig({ view, useSettings, scope, auth, authT, renderModelPicker, harnessModel, checkEndpoint, endpointAuth, useSessions, t }: CodexBundleConfigProps) {
  const state = useCardState(view === 'page', useSettings, scope, harnessModel, endpointAuth, t)
  if (view === 'summary') return <span className={css.description}>{t('card.description')}</span>
  return <CardBody state={state} auth={auth} authT={authT} renderModelPicker={renderModelPicker} checkEndpoint={checkEndpoint} useSessions={useSessions} t={t} />
}
