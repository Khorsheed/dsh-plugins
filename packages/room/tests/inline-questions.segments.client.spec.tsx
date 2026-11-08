// @vitest-environment jsdom
/**
 * A member's round cut at the questions it asked (room-timeline-order E1):
 * the question card holds what the round said before it; the run card, then
 * the landed reply, holds what came after the answer (「接着说」), joined to the
 * question card when nothing lands between. Replays of the shapes old and new
 * logs carry (at = 0 / at > 0 / at = -1 / no asks), the three in-progress
 * states, and a round stopped without a reply. Synthetic content only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { cleanup, render, screen } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { replay } from '../src/journal.ts'
import { roomQuestionDefinition, roomSpeechDefinition, type RoomQuestionData, type RoomSpeechData } from '../src/client/nodes.ts'
import { RoomQuestionView } from '../src/client/RoomQuestionView.tsx'
import { RoomRunView } from '../src/client/RoomRunView.tsx'
import { RoomSpeechView } from '../src/client/RoomSpeechView.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { zh } from '../src/client/locales.ts'
import type { RoomQuestionViewProps, RoomRunViewProps, RoomSpeechViewProps } from '../src/client/slots.ts'
import type { RoomMember, RoomState } from '../src/types.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh) as never
const SESSION = 'room-1' as SessionId
const RUN = '3:m-gu'
const STARTED = 1000
const gu: RoomMember = { id: 'm-gu', name: '顾问', kind: 'cli', provider: 'kimi-cli', role: '协调者', invitedBy: 'human', childSessionId: 'child-gu' as never }
const ev = (seq: number, type: string, data: unknown, time = 1000 + seq * 10) => ({ seq, time, type, data }) as never
const QUESTIONS = [{ id: 'cut', question: '第四章用哪种切法？', options: [{ label: '按时间' }, { label: '按人物' }] }]
const asked = (before?: string) => ev(10, 'room/question', { id: 'q1', member: '顾问', memberId: 'm-gu', questions: QUESTIONS, runId: RUN, ...before === undefined ? {} : { before } })
const answered = ev(12, 'room/question-resolved', { id: 'q1', outcome: 'answered', answers: [{ id: 'cut', selected: ['按人物'] }] })
const spoke = (text: string, asks?: { id: string; at: number }[]) => ev(20, 'room/speech', { member: '顾问', text, runId: RUN, ...asks === undefined ? {} : { asks } })

/** The room state those events replay to, with the round's run as given. */
function stateOf(events: never[], run: 'running' | 'done' | 'cancelled'): RoomState {
  const replayed = replay(events)
  return {
    ...replayed, members: [gu],
    runs: [{ member: '顾问', runId: RUN, state: run, startedAt: STARTED }],
    executions: [{ id: RUN, memberId: 'm-gu', member: '顾问', runId: RUN, state: run, startedAt: STARTED }],
  }
}

async function storeOf(state: RoomState): Promise<RoomStore> {
  const gateway: RoomGateway = { isRoom: async () => ({ ok: true, value: true }), getState: async () => ({ ok: true, value: { ok: true, value: state } }) }
  const store = new RoomStore({ sessions: { list: createSnapshotStore({ current: undefined }) } } as unknown as Context, gateway)
  await store.ensure(SESSION)
  return store
}

/** Fold one Definition over its events into the node data. */
function questionNode(events: never[]): RoomQuestionData {
  let data: RoomQuestionData | undefined
  for (const event of events) {
    const match = roomQuestionDefinition.match(event)
    if (match === null) continue
    data = match.role === 'start'
      ? roomQuestionDefinition.start({} as never, { event, role: 'start' } as never, undefined as never)
      : roomQuestionDefinition.update({ state: data } as never, { event, role: 'update' } as never)
  }
  return data!
}
function speechNode(events: never[]): RoomSpeechData | undefined {
  const event = events.find(entry => roomSpeechDefinition.match(entry) !== null)
  return event === undefined ? undefined : roomSpeechDefinition.start({} as never, { event, role: 'start' } as never, undefined as never)
}

/** The live output stand-in: says which stretch of the round it was asked for. */
const output = vi.fn((_id: string, _startedAt: number, options?: { since?: number; until?: number; empty?: unknown }) => (
  <div data-testid={options?.until === undefined ? 'live-after' : 'live-before'}>{`${options?.since ?? ''}..${options?.until ?? ''}`}{options?.empty as never}</div>
))

/**
 * Render the timeline the host would: each node in its own flow seat, in log
 * order — the question card, then (while running) the run card, then the reply.
 */
async function timeline(events: never[], run: 'running' | 'done' | 'cancelled', between?: string) {
  output.mockClear()
  const roomStore = await storeOf(stateOf(events, run))
  const segment = { roomStore, renderMemberOutput: output, openSession: vi.fn(), cancelMember: vi.fn(async () => {}) }
  const question = questionNode(events)
  const speech = speechNode(events)
  const node = <D,>(kind: string, data: D) => ({ key: kind, kind, id: kind, target: 'chat', anchorSeq: 0, location: { kind: 'unresolved' }, visibility: 'visible', data })
  const view = render(
    <div>
      <div data-chat-flow-key="q"><RoomQuestionView {...{ node: node('room-question', question), sessionId: SESSION, answerQuestion: vi.fn(), segment, t } as unknown as RoomQuestionViewProps} /></div>
      {between !== undefined && <div data-chat-flow-key="h"><p>{between}</p></div>}
      {run === 'running' && <div data-chat-flow-key="r"><RoomRunView {...{ node: node('room-run', { seq: 13, time: 1013, member: '顾问', startedAt: STARTED, state: 'running', runId: RUN }), sessionId: SESSION, roomStore, openSession: vi.fn(), cancelMember: vi.fn(), renderMemberOutput: output, renderSlot: () => null, t } as unknown as RoomRunViewProps} /></div>}
      {speech !== undefined && <div data-chat-flow-key="s"><RoomSpeechView {...{ node: node('room-speech', speech), sessionId: SESSION, roomStore, openSession: vi.fn(), answerQuestion: vi.fn(), renderSlot: () => null, t } as unknown as RoomSpeechViewProps} /></div>}
    </div>,
  )
  const seat = (key: string) => view.container.querySelector(`[data-chat-flow-key="${key}"]`) as HTMLElement
  return { seat }
}

