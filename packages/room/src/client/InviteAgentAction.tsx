/**
 * The session-header「邀请 agent」action (the `conversation.session.header.actions`
 * list slot, every session): one quiet chip that opens the invite dialog.
 * Inviting into a plain session PROMOTES it into a room host-side
 * (ensureRoom); the dialog and its submit path are the same ones the members
 * tab uses.
 * @module @khorsheed/dsh-room/client/InviteAgentAction
 */
import { useEffect, useReducer, useState, type ReactNode } from 'react'
import type { RoomProviderList } from '../types.ts'
import { InviteDialog, type InviteDialogSubmit } from './InviteDialog.tsx'
import type { InviteAgentActionProps } from './slots.ts'
import css from './InviteAgentAction.module.css'

/** The header chip plus its dialog. */
export function InviteAgentAction({
  roomCwd, invite, listProviders, listNames, browseDirectory, modelChoices, roomChrome, sessionId, t,
}: InviteAgentActionProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<RoomProviderList | undefined>(undefined)
  // Re-render when the criterion's inputs move (the inventory answer lands,
  // or the current session flips the per-session verdict).
  const [, bump] = useReducer((count: number): number => count + 1, 0)
  useEffect(() => roomChrome.subscribe(bump), [roomChrome])

  const openDialog = (): void => {
    setProviders(undefined)
    setOpen(true)
    void listProviders().then(setProviders)
  }

  const submit = async (values: InviteDialogSubmit) => {
    // Blank optional fields are omitted, not sent (the host rejects a
    // present-but-blank role; an absent one simply carries no preset).
    const outcome = await invite({
      provider: values.provider,
      name: values.name,
      ...values.instructions === '' ? {} : { instructions: values.instructions },
      ...values.cwd === '' ? {} : { cwd: values.cwd },
      ...values.firstTask === '' ? {} : { firstTask: values.firstTask },
      ...values.model === '' ? {} : { model: values.model },
    })
    return outcome
  }

  // M3' self-hide: the chip is the room's dev affordance — it renders only
  // when this session's preset composition grants the room tools (or the
  // session IS a room, or the criterion has no answer — all fail-open).
  if (!roomChrome.show(sessionId)) return null

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('action.inviteAgent')}
        onClick={openDialog}
      >
        {t('action.inviteAgent')}
      </button>
      {open && (
        <InviteDialog
          mode="invite"
          providers={providers?.providers}
          localAgentAvailable={providers?.localAgentAvailable ?? true}
          inheritedCwd={roomCwd}
          existingNames={listNames()}
          browseDirectory={browseDirectory}
          modelChoices={modelChoices}
          onSubmit={submit}
          onClose={() => { setOpen(false) }}
          t={t}
        />
      )}
    </>
  )
}
