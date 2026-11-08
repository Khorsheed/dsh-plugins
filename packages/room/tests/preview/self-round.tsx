/**
 * Manual UI fixture for a member's background task coming back
 * (member-self-started-rounds M5/M6; compare with
 * proposals/prototypes/member-activity.html 「⑰ 完成 → 接着做 → 交还」 and
 * 「③ 重启后 · 失去联系」) — the real timeline components over a scripted
 * room state:
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * then open /self-round.html?state=<running|selfdone|human|lost|folded>[&lang=en][&dark=1]
 * (running = the CLI opened its own round for the result; selfdone = its
 * reply with the 「后台任务完成后继续」 line, handed to the coordinator as a
 * follow-up, and the coordinator's answer; human = the human dispatched the
 * work: the line, no follow-up; lost = a host restart lost the task: the
 * timeline line and the coordinator's 「失去联系」 follow-up; folded = the task
 * ended while the member worked on another round: that reply carries the
 * quiet 「含后台任务结果」 line and nothing is forwarded.)
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { RoomRunView } from '../../src/client/RoomRunView.tsx'
import { RoomSpeechView } from '../../src/client/RoomSpeechView.tsx'
import { RoomEventView } from '../../src/client/RoomEventView.tsx'
import { en, zh } from '../../src/client/locales.ts'
import type { RoomDelivery, RoomMember, RoomState } from '../../src/types.ts'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'selfdone'
const english = params.get('lang') === 'en'
const dictionary: Record<string, string> = english ? en : zh
const t = ((key: string, vars?: Record<string, unknown>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
if (params.get('dark') === '1') document.documentElement.dataset['theme'] = 'dark'

const now = Date.now()
const BUILD = english ? 'Build and test chapter rendering' : '构建并测试章节渲染'
// The coordinator is a CLI member here so its reply is a room speech with its cause line.
const lead: RoomMember = { id: 'm-lead', name: '人物协调', kind: 'cli', provider: 'claude-local', role: '协调者', invitedBy: 'human', childSessionId: 'child-lead' as never }
const canvas: RoomMember = { id: 'm-canvas', name: 'kimi-canvas', kind: 'cli', provider: 'kimi-cli', role: '画布插件维护', invitedBy: 'human', childSessionId: 'child-canvas' as never }
const human = state === 'human'
const delivery = (id: string, memberId: string, extra: Partial<RoomDelivery>): RoomDelivery =>
  ({ id, dispatchSeq: Number(id.split(':')[0]), memberId, status: 'done', origin: 'coordinator', from: 'm-lead', replyTo: 'm-lead', text: BUILD, queuedAt: now - 20 * 60_000, task: 'j1', ...extra })
const room: RoomState = {
  members: [lead, canvas], relays: [], tasks: [], runs: [],
  deliveries: [
    delivery('4:m-canvas', 'm-canvas', human ? { origin: 'human', from: undefined, replyTo: undefined } : {}),
    delivery('5:m-lead', 'm-lead', { origin: 'report', reportFor: '4:m-canvas', from: undefined, replyTo: undefined }),
    delivery('9:m-lead', 'm-lead', state === 'lost'
      ? { origin: 'report', reportFor: 'background-task:m-canvas:bash-1', followUpOf: '4:m-canvas', from: undefined, replyTo: undefined }
      : { origin: 'report', reportFor: 'execution:exec-self', followUpOf: '4:m-canvas', from: undefined, replyTo: undefined }),
  ],
  executions: [
    { id: '4:m-canvas', memberId: 'm-canvas', member: 'kimi-canvas', state: 'done', startedAt: now - 20 * 60_000 },
    { id: 'execution:exec-self', memberId: 'm-canvas', member: 'kimi-canvas', state: state === 'running' ? 'running' : 'done', startedAt: now - 40_000 },
    { id: '7:m-canvas', memberId: 'm-canvas', member: 'kimi-canvas', state: 'done', startedAt: now - 60_000, executionId: 'exec-7', childSessionId: 'child-canvas' as never,
      reading: { executionId: 'exec-7', operation: 'prompt', outcome: 'done', turns: [4], calls: 3, unrecorded: [], compactions: [],
        callUsage: { inputTokens: 18_000, cacheReadTokens: 42_000, outputTokens: 900 },
        taskResults: [{ taskId: 'bash-1', taskStatus: 'completed', label: BUILD }] } },
  ],
  latestSpeechSeq: 12,
}
const roomStore = { subscribe: () => () => {}, getCached: () => room, refresh: async () => {}, isRoomCached: () => true }
const node = (kind: string, seq: number, data: Record<string, unknown>) => ({ key: `${kind}-${seq}`, kind, id: String(seq), target: 'chat', anchorSeq: seq, location: { kind: 'unresolved' }, visibility: 'visible', data: { seq, time: now, ...data } })
const continues = { taskId: 'bash-1', taskStatus: 'completed', label: BUILD, runId: '4:m-canvas' }

function Cap({ children }: { readonly children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', margin: '18px 0 6px' }}>{children}</div>
}

function Page() {
  const common = { sessionId: 'room-1', roomStore, openSession: () => {}, cancelMember: async () => {}, renderMemberOutput: () => null, renderSlot: () => null, t }
  return (
    <main style={{ maxWidth: 780, margin: '8px auto 24px', padding: '0 16px' }}>
      <Cap>{english ? 'Room timeline' : '房间时间线'}</Cap>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <RoomSpeechView {...{ ...common, node: node('room-speech', 5, { member: 'kimi-canvas', runId: '4:m-canvas', ...human ? {} : { reportedTo: '人物协调' },
          text: english ? 'The build and the full test run are going in the background, about 8 minutes; I will report back when they finish.' : '构建和全部测试已在后台运行，大约需要 8 分钟，完成后我会继续汇报。' }) } as never} />
        {state === 'folded' && <RoomSpeechView {...{ ...common, node: node('room-speech', 8, { member: 'kimi-canvas', runId: '7:m-canvas', childSessionId: 'child-canvas', durationMs: 58_000,
          text: english ? 'Chapter 12 outline is in the canvas. The build that was running meanwhile finished too: 412/412 tests pass.' : '第 12 章的大纲已经写进画布。期间在跑的构建也结束了：测试 412/412 通过。' }) } as never} />}
        {state === 'running' && <RoomRunView {...{ ...common, node: node('room-run', 10, { member: 'kimi-canvas', startedAt: now - 40_000, runId: 'execution:exec-self', state: 'running', continues }) } as never} />}
        {(state === 'selfdone' || human) && <RoomSpeechView {...{ ...common, node: node('room-speech', 11, { member: 'kimi-canvas', runId: 'execution:exec-self', continues, ...human ? {} : { reportedTo: '人物协调' },
          text: english ? 'Build passed, 412/412 tests pass, the panel check is clean. Ready to merge.' : '构建通过，测试 412/412 通过，面板检查没有提示。可以合并。' }) } as never} />}
        {state === 'selfdone' && <RoomSpeechView {...{ ...common, node: node('room-speech', 12, { member: '人物协调', runId: '9:m-lead',
          text: english ? 'Good, I will merge and schedule the release.' : '好，我来合并并安排上线。' }) } as never} />}
        {state === 'lost' && <RoomEventView {...{ node: node('room-event', 10, { sub: 'background-lost', member: 'kimi-canvas', lost: { label: BUILD, because: 'host-restart' } }), sessionId: 'room-1', t } as never} />}
        {state === 'lost' && <RoomSpeechView {...{ ...common, node: node('room-speech', 12, { member: '人物协调', runId: '9:m-lead',
          text: english ? 'kimi-canvas lost the build and tests in the host restart, no result. @kimi-canvas please check and rerun if needed.' : 'kimi-canvas 的构建和测试在宿主重启时失去联系，没有结果。@kimi-canvas 请核对一下，需要的话重新跑。' }) } as never} />}
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Page />)
