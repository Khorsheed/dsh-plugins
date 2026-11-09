/**
 * Manual UI fixture for restart recovery (restart-recovery consolidation;
 * compare with proposals/prototypes/restart-recovery.html, the 「改后」
 * frames) — the real components over a scripted room state:
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * then open /restart.html?state=<t1|t2|c1|g1|m1|setting>[&lang=en][&dark=1]
 * (t1 = rounds cut off, closed on their own cards, the room's auto-continue
 * node and the continuing cards; t2 = what the dispatcher gets: the continued
 * round's normal reply, reported; c1 = the setting off: closed cards, a
 * queued message, the one composer line 停止 · 全部继续; g1 = the goal panel's
 * attempt history; m1 = the members page queue after its own continuation;
 * setting = the members tab's settings with the switch.) All names and texts
 * are invented.
 */
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { RoomRunView } from '../../src/client/RoomRunView.tsx'
import { RoomSpeechView } from '../../src/client/RoomSpeechView.tsx'
import { RoomReceiptView } from '../../src/client/RoomReceiptView.tsx'
import { RoomAutoContinueView, RoomRestartBanner } from '../../src/client/RoomRestart.tsx'
import { RoomPlanView } from '../../src/client/RoomPlanView.tsx'
import { MembersView } from '../../src/client/MembersView.tsx'
import { MemberInboxView } from '../../../local-agent/src/client/MemberInboxView.tsx'
import { zh as agentZh, en as agentEn } from '../../../local-agent/src/client/locales.ts'
import { RESTART_CONTINUE_TEXT } from '../../src/restart-continue.ts'
import { DEFAULT_ROOM_SETTINGS } from '../../src/journal.ts'
import { admitPlanAttempt, changePlan, queuePlanAttempt, recoverPlan, settlePlanAttempt } from '../../src/plan.ts'
import { en, zh } from '../../src/client/locales.ts'
import type { RoomDelivery, RoomMember, RoomState } from '../../src/types.ts'

