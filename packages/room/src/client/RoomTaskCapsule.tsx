/**
 * The task capsule above the room composer: 「● N 个任务进行中」 plus, when
 * something waits on the human (a held message, an approval, a question),
 * an amber 「⚠ N 件需要处理」. Both open the task page in the right sidebar
 * (the second straight at the first task that needs the human). A fresh
 * room — no task, no goal — shows a single 「＋ 邀请成员」 capsule instead.
 * Without the sidebar the capsule cannot open anything and shows nothing.
 */
import { useState, type ReactNode } from 'react'
import type { RoomProviderList, RoomState } from '../types.ts'
import type { RoomComposerProps } from './slots.ts'
import { InviteDialog, inviteRequest, type InviteDialogSubmit } from './InviteDialog.tsx'
import { attentionCount, needsAttention } from './tasks.ts'
import { ActivityCapsule, ActivityTray } from './MemberActivity.tsx'
import type { ActivityGroup, ActivityItem } from './member-activity-view.ts'
import css from './RoomTaskCapsule.module.css'

type Props = Pick<RoomComposerProps,
  'openTasks' | 'openPlanSession' | 'invite' | 'listProviders' | 'roomCwd' | 'browseDirectory' | 'listDirectory' | 'modelSurface' | 'renderHarnessModelPicker' | 't'>
  & {
    readonly state: RoomState
    /** A member waiting on a question inside its round: its capsule jumps back to the question. */
    readonly waiting?: { readonly member: string; readonly jump: () => void } | undefined
    /** More capsules for the row (the member-level queue capsules, room-timeline B2). */
    readonly extra?: ReactNode
    /** Members' background activity: the 「后台 N」 capsule and its tray (absent = none). */
    readonly background?: {
      readonly groups: readonly ActivityGroup[]
      readonly open: boolean
      readonly setOpen: (open: boolean) => void
      readonly jump: (item: ActivityItem, expand: boolean) => void
    } | undefined
  }

/** The background tray (above the row) and capsule (in it), or nothing. */
function backgroundParts(background: Props['background'], t: Props['t']): { readonly tray: ReactNode; readonly capsule: ReactNode } {
  if (background === undefined || background.groups.length === 0) return { tray: null, capsule: null }
  const { groups, open, setOpen, jump } = background
  return {
    tray: open ? <ActivityTray groups={groups} now={Date.now()} jump={(item, expand) => { setOpen(false); jump(item, expand) }} onClose={() => { setOpen(false) }} t={t} /> : null,
    capsule: <ActivityCapsule groups={groups} open={open} onToggle={() => { setOpen(!open) }} t={t} />,
  }
}

/** The capsule row. */
export function RoomTaskCapsule({
  state, openTasks, invite, listProviders, roomCwd, browseDirectory, listDirectory, modelSurface, renderHarnessModelPicker, waiting, background, extra, t,
}: Props): ReactNode {
  const bg = backgroundParts(background, t)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [providers, setProviders] = useState<RoomProviderList | undefined>(undefined)
  const jobs = state.jobs ?? []
  if (jobs.length === 0 && state.goal === undefined && state.plan === undefined) {
    const submitInvite = (values: InviteDialogSubmit) => invite(inviteRequest(values))
    return <div className={css.root}>
      {bg.tray}
      <div className={css.capsules}>
        <button type="button" className={css.capsule} onClick={() => {
          setProviders(undefined)
          setInviteOpen(true)
          void listProviders().then(setProviders)
        }}><span className={css.guide}>{t('members.invite')}</span></button>
        {extra}
        {bg.capsule}
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
        listDirectory={listDirectory}
        modelSurface={modelSurface}
        renderHarnessModelPicker={renderHarnessModelPicker}
        onSubmit={submitInvite}
        onClose={() => { setInviteOpen(false) }}
        t={t}
      />}
    </div>
  }
  if (openTasks === undefined) return null
  const running = jobs.filter(job => job.status === 'running').length
  const attention = attentionCount(state)
  const firstAttention = jobs.find(job => needsAttention(state, job))
  return <div className={css.root}>
    {bg.tray}
    <div className={css.capsules}>
      <button type="button" className={css.capsule} data-testid="room-task-capsule" {...running > 0 ? { 'data-running': '' } : {}} onClick={() => { openTasks() }}>
        {running > 0 && <span className={css.dot} aria-hidden />}
        {running > 0 ? t('job.capsule.running', { count: running }) : t('job.capsule.idle', { count: jobs.length })}
      </button>
      {attention > 0 && <button type="button" className={css.capsule} data-attention="" onClick={() => { openTasks(firstAttention?.id) }}>
        {t('job.capsule.attention', { count: attention })}
      </button>}
      {waiting !== undefined && <button type="button" className={css.capsule} data-attention="" data-waiting="" onClick={waiting.jump}>
        <span className={css.dot} aria-hidden />{t('question.capsule', { member: waiting.member })}
      </button>}
      {extra}
      {bg.capsule}
    </div>
  </div>
}
