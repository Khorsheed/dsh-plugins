import type { HarnessModelPickerInput } from '@khorsheed/dsh-local-agent/client'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@khorsheed/dsh-local-agent/src/client/settings-scope.ts'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the plugins.bundle.config keyed-slot SlotMap merge (alpha.2).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDownOutlineMedium } from './icons.tsx'
import type { LocalAgentModelInfo } from '@khorsheed/dsh-local-agent/types'
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

/** The `local-agent-claude-code` settings namespace section the card edits. */
export interface ClaudeLiveSettings {
  /** Resident (live) mode: one resident stream-json process per member. */
  live?: boolean
  /** Live mirror granularity: folded events or per-chunk streaming. */
  liveMirrorGranularity?: 'event' | 'token'
  /**
   * The model every delegation round starts the CLI with. Absent (the field
   * cleared) means the plugin passes no model at all — the scoped `settings.json`'s own `model` decides,
   * exactly as before the key existed.
   */
  model?: string
  /** Model identifiers saved before; the input's suggestions, capped at five. */
  recentModels?: readonly string[]
}

/** Injected face of the claude-code settings card. */
export interface ClaudeCodeSettingsCardInjected {
  renderModelPicker?: ((props: HarnessModelPickerInput) => ReactNode) | undefined
  /** Bound settings scope for the local-agent-claude-code namespace. */
  scope: SettingsScope<ClaudeLiveSettings>
  /** The auth block's query/command faces, backed by the family core Remote. */
  auth: ProviderAuthInjected
  /** Translate bound to the family core's `local-agent` namespace (the auth block's copy lives there). */
  authT: ProviderAuthBlockProps['t']
  /**
   * The harness's memberless model surface (the family gateway's
   * `harnessModel` Remote): the inherited default the unset field displays
   * and the menu's choice vocabulary. Absent on a core that predates the
   * model broker — the card then keeps the bare free-text input exactly as
   * before brokers existed.
   */
  modelInfo?: () => Promise<LocalAgentModelInfo | null | undefined>
  hooks: {
    /** The same scope as a hooks source, so the card reacts to external writes. */
    settings: SettingsScope<ClaudeLiveSettings>
  }
}

/**
 * Full props of the 0.1.5 settings.plugin.item card entry. The removed slot's
 * owner share was intentionally empty and its root scope delivered the global
 * seats; the structural type below is exact about the one seat the auth block
 * consumes (the slot name is gone from the alpha.2 SlotMap, so the
 * registration goes through a duck-typed narrow — see client/index.ts).
 */
export type ClaudeCodeSettingsCardProps =
  InjectFace<ClaudeCodeSettingsCardInjected>
  & PropsLocale<typeof NS>
  & {
    /** The standing root-scope global seat (ui-session's merge), delivered to the 0.1.5 card by the renderer. */
    useSessions: ProviderAuthBlockProps['useSessions']
  }

/** Full props of the alpha.2 plugins.bundle.config entry (owner prop `view`). */
export type ClaudeCodeBundleConfigProps =
  PropsRuntime<'plugins.bundle.config'>
  & InjectFace<ClaudeCodeSettingsCardInjected>
  & PropsLocale<typeof NS>

/**
 * The staged card state both settings surfaces share: the resident-mode and
 * model edits write through the bound settingsScope immediately
 * (revision-fenced), so a flip takes effect on the next delegation round
 * without a reload; the broker's model surface is fetched while the surface
 * is active (the 0.1.5 card opened, the alpha.2 page mounted) and re-fetched
 * after every save.
 * @param active - whether the surface currently shows the body (gates the model-surface fetch).
 * @param useSettings - the bound settings hook from the inject hooks compartment.
 * @param scope - the bound settings scope the writes go through.
 * @param modelInfo - the harness's memberless model surface read; absent degrades to the bare input.
 * @param t - copy.
 */