const params = new URLSearchParams(location.search)
const scene = params.get('state') ?? 't1'
const english = params.get('lang') === 'en'
const translate = (dictionary: Record<string, string>) => ((key: string, vars?: Record<string, unknown>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
const t = translate(english ? en : zh)
const ta = translate(english ? agentEn : agentZh)
if (params.get('dark') === '1') document.documentElement.dataset['theme'] = 'dark'

const now = Date.now()
const lead: RoomMember = { id: 'm-co', name: '总编排', kind: 'cli', provider: 'claude-code', role: '协调', invitedBy: 'human', childSessionId: 'child-co' as never }
const mapper: RoomMember = { id: 'm-map', name: '地图匠', kind: 'cli', provider: 'kimi-cli', role: '关卡', invitedBy: 'human', childSessionId: 'child-map' as never }
const writer: RoomMember = { id: 'm-np', name: '剧情师', kind: 'cli', provider: 'codex', role: '剧情', invitedBy: 'human', childSessionId: 'child-np' as never }
const MSG = english ? 'Start on the split: 地图匠 builds the north ridge level, 剧情师 writes its three dialogues, both hand over to 总编排.' : '按刚才的分工开工吧：地图匠做北岭关卡，剧情师写北岭的三段对话，做完都交给总编排整合。'
const PARTIAL = english ? 'Reading the north ridge design first, then generating terrain from the grid data… the terrain is half written, adding spawn points and' : '我先读北岭的设计稿，再按格子数据生成地形。地形已经写了一半，正在补出生点和'
const CONT = english ? 'Checking what was done before the restart: levels/north-ridge.json has terrain and two spawn points, the third is missing; level tests not run; nothing committed. Adding the third spawn point, then running the level tests' : '先核对重启前做到哪：levels/north-ridge.json 已有地形和两处出生点，第三处还没写；关卡测试还没跑过；没有提交。接着补第三处出生点，然后跑关卡测试'
const DONE = english ? 'The north ridge level is done: terrain, three spawn points and two shortcuts in levels/north-ridge.json; 12 level tests pass; not committed, ready for integration.' : '北岭关卡做完了：地形、三处出生点、两条捷径都在 levels/north-ridge.json；关卡测试 12 项通过；未提交，等你整合。'
const delivery = (id: string, memberId: string, extra: Partial<RoomDelivery>): RoomDelivery =>
  ({ id, dispatchSeq: Number(id.split(':')[0]), memberId, status: 'cancelled', endedBy: 'restart', interruptedAt: now - 60_000, origin: 'human', text: MSG, queuedAt: now - 20 * 60_000, startedAt: now - 19 * 60_000, task: 'j1', bubble: 'before', ...extra })

const goal = (() => {
  const context = { actor: { kind: 'coordinator' as const, memberId: 'm-co' }, memberIds: new Set(['m-co', 'm-map', 'm-np']), now: now - 40 * 60_000 }
  let plan = changePlan(undefined, { action: 'create', requestId: 'c', expectedRevision: 0, id: 'north', objective: english ? 'North ridge level' : '北岭关卡', mode: 'execute', budget: { maxParallel: 3, maxAttempts: 12, maxAttemptsPerTask: 3, maxActiveMs: 7_200_000 } }, context)
  const task = (id: string, title: string, owner: string) => ({ id, title, stageId: 's', kind: 'task' as const, ownerMemberId: owner, instruction: title, criteria: [english ? 'Reviewable output' : '可核对的产物'], inputRefs: [], artifactPaths: [], dependsOn: [] })
  plan = changePlan(plan, { action: 'extend', requestId: 'e', expectedRevision: plan.revision, stages: [{ id: 's', title: english ? 'North ridge' : '北岭' }],
    tasks: [task('integrate', english ? 'Integrate the north ridge' : '整合北岭', 'm-co'), task('level', english ? 'North ridge level data' : '北岭关卡数据', 'm-map'), task('dialogue', english ? 'North ridge dialogue' : '北岭对话', 'm-np')] }, context)
  for (const [id, attempt] of [['integrate', 'a1'], ['level', 'b1'], ['dialogue', 'c1']] as const) plan = admitPlanAttempt(queuePlanAttempt(plan, id, attempt, `d-${attempt}`, now - 30 * 60_000), id, attempt, now - 30 * 60_000)
  plan = settlePlanAttempt(plan, 'dialogue', 'c1', { state: 'done', evidence: { summary: 'ok', references: ['dialogue/north-ridge.json'], artifacts: [] } }, now - 25 * 60_000)
  plan = changePlan(plan, { action: 'review', requestId: 'r', expectedRevision: plan.revision, taskId: 'dialogue', attemptId: 'c1', decision: 'accepted', reason: 'ok', references: ['review'] }, context)
  plan = recoverPlan(plan, now - 2 * 60_000, { autoContinue: true })
  for (const [id, attempt] of [['integrate', 'a2'], ['level', 'b2']] as const) plan = admitPlanAttempt(queuePlanAttempt(plan, id, attempt, `d-${attempt}`, now - 60_000), id, attempt, now - 60_000)
  return plan
})()

const scenes: Record<string, RoomState> = {
  t1: {
    members: [lead, mapper, writer], relays: [], tasks: [], settings: DEFAULT_ROOM_SETTINGS,
    runs: [{ member: '地图匠', runId: '9:m-map', state: 'running', startedAt: now - 72_000 }, { member: '总编排', runId: '9:m-co', state: 'running', startedAt: now - 40_000 }],
    deliveries: [delivery('4:m-map', 'm-map', {}), delivery('4:m-co', 'm-co', {}),
      delivery('9:m-map', 'm-map', { status: 'running', via: 'auto-continue', text: RESTART_CONTINUE_TEXT }), delivery('9:m-co', 'm-co', { status: 'running', via: 'auto-continue', text: RESTART_CONTINUE_TEXT })],
    continued: ['4:m-map', '4:m-co'],
    jobs: [{ id: 'j1', number: 1, title: MSG, messages: [], status: 'running', startedAt: now - 20 * 60_000, deliveries: ['4:m-map', '4:m-co', '9:m-map', '9:m-co'], members: ['m-map', 'm-co'] }, { id: 'j0', number: 0, title: 'x', messages: [], status: 'running', startedAt: now, deliveries: [], members: [] }],
  },
  c1: {
    members: [lead, mapper, writer], relays: [], tasks: [], settings: { ...DEFAULT_ROOM_SETTINGS, autoContinueAfterRestart: false },
    runs: [{ member: '地图匠', runId: '4:m-map', state: 'cancelled', endedBy: 'restart', startedAt: now - 19 * 60_000 }, { member: '总编排', runId: '4:m-co', state: 'cancelled', endedBy: 'restart', startedAt: now - 19 * 60_000 }],
    deliveries: [delivery('4:m-map', 'm-map', {}), delivery('4:m-co', 'm-co', {}),
      delivery('11:m-co', 'm-co', { status: 'queued', endedBy: undefined, interruptedAt: undefined, text: english ? 'Do not publish the integration yet, I want to look first' : '北岭整合先别发布，等我看过再说', startedAt: undefined, queuedAt: now - 30_000 })],
  },
}
scenes['t2'] = { ...scenes['t1']!, runs: [], deliveries: [delivery('9:m-map', 'm-map', { status: 'done', via: 'auto-continue', endedBy: undefined })] }
scenes['g1'] = { ...scenes['t1']!, plan: goal }
scenes['setting'] = scenes['t1']!
scenes['m1'] = scenes['t1']!
const room = scenes[scene] ?? scenes['t1']!
const roomStore = { subscribe: () => () => {}, getCached: () => room, refresh: async () => {}, isRoomCached: () => true }
const setSettings = async () => ({ ok: true as const })
const node = (kind: string, seq: number, data: Record<string, unknown>) => ({ key: `${kind}-${seq}`, kind, id: String(seq), target: 'chat', anchorSeq: seq, location: { kind: 'unresolved' }, visibility: 'visible', data: { seq, time: now, ...data } })
const output = (text: string) => () => <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: '24px', color: 'var(--dsw-alias-label-primary)' }}>{text}</p>