describe('a landed reply, cut at its questions', () => {
  it('at = 0: the question card holds no text; the reply is all 「接着说」, joined to it', async () => {
    const { seat } = await timeline([asked(), answered, spoke('按人物交替，拆成 6 节。', [{ id: 'q1', at: 0 }])], 'done')
    expect(seat('q').textContent).toContain('问了你')
    expect(seat('q').textContent).toContain('你的回答：按人物')
    expect(seat('q').querySelector('[data-member-output]')).toBeNull()
    expect(seat('s').textContent).toContain('接着说')
    expect(seat('s').textContent).toContain('按人物交替，拆成 6 节。')
    // Joined: the reply drops its own name and avatar.
    expect(seat('s').firstElementChild!.className).toMatch(/grouped/)
    expect(seat('s').textContent).not.toContain('顾问')
  })

  it('at > 0: the text before the question stays with it; the reply shows only what came after', async () => {
    const { seat } = await timeline([asked('双线有两种切法。'), answered, spoke('双线有两种切法。按人物交替，拆成 6 节。', [{ id: 'q1', at: 8 }])], 'done')
    expect(seat('q').textContent).toContain('双线有两种切法。')
    expect(seat('q').textContent).not.toContain('拆成 6 节')
    expect(seat('s').textContent).toContain('按人物交替，拆成 6 节。')
    expect(seat('s').textContent).not.toContain('双线有两种切法')
  })

  it('at = -1 (split point not found): the reply carries the question first, marked mid-round; no card of its own', async () => {
    const { seat } = await timeline([asked('找不到的尾巴'), answered, spoke('双线有两种切法。按人物交替。', [{ id: 'q1', at: -1 }])], 'done')
    expect(seat('q').textContent).toBe('')
    expect(seat('s').textContent).toContain('提问于这一轮中途')
    expect(seat('s').textContent).toContain('双线有两种切法。按人物交替。')
    expect(seat('s').textContent).not.toContain('接着说')
  })

  it('no asks (a question with no round, before 10-27): its own row; the reply whole', async () => {
    const legacy = ev(10, 'room/question', { id: 'q1', member: '顾问', memberId: 'm-gu', questions: QUESTIONS })
    const { seat } = await timeline([legacy, answered, spoke('按人物交替。')], 'done')
    expect(seat('q').textContent).toContain('顾问 问你')
    expect(seat('s').textContent).toContain('按人物交替。')
    expect(seat('s').textContent).not.toContain('接着说')
    expect(seat('s').firstElementChild!.className).not.toMatch(/grouped/)
  })
})

describe('a round in progress', () => {
  it('asking: the question card is the round\'s card (live output up to the question, the stop button); the run card steps aside', async () => {
    const { seat } = await timeline([asked('双线有两种切法。')], 'running')
    expect(seat('q').textContent).toContain('顾问 在等你回答')
    expect(screen.getByRole('button', { name: '停止' })).toBeDefined()
    expect(screen.getByRole('button', { name: '提交回答' })).toBeDefined()
    expect(screen.getByTestId('live-before').textContent).toContain(`${STARTED}..1100`)
    // A refresh lost the earlier output: 「……」 and the recorded tail stand in.
    expect(screen.getByTestId('live-before').textContent).toContain('……双线有两种切法。')
    expect(seat('r').textContent).toBe('')
  })

  it('answered: the question folds in place; the run card goes on below with only what came after, joined', async () => {
    const { seat } = await timeline([asked(), answered], 'running')
    expect(seat('q').textContent).toContain('你的回答：按人物')
    expect(screen.getByTestId('live-before').textContent).toContain(`${STARTED}..1100`)
    expect(seat('r').textContent).toContain('接着说')
    expect(screen.getByTestId('live-after').textContent).toBe('1120..')
    expect(seat('r').firstElementChild!.className).toMatch(/grouped/)
  })

  it('answered by a message: the message sits between, so the run card keeps its avatar', async () => {
    const { seat } = await timeline([asked(), answered], 'running', '按人物交替吧')
    expect(seat('r').textContent).toContain('接着说')
    expect(seat('r').firstElementChild!.className).not.toMatch(/grouped/)
  })

  it('landed: the reply replaces the live output with its own slices', async () => {
    const { seat } = await timeline([asked('双线有两种切法。'), answered, spoke('双线有两种切法。按人物交替。', [{ id: 'q1', at: 8 }])], 'done')
    expect(output).not.toHaveBeenCalled()
    expect(seat('q').textContent).toContain('双线有两种切法。')
    expect(seat('s').textContent).toContain('按人物交替。')
  })
})

describe('a round stopped without a reply', () => {
  it('keeps the question card with the recorded tail (the gap the 10-27 note left)', async () => {
    const expired = ev(12, 'room/question-resolved', { id: 'q1', outcome: 'cancelled' })
    const { seat } = await timeline([asked('双线有两种切法。'), expired], 'cancelled')
    expect(seat('q').textContent).toContain('……双线有两种切法。')
    expect(seat('q').textContent).toContain('已过期，仍可回答')
    expect(output).not.toHaveBeenCalled()
  })
})