function useCardState(
  active: boolean,
  useSettings: ClaudeCodeSettingsCardProps['useSettings'],
  scope: ClaudeCodeSettingsCardProps['scope'],
  modelInfo: ClaudeCodeSettingsCardInjected['modelInfo'],
  t: ClaudeCodeSettingsCardProps['t'],
) {
  const snapshot: SettingsScopeSnapshot<ClaudeLiveSettings> = useSettings(value => value)
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
  // The broker's model surface: fetched while the surface is active and after
  // every save (the save changes the settings layer the surface reports). `null`
  // means the gateway answered null (a brokerless core) or the read was
  // never wired — the card then degrades to the bare input, no effective
  // line, the recent-models suggestions.
  const [modelSurface, setModelSurface] = useState<LocalAgentModelInfo | null>(null)
  useEffect(() => {
    if (!active || modelInfo === undefined) return
    let stale = false
    void modelInfo().then(
      (info) => { if (!stale) setModelSurface(info ?? null) },
      () => { if (!stale) setModelSurface(null) },
    )
    return () => { stale = true }
  }, [active, modelSaved, modelInfo])
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
  // The suggestion vocabulary: the broker's deduped union when the surface
  // answered, the card's own recent-models memory when it did not. Never a
  // hardcoded catalog. A non-empty list turns the field into a select-like
  // control: the always-visible chevron opens the same vocabulary as a menu.
  const choices = modelSurface !== null ? modelSurface.choices : recentModels
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
  // reports: the scoped config's model, then a cli-builtin source that still
  // names its default (a harness catalog's isDefault entry), then the last
  // observed model the records know, and last the generic copy.
  const inheritedModel = modelSurface !== null && modelSurface.cliDefault !== undefined && modelSurface.cliDefault !== ''
    ? modelSurface.cliDefault
    : modelSurface !== null && modelSurface.source === 'cli-builtin' && modelSurface.effective !== undefined && modelSurface.effective !== ''
      ? modelSurface.effective
      : modelSurface !== null && modelSurface.lastObserved !== undefined && modelSurface.lastObserved !== ''
        ? modelSurface.lastObserved
        : undefined
  const modelPlaceholder = inheritedModel ?? t('model.placeholder')
  // The menu's leading item: the same chain, spelled as the follow-default
  // choice. It reads checked while the field is unset, and picking it clears
  // the draft back to follow-default (a save then unsets the key).
  const modelDefaultItem = modelSurface !== null && modelSurface.cliDefault !== undefined && modelSurface.cliDefault !== ''
    ? t('model.menuDefaultCliConfig', { model: modelSurface.cliDefault })
    : modelSurface !== null && modelSurface.source === 'cli-builtin' && modelSurface.effective !== undefined && modelSurface.effective !== ''
      ? t('model.menuDefaultCliBuiltin', { model: modelSurface.effective })
      : modelSurface !== null && modelSurface.lastObserved !== undefined && modelSurface.lastObserved !== ''
        ? t('model.menuDefaultLastObserved', { model: modelSurface.lastObserved })
        : t('model.menuDefault')

  return {
    snapshot, saved, error, ready, live, storedModel, modelValue, modelSaved,
    modelError, choices, modelMenuOpen, modelMenuUp, modelFieldRef,
    modelPlaceholder, modelDefaultItem, saveModel, write, toggleModelMenu,
    setModelDraft, setModelMenuOpen,
  }
}

/** The card body both settings surfaces share: the auth block, the default-model block, and the resident-mode block. */
function CardBody({ state, auth, authT, renderModelPicker, useSessions, t }: {
  readonly state: ReturnType<typeof useCardState>
  readonly auth: ClaudeCodeSettingsCardInjected['auth']
  readonly authT: ClaudeCodeSettingsCardInjected['authT']
  readonly renderModelPicker: ClaudeCodeSettingsCardInjected['renderModelPicker']
  readonly useSessions: ClaudeCodeSettingsCardProps['useSessions']
  readonly t: ClaudeCodeSettingsCardProps['t']
}) {
  const {
    snapshot, saved, error, ready, live, storedModel, modelValue, modelSaved,
    modelError, choices, modelMenuOpen, modelMenuUp, modelFieldRef,
    modelPlaceholder, modelDefaultItem, saveModel, write, toggleModelMenu,
    setModelDraft, setModelMenuOpen,
  } = state
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
        <h3 className={css.blockTitle}>{t('auth.title')}</h3>
        <ProviderAuthBlock
          harness={{ id: 'claude-code', label: 'Claude Code' }}
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
 * The claude-code harness settings card in the 0.1.5 plugin configuration
 * tab: the same collapsible chrome the official plugin cards use,
 * re-implemented locally (the bundle-purity gate forbids value-importing the
 * official chrome — the context-guard pattern), with the at-a-glance
 * credential dot in the header. Explanation copy lives in hover/focus bubbles
 * behind ⓘ anchors — the card's rows stay one line each.
 * @param props - the injected scope/auth faces and copy.
 * @returns the card.
 */
export function ClaudeCodeSettingsCard(props: ClaudeCodeSettingsCardProps) {
  const { useSettings, scope, auth, authT, renderModelPicker, modelInfo, useSessions, t } = props
  const [open, setOpen] = useState(false)
  const state = useCardState(open, useSettings, scope, modelInfo, t)
  // The at-a-glance credential dot in the collapsed header: every mount
  // re-probes (a credential expiring mid-session must flip the dot at the
  // next view); the bus dedupes identical results, so no re-render storm.
  const authStatus = useHarnessAuthStatus('claude-code', auth.status)
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
      {open && <CardBody state={state} auth={auth} authT={authT} renderModelPicker={renderModelPicker} useSessions={useSessions} t={t} />}
    </li>
  )
}

/**
 * The bundle's configuration on the alpha.2 Plugins page
 * (`plugins.bundle.config`, keyed by package name): the page draws the title,
 * the icon, and the crumb itself, so the entry renders the one-liner for the
 * `summary` view and the bare form — with its own save control — for `page`.
 * @param props - the owner view, the injected scope/auth faces, and copy.
 * @returns the entry.
 */
export function ClaudeCodeBundleConfig({ view, useSettings, scope, auth, authT, renderModelPicker, modelInfo, useSessions, t }: ClaudeCodeBundleConfigProps) {
  const state = useCardState(view === 'page', useSettings, scope, modelInfo, t)
  if (view === 'summary') return <span className={css.description}>{t('card.description')}</span>
  return <CardBody state={state} auth={auth} authT={authT} renderModelPicker={renderModelPicker} useSessions={useSessions} t={t} />
}
