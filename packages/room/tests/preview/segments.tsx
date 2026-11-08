/**
 * Manual UI fixture for a member's round cut at the questions it asked
 * (room-timeline-order E1; compare with proposals/prototypes/room-timeline-order.html
 * 「问题二」 ⑥–⑩, 改后) — the real timeline components over room state replayed
 * from synthetic events:
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * then open /segments.html?state=<asking|answered|landed|message|legacy>[&lang=en][&dark=1]
 * (asking = ⑥ the question card is the round's card; answered = ⑦ answered,
 * the round goes on below, joined; landed = ⑧ the reply shows only what came
 * after; message = ⑨ answered by a message, which sits between; legacy = ⑩
 * the reply's split point was not found: the question opens the reply.)
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { RoomQuestionView } from '../../src/client/RoomQuestionView.tsx'
import { RoomRunView } from '../../src/client/RoomRunView.tsx'
import { RoomSpeechView } from '../../src/client/RoomSpeechView.tsx'
import { roomQuestionDefinition, type RoomQuestionData } from '../../src/client/nodes.ts'
import { replay } from '../../src/journal.ts'
import { ANSWER_BY_MESSAGE_PREFIX } from '../../src/client/round-segments.ts'
import { en, zh } from '../../src/client/locales.ts'
import type { RoomMember, RoomState } from '../../src/types.ts'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'answered'
const english = params.get('lang') === 'en'
const dictionary: Record<string, string> = english ? en : zh
const t = ((key: string, vars?: Record<string, unknown>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
if (params.get('dark') === '1') document.documentElement.dataset['theme'] = 'dark'

const now = Date.now()
const STARTED = now - 6 * 60_000 - 40_000
const ASKED = now - 3 * 60_000
const ANSWERED = now - 2 * 60_000 - 31_000
const RUN = '3:m-gu'
const P2MSG = english ? 'Rewrite chapter four as two interleaved threads.' : '把第四章重写成双线叙事。'
const SEG1 = english
  ? 'I read chapter four. There are two ways to split the threads: by time (each section moves the same day forward), or by character (one section the master, one the hero).'
  : '我看了第四章。双线有两种切法：按时间交替（每节推进同一天），或者按人物交替（师父一节、主角一节）。'
const SEG2 = english
  ? 'Good, by character. Chapter four splits into 6 sections: 3 from the master tracking the commission alone, 3 from the hero in the city; section 6 joins the threads on the bridge.\n\nWritten to the canvas · chapter four (6 sections). Section 6 still needs the event that brings them together; I will add that next.'
  : '好，按人物交替。第四章拆成 6 节：师父视角 3 节写他独自追查委托，主角视角 3 节写他在城里的遭遇，第 6 节两条线在桥上汇合。\n\n已写入画布 · 第四章（6 节），第 6 节还缺一个汇合的触发事件，下一步我先补这个。'
const SEG2LIVE = english
  ? 'Good, by character. Chapter four splits into 6 sections: 3 from the master tracking the commission alone, 3 from the hero in the city,'
  : '好，按人物交替。第四章拆成 6 节：师父视角 3 节写他独自追查委托，主角视角 3 节写他在城里的遭遇，'
const BY_MESSAGE = english ? 'By character — give the master\'s thread a bit more.' : '按人物交替吧，师父那条线多写一点。'
const QUESTIONS = [{ id: 'cut', question: english ? 'How should chapter four split?' : '第四章用哪种切法？', options: [{ label: english ? 'By time' : '按时间交替' }, { label: english ? 'By character (recommended)' : '按人物交替（推荐）' }] }]

const gu: RoomMember = { id: 'm-gu', name: english ? 'Advisor' : '故事顾问', kind: 'cli', provider: 'kimi-cli', role: english ? 'Coordinator' : '协调者', invitedBy: 'human', childSessionId: 'child-gu' as never }
const ev = (seq: number, type: string, data: unknown, time: number) => ({ seq, time, type, data }) as never
const answered = state !== 'asking'
const landed = state === 'landed' || state === 'legacy'
const answers = state === 'message'
  ? [{ id: 'cut', selected: [], custom: `${ANSWER_BY_MESSAGE_PREFIX}${BY_MESSAGE}` }]
  : [{ id: 'cut', selected: [QUESTIONS[0]!.options[1]!.label] }]
const events = [
  ev(10, 'room/question', { id: 'q1', member: gu.name, memberId: gu.id, questions: QUESTIONS, runId: RUN, before: SEG1.slice(-160) }, ASKED),
  ...answered ? [ev(12, 'room/question-resolved', { id: 'q1', outcome: 'answered', answers }, ANSWERED)] : [],
  ...landed ? [ev(20, 'room/speech', { member: gu.name, runId: RUN, text: `${SEG1}\n\n${SEG2}`, asks: [{ id: 'q1', at: state === 'legacy' ? -1 : SEG1.length }], durationMs: 400_000 }, now)] : [],
]
const replayed = replay(events)
const runState = landed ? 'done' : 'running'
const room: RoomState = {
  ...replayed, members: [gu],
  runs: [{ member: gu.name, runId: RUN, state: runState, startedAt: STARTED }],
  executions: [{ id: RUN, memberId: gu.id, member: gu.name, runId: RUN, state: runState, startedAt: STARTED }],
}
const roomStore = { subscribe: () => () => {}, getCached: () => room, refresh: async () => {}, isRoomCached: () => true }

// The member's live output, as the real view filters it by stretch.
const output = (_id: string, _startedAt: number, options?: { since?: number; until?: number }) => (
  <div style={{ fontSize: 14, lineHeight: '24px' }}>
    <MarkdownText text={options?.until !== undefined ? SEG1 : SEG2LIVE + '▍'} />
  </div>
)

let question: RoomQuestionData | undefined
for (const event of events) {
  const match = roomQuestionDefinition.match(event)
  if (match === null) continue
  question = match.role === 'start'
    ? roomQuestionDefinition.start({} as never, { event, role: 'start' } as never, undefined as never)
    : roomQuestionDefinition.update({ state: question } as never, { event, role: 'update' } as never)
}
const node = (kind: string, seq: number, data: Record<string, unknown>) => ({ key: `${kind}-${seq}`, kind, id: String(seq), target: 'chat', anchorSeq: seq, location: { kind: 'unresolved' }, visibility: 'visible', data: { seq, time: now, ...data } })
const speech = events.find(event => (event as { type: string }).type === 'room/speech') as { seq: number; time: number; data: Record<string, unknown> } | undefined

function Human({ text }: { readonly text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0 16px' }}>
      <div style={{ maxWidth: '78%', background: 'light-dark(#e3e6ea, rgb(53, 54, 56))', borderRadius: 14, padding: '8px 12px', fontSize: 14 }}>{text}</div>
    </div>
  )
}

function Page() {
  const common = { sessionId: 'room-1', roomStore, openSession: () => {}, cancelMember: async () => {}, renderMemberOutput: output, renderSlot: () => null, answerQuestion: async () => undefined, t }
  const segment = { roomStore, renderMemberOutput: output, openSession: () => {}, cancelMember: async () => {} }
  return (
    <main style={{ maxWidth: 760, margin: '8px auto 24px', padding: '0 16px' }}>
      <div data-chat-flow-key="h"><Human text={P2MSG} /></div>
      <div data-chat-flow-key="q"><RoomQuestionView {...{ ...common, node: node('room-question', 10, question as never), segment } as never} /></div>
      {state === 'message' && <div data-chat-flow-key="m"><Human text={BY_MESSAGE} /></div>}
      {!landed && <div data-chat-flow-key="r"><RoomRunView {...{ ...common, node: node('room-run', 13, { member: gu.name, startedAt: STARTED, state: 'running', runId: RUN }) } as never} /></div>}
      {speech !== undefined && <div data-chat-flow-key="s"><RoomSpeechView {...{ ...common, node: node('room-speech', speech.seq, { ...speech.data, time: speech.time }) } as never} /></div>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Page />)
