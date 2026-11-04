/**
 * The 编辑成员 dialog outside the members tab: the same InviteDialog in edit
 * mode, wired to the same save path ({@link submitMemberEdit}), so a room
 * notice's 「编辑成员」 link opens exactly what the member card's 编辑 opens.
 * The members tab keeps its own host (it also owns invite); both save
 * through {@link submitMemberEdit}.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RoomMember, RoomProviderList } from '../types.ts'
import { InviteDialog, type InviteDialogSubmit } from './InviteDialog.tsx'
import type { MembersViewProps, RoomMembersInjected, RoomMutationOutcome } from './slots.ts'

type T = MembersViewProps['t']

/**
 * Save one member edit: the diff against the member record rides the patch
 * (an emptied cwd/instructions/role CLEARS back to inherit/none), a started
 * member's model and effort go through its member control (queued behind a
 * running round), and the room's own agent switches the session model.
 * @param face - the members face (writes).
 * @param member - the member as the dialog opened on it.
 * @param values - the dialog's values.
 * @param t - the room translator.
 * @returns the outcome, and whether the model change waits for the member's round.
 */
export async function submitMemberEdit(
  face: Pick<RoomMembersInjected, 'saveMemberSelection' | 'modelDirectory' | 'setMemberModel' | 'updateMember' | 'renderMemberConfiguration'>,
  member: RoomMember,
  values: InviteDialogSubmit,
  t: T,
): Promise<{ readonly outcome: RoomMutationOutcome; readonly deferred: boolean }> {
  const name = values.name.trim()
  const cwd = values.cwd.trim()
  const instructions = values.instructions.trim()
  const role = values.role.trim()
  const model = values.model.trim()
  const effort = values.effort.trim()
  const configurationOwned = member.childSessionId !== undefined && face.renderMemberConfiguration !== undefined
  const modelChanged = model !== values.modelBaseline.trim() && !configurationOwned
  const effortChanged = effort !== values.effortBaseline.trim() && !configurationOwned
  let deferred = false
  if (values.memberPicker === true && member.childSessionId !== undefined && face.saveMemberSelection !== undefined
    && (model !== values.modelBaseline.trim() || effort !== values.effortBaseline.trim())) {
    const saved = await face.saveMemberSelection(member.childSessionId, { model, effort })
    if (!saved.ok) return { outcome: { ok: false, message: saved.error }, deferred }
    deferred = saved.deferred
  }
  if (values.mainSelection !== undefined && face.modelDirectory !== undefined) {
    const result = await face.modelDirectory.select(values.mainSelection).catch((error: unknown) => ({ ok: false as const, error }))
    if (!result.ok) return { outcome: { ok: false, message: t('invite.error.generic') }, deferred }
  }
  if (modelChanged && member.childSessionId !== undefined) {
    if (face.setMemberModel === undefined) return { outcome: { ok: false, message: t('invite.error.generic') }, deferred }
    // Compatibility entry also uses the core queue. No journaled model
    // mutation for a started member: its durable owner is local-agent.
    const result = await face.setMemberModel(member.childSessionId, model === '' ? undefined : model)
    if (result === undefined) return { outcome: { ok: false, message: t('invite.error.generic') }, deferred }
    if (!result.ok) return { outcome: { ok: false, message: result.error }, deferred }
  }
  const patch = {
    ...name !== member.name ? { rename: name } : {},
    ...cwd !== (member.cwd ?? '') ? { cwd: cwd === '' ? null : cwd } : {},
    ...instructions !== (member.instructions ?? '')
      ? { instructions: instructions === '' ? null : instructions }
      : {},
    ...role !== (member.role ?? '') ? { role: role === '' ? null : role } : {},
    // The journaled intent: the first dispatch binds it for a never-started
    // member (the broker call above is a no-op there — no delegation record —
    // so this value alone carries the edit). Effort rides the same rule; a
    // started member's effort belongs to the member-configuration card that
    // replaces these fields outright.
    ...modelChanged && member.childSessionId === undefined ? { model: model === '' ? null : model } : {},
    ...effortChanged && member.childSessionId === undefined ? { effort: effort === '' ? null : effort } : {},
  }
  const outcome = Object.keys(patch).length === 0 ? { ok: true as const } : await face.updateMember(member.name, patch)
  return { outcome, deferred }
}

export interface MemberEditDialogProps {
  readonly sessionId: SessionId
  /** The member to edit, by its current name (looked up on the room store's roster). */
  readonly memberName: string
  readonly face: RoomMembersInjected
  readonly onClose: () => void
  readonly t: T
}

/** The edit dialog for one member, hosted anywhere in the room client. */
export function MemberEditDialog({ sessionId, memberName, face, onClose, t }: MemberEditDialogProps): ReactNode {
  const [providers, setProviders] = useState<RoomProviderList | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    void face.listProviders(sessionId).then((list) => { if (!cancelled) setProviders(list) })
    return () => { cancelled = true }
  }, [face, sessionId])
  const state = face.roomStore.getCached(sessionId)
  const member = state?.members.find(entry => entry.name === memberName)
  if (member === undefined) return null
  return (
    <InviteDialog
      mode="edit"
      member={member}
      providers={providers?.providers}
      presets={providers?.presets}
      sessionPreset={providers?.sessionPreset}
      localAgentAvailable={providers?.localAgentAvailable ?? true}
      inheritedCwd={face.roomCwd}
      existingNames={(state?.members ?? []).map(entry => entry.name)}
      browseDirectory={face.browseDirectory}
      modelSurface={face.modelSurface}
      renderHarnessModelPicker={face.renderHarnessModelPicker}
      memberModel={face.memberModel}
      memberConfiguration={member.childSessionId !== undefined ? face.renderMemberConfiguration?.(member.childSessionId) : undefined}
      renderMemberModelPicker={face.renderMemberModelPicker}
      readMemberSelection={face.readMemberSelection}
      mainModelDirectory={face.modelDirectory}
      memberRunning={state?.runs.some(run => run.member === member.name && run.state === 'running') ?? false}
      memberRun={state?.runs.find(run => run.member === member.name)}
      memberTools={face.memberTools}
      reloadMemberTools={face.reloadMemberTools}
      memberRecovery={face.memberRecovery}
      retryMemberStart={face.retryMemberStart}
      reconcileMemberExecution={face.reconcileMemberExecution}
      onSubmit={async (values) => {
        const { outcome } = await submitMemberEdit(face, member, values, t)
        if (outcome.ok) void face.roomStore.refresh(sessionId)
        return outcome
      }}
      onClose={onClose}
      t={t}
    />
  )
}
