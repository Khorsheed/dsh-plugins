import type { LocalAgentUi } from '@khorsheed/dsh-local-agent/client'
/**
 * The invite/edit dialog as a character-creation card: the host's
 * ui-primitives Modal (headless — portaled to document.body over the dimmed
 * page mask, so the room composer and conversation never reflow; Esc / mask
 * click / 取消 close it, Tab stays inside, focus returns to the trigger; a
 * bottom sheet on narrow viewports) with
 * a live member-card preview beside the form — every keystroke re-renders
 * the preview (the preview avatar stays neutral; the name-hash color joins
 * once the member is seated), and a 🎲 dice button rolls a random
 * game-flavored name from the pool (name-pool.ts), skipping names already
 * on the roster. The chrome rides the official design tokens: the near-black
 * button-primary-fill capsule is the one filled action, and no blue accent
 * appears (see InviteDialog.module.css).
 *
 * Field order is primary-first: provider → 默认模型 → 称呼(+🎲) → 首个任务 →
 * ▸ 高级设置 (role instructions + the member-level cwd, collapsed on invite —
 * editing opens it, since editing IS changing those). The model field sits in
 * the main form (promoted out of the drawer): the same control the provider
 * settings cards use, widened with the model's reasoning-effort row (a
 * brokerless composition keeps the control model-only). Invites retain a
 * saved provider choice, otherwise the shared picker chooses the first
 * candidate. Edits retain member configuration.
 * Older cores without the shared picker keep the legacy default/input fallback.
 * The rest of the original
 * contract is unchanged: logged-out providers grey with login guidance (an
 * absent facade degrades the whole section to a hint), the name precheck
 * plus the host's structured duplicate/invalid errors ride the inline error
 * line, instructions ride the front of the member's FIRST task message
 * (never a system-prompt channel), and the cwd accepts direct input, a native
 * pick, or a directory chosen through the browse-backend fallback. Empty cwd
 * inherits the room session's cwd (shown as the placeholder); edit mode diffs
 * name/cwd/instructions/model.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  MembersViewProps, RoomInviteOutcome, RoomInviteValues, RoomModelDirectory, RoomModelSelection, RoomMutationOutcome,
} from './slots.ts'
import type { RoomMember, RoomMemberRun, RoomPresetInfo, RoomProviderInfo } from '../types.ts'
import type { LocalAgentModelInfo } from '@khorsheed/dsh-local-agent/types'
import { IconChevronDownOutlineMedium } from './icons.tsx'
import { MemberCard } from './MemberCard.tsx'
import { BackgroundConfirm } from './MemberActivity.tsx'
import { MemberToolsLine } from './MemberToolsLine.tsx'
import { MemberRecoveryLine } from './MemberRecoveryLine.tsx'
import { RoomDirectoryBrowser } from './RoomDirectoryBrowser.tsx'
import { memberRecovery as foldRecovery } from './member-recovery-view.ts'
import { modeShortName } from './member-tools-view.ts'
import { rollName } from './name-pool.ts'
import { ROOM_ROLE_MAX } from '../journal.ts'
import css from './InviteDialog.module.css'

/** The dialog's submit values (edit mode carries name/cwd/instructions/model/effort). */
export interface InviteDialogSubmit {
  readonly provider: string
  readonly name: string
  /** The member's mode: a host preset id ('' = none). */
  readonly preset: string
  /** Short public role ('' = none). */
  readonly role: string
  readonly instructions: string
  readonly cwd: string
  readonly firstTask: string
  /** The delegation's invite-time model ('' = follow the harness default). */
  readonly model: string
  /** The delegation's invite-time reasoning effort ('' = follow the harness default). */
  readonly effort: string
  /**
   * The model value the edit field opened with (the member's effective model
   * when the broker answered, else the journaled intent): the edit-mode diff
   * baseline — a save only touches the broker/journal when the value moved.
   */
  readonly modelBaseline: string
  /** The effort value the edit field opened with (the journaled intent), the edit-mode diff baseline. */
  readonly effortBaseline: string
  /** Edit mode: model/effort came from the member-control fields — save them through it. */
  readonly memberPicker?: true
  /** Edit mode, the room's own agent: the session model it switches to (only when changed). */
  readonly mainSelection?: RoomModelSelection
}

/**
 * The dialog's submission as the host's invite request: blank optional
 * fields are omitted, not sent (the host rejects a present-but-blank role).
 * Every invite entry (members tab, header action, fresh-room capsule) shares it.
 */
export function inviteRequest(values: InviteDialogSubmit): RoomInviteValues {
  return {
    provider: values.provider,
    name: values.name,
    ...values.instructions === '' ? {} : { instructions: values.instructions },
    ...values.role === '' ? {} : { role: values.role },
    ...values.preset === '' ? {} : { preset: values.preset },
    ...values.cwd === '' ? {} : { cwd: values.cwd },
    ...values.firstTask === '' ? {} : { firstTask: values.firstTask },
    ...values.model === '' ? {} : { model: values.model },
    ...values.effort === '' ? {} : { effort: values.effort },
  }
}

