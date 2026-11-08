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
import { withRunEntry } from './run-entry-shim.ts'

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
  ctx.provide('localAgent', withRunEntry({ start: vi.fn(), resume: vi.fn(), cancel: vi.fn() }, ctx) as never)
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

  it('a message to a member waiting on its question answers it, instead of queueing behind the wait', async () => {
    const bench = await boot()
    const asked = bench.service.receiveMemberCommand(bench.run, { name: 'ask_user_question', arguments: { questions: QUESTIONS } })
    await vi.waitFor(async () => expect((await bench.state()).questions).toHaveLength(1))
    const posted = await bench.service.postMessage({ sessionId: bench.sessionId, text: '@gm 先去问问策划那边的设定再定' })
    expect(posted.ok).toBe(true)
    const outcome = await asked
    expect(JSON.parse((outcome as { receipt: string }).receipt)).toEqual({ answers: [
      { id: 'fun', selected: [], custom: '没有选选项，直接回复了：先去问问策划那边的设定再定' }, { id: 'len', selected: [] },
    ] })
    // The message settled as that answer: no round of its own for gm.
    const state = await bench.state()
    expect(state.questions).toBeUndefined()
    const seq = (posted as { value: { seq: number } }).value.seq
    expect(state.deliveries?.find(row => row.dispatchSeq === seq)).toMatchObject({ status: 'done' })
    const localAgent = bench.ctx.get('localAgent') as { start: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> }
    expect(localAgent.start).not.toHaveBeenCalled()
    expect(localAgent.resume).not.toHaveBeenCalled()
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
    // The asker's card comes to the bottom first, so the question is in view.
    const moved = room.snapshotEvents().findIndex(event => event.type === 'room/run-moved')
    expect(room.snapshotEvents()[moved]?.data).toEqual({ member: 'gm', startedAt: 7 })
    expect(moved).toBeLessThan(room.snapshotEvents().findIndex(event => event.type === 'room/question'))
  })

  it('answering a question in a running round moves its card below the answer (room-timeline-order E1)', async () => {
    const bench = await boot()
    const room = bench.ctx.sessions.get(bench.sessionId)!
    room.append('room/run-state', { member: 'gm', state: 'running', startedAt: 7, runId: 'run-7' })
    const asked = bench.service.receiveMemberCommand(bench.run, { name: 'ask_user_question', arguments: { questions: QUESTIONS } })
    await vi.waitFor(async () => expect((await bench.state()).questions).toHaveLength(1))
    const [card] = (await bench.state()).questions!
    expect(await bench.service.answerQuestion({ sessionId: bench.sessionId, id: card!.id, answers: [{ id: 'fun', selected: ['读懂习性'] }, { id: 'len', selected: ['3-5 分钟'] }] })).toEqual({ ok: true })
    await asked
    const types = room.snapshotEvents().map(event => event.type)
    const resolved = types.lastIndexOf('room/question-resolved')
    expect(types.slice(resolved + 1)).toContain('room/run-moved')
    expect(room.snapshotEvents()[types.lastIndexOf('room/run-moved')]!.data).toEqual({ member: 'gm', startedAt: 7 })
    expect(types.lastIndexOf('room/run-moved')).toBeGreaterThan(resolved)
    // The question log carries when it settled: the round's 「接着说」 starts there.
    const ask = (await bench.state()).askLog!.find(entry => entry.id === card!.id)!
    expect(ask.resolvedAt).toBe(room.snapshotEvents()[resolved]!.time)
  })

  it('a question answered with no round running moves nothing', async () => {
    const bench = await boot()
    const room = bench.ctx.sessions.get(bench.sessionId)!
    const asked = bench.service.receiveMemberCommand(bench.run, { name: 'ask_user_question', arguments: { questions: QUESTIONS } })
    await vi.waitFor(async () => expect((await bench.state()).questions).toHaveLength(1))
    const [card] = (await bench.state()).questions!
    await bench.service.answerQuestion({ sessionId: bench.sessionId, id: card!.id, answers: [{ id: 'fun', selected: ['读懂习性'] }, { id: 'len', selected: ['3-5 分钟'] }] })
    await asked
    expect(room.snapshotEvents().some(event => event.type === 'room/run-moved')).toBe(false)
  })

  it('a landed reply places its questions in the log: each question\'s slice, or the inline fallback', async () => {
    const bench = await boot()
    const room = bench.ctx.sessions.get(bench.sessionId)!
    room.append('room/question', { id: 'a', member: 'gm', memberId: 'm', questions: [{ id: 'x', question: '?' }], runId: 'run-1', before: '先说一句。' })
    room.append('room/question-resolved', { id: 'a', outcome: 'answered', answers: [{ id: 'x', selected: [] }] })
    room.append('room/question', { id: 'b', member: 'gm', memberId: 'm', questions: [{ id: 'x', question: '?' }], runId: 'run-1', before: '再说一句。' })
    room.append('room/question-resolved', { id: 'b', outcome: 'answered', answers: [{ id: 'x', selected: [] }] })
    room.append('room/speech', { member: 'gm', runId: 'run-1', text: '先说一句。再说一句。最后。', asks: [{ id: 'a', at: 5 }, { id: 'b', at: 10 }] })
    room.append('room/question', { id: 'c', member: 'gm', memberId: 'm', questions: [{ id: 'x', question: '?' }], runId: 'run-2', before: '找不到' })
    room.append('room/speech', { member: 'gm', runId: 'run-2', text: '全文。', asks: [{ id: 'c', at: -1 }] })
    const log = new Map((await bench.state()).askLog!.map(ask => [ask.id, ask]))
    expect(log.get('a')!.reply).toMatchObject({ at: 5, said: '先说一句。' })
    expect(log.get('b')!.reply).toMatchObject({ at: 10, said: '再说一句。' })
    expect(log.get('a')!.before).toBe('先说一句。')
    expect(log.get('c')!.reply).toMatchObject({ at: -1, inline: true })
  })

  it('a running member card re-anchors below the room agent\'s turn when that turn ends', async () => {
    // The coordinator invited or sent mid-turn: the card started inside its
    // turn and would fold away with the turn's process.
    const bench = await boot()
    const room = bench.ctx.sessions.get(bench.sessionId)!
    room.append('room/run-state', { member: 'gm', state: 'running', startedAt: 9, runId: 'run-9' })
    room.append('turn/end', { turn: 1, reason: { kind: 'completed' } } as never)
    await vi.waitFor(() => expect(room.snapshotEvents().at(-1)?.type).toBe('room/run-moved'))
    expect(room.snapshotEvents().at(-1)?.data).toEqual({ member: 'gm', startedAt: 9 })
    // Nothing runs: a turn end moves nothing.
    room.append('room/run-state', { member: 'gm', state: 'done', startedAt: 9, runId: 'run-9' })
    room.append('turn/end', { turn: 2, reason: { kind: 'completed' } } as never)
    await Promise.resolve()
    expect(room.snapshotEvents().at(-1)?.type).toBe('turn/end')
  })

  it('validates questions, accepting their JSON text too', () => {
    expect(parseQuestions(JSON.stringify([{ question: '要不要轻失败？', multi_select: true, options: ['要', '不要'] }])))
      .toEqual([{ id: 'q1', question: '要不要轻失败？', multiSelect: true, options: [{ label: '要' }, { label: '不要' }] }])
    expect(parseQuestions([])).toBe('questions must be a non-empty array')
    expect(parseQuestions([{ id: 'a', question: 'x' }, { id: 'a', question: 'y' }])).toBe('Question ids must be unique')
    expect(parseQuestions([{ options: ['x'] }])).toBe('questions[0].question is required')
  })
})
