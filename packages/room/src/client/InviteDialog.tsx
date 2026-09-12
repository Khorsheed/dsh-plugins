/**
 * The invite/edit dialog as a character-creation card: a self-drawn
 * lightweight modal (overlay + centered card, Esc/overlay-click closes) with
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
 * settings cards use — an unset field DISPLAYS the provider's current default
 * dimmed (inherited, never pinned), the chevron menu leads with a 默认 item
 * over the harness's full choice vocabulary (invite-time riding the
 * localAgentGateway `harnessModel` read; edit-time prefilled from the member's
 * own `memberModel` surface — effective as the value, choices as the menu —
 * with the journaled intent as the fallback baseline). The rest of the original
 * contract is unchanged: logged-out providers grey with login guidance (an
 * absent facade degrades the whole section to a hint), the name precheck
 * plus the host's structured duplicate/invalid errors ride the inline error
 * line, instructions ride the front of the member's FIRST task message
 * (never a system-prompt channel), the cwd is a read-only display filled by
 * the 浏览… button (the official `uiWorkspace.pickDirectory` call;
 * empty = inherit the room session's cwd, shown as the placeholder), and
 * edit mode diffs name/cwd/instructions/model.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type {
  MembersViewProps, RoomInviteOutcome, RoomMutationOutcome,
} from './slots.ts'
import type { RoomMember, RoomProviderInfo } from '../types.ts'
import type { LocalAgentModelInfo } from '@khorsheed/dsh-local-agent/types'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { MemberCard } from './MemberCard.tsx'
import { rollName } from './name-pool.ts'
import css from './InviteDialog.module.css'

/** The dialog's submit values (edit mode carries name/cwd/instructions/model). */
export interface InviteDialogSubmit {
  readonly provider: string
  readonly name: string
  readonly instructions: string
  readonly cwd: string
  readonly firstTask: string
  /** The delegation's invite-time model ('' = follow the harness default). */
  readonly model: string
  /**
   * The model value the edit field opened with (the member's effective model
   * when the broker answered, else the journaled intent): the edit-mode diff
   * baseline — a save only touches the broker/journal when the value moved.
   */
  readonly modelBaseline: string
}

export interface InviteDialogProps {
  readonly mode: 'invite' | 'edit'
  /** The member being edited (edit mode). */
  readonly member?: RoomMember | undefined
  /** The invitable providers; undefined while loading (invite mode). */
  readonly providers?: readonly RoomProviderInfo[] | undefined
  /** False = the delegation facade is absent (invite mode). */
  readonly localAgentAvailable: boolean
  /** The room session's cwd (the empty-cwd placeholder, invite mode). */
  readonly inheritedCwd?: string | undefined
  /** The roster's current names — the name dice never rolls one of these. */
  readonly existingNames: readonly string[]
  /**
   * The 浏览… button's pick call (the official `uiWorkspace.pickDirectory`
   * call): resolves the picked absolute path, null on cancel or when the
   * host serves no native picking capability.
   */
  readonly browseDirectory: () => Promise<string | null>
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
  mode, member, providers, localAgentAvailable, inheritedCwd, existingNames,
  browseDirectory, modelSurface, memberModel, onSubmit, onClose, t,
}: InviteDialogProps): ReactNode {
  const [provider, setProvider] = useState('')
  const [name, setName] = useState(member?.name ?? '')
  const [instructions, setInstructions] = useState(member?.instructions ?? '')
  const [cwd, setCwd] = useState(member?.cwd ?? '')
  const [firstTask, setFirstTask] = useState('')
  // Edit mode opens on the journaled intent; the broker's effective model
  // replaces it when the memberModel read below answers.
  const [model, setModel] = useState(mode === 'edit' ? member?.model ?? '' : '')
  const [modelBaseline, setModelBaseline] = useState(mode === 'edit' ? member?.model ?? '' : '')
  /** The model row's surface: menu vocabulary + the default an unset field displays. */
  const [surface, setSurface] = useState<LocalAgentModelInfo | undefined>(undefined)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelFieldRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  // Invite keeps the advanced drawer folded; edit opens it — changing those
  // fields is what the edit dialog is for.
  const [advancedOpen, setAdvancedOpen] = useState(mode === 'edit')

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // An open model menu eats the first Esc; the next one closes the dialog.
      if (modelMenuOpen) {
        setModelMenuOpen(false)
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose, modelMenuOpen])

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
  const someLoggedOut = (providers ?? []).some(entry => !entry.authenticated)
  /** The chosen provider's roster harness name (the harnessModel lookup key). */
  const chosenHarness = (providers ?? []).find(entry => entry.provider === chosen)?.harness

  // The model surface follows the chosen provider: a harness without a
  // broker read (or a composition without the family's client half) leaves
  // the field a plain text input — blank still follows the harness default.
  useEffect(() => {
    setSurface(undefined)
    if (mode !== 'invite' || modelSurface === undefined || chosenHarness === undefined) return
    let cancelled = false
    void modelSurface(chosenHarness).then((result) => {
      if (!cancelled) setSurface(result)
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
    ? validName(name)
    : localAgentAvailable && chosen !== '' && validName(name)

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
            <IconChevronDownOutline14 className={modelMenuOpen ? `${css.modelMenuChevron} ${css.modelMenuChevronOpen}` : css.modelMenuChevron} />
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
  const previewMember: RoomMember = {
    name: previewName,
    kind: 'cli',
    invitedBy: 'human',
    ...previewProvider === undefined || previewProvider === '' ? {} : { provider: previewProvider },
    ...instructions.trim() === '' ? {} : { instructions: instructions.trim() },
  }

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
      // No native picking capability on this host (or a transport failure):
      // the field keeps its value and the hint explains the miss.
      setError(t('invite.browseFailed'))
    } finally {
      setBrowsing(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit || busy) return
    if (!validName(name)) {
      setError(t('invite.error.invalid'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const outcome = await onSubmit({
        provider: chosen, name, instructions: instructions.trim(), cwd: cwd.trim(), firstTask: firstTask.trim(),
        model: model.trim(), modelBaseline,
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

  const onCardKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation()
  }

  return (
    <div
      className={css.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={css.card} role="dialog" aria-modal="true" onKeyDown={onCardKeyDown}>
        <div className={css.title}>
          {mode === 'invite' ? t('invite.title') : t('invite.title.edit', { member: member?.name ?? '' })}
        </div>
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
                    onChange={event => { setProvider(event.target.value) }}
                  >
                    {(providers ?? []).map(entry => (
                      <option key={entry.provider} value={entry.provider} disabled={!entry.authenticated}>
                        {entry.displayName}{entry.authenticated ? '' : t('invite.loggedOut')}
                      </option>
                    ))}
                  </select>
                  {someLoggedOut && <span className={css.hint}>{t('invite.loginHint')}</span>}
                </label>
              )
            )}
            {modelField}
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
              <span className={css.hint}>{t('invite.nameHint')}</span>
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
                <label className={css.field}>
                  <span className={css.label}>{t('invite.cwd')}</span>
                  <span className={css.cwdRow}>
                    {/* Read-only display: a picked path only (manual typing went
                        away with the 浏览… button; empty = inherit the room cwd,
                        shown as the placeholder). */}
                    <input
                      className={css.input}
                      value={cwd}
                      placeholder={inheritedCwd ?? ''}
                      readOnly
                      aria-label={t('invite.cwd')}
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
                </label>
              </div>
            </details>
          </div>
          <div className={css.previewCol}>
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
          </div>
        </div>
        {error !== null && <div className={css.error} role="alert">{error}</div>}
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
    </div>
  )
}
