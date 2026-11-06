/**
 * Manual UI fixture for members' background activity (member-self-started-rounds
 * M2; compare with proposals/prototypes/member-activity.html) — the real
 * components over scripted local-agent reads:
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * then open /activity.html?state=<strip|tray|lost|cmdrun|cmdout|cmdlost|unsupported|members|confirmReload|confirmSave>[&lang=en][&dark=1]
 * (confirmReload / confirmSave = the edit dialog: 重新载入, or saving a new
 * model, while the member's process runs 2 background tasks.)
 * (strip/tray/lost = the composer capsule and its tray; cmd* = the member
 * session's card in the launching turn's tail; unsupported = a Codex member:
 * no card, no members line; members = the members page lines.)
 */
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { LocalAgentBackgroundTask, LocalAgentBackgroundTasks } from '@khorsheed/dsh-local-agent/types'
import { RoomTaskCapsule } from '../../src/client/RoomTaskCapsule.tsx'
import { MembersView } from '../../src/client/MembersView.tsx'
import { ActivityReveals, MemberActivityStore, useRoomActivity } from '../../src/client/MemberActivity.tsx'
import { MemberActivityTail } from '../../src/client/MemberActivityTail.tsx'
import { InviteDialog } from '../../src/client/InviteDialog.tsx'
import { en, zh } from '../../src/client/locales.ts'
import type { RoomMember, RoomState } from '../../src/types.ts'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'strip'
const english = params.get('lang') === 'en'
const dictionary: Record<string, string> = english ? en : zh
const t = ((key: string, vars?: Record<string, unknown>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
if (params.get('dark') === '1') document.documentElement.dataset['theme'] = 'dark'

const MIN = 60_000
const now = Date.now()
const BUILD = english ? 'Build and test canvas-novel' : '构建并测试 canvas-novel'
const CMD = 'pnpm --filter @khorsheed/dsh-canvas-novel run build && pnpm --filter @khorsheed/dsh-canvas-novel run test && pnpm check:panels'
const OUTPUT = ['✓ tests/store.spec.ts (112 tests) 4.1s', '✓ tests/relations.spec.ts (64 tests) 2.3s', '✓ tests/chapter-markdown.spec.ts (38 tests) 1.8s', '❯ tests/card-actions.spec.ts (0/27)', '❯ tests/panel.client.spec.tsx (0/41)']
const keep = new Date(now + 4 * 60 * MIN).getTime()

const lead: RoomMember = { id: 'm-lead', name: '人物协调', kind: 'main-agent', role: '协调者', invitedBy: 'human' }
const canvas: RoomMember = { id: 'm-canvas', name: 'kimi-canvas', kind: 'cli', provider: 'kimi-cli', role: '画布插件维护', invitedBy: 'human', childSessionId: 'child-canvas' as never, instructions: '维护画布插件：构建、测试、部署。' }
const editor: RoomMember = { id: 'm-edit', name: '剪辑师', kind: 'cli', provider: 'kimi-cli', role: '剪辑', invitedBy: 'human', childSessionId: 'child-edit' as never, instructions: '负责播客剪辑。' }
const modeler: RoomMember = { id: 'm-model', name: '人物建模大师', kind: 'cli', provider: 'kimi-cli', role: '人物建模', invitedBy: 'human', childSessionId: 'child-model' as never, instructions: '负责人物建模与导出。' }
const voice: RoomMember = { id: 'm-voice', name: '配音员', kind: 'cli', provider: 'codex', role: '配音', invitedBy: 'human', childSessionId: 'child-voice' as never, instructions: '负责配音试听。' }

const task = (id: string, patch: Partial<LocalAgentBackgroundTask>): LocalAgentBackgroundTask => ({
  id, label: BUILD, kind: 'shell', command: CMD, startedAt: now - 12 * MIN, state: 'running', callId: `call-${id}`, startedBy: 'exec-1', outputTail: OUTPUT, ...patch,
})
const live = (tasks: LocalAgentBackgroundTask[], extra: Partial<LocalAgentBackgroundTasks> = {}): LocalAgentBackgroundTasks => ({ supported: true, tasks, processAlive: true, ...extra })
const UNSUPPORTED: LocalAgentBackgroundTasks = { supported: false, tasks: [], processAlive: false }

const lostScene = state === 'lost' || state === 'cmdlost'
const READS: Record<string, LocalAgentBackgroundTasks | null> = lostScene ? {
  'child-canvas': live([
    task('bash-1', { state: 'lost', lostBecause: 'host-restart', endedAt: now - 3 * MIN }),
    task('agent-1', { kind: 'agent', label: english ? 'Write: finish the subtitles' : '编写：补全全片字幕', state: 'lost', lostBecause: 'host-restart', startedBy: 'exec-2', command: undefined, outputTail: undefined }),
  ], { processAlive: false }),
  'child-model': live([task('bash-9', { state: 'lost' })]),
  'child-edit': live([]),
  'child-voice': UNSUPPORTED,
} : {
  'child-canvas': live([
    task('bash-1', {}),
    task('agent-1', { kind: 'agent', label: english ? 'Write: finish the subtitles' : '编写：补全全片字幕', startedAt: now - 6 * MIN, startedBy: 'exec-2', command: undefined, outputTail: undefined }),
  ], { keepAliveUntil: keep }),
  // The members page shows one member with a lost task (the amber line); the tray an ended one.
  'child-model': live([state === 'members'
    ? task('bash-2', { state: 'lost', lostBecause: 'host-restart' })
    : task('bash-2', { label: english ? 'Export Ayuan glb and run the review' : '导出阿沅 glb 并跑审查', state: 'completed', exitCode: 0, startedAt: now - 20 * MIN, endedAt: now - 20 * MIN + 185_000, startedBy: 'exec-2', resultIn: 'exec-self' })]),
  'child-edit': live([]),
  'child-voice': UNSUPPORTED,
}

const room: RoomState = {
  members: [lead, canvas, editor, modeler, voice],
  relays: [],
  tasks: [],
  runs: [{ member: '剪辑师', state: 'running', startedAt: now - 192_000 } as never],
  deliveries: [
    { id: 'd1', dispatchSeq: 1, memberId: 'm-canvas', status: 'done', origin: 'coordinator', from: 'm-lead', text: 'build', queuedAt: now - 13 * MIN, task: 'j1' },
    { id: 'd2', dispatchSeq: 2, memberId: 'm-model', status: 'done', origin: 'human', text: 'export', queuedAt: now - 25 * MIN, task: 'j1' },
  ],
  executions: [
    { id: 'd1', runId: 'd1', member: 'kimi-canvas', state: 'done', startedAt: now - 13 * MIN, executionId: 'exec-1' },
    { id: 'd2', runId: 'd2', member: '人物建模大师', state: 'done', startedAt: now - 25 * MIN, executionId: 'exec-2' },
    { id: 'self-1', runId: 'self-1', member: '人物建模大师', state: 'done', startedAt: now - 20 * MIN + 190_000, executionId: 'exec-self' },
  ],
  jobs: [{ id: 'j1', number: 1, title: '画布章节渲染', messages: [], status: 'running', startedAt: now - 30 * MIN, deliveries: ['d1', 'd2'], members: ['m-canvas', 'm-model'] }],
} as never

const store = new MemberActivityStore(async id => READS[id] ?? null)
const memberActivity = { store, reveals: new ActivityReveals() }
const roomStore = { subscribe: () => () => {}, getCached: () => room, refresh: async () => {}, isRoomCached: () => true, memberRoom: (child: string) => { const member = room.members.find(entry => entry.childSessionId === child); return member === undefined ? undefined : { state: room, member } } }

function Composer() {
  const activity = useRoomActivity(memberActivity, room)
  useEffect(() => { if (state === 'tray' || state === 'lost') activity.setOpen(true) }, [activity.groups.length])
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div data-testid="dock" style={{ padding: '0 16px 16px' }}>
        <RoomTaskCapsule
          state={room}
          openTasks={() => {}}
          invite={async () => ({ ok: true }) as never}
          listProviders={async () => undefined}
          browseDirectory={async () => null}
          background={{ ...activity, jump: () => {} }}
          t={t}
        />
        <div data-testid="composer" style={{ maxWidth: 780, margin: '0 auto', padding: 16, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 22, background: 'var(--dsw-alias-bg-layer-1)' }}>
          <small style={{ color: 'var(--dsw-alias-label-tertiary)' }}>协调者 · 人物协调</small>
          <div style={{ minHeight: 48, marginTop: 8, color: 'var(--dsw-alias-label-tertiary)' }}>{english ? 'Message the members, @ one of them…' : '给成员发消息，@ 指定成员…'}</div>
        </div>
      </div>
    </div>
  )
}

/** A member session's launching turn: the user message, the reply, and the turn tail. */
function Session() {
  const child = state === 'unsupported' ? 'child-voice' : 'child-canvas'
  const [, setTick] = useState(0)
  useEffect(() => {
    if (state !== 'cmdout') return
    memberActivity.reveals.request('bash-1', true)
    setTick(value => value + 1)
  }, [])
  const owner = { turn: { data: { get: () => ({ calls: ['call-bash-1'] }) } } }
  return (
    <main style={{ maxWidth: 760, margin: '24px auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', borderBottom: '1px solid var(--dsw-alias-border-l1)', paddingBottom: 8 }}>
        房间 › <b style={{ color: 'var(--dsw-alias-label-primary)' }}>{state === 'unsupported' ? '配音员' : 'kimi-canvas'}</b> · {state === 'unsupported' ? 'codex' : 'kimi-cli'}
      </div>
      <div style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '7px 11px', borderRadius: '12px 12px 4px 12px', background: 'var(--dsw-alias-bg-layer-2)' }}>
        {english ? 'Build the chapter rendering change, run all the tests, and tell me the result.' : '把章节渲染的改动构建一遍、跑完测试，结果告诉我。'}
      </div>
      <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)' }}>
        {english ? 'The build and the full test run take about 8 minutes; I put them in the background and will report when they finish.' : '构建和全部测试要 8 分钟左右，我放到后台跑，完成后我会继续汇报。'}
      </p>
      <div>
        <MemberActivityTail
          {...owner}
          memberActivity={memberActivity}
          memberRoom={roomStore.memberRoom}
          subscribeRooms={() => () => {}}
          sessionId={child}
          t={t}
        />
      </div>
    </main>
  )
}

