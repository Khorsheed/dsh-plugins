import { useEffect, useState } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@khorsheed/dsh-local-agent/src/client/settings-scope.ts'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the plugins.item list-slot SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDownOutlineMedium } from './icons.tsx'
import type { LocalAgentEndpointAuthFields, LocalAgentEndpointAuthState, LocalAgentModelDirectory } from '@khorsheed/dsh-local-agent/types'
// The shared auth block is bundled from the family core's source — the
// sanctioned core/companion edge (the host half already depends on the core);
// the block carries no runtime identity to share.
import {
  ProviderAuthBlock, type ProviderAuthBlockProps, type ProviderAuthInjected,
} from '@khorsheed/dsh-local-agent/src/client/ProviderAuthBlock.tsx'
import { AuthStatusDot } from '@khorsheed/dsh-local-agent/src/client/AuthStatusDot.tsx'
import { publishAuthStatus, useHarnessAuthStatus, usePublishedAuthStatus } from '@khorsheed/dsh-local-agent/src/client/auth-status.ts'
import { ModelListSection } from '@khorsheed/dsh-local-agent/src/client/ModelListSection.tsx'
import { NS } from './locales.ts'
import css from './SettingsCard.module.css'

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
  /** Model identifiers saved before; the member picker's suggestion vocabulary, capped at five. */
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
   * The harness's curated model list (the family gateway's
   * `modelList`/`configureModelList` Remotes): the editor's ordered
   * shortlist — its first entry is the default model. Absent on a core that
   * predates the Remotes — the card then hides the editor.
   */
  modelList?: {
    read(): Promise<readonly string[] | null | undefined>
    write(models: readonly string[]): Promise<readonly string[] | null | undefined>
  }
  /**
   * The endpoint's served model catalog (the family gateway's
   * `modelDirectory` Remote): the add dialog's candidate vocabulary. Absent
   * on a core that predates the Remote — the dialog then shows its reason.
   */
  modelDirectory?: (refresh?: boolean) => Promise<LocalAgentModelDirectory | null | undefined>
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
    settings: SettingsScope<KimiLiveSettings>
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
export type KimiSettingsCardProps =
  InjectFace<KimiSettingsCardInjected>
  & PropsLocale<typeof NS>
  & {
    /** The standing root-scope global seat (ui-session's merge), delivered to the 0.1.5 card by the renderer. */
    useSessions: ProviderAuthBlockProps['useSessions']
  }

/** Full props of the plugins.item entry (owner prop `view`). */
export type KimiBundleConfigProps =
  PropsRuntime<'plugins.item'>
  & InjectFace<KimiSettingsCardInjected>
  & PropsLocale<typeof NS>

/**
 * Full props of the harness's section inside the core's「本机 Agent 委派」
 * family card: the same inject face minus the slot-owner share, plus the one
 * global seat the body consumes, forwarded by the family card (the section
 * render bypasses the slot runtime, so its remaining standard seats are not
 * fabricable here and are deliberately absent).
 */
export type KimiCardSectionProps =
  InjectFace<KimiSettingsCardInjected>
  & PropsLocale<typeof NS>
  & {
    /** Whether the section is currently expanded (the family card mounts the body only while it is). */
    readonly active: boolean
    /** The standing root-scope global seat (ui-session's merge), forwarded by the family card. */
    readonly useSessions: ProviderAuthBlockProps['useSessions']
  }

/**
 * The staged card state both settings surfaces share: the resident-mode
 * switch writes through the bound settingsScope immediately
 * (revision-fenced), so a flip takes effect on the next delegation round
 * without a reload; the endpoint credential form talks to the harness's own
 * store through the endpointAuth face. The「可用模型」section is the family
 * core's shared ModelListSection, which owns its own state.
 * @param active - whether the surface currently shows the body (gates the credential-form fetch).
 * @param useSettings - the bound settings hook from the inject hooks compartment.
 * @param scope - the bound settings scope the writes go through.
 * @param endpointAuth - the harness's endpoint credential face; absent hides the credential form.
 */
