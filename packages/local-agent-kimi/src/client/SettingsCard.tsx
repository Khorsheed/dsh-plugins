import { useEffect, useRef, useState } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the plugins.bundle.config keyed-slot SlotMap merge (alpha.2).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { IconChevronDownOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** The `local-agent-kimi` settings namespace section the card edits. */
export interface KimiLiveSettings {
  /** Resident (live) mode: one resident `kimi acp` process per member. */
  live?: boolean
  /** Live mirror granularity: folded events or per-chunk streaming. */
  liveMirrorGranularity?: 'event' | 'token'
  /**
   * The model every delegation round starts the CLI with. Absent (the field
   * cleared) means the plugin passes no model at all — the scoped `config.toml`'s `default_model` decides,
   * exactly as before the key existed.
   */
  model?: string
  /** Model identifiers saved before; the input's suggestions, capped at five. */
  recentModels?: readonly string[]
}

/** Injected face of the kimi settings card. */
export interface KimiSettingsCardInjected {
  /** Bound settings scope for the local-agent-kimi namespace. */
  scope: SettingsScope<KimiLiveSettings>
  /** The auth block's query/command faces, backed by the family core Remote. */
  auth: ProviderAuthInjected
  /** Translate bound to the family core's `local-agent` namespace (the auth block's copy lives there). */
  authT: ProviderAuthBlockProps['t']
  /**
   * The harness's memberless model surface (the gateway's `harnessModel`
   * Remote). Undefined means the broker is absent (a core without one): the
   * card then renders exactly the pre-broker free-text field, with no
   * effective-model line and the recent-models suggestions.
   */
  harnessModel: () => Promise<LocalAgentModelInfo | undefined>
  hooks: {
    /** The same scope as a hooks source, so the card reacts to external writes. */
    settings: SettingsScope<KimiLiveSettings>
  }
}

/**
 * Full props of the 0.1.5 settings.plugin.item card entry. The removed slot's
 * owner share was intentionally empty and its root scope delivered the global
 * seats; the structural type below is exact about the one seat the auth block
 * consumes (the slot name is gone from the alpha.2 SlotMap, so the
 * registration goes through a duck-typed narrow — see client/index.ts).
 */
export type KimiSettingsCardProps =
  InjectFace<KimiSettingsCardInjected>
  & PropsLocale<typeof NS>
  & {
    /** The standing root-scope global seat (ui-session's merge), delivered to the 0.1.5 card by the renderer. */
    useSessions: ProviderAuthBlockProps['useSessions']
  }

/** Full props of the alpha.2 plugins.bundle.config entry (owner prop `view`). */
export type KimiBundleConfigProps =
  PropsRuntime<'plugins.bundle.config'>
  & InjectFace<KimiSettingsCardInjected>
  & PropsLocale<typeof NS>

/**
 * The staged card state both settings surfaces share: the resident-mode and
 * model edits write through the bound settingsScope immediately
 * (revision-fenced), so a flip takes effect on the next delegation round
 * without a reload; the memberless model surface is re-read whenever the
 * stored model changes — a save can move the effective layer between settings
 * and the CLI's own default.
 * @param active - whether the surface reads the model surface at all (the summary one-liner never does).
 * @param useSettings - the bound settings hook from the inject hooks compartment.
 * @param scope - the bound settings scope the writes go through.
 * @param harnessModel - the harness's memberless model surface read.
 * @param t - copy.
 */
function useCardState(
  active: boolean,
  useSettings: KimiSettingsCardProps['useSettings'],
  scope: KimiSettingsCardProps['scope'],
  harnessModel: KimiSettingsCardInjected['harnessModel'],
  t: KimiSettingsCardProps['t'],
) {
  const snapshot: SettingsScopeSnapshot<KimiLiveSettings> = useSettings(value => value)
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
  // The memberless model surface (effective model + its source + the pickable
  // vocabulary), re-read whenever the stored model changes — a save can move
  // the effective layer between settings and the CLI's own default.
  const [modelInfo, setModelInfo] = useState<LocalAgentModelInfo | undefined>(undefined)
  useEffect(() => {
    if (!active) return
    let stale = false
    void harnessModel().then((info) => { if (!stale) setModelInfo(info) })
    return () => { stale = true }
  }, [active, harnessModel, storedModel])
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
  // reports: the scoped config's model, then a cli-builtin source that still
  // names its default (a harness catalog's isDefault entry), then the last
  // observed model the records know, and last the generic copy.
  const inheritedModel = modelInfo?.cliDefault !== undefined && modelInfo.cliDefault !== ''
    ? modelInfo.cliDefault
    : modelInfo?.source === 'cli-builtin' && modelInfo.effective !== undefined && modelInfo.effective !== ''
      ? modelInfo.effective
      : modelInfo?.lastObserved !== undefined && modelInfo.lastObserved !== ''
        ? modelInfo.lastObserved
        : undefined
  const modelPlaceholder = inheritedModel ?? t('model.placeholder')
  // The menu's leading item: the same chain, spelled as the follow-default
  // choice. It reads checked while the field is unset, and picking it clears
  // the draft back to follow-default (a save then unsets the key).
  const modelDefaultItem = modelInfo?.cliDefault !== undefined && modelInfo.cliDefault !== ''
    ? t('model.menuDefault.cliConfig', { model: modelInfo.cliDefault })
    : modelInfo?.source === 'cli-builtin' && modelInfo.effective !== undefined && modelInfo.effective !== ''
      ? t('model.menuDefault.cliBuiltin', { model: modelInfo.effective })
      : modelInfo?.lastObserved !== undefined && modelInfo.lastObserved !== ''
        ? t('model.menuDefault.lastObserved', { model: modelInfo.lastObserved })
        : t('model.menuDefault')

  return {
    snapshot, saved, error, ready, live, storedModel, modelValue, modelSaved,
    modelError, choices, modelMenuOpen, modelMenuUp, modelFieldRef,
    modelPlaceholder, modelDefaultItem, saveModel, write, toggleModelMenu,
    setModelDraft, setModelMenuOpen,
  }
}

/** The card body both settings surfaces share: the auth block, the default-model block, and the resident-mode block. */
function CardBody({ state, auth, authT, useSessions, t }: {
  readonly state: ReturnType<typeof useCardState>
  readonly auth: KimiSettingsCardInjected['auth']
  readonly authT: KimiSettingsCardInjected['authT']
  readonly useSessions: KimiSettingsCardProps['useSessions']
  readonly t: KimiSettingsCardProps['t']
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
          harness={{ id: 'kimi', label: 'Kimi Code' }}
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
          ) : modelInputElement}
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
 * The kimi harness settings card in the 0.1.5 plugin configuration tab: the
 * same collapsible chrome the official plugin cards use, re-implemented
 * locally (the bundle-purity gate forbids value-importing the official chrome
 * — the context-guard pattern), with the at-a-glance credential dot in the
 * header. Explanation copy lives in hover/focus bubbles behind ⓘ anchors —
 * the card's rows stay one line each.
 * @param props - the injected scope/auth faces and copy.
 * @returns the card.
 */
export function KimiSettingsCard(props: KimiSettingsCardProps) {
  const { useSettings, scope, auth, authT, harnessModel, useSessions, t } = props
  const [open, setOpen] = useState(false)
  // The model surface read is NOT open-gated on this surface (it warms the
  // vocabulary while the card is collapsed), so the 0.1.5 card always reads.
  const state = useCardState(true, useSettings, scope, harnessModel, t)
  // The at-a-glance credential dot in the collapsed header: every mount
  // re-probes (a credential expiring mid-session must flip the dot at the
  // next view); the bus dedupes identical results, so no re-render storm.
  const authStatus = useHarnessAuthStatus('kimi', auth.status)
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
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open && <CardBody state={state} auth={auth} authT={authT} useSessions={useSessions} t={t} />}
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
export function KimiBundleConfig({ view, useSettings, scope, auth, authT, harnessModel, useSessions, t }: KimiBundleConfigProps) {
  const state = useCardState(view === 'page', useSettings, scope, harnessModel, t)
  if (view === 'summary') return <span className={css.description}>{t('card.description')}</span>
  return <CardBody state={state} auth={auth} authT={authT} useSessions={useSessions} t={t} />
}
