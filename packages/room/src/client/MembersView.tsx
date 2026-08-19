/**
 * Members view: the room session's 成员 conversation-view tab. Owns
 * everything member-related — roster rows (color dot, name, provider/kind,
 * status + elapsed, per-row [轨迹→] [中断] [编辑] [移除]) and the invite
 * entry. Data rides the room store (refreshed on entering the tab and after
 * every own mutation; the store's running-only poll keeps the elapsed
 * honest). The main-agent member takes no instructions and cannot be
 * removed — it is the room itself.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { RoomMember } from '../types.ts'
import { formatDurationMs } from './format.ts'
import { memberColor } from './member-color.ts'
import { InviteDialog, type InviteDialogSubmit } from './InviteDialog.tsx'
import type { MembersViewProps } from './slots.ts'
import type { RoomProviderList } from '../types.ts'
import css from './MembersView.module.css'

type DialogState = { readonly mode: 'invite' } | { readonly mode: 'edit'; readonly member: RoomMember } | null

/** The members tab. */
export function MembersView({
  sessionId, roomStore, roomCwd, openSession, cancelMember, removeMember, updateMember, invite, listProviders, t,
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
      {state.members.map((member) => {
        const run = state.runs.find(entry => entry.member === member.name)
        const running = run?.state === 'running'
        const failed = run?.state === 'failed'
        const child = member.childSessionId
        return (
          <div className={css.row} key={member.name}>
            <span className={css.dot} style={{ background: memberColor(member.name) }} aria-hidden />
            <span className={css.name}>{member.name}</span>
            <span className={css.hint}>
              {member.kind === 'main-agent' ? t('member.kind.main') : member.provider ?? ''}
            </span>
            {member.instructions !== undefined && (
              <span className={css.instructions} title={member.instructions}>
                {member.instructions}
              </span>
            )}
            <span className={failed ? css.statusFailed : css.status}>
              {running
                ? `${t('members.status.running')} · ${formatDurationMs(Date.now() - (run?.startedAt ?? Date.now()))}`
                : failed ? t('members.status.failed') : t('members.status.idle')}
            </span>
            <span className={css.actions}>
              {child !== undefined && (
                <button
                  type="button"
                  className={css.action}
                  onClick={() => { openSession(child) }}
                >
                  {t('members.trajectory')}
                </button>
              )}
              {running && (
                <button
                  type="button"
                  className={css.action}
                  onClick={() => { void cancelMember(member.name) }}
                >
                  {t('members.interrupt')}
                </button>
              )}
              {member.kind === 'cli' && (
                <button
                  type="button"
                  className={css.action}
                  onClick={() => { setDialog({ mode: 'edit', member }) }}
                >
                  {t('members.edit')}
                </button>
              )}
              {member.kind === 'cli' && (
                <button
                  type="button"
                  className={css.action}
                  onClick={() => { void remove(member) }}
                >
                  {t('members.remove')}
                </button>
              )}
            </span>
          </div>
        )
      })}
      {notice !== null && <div className={css.notice} role="status">{notice}</div>}
      {error !== null && <div className={css.error} role="alert">{error}</div>}
      <button type="button" className={css.invite} onClick={openInvite}>
        {t('members.invite')}
      </button>
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
