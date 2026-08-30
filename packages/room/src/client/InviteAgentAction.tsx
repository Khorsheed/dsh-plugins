/**
 * The session-header「邀请 agent」action (the `conversation.session.header.actions`
 * list slot, every session): one quiet chip that opens the invite dialog.
 * Inviting into a plain session PROMOTES it into a room host-side
 * (ensureRoom); the dialog and its submit path are the same ones the members
 * tab uses.
 * @module @khorsheed/dsh-room/client/InviteAgentAction
 */
import { useState, type ReactNode } from 'react'
import type { RoomProviderList } from '../types.ts'
import { InviteDialog, type InviteDialogSubmit } from './InviteDialog.tsx'
import type { InviteAgentActionProps } from './slots.ts'
import css from './InviteAgentAction.module.css'

/** The header chip plus its dialog. */
export function InviteAgentAction({
  roomCwd, invite, listProviders, listNames, browseDirectory, t,
}: InviteAgentActionProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<RoomProviderList | undefined>(undefined)

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
    })
    return outcome
  }

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
          onSubmit={submit}
          onClose={() => { setOpen(false) }}
          t={t}
        />
      )}
    </>
  )
}
