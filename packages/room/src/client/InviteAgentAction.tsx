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
import { InviteDialog, inviteRequest, type InviteDialogSubmit } from './InviteDialog.tsx'
import type { InviteAgentActionProps } from './slots.ts'
import css from './InviteAgentAction.module.css'

/** The header chip plus its dialog. */
export function InviteAgentAction({
  roomCwd, invite, listProviders, listNames, browseDirectory, listDirectory, modelSurface, renderHarnessModelPicker, roomChrome, sessionId, t,
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
    void listProviders(sessionId).then(setProviders)
  }

  const submit = (values: InviteDialogSubmit) => invite(inviteRequest(values))

  // M3' self-hide applies to the entry, not to an invitation already in
  // progress: an inventory answer landing after the click must not discard it.
  const show = roomChrome.show(sessionId)
  if (!open && !show) return null

  return (
    <>
      {show && (
        <button
          type="button"
          className={css.trigger}
          aria-label={t('action.inviteAgent')}
          onClick={openDialog}
        >
          {t('action.inviteAgent')}
        </button>
      )}
      {open && (
        <InviteDialog
          mode="invite"
          providers={providers?.providers}
          presets={providers?.presets}
          sessionPreset={providers?.sessionPreset}
          localAgentAvailable={providers?.localAgentAvailable ?? true}
          inheritedCwd={roomCwd}
          existingNames={listNames()}
          browseDirectory={browseDirectory}
          listDirectory={listDirectory}
          modelSurface={modelSurface}
          renderHarnessModelPicker={renderHarnessModelPicker}
          onSubmit={submit}
          onClose={() => { setOpen(false) }}
          t={t}
        />
      )}
    </>
  )
}