function useCardState(
  active: boolean,
  useSettings: KimiSettingsCardProps['useSettings'],
  scope: KimiSettingsCardProps['scope'],
  endpointAuth: KimiSettingsCardInjected['endpointAuth'],
) {
  const snapshot: SettingsScopeSnapshot<KimiLiveSettings> = useSettings(value => value)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  const ready = snapshot.status === 'ready' && snapshot.writable
  const live = snapshot.value?.live ?? false
  // The endpoint credential form talks to the harness's OWN credential store
  // through the endpointAuth face — never the settings scope, so no key ever
  // lands in the profile patch document. baseUrl echoes (it is not a
  // secret); the key never does — a set key shows as a "configured"
  // placeholder and the input holds only the draft of a REPLACEMENT. A blank
  // write clears the field (the config layer then answers for it again).
  const [endpointState, setEndpointState] = useState<LocalAgentEndpointAuthState | null | 'unavailable'>(null)
  const [baseUrlDraft, setBaseUrlDraft] = useState<string | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState<string | null>(null)
  const [endpointSaved, setEndpointSaved] = useState(false)
  const [endpointError, setEndpointError] = useState(false)
  const endpointDirty = baseUrlDraft !== null || apiKeyDraft !== null
  const endpointUnavailable = endpointAuth === undefined || endpointState === 'unavailable'
  const endpointLoading = !endpointUnavailable && endpointState === null
  const apiKeyConfigured = endpointState !== null && endpointState !== 'unavailable' && endpointState.apiKeySet
  // A login or logout elsewhere in the card (the auth block) changes what
  // the store holds — logout deletes the saved key: re-read, or the form
  // keeps saying 已配置 for a key that is gone.
  const authPublished = usePublishedAuthStatus('kimi')
  useEffect(() => {
    if (!active || endpointAuth === undefined) return
    let stale = false
    void endpointAuth.read().then(
      (state) => { if (!stale) setEndpointState(state ?? 'unavailable') },
      () => { if (!stale) setEndpointState('unavailable') },
    )
    return () => { stale = true }
  }, [active, endpointAuth, endpointSaved, authPublished])
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
          // Flip the status dot with the write's own answer — only in the
          // authenticated direction.
          if (state.apiKeySet) publishAuthStatus('kimi', 'authenticated')
        }
        setBaseUrlDraft(null)
        setApiKeyDraft(null)
        setEndpointSaved(true)
      },
      () => { setEndpointError(true) },
    )
  }

  const write = (field: string, value: unknown): void => {
    setSaved(false)
    setError(false)
    void scope.set(field, value).then(() => { setSaved(true) }, () => { setError(true) })
  }

  return {
    snapshot, saved, error, ready, live, write,
    endpointUnavailable, endpointLoading,
    baseUrlValue: baseUrlDraft ?? (endpointState !== null && endpointState !== 'unavailable' ? endpointState.baseUrl ?? '' : ''),
    apiKeyConfigured, apiKeyDraft,
    endpointSaved, endpointError, endpointDirty,
    saveEndpoint, setBaseUrlDraft, setApiKeyDraft,
  }
}

/** The card body both settings surfaces share: the auth block, the model-list section, and the resident-mode block. */
function CardBody({ state, active, auth, authT, modelList, modelDirectory, checkEndpoint, useSessions, t }: {
  readonly state: ReturnType<typeof useCardState>
  readonly active: boolean
  readonly auth: KimiSettingsCardInjected['auth']
  readonly authT: KimiSettingsCardInjected['authT']
  readonly modelList: KimiSettingsCardInjected['modelList']
  readonly modelDirectory: KimiSettingsCardInjected['modelDirectory']
  readonly checkEndpoint: KimiSettingsCardInjected['checkEndpoint']
  readonly useSessions: KimiSettingsCardProps['useSessions']
  readonly t: KimiSettingsCardProps['t']
}) {
  const {
    snapshot, saved, error, ready, live, write,
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
          harness={{ id: 'kimi', label: 'Kimi Code' }}
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
      <ModelListSection
        active={active}
        modelList={modelList}
        modelDirectory={modelDirectory}
        directoryRefresh={endpointSaved}
        t={authT}
      />
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
 * The kimi harness settings card of the retired 0.1.5 plugin configuration
 * tab (no longer registered; the live surface is the plugins.item entry
 * below): the same collapsible chrome the official plugin cards use, re-implemented
 * locally (the bundle-purity gate forbids value-importing the official chrome
 * — the context-guard pattern), with the at-a-glance credential dot in the
 * header. Explanation copy lives in hover/focus bubbles behind ⓘ anchors —
 * the card's rows stay one line each.
 * @param props - the injected scope/auth faces and copy.
 * @returns the card.
 */
export function KimiSettingsCard(props: KimiSettingsCardProps) {
  const { useSettings, scope, auth, authT, modelList, modelDirectory, checkEndpoint, endpointAuth, useSessions, t } = props
  const [open, setOpen] = useState(false)
  const state = useCardState(open, useSettings, scope, endpointAuth)
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
        <IconChevronDownOutlineMedium className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open && <CardBody state={state} active={open} auth={auth} authT={authT} modelList={modelList} modelDirectory={modelDirectory} checkEndpoint={checkEndpoint} useSessions={useSessions} t={t} />}
    </li>
  )
}

/**
 * The provider's card on the Plugins page (the `plugins.item` entry
 * client/index.ts registers while the Host serves the namespace AND the core
 * predates the family card): the page
 * draws the title, the icon, and the crumb itself, so the entry renders the
 * one-liner for the `summary` view and the bare form — with its own save
 * control — for `page`.
 * @param props - the owner view, the injected scope/auth faces, and copy.
 * @returns the entry.
 */
export function KimiBundleConfig({ view, useSettings, scope, auth, authT, modelList, modelDirectory, checkEndpoint, endpointAuth, useSessions, t }: KimiBundleConfigProps) {
  const state = useCardState(view === 'page', useSettings, scope, endpointAuth)
  if (view === 'summary') return <span className={css.description}>{t('card.description')}</span>
  return <CardBody state={state} active={view === 'page'} auth={auth} authT={authT} modelList={modelList} modelDirectory={modelDirectory} checkEndpoint={checkEndpoint} useSessions={useSessions} t={t} />
}

/**
 * The harness's section inside the core's「本机 Agent 委派」family card: the
 * same useCardState + CardBody the plugins.item page view renders — the
 * collapsible chrome belongs to the family card now.
 * @param props - the injected scope/auth faces, the forwarded session seat, and copy.
 * @returns the section body.
 */
export function KimiCardSection({ active, useSettings, scope, auth, authT, modelList, modelDirectory, checkEndpoint, endpointAuth, useSessions, t }: KimiCardSectionProps) {
  const state = useCardState(active, useSettings, scope, endpointAuth)
  return <CardBody state={state} active={active} auth={auth} authT={authT} modelList={modelList} modelDirectory={modelDirectory} checkEndpoint={checkEndpoint} useSessions={useSessions} t={t} />
}