function Human({ text, seq }: { readonly text: string; readonly seq?: number }) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
    <div style={{ maxWidth: '78%', padding: '8px 12px', borderRadius: 14, background: 'var(--dsw-alias-bg-layer-2)', fontSize: 14 }}>{text}</div>
    {seq !== undefined && <RoomReceiptView {...{ node: node('room-receipt', seq, { messageId: 'msg' }), sessionId: 'room-1', roomStore, withdraw: async () => undefined, t } as never} />}
  </div>
}

function Timeline() {
  const common = { sessionId: 'room-1', roomStore, openSession: () => {}, cancelMember: async () => {}, renderSlot: () => null, t }
  if (scene === 't2') {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <RoomSpeechView {...{ ...common, node: node('room-speech', 12, { member: '地图匠', text: DONE, runId: '9:m-map', reportedTo: '总编排', durationMs: 485_000 }) } as never} />
    </div>
  }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Human text={MSG} />
    <RoomRunView {...{ ...common, renderMemberOutput: output(PARTIAL), node: node('room-run', 5, { member: '地图匠', startedAt: now - 19 * 60_000, runId: '4:m-map', state: 'cancelled', endedBy: 'restart' }) } as never} />
    <RoomRunView {...{ ...common, renderMemberOutput: output(english ? 'Got it — while the two deliver, I am preparing the integration script.' : '收到，先等两位交付，我把整合脚本准备好。'), node: node('room-run', 6, { member: '总编排', startedAt: now - 19 * 60_000, runId: '4:m-co', state: 'cancelled', endedBy: 'restart' }) } as never} />
    {scene === 'c1' && <Human text={english ? 'Do not publish the integration yet, I want to look first' : '北岭整合先别发布，等我看过再说'} seq={11} />}
    {scene !== 'c1' && <>
      <RoomAutoContinueView {...{ node: node('room-auto-continue', 9, { targets: ['地图匠', '总编排'], text: RESTART_CONTINUE_TEXT }), sessionId: 'room-1', roomStore, setSettings, t } as never} />
      <RoomRunView {...{ ...common, renderMemberOutput: output(CONT), node: node('room-run', 10, { member: '地图匠', startedAt: now - 72_000, runId: '9:m-map', state: 'running' }) } as never} />
      <RoomRunView {...{ ...common, renderMemberOutput: output(english ? 'Checking how far the integration script got: the north ridge entry is in src/levels/index.js, tests not run' : '先核对整合脚本改到哪了：src/levels/index.js 已加北岭入口，测试还没跑'), node: node('room-run', 11, { member: '总编排', startedAt: now - 40_000, runId: '9:m-co', state: 'running' }) } as never} />
    </>}
  </div>
}

