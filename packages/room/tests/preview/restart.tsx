/**
 * Manual UI fixture for 重启后继续 (member-self-started-rounds M9; compare
 * with proposals/prototypes/member-activity.html states 4–7) — the real
 * components over a scripted room state:
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * then open /restart.html?state=<autocont|manual|again|setting>[&lang=en][&dark=1]
 * (autocont = the room continued two members itself: timeline row, composer
 * banner, members page line; manual = the setting off, waiting for the
 * human; again = an auto-continued round interrupted again; setting = the
 * members tab's settings with the switch.)
 */
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { RoomRunView } from '../../src/client/RoomRunView.tsx'
import { RoomSpeechView } from '../../src/client/RoomSpeechView.tsx'
import { RoomAutoContinueView, RoomRestartBanner } from '../../src/client/RoomRestart.tsx'
import { MembersView } from '../../src/client/MembersView.tsx'
import { RESTART_CONTINUE_TEXT } from '../../src/restart-continue.ts'
import { DEFAULT_ROOM_SETTINGS } from '../../src/journal.ts'
import { en, zh } from '../../src/client/locales.ts'
import type { RoomDelivery, RoomMember, RoomState } from '../../src/types.ts'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'autocont'
const english = params.get('lang') === 'en'
const dictionary: Record<string, string> = english ? en : zh
const t = ((key: string, vars?: Record<string, unknown>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
if (params.get('dark') === '1') document.documentElement.dataset['theme'] = 'dark'

const LOST = 'Execution outcome is unknown after restart; reconcile before retrying'
const now = Date.now()
const lead: RoomMember = { id: 'm-lead', name: '人物协调', kind: 'main-agent', role: '协调者', invitedBy: 'human' }
const canvas: RoomMember = { id: 'm-canvas', name: 'kimi-canvas', kind: 'cli', provider: 'kimi-cli', role: '画布插件维护', invitedBy: 'human', childSessionId: 'child-canvas' as never, instructions: '维护画布插件。' }
const modeler: RoomMember = { id: 'm-model', name: '人物建模大师', kind: 'cli', provider: 'kimi-cli', role: '人物建模', invitedBy: 'human', childSessionId: 'child-model' as never, instructions: '负责人物建模。' }
const CANVAS_WORK = english ? 'Wiring chapter rendering into the canvas cards: store.ts is done, running the tests…' : '正在把章节渲染接到画布卡片上，已改完 store.ts，正在跑测试……'
const delivery = (id: string, memberId: string, extra: Partial<RoomDelivery>): RoomDelivery =>
  ({ id, dispatchSeq: Number(id.split(':')[0]), memberId, status: 'uncertain', origin: 'coordinator', from: 'm-lead', text: '把章节渲染接到画布卡片上', queuedAt: now - 20 * 60_000, task: 'j1', ...extra })

const scenes: Record<string, RoomState> = {
  // ④ The room continued both itself; kimi-canvas is on it, 人物建模大师 queued behind.
  autocont: {
    members: [lead, canvas, modeler], relays: [], tasks: [], settings: DEFAULT_ROOM_SETTINGS,
    runs: [{ member: 'kimi-canvas', runId: '9:m-canvas', state: 'running', startedAt: now - 12_000 }, { member: '人物建模大师', runId: '9:m-model', state: 'running', startedAt: now - 9_000 }],
    deliveries: [
      delivery('4:m-canvas', 'm-canvas', { status: 'cancelled' }), delivery('5:m-model', 'm-model', { status: 'cancelled' }),
      delivery('9:m-canvas', 'm-canvas', { status: 'running', origin: 'human', via: 'auto-continue', text: RESTART_CONTINUE_TEXT }),
      delivery('9:m-model', 'm-model', { status: 'running', origin: 'human', via: 'auto-continue', text: RESTART_CONTINUE_TEXT }),
    ],
    continued: ['4:m-canvas', '5:m-model'],
    executions: [{ id: '4:m-canvas', runId: '4:m-canvas', memberId: 'm-canvas', member: 'kimi-canvas', childSessionId: 'child' as never, executionId: 'exec-4:m-canvas', state: 'cancelled', startedAt: now - 20 * 60_000 }],
  },
  // ⑤ Setting off: both wait for the human.
  manual: {
    members: [lead, canvas, modeler], relays: [], tasks: [], settings: { ...DEFAULT_ROOM_SETTINGS, autoContinueAfterRestart: false },
    runs: [{ member: 'kimi-canvas', runId: '4:m-canvas', state: 'uncertain', startedAt: now - 20 * 60_000, error: LOST }, { member: '人物建模大师', runId: '5:m-model', state: 'uncertain', startedAt: now - 19 * 60_000, error: LOST }],
    deliveries: [delivery('4:m-canvas', 'm-canvas', {}), delivery('5:m-model', 'm-model', {})],
    executions: [{ id: '4:m-canvas', runId: '4:m-canvas', memberId: 'm-canvas', member: 'kimi-canvas', childSessionId: 'child' as never, executionId: 'exec-4:m-canvas', state: 'uncertain', startedAt: now - 20 * 60_000, error: LOST }],
  },
  // ⑥ The auto-continued round of kimi-canvas was cut off again; 人物建模大师 finished.
  again: {
    members: [lead, canvas, modeler], relays: [], tasks: [], settings: DEFAULT_ROOM_SETTINGS,
    runs: [{ member: 'kimi-canvas', runId: '9:m-canvas', state: 'uncertain', startedAt: now - 5 * 60_000, error: LOST }, { member: '人物建模大师', runId: '9:m-model', state: 'done', startedAt: now - 6 * 60_000 }],
    deliveries: [
      delivery('9:m-canvas', 'm-canvas', { origin: 'human', via: 'auto-continue', text: RESTART_CONTINUE_TEXT }),
      delivery('9:m-model', 'm-model', { status: 'done', origin: 'human', via: 'auto-continue', text: RESTART_CONTINUE_TEXT }),
    ],
    continued: ['4:m-canvas', '5:m-model'],
    executions: [{ id: '9:m-canvas', runId: '9:m-canvas', memberId: 'm-canvas', member: 'kimi-canvas', childSessionId: 'child' as never, executionId: 'exec-9:m-canvas', state: 'uncertain', startedAt: now - 5 * 60_000, error: LOST }],
  },
}
scenes['setting'] = scenes['autocont']!
const room = scenes[state] ?? scenes['autocont']!
const roomStore = { subscribe: () => () => {}, getCached: () => room, refresh: async () => {}, isRoomCached: () => true }
const setSettings = async () => ({ ok: true as const })
const node = (kind: string, seq: number, data: Record<string, unknown>) => ({ key: `${kind}-${seq}`, kind, id: String(seq), target: 'chat', anchorSeq: seq, location: { kind: 'unresolved' }, visibility: 'visible', data: { seq, time: now, ...data } })

function Cap({ children }: { readonly children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', margin: '18px 0 6px' }}>{children}</div>
}

function Timeline() {
  const common = { sessionId: 'room-1', roomStore, openSession: () => {}, cancelMember: async () => {}, renderMemberOutput: () => null, renderSlot: () => null, t }
  const auto = <RoomAutoContinueView {...{ node: node('room-auto-continue', 9, { targets: ['kimi-canvas', '人物建模大师'], text: RESTART_CONTINUE_TEXT }), sessionId: 'room-1', roomStore, setSettings, t } as never} />
  return (
    <>
      <Cap>{english ? 'Room timeline' : '房间时间线'}</Cap>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {state !== 'again' && <RoomRunView {...{ ...common, node: node('room-run', 5, { member: 'kimi-canvas', startedAt: now - 20 * 60_000, runId: '4:m-canvas', state: 'failed', error: LOST }) } as never} />}
        {state !== 'again' && <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }}>{CANVAS_WORK}</p>}
        {state !== 'manual' && auto}
        {state === 'again' && <RoomSpeechView {...{ ...common, node: node('room-speech', 11, { member: '人物建模大师', text: english ? 'Checked: Ayuan\'s model is already exported and 71/71 tests pass, nothing redone. Published v35.' : '核对过了：阿沅的模型已经导出，测试 71/71 通过，没有重做。已发布 v35。' }) } as never} />}
        {state === 'again' && <RoomRunView {...{ ...common, node: node('room-run', 12, { member: 'kimi-canvas', startedAt: now - 5 * 60_000, runId: '9:m-canvas', state: 'failed', error: LOST }) } as never} />}
        {state === 'autocont' && <RoomRunView {...{ ...common, node: node('room-run', 10, { member: 'kimi-canvas', startedAt: now - 12_000, runId: '9:m-canvas', state: 'running' }) } as never} />}
      </div>
    </>
  )
}

function Composer() {
  return (
    <>
      <Cap>{english ? 'Room composer' : '房间输入框'}</Cap>
      <RoomRestartBanner sessionId={`preview-${state}`} state={room} busy={false} onContinueAll={() => {}} setSettings={setSettings} t={t} />
      <div style={{ marginTop: 8, padding: 16, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 22, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-tertiary)' }}>
        {english ? 'Message the members, @ one of them…' : '给成员发消息，@ 指定成员…'}
      </div>
    </>
  )
}

function Members() {
  const noop = async () => undefined as never
  useEffect(() => {
    if (state !== 'setting') return
    // Open the settings disclosure and bring the switch into view.
    const header = [...document.querySelectorAll('button')].find(button => button.textContent?.includes(english ? 'Collaboration' : '协作设置'))
    header?.click()
    requestAnimationFrame(() => document.querySelector('[data-setting="auto-continue"]')?.scrollIntoView({ block: 'center' }))
  }, [])
  return (
    <MembersView
      {...{
        sessionId: 'room-1', roomStore, openSession: () => {}, removeMember: noop, restoreMember: noop, setSettings,
        updateMember: noop, invite: noop, listProviders: noop, browseDirectory: async () => null, t,
      } as never}
    />
  )
}

function Page() {
  if (state === 'setting') return <div style={{ maxWidth: 720, margin: '0 auto' }}><Members /></div>
  return (
    <main style={{ maxWidth: 780, margin: '8px auto 24px', padding: '0 16px' }}>
      <Timeline />
      <Composer />
      {state !== 'again' && <><Cap>{english ? 'Members page' : '成员页'}</Cap><Members /></>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Page />)