export interface InviteDialogProps {
  readonly renderHarnessModelPicker?: LocalAgentUi['renderHarnessModelPicker'] | undefined
  readonly memberConfiguration?: ReactNode | undefined
  readonly mode: 'invite' | 'edit'
  /** The member being edited (edit mode). */
  readonly member?: RoomMember | undefined
  /** The invitable providers; undefined while loading (invite mode). */
  readonly providers?: readonly RoomProviderInfo[] | undefined
  /** Host agent presets a member's mode may name; absent = no mode picker. */
  readonly presets?: readonly RoomPresetInfo[] | undefined
  /** The room session's own mode: the default mode of a new member. */
  readonly sessionPreset?: string | undefined
  /** False = the delegation facade is absent (invite mode). */
  readonly localAgentAvailable: boolean
  /** The room session's cwd (the empty-cwd placeholder, invite mode). */
  readonly inheritedCwd?: string | undefined
  /** The roster's current names — the name dice never rolls one of these. */
  readonly existingNames: readonly string[]
  /** The native pick call; null means cancelled, a rejection can fall back to listDirectory. */
  readonly browseDirectory: () => Promise<string | null>
  readonly listDirectory?: MembersViewProps['listDirectory']
  /**
   * The pickable model surface of one harness (the localAgentGateway
   * `harnessModel` read): the model row's menu vocabulary plus the default an
   * unset field displays. Absent, the model field is a plain text input.
   */
  readonly modelSurface?: ((harness: string) => Promise<LocalAgentModelInfo | undefined>) | undefined
  /**
   * A member's own model surface (the localAgentGateway `memberModel` read):
   * the edit dialog's prefill and menu source — preferred over
   * `harnessModel` for an existing member, since it carries that member's
   * effective/source/choices. null/undefined answers keep the journaled
   * intent as the baseline.
   */
  readonly memberModel?: ((childSessionId: string) => Promise<LocalAgentModelInfo | null | undefined>) | undefined
  /**
   * Edit mode, a started CLI member: the invite picker's two selects over the
   * member's own directory (local-agent's member-control form face). Absent
   * (an older core), the live member-configuration control stays.
   */
  readonly renderMemberModelPicker?: LocalAgentUi['renderMemberModelPicker'] | undefined
  readonly readMemberSelection?: LocalAgentUi['readMemberSelection'] | undefined
  /** Edit mode, the room's own agent: the session's model directory (its model IS the session's). */
  readonly mainModelDirectory?: RoomModelDirectory | undefined
  /** Edit mode: the member is running a round (model and effort wait for its end). */
  readonly memberRunning?: boolean | undefined
  /**
   * Edit mode: the member's latest run as the room knows it, so the head
   * card's status chip tells the truth (running / failed / idle) instead of
   * a fixed 空闲.
   */
  readonly memberRun?: RoomMemberRun | undefined
  /** Edit mode, a CLI member with a mode: what its process holds of the mode's tools (local-agent's read); absent without the family. */
  readonly memberTools?: MembersViewProps['memberTools']
  /** Edit mode: reload that member's process so it lists its tools again. */
  readonly reloadMemberTools?: MembersViewProps['reloadMemberTools']
  /** Edit mode, a started CLI member: a failed start or interrupted rounds (local-agent's reads); absent without the family. */
  readonly memberRecovery?: MembersViewProps['memberRecovery']
  /** Edit mode: 对账并重试 for a member whose start failed. */
  readonly retryMemberStart?: MembersViewProps['retryMemberStart']
  /** Edit mode: the human's verdict on a round a restart interrupted. */
  readonly reconcileMemberExecution?: MembersViewProps['reconcileMemberExecution']
  /**
   * Edit mode, a started CLI member: how many background tasks its live
   * process runs now. Saving a model change replaces that process, so a
   * positive count asks 「会让 N 项后台工作失去联系，继续吗？」 first.
   */
  readonly runningBackgroundTasks?: MembersViewProps['runningBackgroundTasks']
  readonly onSubmit: (values: InviteDialogSubmit) => Promise<RoomMutationOutcome | RoomInviteOutcome>
  readonly onClose: () => void
  readonly t: MembersViewProps['t']
}

/** The addressing-name grammar (host-validated too; this is the precheck). */
function validName(name: string): boolean {
  return name !== '' && !/\s/.test(name) && !name.includes('@')
}

