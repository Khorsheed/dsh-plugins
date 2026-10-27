/**
 * Members' questions: a CLI member's ask_user_question becomes a pick-to-answer
 * card in the room; the human's answers (or the card expiring) resolve the
 * member's waiting call.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import RoomService, { parseQuestions } from '../src/index.ts'
import { createRoom } from './promote.ts'

async function boot() {
  const ctx = new Context()
  const agent = { followup: vi.fn(), send: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn() }
  ctx.provide('agents', {
    get: () => agent,
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  ctx.provide('localAgent', { start: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  await service.invite({ sessionId, provider: 'claude-local', name: 'gm' })
  ctx.sessions.get(sessionId)!.append('room/member-updated', { name: 'gm', childSessionId: SessionId('child-gm') })
  const run = { childSessionId: 'child-gm', parentSessionId: String(sessionId), provider: 'claude-local' }
  const state = async () => {
    const result = await service.getState({ sessionId })
    if (!result.ok) throw new Error('room unavailable')
    return result.value
  }
  return { ctx, service, sessionId, run, state }
}

const QUESTIONS = [
  { id: 'fun', question: '核心乐趣是哪一种？', header: '核心乐趣', options: [{ label: '读懂习性', description: '解谜感' }, { label: '潜行张力' }] },
  { id: 'len', question: '一局多长？', options: ['3-5 分钟', '15-20 分钟'] },
]

describe('member questions', () => {
  it('shows a card, and hands the human\'s answers back to the asking member', async () => {
    const bench = await boot()
    const asked = bench.service.receiveMemberCommand(bench.run, { name: 'ask_user_question', arguments: { questions: QUESTIONS } })
    await vi.waitFor(async () => expect((await bench.state()).questions).toHaveLength(1))
    const [card] = (await bench.state()).questions!
    expect(card).toMatchObject({ member: 'gm', questions: [{ id: 'fun', header: '核心乐趣', options: [{ label: '读懂习性', description: '解谜感' }, { label: '潜行张力' }] }, { id: 'len', options: [{ label: '3-5 分钟' }, { label: '15-20 分钟' }] }] })
    expect(await bench.service.answerQuestion({ sessionId: bench.sessionId, id: card!.id, answers: [
      { id: 'fun', selected: ['读懂习性'] }, { id: 'len', selected: [], custom: ' 10 分钟左右 ' }, { id: 'stray', selected: ['x'] },
    ] })).toEqual({ ok: true })
    const outcome = await asked
    expect(outcome.ok).toBe(true)
    expect(JSON.parse((outcome as { receipt: string }).receipt)).toEqual({ answers: [
      { id: 'fun', selected: ['读懂习性'] }, { id: 'len', selected: [], custom: '10 分钟左右' },
    ] })
    expect((await bench.state()).questions).toBeUndefined()
    expect(await bench.service.answerQuestion({ sessionId: bench.sessionId, id: card!.id, answers: [] }))
      .toEqual({ ok: false, error: { code: 'question-not-pending' } })
  })

  it('a card no waiting call stands behind (a restart) expires on the next access', async () => {
    const bench = await boot()
    bench.ctx.sessions.get(bench.sessionId)!.append('room/question', { id: 'orphan', member: 'gm', memberId: 'm', questions: [{ id: 'q1', question: '?' }] })
    await bench.service.setGoal({ sessionId: bench.sessionId, text: '做一只兽的样板' })
    expect((await bench.state()).questions).toBeUndefined()
  })

  it('an expired card still takes an answer: it reaches the member as a new message, once', async () => {
    const bench = await boot()
    const session = bench.ctx.sessions.get(bench.sessionId)!
    const gmId = (session.snapshotEvents().find(event => event.type === 'room/member-added' && (event.data as { name: string }).name === 'gm')!.data as { id: string }).id
    session.append('room/question', { id: 'late', member: 'gm', memberId: gmId, questions: [{ id: 'q1', header: '外形', question: '哪种身形？', options: [{ label: '狐首人身' }] }] })
    session.append('room/question', { id: 'gate', member: 'gm', memberId: gmId, questions: [{ id: 'help', question: '允许吗', options: [{ label: '允许' }] }], consent: true })
    session.append('room/question-resolved', { id: 'late', outcome: 'cancelled' })
    expect(await bench.service.answerQuestion({ sessionId: bench.sessionId, id: 'late', answers: [{ id: 'q1', selected: ['狐首人身'], custom: '要背货箱' }] })).toEqual({ ok: true })
    const events = session.snapshotEvents()
    expect(events.filter(event => event.type === 'room/question-resolved' && (event.data as { id: string }).id === 'late').at(-1)!.data)
      .toEqual({ id: 'late', outcome: 'answered', answers: [{ id: 'q1', selected: ['狐首人身'], custom: '要背货箱' }], late: true })
    const dispatch = events.filter(event => event.type === 'room/dispatch').at(-1)!.data as { targets: string[]; origin: string; text: string }
    expect(dispatch).toMatchObject({ targets: ['gm'], origin: 'human' })
    expect(dispatch.text).toContain('外形：哪种身形？ → 狐首人身；要背货箱')
    // Answered once is answered; a consent gate never answers late.
    expect(await bench.service.answerQuestion({ sessionId: bench.sessionId, id: 'late', answers: [] })).toEqual({ ok: false, error: { code: 'question-not-pending' } })
    expect(await bench.service.answerQuestion({ sessionId: bench.sessionId, id: 'gate', answers: [{ id: 'help', selected: ['允许'] }] })).toEqual({ ok: false, error: { code: 'question-not-pending' } })
  })

  it('a question asked mid-round records that round and the text said so far', async () => {
    const bench = await boot()
    const room = bench.ctx.sessions.get(bench.sessionId)!
    room.append('room/run-state', { member: 'gm', state: 'running', startedAt: 7, runId: 'run-7' })
    const child = bench.ctx.sessions.create(SessionId('child-gm'), { meta: {} })
    child.append('turn/start', { turn: 1 } as never)
    child.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '第一批你想先刻画哪一组？' }] } } as never, { surfaceOp: 'append' } as never)
    void bench.service.receiveMemberCommand(bench.run, { name: 'ask_user_question', arguments: { questions: QUESTIONS } })
    await vi.waitFor(() => expect(room.snapshotEvents().some(event => event.type === 'room/question')).toBe(true))
    const asked = room.snapshotEvents().find(event => event.type === 'room/question')!.data as { runId?: string; before?: string }
    expect(asked).toMatchObject({ runId: 'run-7', before: '第一批你想先刻画哪一组？' })
  })

  it('validates questions, accepting their JSON text too', () => {
    expect(parseQuestions(JSON.stringify([{ question: '要不要轻失败？', multi_select: true, options: ['要', '不要'] }])))
      .toEqual([{ id: 'q1', question: '要不要轻失败？', multiSelect: true, options: [{ label: '要' }, { label: '不要' }] }])
    expect(parseQuestions([])).toBe('questions must be a non-empty array')
    expect(parseQuestions([{ id: 'a', question: 'x' }, { id: 'a', question: 'y' }])).toBe('Question ids must be unique')
    expect(parseQuestions([{ options: ['x'] }])).toBe('questions[0].question is required')
  })
})
