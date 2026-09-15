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
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RoomMember } from '../types.ts'
import { MemberCard } from './MemberCard.tsx'
import { InviteDialog, type InviteDialogSubmit } from './InviteDialog.tsx'
import type { MembersViewProps, RoomModelDirectory } from './slots.ts'
import type { RoomProviderList } from '../types.ts'
import css from './MembersView.module.css'

type DialogState = { readonly mode: 'invite' } | { readonly mode: 'edit'; readonly member: RoomMember } | null

/**
 * The main-agent card's model hint: the session's current selection from the
 * official per-session directory (the same instance the composer's model seat
 * reads), null before the first load resolves.
 */
function MainAgentModelHint({ directory }: { readonly directory: RoomModelDirectory }): ReactNode {
  const state = useSyncExternalStore(
    fn => directory.store.subscribe(fn),
    () => directory.store.getSnapshot(),
  )
  if (state.current === null) return null
  const choice = state.groups
    .flatMap(group => group.models.map(model => ({ group, model })))
    .find(entry => entry.group.id === state.current?.provider && entry.model.id === state.current.model)
  return <>{choice?.model.name ?? `${state.current.provider}/${state.current.model}`}</>
}

/** The members tab. */
export function MembersView({
  sessionId, roomStore, roomCwd, openSession, removeMember, updateMember, invite, listProviders, browseDirectory,
  modelSurface, renderHarnessModelPicker, memberModel, setMemberModel, renderMemberConfiguration, modelDirectory, t,
}: MembersViewProps): ReactNode {
  // Entering the tab pulls the freshest state once.
  useEffect(() => { void roomStore.refresh(sessionId) }, [roomStore, sessionId])
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const [dialog, setDialog] = useState<DialogState>(null)
  const [providers, setProviders] = useState<RoomProviderList | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The CLI members' effective models, keyed by member name (the cards' hints). */
  const [memberModels, setMemberModels] = useState<ReadonlyMap<string, string>>(new Map())
  const anyRunning = state?.runs.some(run => run.state === 'running') ?? false
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!anyRunning) return undefined
    const timer = setInterval(() => { setTick(value => value + 1) }, 1000)
    return () => { clearInterval(timer) }
  }, [anyRunning])

  // The cards' model hints: one memberModel read per dispatched CLI member,
  // refetched with the store (a switch through the member composer or the
  // edit dialog lands on the next refresh). Null/absent answers render no
  // hint — the pre-broker behavior exactly.
  useEffect(() => {
    if (memberModel === undefined) return
    const fetchable = (state?.members ?? [])
      .filter(member => member.kind === 'cli' && member.childSessionId !== undefined)
    let cancelled = false
    void Promise.all(fetchable.map(async member =>
      [member.name, await memberModel(member.childSessionId as string)] as const,
    )).then((results) => {
      if (cancelled) return
      const next = new Map<string, string>()
      for (const [name, info] of results) {
        if (info === null || info === undefined) continue
        next.set(name, info.effective ?? t('members.model.default'))
      }
      setMemberModels(next)
    })
    return () => { cancelled = true }
  }, [memberModel, state?.members, t])

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
      // Diff against the member record: only changed fields ride the patch;
      // an emptied cwd/instructions CLEARS (null) back to the inherit/no-
      // preset state.
      const member = dialog.member
      const name = values.name.trim()
      const cwd = values.cwd.trim()
      const instructions = values.instructions.trim()
      const model = values.model.trim()
      const modelChanged = model !== values.modelBaseline.trim() && !(member.childSessionId !== undefined && renderMemberConfiguration !== undefined)
      if (modelChanged && member.childSessionId !== undefined) {
        if (setMemberModel === undefined) return { ok: false as const, message: t('invite.error.generic') }
        // Compatibility entry also uses the core queue. No journaled model
        // mutation for a started member: its durable owner is local-agent.
        const result = await setMemberModel(member.childSessionId, model === '' ? undefined : model)
        if (result === undefined) return { ok: false as const, message: t('invite.error.generic') }
        if (!result.ok) return { ok: false as const, message: result.error }
      }
      const patch = {
        ...name !== member.name ? { rename: name } : {},
        ...cwd !== (member.cwd ?? '') ? { cwd: cwd === '' ? null : cwd } : {},
        ...instructions !== (member.instructions ?? '')
          ? { instructions: instructions === '' ? null : instructions }
          : {},
        // The journaled intent: the first dispatch binds it for a never-
        // started member (the broker call above is a no-op there — no
        // delegation record — so this value alone carries the edit).
        ...modelChanged && member.childSessionId === undefined ? { model: model === '' ? null : model } : {},
      }
      return Object.keys(patch).length === 0 ? { ok: true as const } : updateMember(member.name, patch)
    }
    const outcome = await invite({
      provider: values.provider,
      name: values.name,
      // Blank instructions are omitted, not sent: the host rejects a
      // present-but-blank role, and an absent one simply carries no preset.
      ...values.instructions === '' ? {} : { instructions: values.instructions },
      ...values.cwd === '' ? {} : { cwd: values.cwd },
      ...values.firstTask === '' ? {} : { firstTask: values.firstTask },
      ...values.model === '' ? {} : { model: values.model },
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

  const dialogNode = dialog !== null && (
    <InviteDialog
      mode={dialog.mode}
      member={dialog.mode === 'edit' ? dialog.member : undefined}
      providers={providers?.providers}
      localAgentAvailable={providers?.localAgentAvailable ?? true}
      inheritedCwd={roomCwd}
      existingNames={(state?.members ?? []).map(entry => entry.name)}
      browseDirectory={browseDirectory}
      modelSurface={modelSurface}
      renderHarnessModelPicker={renderHarnessModelPicker}
      memberModel={memberModel}
      memberConfiguration={dialog.mode === 'edit' && dialog.member.childSessionId !== undefined ? renderMemberConfiguration?.(dialog.member.childSessionId) : undefined}
      onSubmit={submitDialog}
      onClose={() => { setDialog(null) }}
      t={t}
    />
  )

  // A plain session gets the centered guide state (the official empty-state
  // shape: glyph → title → one-line explainer → primary action) instead of
  // the bare "not a room": inviting an agent IS the promotion (the header
  // action is its twin entry).
  if (roomStore.isRoomCached(sessionId) === false) {
    return (
      <div className={css.guide}>
        <span className={css.guideIcon} aria-hidden>
          <IconAgentPresetOutline16 size={30} />
        </span>
        <p className={css.guideTitle}>{t('members.notRoomTitle')}</p>
        <p className={css.guideHint}>{t('members.notRoom')}</p>
        <Button variant="primary" onClick={openInvite}>
          {t('members.notRoomAction')}
        </Button>
        {dialogNode}
      </div>
    )
  }
  if (state === undefined) return null

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
              modelHint={member.kind === 'main-agent'
                ? (modelDirectory !== undefined ? <MainAgentModelHint directory={modelDirectory} /> : undefined)
                : memberModels.get(member.name)}
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
      {dialogNode}
    </div>
  )
}
