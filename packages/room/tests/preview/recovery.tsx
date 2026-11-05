/**
 * Manual UI fixture for a room after a host restart with one interrupted
 * delivery (batch 5 S7: the real RoomRunView, RoomDispatchView and the member
 * edit dialog, fed the projection getState returns once the core's ledger
 * says the round is uncertain):
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * then open /recovery.html?state=<timeline|dialog>[&lang=en][&dark=1]
 * (`timeline` = the room's conversation: the interrupted round reads 待对账,
 * a later message to the same member waits for it; `dialog` = that member's
 * edit dialog with the same round under 待对账.)
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { InviteDialog } from '../../src/client/InviteDialog.tsx'
import { RoomRunView } from '../../src/client/RoomRunView.tsx'
import { RoomDispatchView } from '../../src/client/RoomDispatchView.tsx'
import type { MemberRecoveryRead } from '../../src/client/member-recovery-view.ts'
import { en, zh } from '../../src/client/locales.ts'
import type { RoomMember, RoomState } from '../../src/types.ts'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'timeline'
const english = params.get('lang') === 'en'
const dictionary: Record<string, string> = english ? en : zh
const t = ((key: string, vars?: Record<string, unknown>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
if (params.get('dark') === '1') document.documentElement.dataset['theme'] = 'dark'

const RESTART = 'Execution outcome is unknown after restart; reconcile before retrying'
const started = new Date(2026, 10, 5, 9, 12).getTime()
const member: RoomMember = {
  id: 'm1', name: '人物建模大师', kind: 'cli', provider: 'kimi-cli', role: '人物建模', preset: 'dsh-gamedev', invitedBy: 'human', childSessionId: 'child-gm' as never,
  instructions: '你是一个游戏开发会话里的协作成员，名字叫「人物建模大师」……',
}
const coordinator: RoomMember = { id: 'd', name: 'dsh', kind: 'main-agent', invitedBy: 'human' }
const room: RoomState = {
  members: [coordinator, member],
  relays: [], tasks: [],
  runs: [{ member: member.name, runId: '4:m1', state: 'uncertain', startedAt: started, error: RESTART }],
  executions: [
    // The delivery the restart cut off: the core's ledger says uncertain.
    { id: '4:m1', runId: '4:m1', memberId: 'm1', member: member.name, childSessionId: 'child-gm' as never, executionId: 'exec-1', state: 'uncertain', startedAt: started, error: RESTART },
  ],
  deliveries: [
    { id: '4:m1', dispatchSeq: 4, memberId: 'm1', origin: 'human', status: 'uncertain', text: '把阿沅的脸再修一下，修完直接发布', queuedAt: started - 2_000, startedAt: started, error: RESTART },
    // The coordinator's follow-up to the same member waits for 待对账 (not failed).
    { id: '6:m1', dispatchSeq: 6, memberId: 'm1', origin: 'coordinator', from: 'd', kind: 'task', status: 'queued', waiting: 'reconcile', text: '发布后顺便把试玩区的截图更新一下', queuedAt: started + 60_000 },
  ],
}
const roomStore = { subscribe: () => () => {}, getCached: () => room, refresh: async () => {}, isRoomCached: () => true }

function bubble(who: string, text: string) {
  return (
    <div style={{ background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 14, padding: '12px 16px' }}>
      <b>{who}</b><p style={{ margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary)' }}>{text}</p>
    </div>
  )
}

function Timeline() {
  const common = { sessionId: 'room-1', roomStore, openSession: () => {}, cancelMember: async () => {}, renderMemberOutput: () => null, renderSlot: () => null, t }
  return (
    <main style={{ maxWidth: 780, margin: '24px auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {bubble(english ? 'You' : '你', `@${member.name} 把阿沅的脸再修一下，修完直接发布。`)}
      {/* The interrupted round's card: running edge, closed by recovery; the projection reads the core. */}
      <RoomRunView {...{ ...common, node: { key: 'r', kind: 'room-run', id: '5', target: 'chat', anchorSeq: 5, location: { kind: 'unresolved' }, visibility: 'visible',
        data: { seq: 5, time: started, member: member.name, startedAt: started, runId: '4:m1', state: 'failed', error: RESTART } } } as never} />
      <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', textAlign: 'center' }}>{english ? '— host restarted —' : '— 实例重启 —'}</p>
      <RoomDispatchView {...{ node: { data: { seq: 6, time: started + 60_000, kind: 'task', from: 'd', targets: [member.name], text: '发布后顺便把试玩区的截图更新一下' } }, sessionId: 'room-1', roomStore, t } as never} />
    </main>
  )
}

/** The edit dialog's reads: the member's ledger holds the same round, uncertain. */
const recovery: MemberRecoveryRead = {
  configuration: { memberId: 'child-gm', revision: 4, status: 'idle', current: { revision: 3, selection: { model: { mode: 'inherit' }, effort: { mode: 'inherit' } }, resolved: { model: 'kimi-code/k3' } } } as never,
  inbox: { memberId: 'child-gm', paused: false, messages: [{ id: 'exec-1', caller: 'room', key: '4:m1', status: 'uncertain', createdAt: started - 2_000, updatedAt: started }] },
}

function Dialog() {
  return (
    <InviteDialog
      mode="edit"
      member={member}
      presets={[{ id: 'dsh-gamedev', name: english ? 'Game dev mode' : '游戏开发模式', isDefault: false }]}
      localAgentAvailable
      existingNames={[member.name]}
      browseDirectory={async () => null}
      // After a restart: no process yet, the member's session not loaded (as in member-tools.html?state=recoveryUncertain).
      memberTools={async () => ({ preset: 'dsh-gamedev', expected: [], expectedUnknown: true, process: 'none', received: [], reloadable: true }) as never}
      reloadMemberTools={async () => ({ ok: true, when: 'now' }) as never}
      memberRecovery={async () => recovery}
      retryMemberStart={async () => ({ ok: true as const })}
      reconcileMemberExecution={async () => ({ ok: true as const })}
      onSubmit={async () => ({ ok: true })}
      onClose={() => {}}
      t={t}
    />
  )
}

createRoot(document.getElementById('root')!).render(state === 'dialog' ? <Dialog /> : <Timeline />)
