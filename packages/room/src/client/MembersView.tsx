/**
 * Members view: the room session's 成员 conversation-view tab. Owns
 * everything member-related — a card grid (member-color avatar block with the
 * uppercased name, provider/kind, clamped role instructions with an inline
 * expander, status chip, per-card [轨迹→] [编辑] [移除]) and the dashed
 * invite card. The running chip is the "去看看它在干什么" jump into the
 * member's child session; interrupt deliberately does NOT live here — it
 * belongs to the run surfaces (the chat-stream run row's stop, the member
 * session's own Stop). Data rides the room store (refreshed on entering the
 * tab and after every own mutation; the store's running-only poll keeps the
 * elapsed honest). The main-agent member takes no instructions and cannot be
 * removed — it is the room itself.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { RoomMember, RoomMemberRun } from '../types.ts'
import { formatDurationMs } from './format.ts'
import { memberColor } from './member-color.ts'
import { InviteDialog, type InviteDialogSubmit } from './InviteDialog.tsx'
import type { MembersViewProps } from './slots.ts'
import type { RoomProviderList } from '../types.ts'
import css from './MembersView.module.css'

type DialogState = { readonly mode: 'invite' } | { readonly mode: 'edit'; readonly member: RoomMember } | null

/** One roster card: identity, avatar block, role, status chip, actions. */
function MemberCard({
  member, run, elapsedMs, openSession, onEdit, onRemove, t,
}: {
  readonly member: RoomMember
  readonly run: RoomMemberRun | undefined
  /** Tick-driven elapsed for a running member (undefined otherwise). */
  readonly elapsedMs: number | undefined
  readonly openSession: MembersViewProps['openSession']
  readonly onEdit: () => void
  readonly onRemove: () => void
  readonly t: MembersViewProps['t']
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const instructionsRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    if (expanded) return
    const element = instructionsRef.current
    if (element !== null) setOverflowing(element.scrollHeight > element.clientHeight + 1)
  }, [member.instructions, expanded])

  const color = memberColor(member.name)
  const child = member.childSessionId
  const running = run?.state === 'running'
  const failed = run?.state === 'failed'
  return (
    <div className={css.card} data-member={member.name}>
      <div className={css.head}>
        <span className={css.dot} style={{ background: color }} aria-hidden />
        <span className={css.name}>{member.name}</span>
        <span className={css.hint}>
          {member.kind === 'main-agent' ? t('member.kind.main') : member.provider ?? ''}
        </span>
      </div>
      <div className={css.avatar} style={{ '--member-color': color } as CSSProperties} aria-hidden>
        {member.name.toUpperCase()}
      </div>
      {member.kind === 'cli' && (
        member.instructions === undefined ? (
          <p className={css.instructionsEmpty}>{t('members.instructions.empty')}</p>
        ) : (
          <div className={css.instructionsBlock}>
            <p
              ref={instructionsRef}
              className={expanded ? css.instructionsExpanded : css.instructions}
              title={expanded ? undefined : member.instructions}
            >
              {member.instructions}
            </p>
            {(overflowing || expanded) && (
              <button
                type="button"
                className={css.expandToggle}
                onClick={() => { setExpanded(value => !value) }}
              >
                {expanded ? t('members.instructions.collapse') : t('members.instructions.expand')}
              </button>
            )}
          </div>
        )
      )}
      <div className={css.foot}>
        {running ? (
          <button
            type="button"
            className={css.chipRunning}
            title={t('speech.jump')}
            disabled={child === undefined}
            onClick={() => { if (child !== undefined) openSession(child) }}
          >
            {`${t('members.status.running')} · ${formatDurationMs(elapsedMs ?? 0)}`}
          </button>
        ) : (
          <span className={failed ? css.chipFailed : css.chipIdle}>
            {failed ? t('members.status.failed') : t('members.status.idle')}
          </span>
        )}
        {member.kind === 'cli' && (
          <span className={css.actions}>
            <button
              type="button"
              className={css.action}
              disabled={child === undefined}
              onClick={() => { if (child !== undefined) openSession(child) }}
            >
              {t('members.trajectory')}
            </button>
            <button type="button" className={css.action} onClick={onEdit}>
              {t('members.edit')}
            </button>
            <button type="button" className={css.action} onClick={onRemove}>
              {t('members.remove')}
            </button>
          </span>
        )}
      </div>
    </div>
  )
}

/** The members tab. */
export function MembersView({
  sessionId, roomStore, roomCwd, openSession, removeMember, updateMember, invite, listProviders, t,
}: MembersViewProps): ReactNode {
  // Entering the tab pulls the freshest state once.
  useEffect(() => { void roomStore.refresh(sessionId) }, [roomStore, sessionId])
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const [dialog, setDialog] = useState<DialogState>(null)
  const [providers, setProviders] = useState<RoomProviderList | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const anyRunning = state?.runs.some(run => run.state === 'running') ?? false
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!anyRunning) return undefined
    const timer = setInterval(() => { setTick(value => value + 1) }, 1000)
    return () => { clearInterval(timer) }
  }, [anyRunning])

  if (roomStore.isRoomCached(sessionId) === false) {
    return <div className={css.empty}>{t('members.notRoom')}</div>
  }
  if (state === undefined) return null

  const flash = (message: string): void => {
    setNotice(message)
    setTimeout(() => { setNotice(null) }, 3000)
  }

  const openInvite = (): void => {
    setProviders(undefined)
    setDialog({ mode: 'invite' })
    void listProviders().then(setProviders)
  }

  const submitDialog = async (values: InviteDialogSubmit) => {
    if (dialog === null) return { ok: false as const, message: '' }
    if (dialog.mode === 'edit') {
      return updateMember(dialog.member.name, values.instructions)
    }
    const outcome = await invite({
      provider: values.provider,
      name: values.name,
      instructions: values.instructions,
      ...values.cwd === '' ? {} : { cwd: values.cwd },
      ...values.firstTask === '' ? {} : { firstTask: values.firstTask },
    })
    if (outcome.ok) {
      flash(outcome.pendingFirstTask
        ? t('invite.success.task', { member: values.name })
        : t('invite.success.idle', { member: values.name }))
    }
    return outcome
  }

  const remove = async (member: RoomMember): Promise<void> => {
    if (!window.confirm(t('members.removeConfirm', { member: member.name }))) return
    const outcome = await removeMember(member.name)
    if (!outcome.ok) setError(outcome.message)
  }

  return (
    <div className={css.members}>
      <div className={css.grid}>
        {state.members.map((member) => {
          const run = state.runs.find(entry => entry.member === member.name)
          const running = run?.state === 'running'
          return (
            <MemberCard
              key={member.name}
              member={member}
              run={run}
              elapsedMs={running ? Date.now() - (run?.startedAt ?? Date.now()) : undefined}
              openSession={openSession}
              onEdit={() => { setDialog({ mode: 'edit', member }) }}
              onRemove={() => { void remove(member) }}
              t={t}
            />
          )
        })}
        <button type="button" className={css.invite} onClick={openInvite}>
          {t('members.invite')}
        </button>
      </div>
      {notice !== null && <div className={css.notice} role="status">{notice}</div>}
      {error !== null && <div className={css.error} role="alert">{error}</div>}
      {dialog !== null && (
        <InviteDialog
          mode={dialog.mode}
          member={dialog.mode === 'edit' ? dialog.member : undefined}
          providers={providers?.providers}
          localAgentAvailable={providers?.localAgentAvailable ?? true}
          inheritedCwd={roomCwd}
          onSubmit={submitDialog}
          onClose={() => { setDialog(null) }}
          t={t}
        />
      )}
    </div>
  )
}
