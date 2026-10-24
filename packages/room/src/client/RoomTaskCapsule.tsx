/**
 * The task capsule above the room composer: 「● N 个任务进行中」 plus, when
 * something waits on the human (an uncertain outcome, a held message), an
 * amber 「⚠ N 件需要处理」. Both open the task page in the right sidebar
 * (the second straight at the first task that needs the human). A fresh
 * room — no task, no goal — shows a single 「＋ 邀请成员」 capsule instead.
 * Without the sidebar the capsule cannot open anything, so uncertain
 * outcomes fall back to the inline reconcile view.
 */
import { useState, type ReactNode } from 'react'
import type { RoomProviderList, RoomState } from '../types.ts'
import type { RoomComposerProps } from './slots.ts'
import { InviteDialog, inviteRequest, type InviteDialogSubmit } from './InviteDialog.tsx'
import { RoomRecoveryView } from './RoomRecoveryView.tsx'
import { attentionCount, needsAttention } from './tasks.ts'
import css from './RoomTaskCapsule.module.css'

type Props = Pick<RoomComposerProps,
  'openTasks' | 'reconcileDelivery' | 'openPlanSession' | 'invite' | 'listProviders' | 'roomCwd' | 'browseDirectory' | 'modelSurface' | 'renderHarnessModelPicker' | 't'>
  & { readonly state: RoomState }

/** The capsule row. */
export function RoomTaskCapsule({
  state, openTasks, reconcileDelivery, openPlanSession, invite, listProviders, roomCwd, browseDirectory, modelSurface, renderHarnessModelPicker, t,
}: Props): ReactNode {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [providers, setProviders] = useState<RoomProviderList | undefined>(undefined)
  const jobs = state.jobs ?? []
  if (jobs.length === 0 && state.goal === undefined && state.plan === undefined) {
    const submitInvite = (values: InviteDialogSubmit) => invite(inviteRequest(values))
    return <div className={css.root}>
      <div className={css.capsules}>
        <button type="button" className={css.capsule} onClick={() => {
          setProviders(undefined)
          setInviteOpen(true)
          void listProviders().then(setProviders)
        }}><span className={css.guide}>{t('members.invite')}</span></button>
      </div>
      {inviteOpen && <InviteDialog
        mode="invite"
        providers={providers?.providers}
        presets={providers?.presets}
        sessionPreset={providers?.sessionPreset}
        localAgentAvailable={providers?.localAgentAvailable ?? true}
        inheritedCwd={roomCwd}
        existingNames={state.members.map(entry => entry.name)}
        browseDirectory={browseDirectory}
        modelSurface={modelSurface}
        renderHarnessModelPicker={renderHarnessModelPicker}
        onSubmit={submitInvite}
        onClose={() => { setInviteOpen(false) }}
        t={t}
      />}
    </div>
  }
  if (openTasks === undefined) {
    return reconcileDelivery === undefined ? null
      : <RoomRecoveryView deliveries={state.deliveries ?? []} members={state.members} reconcile={reconcileDelivery} openSession={openPlanSession} t={t} />
  }
  const running = jobs.filter(job => job.status === 'running').length
  const attention = attentionCount(state)
  const firstAttention = jobs.find(job => needsAttention(state, job))
  return <div className={css.root}>
    <div className={css.capsules}>
      <button type="button" className={css.capsule} data-testid="room-task-capsule" {...running > 0 ? { 'data-running': '' } : {}} onClick={() => { openTasks() }}>
        {running > 0 && <span className={css.dot} aria-hidden />}
        {running > 0 ? t('job.capsule.running', { count: running }) : t('job.capsule.idle', { count: jobs.length })}
      </button>
      {attention > 0 && <button type="button" className={css.capsule} data-attention="" onClick={() => { openTasks(firstAttention?.id) }}>
        {t('job.capsule.attention', { count: attention })}
      </button>}
    </div>
  </div>
}