function Composer() {
  return <>
    <div style={{ marginTop: 16 }}>
      <RoomRestartBanner state={room} busy={false} onContinue={() => {}} onStop={() => {}} t={t} />
    </div>
    <div style={{ marginTop: 8, padding: 16, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 22, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-tertiary)' }}>
      {english ? 'Message the members, @ one of them…' : '发消息，@ 指定成员…'}
    </div>
  </>
}

function Members() {
  const noop = async () => undefined as never
  useEffect(() => {
    const header = [...document.querySelectorAll('button')].find(button => button.textContent?.includes(english ? 'Collaboration' : '协作设置'))
    header?.click()
    requestAnimationFrame(() => document.querySelector('[data-setting="auto-continue"]')?.scrollIntoView({ block: 'center' }))
  }, [])
  return <MembersView {...{ sessionId: 'room-1', roomStore, openSession: () => {}, removeMember: noop, restoreMember: noop, setSettings, updateMember: noop, invite: noop, listProviders: noop, browseDirectory: async () => null, t } as never} />
}

function MemberPage() {
  const inbox = { memberId: 'child-map', paused: false, messages: [
    { id: 'cut', caller: 'composer' as const, key: 'k-1', text: '把北岭的捷径再加一条，从瀑布后面绕过去。', status: 'cancelled' as const, interrupted: 'restart' as const, error: '被重启打断', createdAt: 1, updatedAt: 2 },
    { id: 'cont', caller: 'composer' as const, key: 'restart-continue:cut', text: RESTART_CONTINUE_TEXT, preview: english ? 'Continue after restart' : '重启后继续', status: 'running' as const, createdAt: 3, updatedAt: 3 },
    { id: 'typed', caller: 'composer' as const, key: 'k-2', text: english ? 'Also move the spawn point to the bridge head.' : '顺便把出生点挪到桥头。', status: 'queued' as const, createdAt: 4, updatedAt: 4 },
  ] }
  const face = { read: async () => inbox, control: async () => ({ ok: true as const }) }
  return <div style={{ border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 14, padding: 12, background: 'var(--dsw-alias-bg-layer-1)' }}>
    <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 8 }}><b style={{ color: 'var(--dsw-alias-label-primary)' }}>地图匠</b> · kimi-cli</div>
    <p style={{ fontSize: 14, margin: '4px 0' }}>{english ? 'Add one more shortcut on the north ridge, round the back of the waterfall.' : '把北岭的捷径再加一条，从瀑布后面绕过去。'}</p>
    <p style={{ fontSize: 14, margin: '4px 0', color: 'var(--dsw-alias-label-tertiary)' }}>{english ? 'Looking at the waterfall stretch first, the shortcut has to avoid' : '好，我先看瀑布那一段的格子数据，捷径要避开'}</p>
    <p style={{ fontSize: 14, margin: '4px 0' }}>{english ? 'Checking first: the shortcut cells are half changed, tests not run. Connecting the rest…' : '先核对：捷径的格子已经改了一半，还没跑测试。接着把剩下的连上……'}</p>
    <MemberInboxView face={face} t={ta} />
  </div>
}

function Page() {
  // The goal panel's task rows open, so the attempt history shows.
  useEffect(() => {
    if (scene === 'g1') for (const element of document.querySelectorAll('details')) element.open = true
  }, [])
  if (scene === 'setting') return <div style={{ maxWidth: 720, margin: '0 auto' }}><Members /></div>
  return <main style={{ maxWidth: 780, margin: '8px auto 24px', padding: '0 16px', containerType: 'inline-size', containerName: 'room' } as React.CSSProperties}>
    {scene === 'g1' && <RoomPlanView plan={goal} members={[lead, mapper, writer]} command={async () => ({ ok: true as const })} expanded t={t} />}
    {scene === 'm1' && <MemberPage />}
    {scene !== 'g1' && scene !== 'm1' && <><Timeline /><Composer /></>}
  </main>
}

createRoot(document.getElementById('root')!).render(<Page />)
