/**
 * The invite/edit dialog: a self-drawn lightweight modal (overlay + centered
 * card, Esc/overlay-click closes). Invite mode collects provider (the
 * local-agent roster; logged-out providers greyed with login guidance, an
 * absent facade degrades the whole section to a hint), display name (client
 * precheck plus the host's structured duplicate/invalid errors), role
 * instructions (optional — they ride the front of the member's FIRST task
 * message, never a system-prompt channel; the hint says so honestly), a
 * member-level cwd (a read-only display filled by the 浏览… button — the
 * official `workspaces.pickDirectory` wire primitive, since the official
 * picker UI is bound to ui-workspace's adopt-as-workspace flow holes and
 * cannot serve a pure path pick; empty = inherit the room session's cwd,
 * shown as the placeholder), and an optional first task. Edit mode reuses
 * the card with the name (rename), cwd (clear = inherit again), and
 * instructions (clear = no preset injected) fields.
 */
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import type {
  MembersViewProps, RoomInviteOutcome, RoomMutationOutcome,
} from './slots.ts'
import type { RoomMember, RoomProviderInfo } from '../types.ts'
import css from './InviteDialog.module.css'

/** The dialog's submit values (edit mode carries name/cwd/instructions only). */
export interface InviteDialogSubmit {
  readonly provider: string
  readonly name: string
  readonly instructions: string
  readonly cwd: string
  readonly firstTask: string
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
  /**
   * The 浏览… button's pick call (the official `workspaces.pickDirectory`
   * wire primitive): resolves the picked absolute path, null on cancel, and
   * throws when the host serves no native picking capability (the button's
   * failure shows as an inline hint, the field stays as it was).
   */
  readonly browseDirectory: () => Promise<string | null>
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
  mode, member, providers, localAgentAvailable, inheritedCwd, browseDirectory, onSubmit, onClose, t,
}: InviteDialogProps): ReactNode {
  const [provider, setProvider] = useState('')
  const [name, setName] = useState(member?.name ?? '')
  const [instructions, setInstructions] = useState(member?.instructions ?? '')
  const [cwd, setCwd] = useState(member?.cwd ?? '')
  const [firstTask, setFirstTask] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const authenticated = (providers ?? []).filter(entry => entry.authenticated)
  const chosen = provider === '' ? (authenticated[0]?.provider ?? '') : provider
  const someLoggedOut = (providers ?? []).some(entry => !entry.authenticated)
  // Edit mode: instructions may clear (empty = no preset injected); the name
  // is the only hard requirement.
  const canSubmit = mode === 'edit'
    ? validName(name)
    : localAgentAvailable && chosen !== '' && validName(name)

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
        <label className={css.field}>
          <span className={css.label}>{t('invite.name')}</span>
          <input
            className={css.input}
            value={name}
            placeholder="ada"
            onChange={event => { setName(event.target.value) }}
          />
          <span className={css.hint}>{t('invite.nameHint')}</span>
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