/** The invite/edit modal card. */
export function InviteDialog({
  mode, member, providers, presets, sessionPreset, localAgentAvailable, inheritedCwd, existingNames,
  browseDirectory, listDirectory, modelSurface, renderHarnessModelPicker, memberModel, memberConfiguration,
  renderMemberModelPicker, readMemberSelection, mainModelDirectory, memberRunning = false, memberRun, memberTools, reloadMemberTools,
  memberRecovery, retryMemberStart, reconcileMemberExecution, runningBackgroundTasks, onSubmit, onClose, t,
}: InviteDialogProps): ReactNode {
  const isMain = mode === 'edit' && member?.kind === 'main-agent'
  /** A started CLI member edited through the member-control form fields (saved on 保存). */
  const pickerChild = mode === 'edit' && member?.kind === 'cli' && renderMemberModelPicker !== undefined && readMemberSelection !== undefined
    ? member.childSessionId : undefined
  const [provider, setProvider] = useState('')
  const [name, setName] = useState(member?.name ?? '')
  const [role, setRole] = useState(member?.role ?? '')
  const [instructions, setInstructions] = useState(member?.instructions ?? '')
  const [cwd, setCwd] = useState(member?.cwd ?? '')
  const [firstTask, setFirstTask] = useState('')
  // Edit mode opens on the journaled intent; the broker's effective model
  // replaces it when the memberModel read below answers.
  const [model, setModel] = useState(mode === 'edit' ? member?.model ?? '' : '')
  const [modelBaseline, setModelBaseline] = useState(mode === 'edit' ? member?.model ?? '' : '')
  // The effort companion of the model field: '' = follow the harness default.
  // Edit mode opens on the journaled intent (a live member's effective effort
  // is the member-configuration card's business — it replaces this field).
  const [effort, setEffort] = useState(mode === 'edit' ? member?.effort ?? '' : '')
  // Read-only baseline: no broker read rewrites it (a live member's effort
  // belongs to the member-configuration card that replaces this field).
  const [effortBaseline, setEffortBaseline] = useState(mode === 'edit' ? member?.effort ?? '' : '')
  // The member-control draft: the fields render once it is read (an empty
  // value would make the picker pick its first entry). A round in flight
  // makes a save wait for its end.
  const [draftReady, setDraftReady] = useState(false)
  const [roundBusy, setRoundBusy] = useState(false)
  useEffect(() => {
    if (pickerChild === undefined || readMemberSelection === undefined) return
    let cancelled = false
    void readMemberSelection(pickerChild).then((draft) => {
      if (cancelled) return
      if (draft !== undefined) {
        setModel(draft.model); setModelBaseline(draft.model)
        setEffort(draft.effort); setEffortBaseline(draft.effort)
        setRoundBusy(draft.busy)
      }
      setDraftReady(true)
    })
    return () => { cancelled = true }
  }, [pickerChild, readMemberSelection])
  // The room's own agent: its model is the session's (opened on the current selection).
  const [mainSelection, setMainSelection] = useState<RoomModelSelection | null | undefined>(undefined)
  const [mainBaseline, setMainBaseline] = useState<RoomModelSelection | null>(null)
  const mainSnapshot = useSyncExternalStore(
    mainModelDirectory?.store.subscribe ?? noSubscribe,
    () => mainModelDirectory?.store.getSnapshot(),
  )
  useEffect(() => { if (isMain) void mainModelDirectory?.load() }, [isMain, mainModelDirectory])
  useEffect(() => {
    if (!isMain || mainSelection !== undefined || mainSnapshot === undefined || mainSnapshot.status === 'loading') return
    setMainSelection(mainSnapshot.current)
    setMainBaseline(mainSnapshot.current)
  }, [isMain, mainSelection, mainSnapshot])
  /** The model row's surface: menu vocabulary + the default an unset field displays. */
  const [surface, setSurface] = useState<LocalAgentModelInfo | undefined>(undefined)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelFieldRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Saving waits on 「会让 N 项后台工作失去联系」: N, until 继续 or 取消. */
  const [saveConfirm, setSaveConfirm] = useState<number | undefined>(undefined)
  // Bumped after a 立即载入 / 重新载入 so the recovery block re-reads at once.
  const [recoveryKey, setRecoveryKey] = useState(0)
  const recoveryChild = mode === 'edit' && member?.kind === 'cli' && memberRecovery !== undefined && retryMemberStart !== undefined
    ? member.childSessionId : undefined
  /**
   * 立即载入 / 重新载入's first step: a member whose last start failed is
   * retried (对账并重试) before the load; a selection that did not apply is
   * left to the block's own button. Resolves the new reason when it fails again.
   */
  const recoverBeforeLoad = recoveryChild === undefined ? undefined : async (): Promise<string | undefined> => {
    const before = foldRecovery(await memberRecovery!(recoveryChild))
    if (before?.failed?.cause !== 'start') return undefined
    const outcome = await retryMemberStart!(recoveryChild, before.failed.revision)
    const after = foldRecovery(await memberRecovery!(recoveryChild))
    if (after?.failed !== undefined) return after.failed.reason === '' ? t('recovery.member.error') : after.failed.reason
    return outcome.ok ? undefined : outcome.message
  }
  const [browsing, setBrowsing] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  // Invite keeps the advanced drawer folded; edit opens it — changing those
  // fields is what the edit dialog is for.
  const [advancedOpen, setAdvancedOpen] = useState(mode === 'edit')
  // The head card's running chip carries an elapsed time: tick while the member runs.
  const [now, setNow] = useState(() => Date.now())
  const ticking = mode === 'edit' && memberRun?.state === 'running'
  useEffect(() => {
    if (!ticking) return undefined
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [ticking])

  // Esc belongs to the Modal layer (useModalLayer); an open model menu eats
  // the first one during capture, so the layer sees it handled.
  const onLayerKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !modelMenuOpen) return
    event.preventDefault()
    setModelMenuOpen(false)
  }

  // Click-outside closes the model menu (the settings cards' pattern).
  useEffect(() => {
    if (!modelMenuOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      if (modelFieldRef.current?.contains(event.target as Node) === true) return
      setModelMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => { document.removeEventListener('mousedown', onPointerDown) }
  }, [modelMenuOpen])

  const authenticated = (providers ?? []).filter(entry => entry.authenticated)
  const chosen = provider === '' ? (authenticated[0]?.provider ?? '') : provider
  // A new member works in the room's own mode unless the human picks another.
  const roomMode = sessionPreset !== undefined && presets?.some(entry => entry.id === sessionPreset) === true ? sessionPreset : undefined
  /** A member's mode: '' = none (only its own tools plus the room's); undefined = untouched (the room's mode). */
  const [cliPicked, setCliPreset] = useState<string | undefined>(undefined)
  const cliPreset = cliPicked ?? roomMode ?? ''
  const someLoggedOut = (providers ?? []).some(entry => !entry.authenticated)
  /** The chosen provider's roster harness name (the harnessModel lookup key). */
  const chosenHarness = (providers ?? []).find(entry => entry.provider === chosen)?.harness

  // The model surface follows the chosen provider: a harness without a
  // broker read (or a composition without the family's client half) leaves
  // the field a plain text input — blank still follows the harness default.
  useEffect(() => {
    // Edit mode's surface is the member's own (below): never reset it here.
    if (mode !== 'invite') return
    setSurface(undefined)
    if (modelSurface === undefined || chosenHarness === undefined) return
    let cancelled = false
    void modelSurface(chosenHarness).then((result) => {
      if (!cancelled) {
        setSurface(result)
        const saved = result?.settings
        if (saved) setModel(current => current || saved)
      }
    }, () => {})
    return () => { cancelled = true }
  }, [mode, modelSurface, chosenHarness])

  // Edit mode: the member's own model surface prefills the field (effective)
  // and serves the menu (choices). null (no delegation record yet — a
  // never-started member — or a brokerless harness) and undefined (RPC
  // failure) answers keep the journaled intent as the baseline.
  const editChild = mode === 'edit' ? member?.childSessionId : undefined
  useEffect(() => {
    if (mode !== 'edit' || memberModel === undefined || editChild === undefined) return
    let cancelled = false
    void memberModel(editChild).then((info) => {
      if (cancelled || info === null || info === undefined) return
      setModel(info.effective ?? '')
      setModelBaseline(info.effective ?? '')
      setSurface(info)
    }, () => {})
    return () => { cancelled = true }
  }, [mode, memberModel, editChild])
  // Edit mode: instructions may clear (empty = no preset injected); the name
  // is the only hard requirement.
  const canSubmit = mode === 'edit'
    ? validName(name) && !(name !== member?.name && existingNames.includes(name))
    : localAgentAvailable && chosen !== '' && validName(name) && !existingNames.includes(name)

  // The model row: the same control the provider settings cards use. An unset
  // field DISPLAYS the provider's current default dimmed (inherited, never
  // pinned); the chevron menu leads with the 默认 item (picking it clears the
  // field back to follow-default) over the full unfiltered vocabulary.
  const modelChoices = surface?.choices ?? []
  const surfaceDefault = surface?.effective ?? surface?.cliDefault
  const modelPlaceholder = mode === 'edit'
    ? t('invite.modelPlaceholderEdit')
    : surfaceDefault !== undefined && surfaceDefault !== ''
      ? t('invite.modelPlaceholderDefault', { model: surfaceDefault })
      : t('invite.modelPlaceholder')
  const modelDefaultItem = mode === 'edit'
    ? t('invite.modelDefaultItemEdit')
    : surfaceDefault !== undefined && surfaceDefault !== ''
      ? t('invite.modelDefaultItemNamed', { model: surfaceDefault })
      : t('invite.modelDefaultItem')
  const modelField = (
    <label className={css.field}>
      <span className={css.label}>{t('invite.model')}</span>
      {modelChoices.length > 0 ? (
        <div className={css.modelField} ref={modelFieldRef}>
          <input
            className={css.modelInput}
            value={model}
            placeholder={modelPlaceholder}
            aria-label={t('invite.model')}
            onChange={event => { setModel(event.target.value) }}
          />
          <button
            type="button"
            className={css.modelMenuButton}
            aria-label={t('invite.modelMenu')}
            aria-haspopup="menu"
            aria-expanded={modelMenuOpen}
            onClick={() => { setModelMenuOpen(open => !open) }}
          >
            <IconChevronDownOutlineMedium className={modelMenuOpen ? `${css.modelMenuChevron} ${css.modelMenuChevronOpen}` : css.modelMenuChevron} />
          </button>
          {modelMenuOpen && (
            <div className={css.modelMenu} role="menu" aria-label={t('invite.modelMenu')}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={model.trim() === ''}
                className={model.trim() === '' ? `${css.modelItemDefault} ${css.modelItemCurrent}` : css.modelItemDefault}
                onClick={() => { setModel(''); setModelMenuOpen(false) }}
              >
                <span className={css.modelItemLabel}>{modelDefaultItem}</span>
                <span className={css.modelItemCheck} aria-hidden>{model.trim() === '' ? '✓' : ''}</span>
              </button>
              {modelChoices.map(choice => (
                <button
                  key={choice}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice === model.trim()}
                  className={choice === model.trim() ? css.modelItemCurrent : css.modelItem}
                  onClick={() => { setModel(choice); setModelMenuOpen(false) }}
                >
                  <span className={css.modelItemLabel}>{choice}</span>
                  <span className={css.modelItemCheck} aria-hidden>{choice === model.trim() ? '✓' : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <input
          className={css.input}
          value={model}
          placeholder={modelPlaceholder}
          aria-label={t('invite.model')}
          onChange={event => { setModel(event.target.value) }}
        />
      )}
      <span className={css.hint}>
        {mode === 'edit' ? t('invite.modelHintEdit') : t('invite.modelHint')}
      </span>
    </label>
  )

  // The live preview: the form values as a roster card, always idle.
  const previewName = name.trim() === '' ? t('invite.previewName') : name.trim()
  const previewProvider = mode === 'edit'
    ? member?.provider
    : (providers ?? []).find(entry => entry.provider === chosen)?.displayName ?? chosen
  const previewMember: RoomMember = mode === 'edit' && member !== undefined ? (({ instructions: _i, role: _r, ...rest }: RoomMember): RoomMember => ({
    ...rest,
    name: previewName,
    ...instructions.trim() === '' ? {} : { instructions: instructions.trim() },
    ...role.trim() === '' ? {} : { role: role.trim() },
  }))(member) : {
    name: previewName,
    kind: 'cli',
    ...cliPreset !== '' ? { preset: cliPreset } : {},
    invitedBy: 'human',
    ...previewProvider === undefined || previewProvider === '' ? {} : { provider: previewProvider },
    ...instructions.trim() === '' ? {} : { instructions: instructions.trim() },
    ...role.trim() === '' ? {} : { role: role.trim() },
  }

  // A typed name that cannot be saved: invalid (whitespace, @) or another member's.
  const nameProblem = name === '' ? undefined
    : !validName(name) ? 'invite.error.invalid' as const
      : name !== member?.name && existingNames.includes(name) ? 'invite.error.duplicate' as const
        : undefined

  const rollDice = (): void => {
    const rolled = rollName(existingNames, name)
    if (rolled !== undefined) setName(rolled)
  }

  const browse = async (): Promise<void> => {
    if (browsing) return
    setBrowsing(true)
    setError(null)
    try {
      const picked = await browseDirectory()
      if (picked !== null) setCwd(picked)
    } catch {
      if (listDirectory !== undefined) setDirectoryOpen(true)
      else setError(t('invite.browseFailed'))
    } finally {
      setBrowsing(false)
    }
  }

  const submit = async (confirmed = false): Promise<void> => {
    if (!canSubmit || busy) return
    if (!validName(name)) {
      setError(t('invite.error.invalid'))
      return
    }
    setBusy(true)
    setError(null)
    setSaveConfirm(undefined)
    try {
      // A model (or effort) change replaces a started CLI member's process:
      // its running background work would lose contact — confirm first.
      const child = mode === 'edit' && member?.kind === 'cli' ? member.childSessionId : undefined
      const modelEdit = model.trim() !== modelBaseline.trim() || effort.trim() !== effortBaseline.trim()
      if (!confirmed && child !== undefined && modelEdit && runningBackgroundTasks !== undefined) {
        const running = await runningBackgroundTasks(child).catch(() => 0)
        if (running > 0) {
          setSaveConfirm(running)
          return
        }
      }
      const mainChanged = isMain && mainSelection != null && !sameSelection(mainSelection, mainBaseline)
      const outcome = await onSubmit({
        provider: chosen, preset: cliPreset, name, role: role.trim(), instructions: instructions.trim(), cwd: cwd.trim(), firstTask: firstTask.trim(),
        model: model.trim(), modelBaseline, effort: effort.trim(), effortBaseline,
        ...pickerChild !== undefined && draftReady ? { memberPicker: true as const } : {},
        ...mainChanged && mainSelection != null ? { mainSelection } : {},
      })
      if (!outcome.ok) {
        setError(outcome.message)
        return
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  // Keystrokes typed in the dialog stay out of the React ancestors the portal
  // still bubbles through (the room composer); Esc and Tab reach the Modal
  // layer's document listener (close, focus trap).
  const onCardKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' || event.key === 'Tab') return
    event.stopPropagation()
  }

  const title = mode === 'invite' ? t('invite.title') : t('invite.title.edit', { member: member?.name ?? '' })
  return (
    <Modal open headless title={title} onClose={onClose} className={mode === 'edit' ? `${css.card ?? ''} ${css.cardEdit ?? ''}` : css.card ?? ''} onKeyDownCapture={onLayerKeyDownCapture}>
      <div className={css.sheet} data-mode={mode} onKeyDown={onCardKeyDown}>
        <div className={css.title}>{title}</div>
        <div className={css.body}>
          <div className={css.form}>
            {mode === 'invite' && (
              !localAgentAvailable ? (
                <div className={css.hint} role="status">{t('invite.facadeMissing')}</div>
              ) : (
                <label className={css.field}>
                  <span className={css.label}>{t('invite.provider')}</span>
                  <select
                    className={css.select}
                    value={chosen}
                    onChange={event => { setProvider(event.target.value); setModel(''); setEffort('') }}
                  >
                    {localAgentAvailable && (providers ?? []).map(entry => (
                      <option key={entry.provider} value={entry.provider} disabled={!entry.authenticated}>
                        {entry.displayName}{entry.authenticated ? '' : t('invite.loggedOut')}
                      </option>
                    ))}
                  </select>
                  {someLoggedOut && <span className={css.hint}>{t('invite.loginHint')}</span>}
                </label>
              )
            )}
            {mode === 'invite' && presets !== undefined && presets.length > 0 && localAgentAvailable && (
              <label className={css.field}>
                <span className={css.label}>{t('invite.cliPreset')}</span>
                <select
                  className={css.select}
                  aria-label={t('invite.cliPreset')}
                  value={cliPreset}
                  onChange={event => { setCliPreset(event.target.value) }}
                >
                  <option value="">{t('invite.cliPresetNone')}</option>
                  {presets.map(entry => (
                    <option key={entry.id} value={entry.id} disabled={entry.broken !== undefined} title={entry.broken ?? entry.description}>
                      {entry.name ?? entry.id}
                    </option>
                  ))}
                </select>
                <span className={css.hint}>
                  {(() => {
                    const picked = presets.find(entry => entry.id === cliPreset)
                    const about = picked?.broken ?? picked?.description
                    return [about, t('invite.cliPresetHint')].filter(Boolean).join(' · ')
                  })()}
                </span>
              </label>
            )}
            {mode === 'edit' && <div className={css.editHead}>
              <MemberCard
                preview
                member={previewMember}
                run={memberRun}
                elapsedMs={memberRun?.state === 'running' ? Math.max(0, now - memberRun.startedAt) : undefined}
                openSession={() => {}}
                onEdit={() => {}}
                onRemove={() => {}}
                t={t}
              />
              {/* What the invitation fixed: shown, not offered. */}
              {isMain ? <dl className={css.locked}><span className={css.lockedNote}>{t('invite.mainLocked')}</span></dl> : <dl className={css.locked}>
                <div><dt>{t('invite.provider')}</dt><dd>{member?.provider ?? '—'}</dd></div>
                <div><dt>{t('invite.cliPreset')}</dt><dd>{member?.preset === undefined
                  ? t('invite.cliPresetNone')
                  : presets?.find(entry => entry.id === member?.preset)?.name ?? member?.preset}</dd></div>
              </dl>}
              {/* What the member's current process holds of its mode's tools (no mode, no line). */}
              {!isMain && member?.kind === 'cli' && member.preset !== undefined && member.childSessionId !== undefined
                && memberTools !== undefined && reloadMemberTools !== undefined && (
                <MemberToolsLine
                  childSessionId={member.childSessionId}
                  modeName={modeShortName(presets?.find(entry => entry.id === member.preset)?.name ?? member.preset)}
                  provider={member.provider ?? ''}
                  running={memberRunning}
                  read={memberTools}
                  reload={reloadMemberTools}
                  recover={recoverBeforeLoad}
                  onLoad={() => { setRecoveryKey(key => key + 1) }}
                  t={t}
                />
              )}
              {/* A member that cannot take work until the user acts: recovered here, without leaving the room. */}
              {!isMain && recoveryChild !== undefined && (
                <MemberRecoveryLine
                  childSessionId={recoveryChild}
                  read={memberRecovery!}
                  retry={retryMemberStart!}
                  reconcile={reconcileMemberExecution}
                  refreshKey={recoveryKey}
                  t={t}
                />
              )}
            </div>}
            {isMain
              ? (mainModelDirectory !== undefined && mainSnapshot !== undefined && (
                <MainModelFields snapshot={mainSnapshot} value={mainSelection ?? null} onChange={setMainSelection} disabled={busy}
                  classes={{ row: css.fieldPair, field: css.field, label: css.label, select: css.select }} t={t} />
              ))
              : pickerChild !== undefined
                ? (draftReady ? renderMemberModelPicker?.(pickerChild, { value: model, onChange: setModel, effort: { value: effort, onChange: setEffort }, disabled: busy, fields: { row: css.fieldPair, field: css.field, label: css.label, select: css.select } }) : null)
                : mode === 'edit' && memberConfiguration !== undefined
                  ? <div className={css.field}><span className={css.label}>{t('invite.modelLabel')}</span><div className={css.memberConfiguration}>{memberConfiguration}</div></div>
                  : memberConfiguration ?? (mode === 'invite' && chosenHarness !== undefined && (modelSurface === undefined || surface !== undefined) ? renderHarnessModelPicker?.(chosenHarness, { value: model, onChange: setModel, effort: { value: effort, onChange: setEffort }, disabled: busy, fields: { row: css.fieldPair, field: css.field, label: css.label, select: css.select } }) : undefined) ?? modelField}
            {isMain && mainModelDirectory !== undefined && <span className={css.hint}>{t('invite.mainModelHint')}</span>}
            {mode === 'edit' && (memberRunning || roundBusy) && (pickerChild !== undefined || isMain) && (
              <div className={css.pending} role="status">{t('invite.modelBusy', { member: member?.name ?? '' })}</div>
            )}
            <label className={css.field}>
              <span className={css.label}>{t('invite.name')}</span>
              <span className={css.nameRow}>
                <input
                  className={css.input}
                  value={name}
                  placeholder="ada"
                  onChange={event => { setName(event.target.value) }}
                />
                <button
                  type="button"
                  className={css.dice}
                  title={t('invite.randomName')}
                  aria-label={t('invite.randomName')}
                  onClick={rollDice}
                >
                  🎲
                </button>
              </span>
              {/* Say why 保存/邀请 is unavailable instead of a silently grey button. */}
              {nameProblem === undefined
                ? <span className={css.hint}>{t('invite.nameHint')}</span>
                : <span className={`${css.hint} ${css.hintError}`} role="alert">{t(nameProblem)}</span>}
            </label>
            <label className={css.field}>
              <span className={css.label}>{t('invite.role')}</span>
              <input
                className={css.input}
                value={role}
                maxLength={ROOM_ROLE_MAX}
                placeholder={t('invite.rolePlaceholder')}
                onChange={event => { setRole(event.target.value) }}
              />
              <span className={css.hint}>{t('invite.roleHint')}</span>
            </label>
            {mode === 'invite' && (
              <label className={css.field}>
                <span className={css.label}>{t('invite.firstTask')}</span>
                <textarea
                  className={css.textarea}
                  rows={2}
                  value={firstTask}
                  onChange={event => { setFirstTask(event.target.value) }}
                />
                <span className={css.hint}>{t('invite.firstTaskHint')}</span>
              </label>
            )}
            <details
              className={css.advanced}
              open={advancedOpen}
              onToggle={(event) => { setAdvancedOpen(event.currentTarget.open) }}
            >
              <summary className={css.advancedSummary}>{t('invite.advanced')}</summary>
              <div className={css.advancedBody}>
                <label className={css.field}>
                  <span className={css.label}>{t('invite.instructions')}</span>
                  <textarea
                    className={css.textarea}
                    rows={3}
                    value={instructions}
                    placeholder={t('invite.instructionsPlaceholder')}
                    onChange={event => { setInstructions(event.target.value) }}
                  />
                  <span className={css.hint}>
                    {mode === 'edit' ? t('invite.instructionsHintEdit') : t('invite.instructionsHint')}
                  </span>
                </label>
                {/* The room's own agent works in the session's cwd: nothing to pick. */}
                {!isMain && <label className={css.field}>
                  <span className={css.label}>{t('invite.cwd')}</span>
                  <span className={css.cwdRow}>
                    <input
                      className={css.input}
                      value={cwd}
                      placeholder={inheritedCwd ?? ''}
                      aria-label={t('invite.cwd')}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={event => { setCwd(event.target.value) }}
                    />
                    <button
                      type="button"
                      className={css.browse}
                      disabled={browsing}
                      onClick={() => { void browse() }}
                    >
                      {t('invite.browse')}
                    </button>
                    {cwd !== '' && (
                      <button
                        type="button"
                        className={css.browse}
                        aria-label={t('invite.cwdReset')}
                        onClick={() => { setCwd('') }}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                  <span className={css.hint}>{t('invite.cwdHint')}</span>
                </label>}
              </div>
            </details>
          </div>
          {mode === 'invite' && <div className={css.previewCol}>
            <span className={css.previewLabel}>{t('invite.preview')}</span>
            <MemberCard
              preview
              member={previewMember}
              run={undefined}
              elapsedMs={undefined}
              openSession={() => {}}
              onEdit={() => {}}
              onRemove={() => {}}
              t={t}
            />
          </div>}
        </div>
        {error !== null && <div className={css.error} role="alert">{error}</div>}
        {saveConfirm !== undefined && (
          <BackgroundConfirm
            count={saveConfirm}
            disabled={busy}
            onConfirm={() => { void submit(true) }}
            onCancel={() => { setSaveConfirm(undefined) }}
            t={t}
          />
        )}
        <div className={css.buttons}>
          <button type="button" className={css.button} onClick={onClose}>{t('invite.cancel')}</button>
          <button
            type="button"
            className={css.primary}
            disabled={!canSubmit || busy}
            onClick={() => { void submit() }}
          >
            {mode === 'invite' ? t('invite.submit') : t('invite.save')}
          </button>
        </div>
      </div>
      {directoryOpen && listDirectory !== undefined && (
        <RoomDirectoryBrowser
          listDirectory={listDirectory}
          onPicked={(picked) => { setCwd(picked); setDirectoryOpen(false) }}
          onClose={() => { setDirectoryOpen(false) }}
          t={t}
        />
      )}
    </Modal>
  )
}

const noSubscribe = (): (() => void) => () => {}

/** Same provider, model and effort. */
function sameSelection(a: RoomModelSelection | null, b: RoomModelSelection | null): boolean {
  return a?.provider === b?.provider && a?.model === b?.model && (a?.reasoningEffort ?? '') === (b?.reasoningEffort ?? '')
}

/**
 * The room's own agent's model fields: the session directory's models (grouped
 * by provider) and the picked model's effort levels, as two selects in the
 * invite picker's form classes.
 */
function MainModelFields({ snapshot, value, onChange, disabled, classes, t }: {
  readonly snapshot: NonNullable<ReturnType<RoomModelDirectory['store']['getSnapshot']>>
  readonly value: RoomModelSelection | null
  readonly onChange: (next: RoomModelSelection) => void
  readonly disabled: boolean
  readonly classes: { readonly row: string | undefined; readonly field: string | undefined; readonly label: string | undefined; readonly select: string | undefined }
  readonly t: InviteDialogProps['t']
}): ReactNode {
  const key = (provider: string, model: string): string => `${provider}\u0000${model}`
  const model = value === null ? undefined : snapshot.groups.find(group => group.id === value.provider)?.models.find(entry => entry.id === value.model)
  const efforts = model?.reasoning?.efforts ?? []
  return (
    <div className={classes.row}>
      <label className={classes.field}>
        <span className={classes.label}>{t('invite.mainModel')}</span>
        <select
          className={classes.select}
          disabled={disabled}
          value={value === null ? '' : key(value.provider, value.model)}
          onChange={(event) => {
            const [provider = '', id = ''] = event.target.value.split('\u0000')
            const next = snapshot.groups.find(group => group.id === provider)?.models.find(entry => entry.id === id)
            const fallback = next?.reasoning?.defaultEffort ?? next?.reasoning?.efforts[0]?.id
            const kept = value?.reasoningEffort !== undefined && next?.reasoning?.efforts.some(effort => effort.id === value.reasoningEffort) === true ? value.reasoningEffort : fallback
            onChange({ provider, model: id, ...kept === undefined ? {} : { reasoningEffort: kept } })
          }}
        >
          {value !== null && model === undefined && <option value={key(value.provider, value.model)}>{value.model}</option>}
          {snapshot.groups.map(group => (
            <optgroup key={group.id} label={group.name}>
              {group.models.map(entry => <option key={entry.id} value={key(group.id, entry.id)}>{entry.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className={classes.field}>
        <span className={classes.label}>{t('invite.mainEffort')}</span>
        <select
          className={classes.select}
          disabled={disabled || efforts.length === 0 || value === null}
          value={value?.reasoningEffort ?? ''}
          onChange={(event) => { if (value !== null) onChange({ ...value, reasoningEffort: event.target.value }) }}
        >
          {efforts.length === 0 && <option value="">{t('invite.mainEffortNone')}</option>}
          {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        </select>
      </label>
    </div>
  )
}
