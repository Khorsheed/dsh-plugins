/**
 * The invite/edit dialog: a self-drawn lightweight modal (overlay + centered
 * card, Esc/overlay-click closes). Invite mode collects provider (the
 * local-agent roster; logged-out providers greyed with login guidance, an
 * absent facade degrades the whole section to a hint), display name (client
 * precheck plus the host's structured duplicate/invalid errors), role
 * instructions, a member-level cwd (empty = inherit the room session's cwd,
 * shown as the placeholder), and an optional first task. Edit mode reuses
 * the card with only the instructions field.
 */
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import type {
  MembersViewProps, RoomInviteOutcome, RoomMutationOutcome,
} from './slots.ts'
import type { RoomMember, RoomProviderInfo } from '../types.ts'
import css from './InviteDialog.module.css'

/** The dialog's submit values (edit mode carries instructions only). */
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
  mode, member, providers, localAgentAvailable, inheritedCwd, onSubmit, onClose, t,
}: InviteDialogProps): ReactNode {
  const [provider, setProvider] = useState('')
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState(member?.instructions ?? '')
  const [cwd, setCwd] = useState('')
  const [firstTask, setFirstTask] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
  const canSubmit = mode === 'edit'
    ? instructions.trim() !== ''
    : localAgentAvailable && chosen !== '' && validName(name) && instructions.trim() !== ''

  const submit = async (): Promise<void> => {
    if (!canSubmit || busy) return
    if (mode === 'invite' && !validName(name)) {
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
          <>
            {!localAgentAvailable ? (
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
              <input
                className={css.input}
                value={cwd}
                placeholder={inheritedCwd ?? ''}
                onChange={event => { setCwd(event.target.value) }}
              />
              <span className={css.hint}>{t('invite.cwdHint')}</span>
            </label>
          </>
        )}
        <label className={css.field}>
          <span className={css.label}>{t('invite.instructions')}</span>
          <textarea
            className={css.textarea}
            rows={3}
            value={instructions}
            onChange={event => { setInstructions(event.target.value) }}
          />
          <span className={css.hint}>{t('invite.instructionsHint')}</span>
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