function Members() {
  const noop = async () => undefined as never
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <MembersView
        {...{
          sessionId: 'room-1', roomStore, openSession: () => {}, removeMember: noop, restoreMember: noop, setSettings: noop,
          updateMember: noop, invite: noop, listProviders: noop, browseDirectory: async () => null, memberActivity,
          memberModel: async (child: string) => (child === 'child-voice' ? { effective: 'gpt-5.5' } : { effective: 'kimi-code/k3' }), t,
        } as never}
      />
    </div>
  )
}

/** The edit dialog asking before it replaces a process with background work. */
function Confirm() {
  const save = state === 'confirmSave'
  useEffect(() => {
    const timer = setInterval(() => {
      if (save) {
        const input = document.querySelector<HTMLInputElement>(`input[aria-label="${dictionary['invite.model']}"]`)
        const button = [...document.querySelectorAll('button')].find(entry => entry.textContent === dictionary['invite.save'])
        if (input === null || button === undefined) return
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, 'kimi-code/k3.1-pro')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        setTimeout(() => { button.click() }, 50)
        clearInterval(timer)
        return
      }
      const button = [...document.querySelectorAll('button')].find(entry => entry.textContent === dictionary['tools.reload'])
      if (button !== undefined) { button.click(); clearInterval(timer) }
    }, 100)
    return () => { clearInterval(timer) }
  }, [])
  const tools = { preset: 'dsh-gamedev', expected: ['game_open', 'game_read', 'game_publish'], process: 'placeholder', received: [], loadedAt: now - 30 * MIN, reloadable: true }
  return (
    <InviteDialog
      mode="edit"
      member={{ ...canvas, preset: 'dsh-gamedev', model: 'kimi-code/k3' }}
      presets={[{ id: 'dsh-gamedev', name: english ? 'Game dev mode' : '游戏开发模式', isDefault: false }]}
      localAgentAvailable
      existingNames={[canvas.name]}
      browseDirectory={async () => null}
      memberTools={async () => tools as never}
      reloadMemberTools={async (_child, options) => (options?.confirmBackgroundTasks === true ? { ok: true, when: 'now' } : { ok: false, reason: 'background-tasks', running: 2 })}
      runningBackgroundTasks={async () => 2}
      onSubmit={async () => ({ ok: true })}
      onClose={() => {}}
      t={t}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  state.startsWith('confirm') ? <Confirm /> : state === 'members' ? <Members /> : state.startsWith('cmd') || state === 'unsupported' ? <Session /> : <Composer />,
)
