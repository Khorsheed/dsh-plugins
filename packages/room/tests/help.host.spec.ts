/**
 * Cross-session help: a room member asks another session; the request waits
 * in that session's own queue as a room-help message, the helper answers or
 * asks back through its agent-local tools (or its turn's last answer stands
 * in), and the answer reaches the asking member as a report.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import RoomService from '../src/index.ts'
import { mentionedSessions, readHelpSource, turnAnswer } from '../src/help.ts'
import { createRoom } from './promote.ts'

/** A `dsh-session:` mention the way the host composer writes one. */
const mention = (title: string, id: string): string => `@[${title}](dsh-session:${Buffer.from(JSON.stringify(id)).toString('base64url')})`

const HELPER = 'helper-1'

type Row = { type: string; seq: number; time: number; data: Record<string, unknown> }

async function boot(options: { busy?: boolean } = {}) {
  const ctx = new Context()
  const roomAgent = { followup: vi.fn(), send: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn() }
  ctx.provide('agents', {
    get: () => roomAgent,
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  ctx.provide('localAgent', { start: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as never)

  // The helper: its own session log, queue and agent-local tool registry.
  const rows: Row[] = []
  const tools: { name: string; execute: (args: Record<string, string>, exec: { agent: unknown }) => Promise<{ text: string }> }[] = []
  let idle!: () => void
  let turnDone = new Promise<void>((resolve) => { idle = resolve })
  const helper = {
    id: HELPER,
    status: options.busy === true ? 'running' : 'idle',
    session: { id: HELPER, header: {}, snapshotEvents: () => rows },
    followup: vi.fn((message: { id: string; content: unknown[]; source: unknown }) => {
      rows.push({ type: 'user/message', seq: rows.length, time: Date.now(), data: { id: message.id, content: message.content, source: message.source } })
    }),
    whenIdle: vi.fn(() => turnDone),
    ctx: { get: (name: string) => name === 'tools' ? { register: (def: (typeof tools)[number]) => { tools.push(def); return () => {} } } : undefined },
  }
  const answer = (text: string): void => {
    rows.push({ type: 'assistant/message', seq: rows.length, time: Date.now(), data: { message: { id: `a${rows.length}`, role: 'assistant', content: [{ type: 'text', text }] } } })
  }
  const endTurn = (): void => {
    idle()
    turnDone = new Promise<void>((resolve) => { idle = resolve })
  }
  ctx.provide('sessionController', { resolveAgent: vi.fn(async () => ({ agent: helper })) } as never)
  ctx.provide('sessionReferenceResolver', {
    listCandidates: vi.fn(async (_agent: unknown, query: string) => [
      { sessionId: HELPER, label: '开发剪辑插件' },
      { sessionId: 'other', label: '读书会' },
    ].filter(entry => query === '' || entry.sessionId.includes(query) || entry.label.includes(query))),
  } as never)

  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  const room = ctx.sessions.get(sessionId)!
  const caller = { id: sessionId, session: room }
  const thread = () => room.snapshotEvents().filter(event => event.type.startsWith('room/help'))
  const tool = (name: string) => tools.find(entry => entry.name === name)!
  return { ctx, service, sessionId, room, caller, helper, rows, tools, tool, answer, endTurn, roomAgent, thread }
}

describe('cross-session help', () => {
  it('asks a session the human @-mentioned without a card, queues the request there, and hands the reply back', async () => {
    const bench = await boot({ busy: true })
    bench.room.append('user/message', { id: 'h1', content: [{ type: 'text', text: `去问问 ${mention('开发剪辑插件', HELPER)}` }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    const sent = await bench.service.askHelp({ sessionId: bench.sessionId, session: '开发剪辑插件', text: '导出第 3 期时报 segment too short' }, bench.caller as never)
    expect(sent).toMatch(/busy, so the request waits in its queue/)
    expect((await bench.service.getState({ sessionId: bench.sessionId }) as { value: { questions?: unknown } }).value.questions).toBeUndefined()

    // The request is an ordinary follow-up in the helper's own queue, carrying the room's source.
    expect(bench.helper.followup).toHaveBeenCalledOnce()
    const source = readHelpSource(bench.rows[0]!.data.source)
    expect(source).toMatchObject({ room: bench.sessionId, from: 'dsh', op: 'request', text: '导出第 3 期时报 segment too short' })
    expect(bench.tools.map(entry => entry.name)).toEqual(['room_help_reply', 'room_help_ask'])
    expect(bench.thread().map(event => [event.type, (event.data as { state?: string }).state])).toEqual([['room/help', undefined], ['room/help-state', 'queued']])

    // The helper answers with the reply tool; the asker gets it as a report.
    const replied = await bench.tool('room_help_reply').execute({ text: '压缩后留下 <0.1 秒残片，已修', handoff: '分支 fix/render-tiny-segments；合进来后重新导出' }, { agent: bench.helper })
    expect(replied).toEqual({ text: expect.stringMatching(/reached dsh/) })
    await bench.service.engine.idle()
    expect(bench.thread().slice(-2).map(event => event.data)).toMatchObject([
      { kind: 'reply', text: '压缩后留下 <0.1 秒残片，已修', handoff: '分支 fix/render-tiny-segments；合进来后重新导出' },
      { state: 'replied' },
    ])
    const report = bench.roomAgent.followup.mock.calls.at(-1)![0] as { content: { text: string }[] }
    expect(report.content[0]!.text).toMatch(/Help reply from "开发剪辑插件"[\s\S]*Handoff: 分支 fix\/render-tiny-segments/)

    // The turn ending afterwards adds nothing: the reply tool already answered.
    bench.endTurn()
    await vi.waitFor(() => expect(bench.helper.whenIdle).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(bench.thread().filter(event => event.type === 'room/help-message')).toHaveLength(1)
  })

  it('asks the human before the first ask of a session nobody @-mentioned', async () => {
    const bench = await boot()
    const sent = bench.service.askHelp({ sessionId: bench.sessionId, session: HELPER, text: '帮我看看' }, bench.caller as never)
    let card: { id: string } | undefined
    await vi.waitFor(async () => {
      card = (await bench.service.getState({ sessionId: bench.sessionId }) as { value: { questions?: { id: string }[] } }).value.questions?.[0]
      expect(card).toBeDefined()
    })
    expect(await bench.service.answerQuestion({ sessionId: bench.sessionId, id: card!.id, answers: [{ id: 'help', selected: ['不允许'] }] })).toEqual({ ok: true })
    expect(await sent).toMatch(/did not allow/)
    expect(bench.helper.followup).not.toHaveBeenCalled()
  })

  it('carries a question back to the asker and the asker\'s answer to the helper; a turn without the reply tool hands over its last answer', async () => {
    const bench = await boot()
    bench.room.append('user/message', { id: 'h1', content: [{ type: 'text', text: mention('开发剪辑插件', HELPER) }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    await bench.service.askHelp({ sessionId: bench.sessionId, session: HELPER, text: '导出报错' }, bench.caller as never)
    const helpId = (bench.thread()[0]!.data as { id: string }).id

    expect(await bench.tool('room_help_ask').execute({ question: '最短停顿设了多少？' }, { agent: bench.helper })).toEqual({ text: expect.stringMatching(/End your turn/) })
    await bench.service.engine.idle()
    expect((bench.roomAgent.followup.mock.calls.at(-1)![0] as { content: { text: string }[] }).content[0]!.text).toMatch(/Question from "开发剪辑插件"[\s\S]*最短停顿设了多少/)
    bench.endTurn()

    // The asker answers on the thread; the helper's next turn ends with a plain answer.
    expect(await bench.service.askHelp({ sessionId: bench.sessionId, help: helpId, text: '0.15 秒' }, bench.caller as never)).toMatch(/Sent to/)
    expect(readHelpSource(bench.rows.at(-1)!.data.source)).toMatchObject({ op: 'message', text: '0.15 秒' })
    bench.answer('那就是残片问题，已修好')
    bench.endTurn()
    await vi.waitFor(() => expect(bench.thread().at(-1)!.data).toEqual({ help: helpId, state: 'replied' }))
    expect(bench.thread().filter(event => event.type === 'room/help-message').map(event => event.data)).toMatchObject([
      { kind: 'question' }, { kind: 'message', text: '0.15 秒' }, { kind: 'reply', text: '那就是残片问题，已修好', fallback: true },
    ])
  })

  it('refuses outside a room, unknown sessions and ambiguous names', async () => {
    const bench = await boot()
    expect(await bench.service.askHelp({ sessionId: 'not-a-room', session: HELPER, text: 'x' }, bench.caller as never)).toMatch(/inside a room/)
    expect(await bench.service.askHelp({ sessionId: bench.sessionId, session: '没有这个', text: 'x' }, bench.caller as never)).toMatch(/No session matches/)
    expect(await bench.service.askHelp({ sessionId: bench.sessionId, session: '', text: 'x' }, bench.caller as never)).toMatch(/Name the session/)
    expect(await bench.service.askHelp({ sessionId: bench.sessionId, help: 'nope', text: 'x' }, bench.caller as never)).toMatch(/No help thread/)
  })
})

describe('the human pointing at a session', () => {
  it('tells the coordinator to ask it through room_help, in the prompt only', async () => {
    const bench = await boot()
    const sent = await bench.service.postMessage({ sessionId: bench.sessionId, text: `${mention('游戏大师（游戏开发）', HELPER)} 问问他在做什么` })
    expect(sent.ok).toBe(true)
    await bench.service.engine.idle()
    const prompt = (bench.roomAgent.followup.mock.calls.at(-1)![0] as { content: { text: string }[] }).content[0]!.text
    expect(prompt).toMatch(/人点名了房间外的会话：「游戏大师（游戏开发）」。用 room_help 去问/)
    const dispatch = bench.room.snapshotEvents().findLast(event => event.type === 'room/dispatch')!
    expect((dispatch.data as { text: string }).text).not.toContain('room_help')
  })
})

describe('a CLI member asking', () => {
  it('asks through the bridge command; the reply reaches that member', async () => {
    const bench = await boot()
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'claude-local', name: 'gm' })
    bench.room.append('room/member-updated', { name: 'gm', childSessionId: SessionId('child-gm') })
    bench.room.append('user/message', { id: 'h1', content: [{ type: 'text', text: mention('开发剪辑插件', HELPER) }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    const actor = { childSessionId: 'child-gm', parentSessionId: String(bench.sessionId), provider: 'claude-local' }
    const outcome = await bench.service.receiveMemberCommand(actor as never, { name: 'room_help', arguments: { session: '开发剪辑插件', text: '导出报错' } } as never)
    expect(outcome).toMatchObject({ ok: true, receipt: expect.stringMatching(/Sent to "开发剪辑插件"/) })
    expect(bench.thread()[0]!.data).toMatchObject({ fromName: 'gm' })
    expect(await bench.service.receiveMemberCommand(actor as never, { name: 'room_help', arguments: { text: 'x', bogus: 1 } } as never)).toMatchObject({ ok: false })
  })
})

describe('outside sessions on the member list', () => {
  it('links, refuses a member\'s own session, unlinks, and remembers a dismissed hint', async () => {
    const bench = await boot()
    expect(await bench.service.linkSession({ sessionId: bench.sessionId, target: HELPER, title: '开发剪辑插件' })).toEqual({ ok: true })
    expect(await bench.service.linkSession({ sessionId: bench.sessionId, target: bench.sessionId, title: 'self' })).toEqual({ ok: false, error: { code: 'invalid-settings' } })
    expect(await bench.service.dismissHelpNudge({ sessionId: bench.sessionId, target: HELPER })).toEqual({ ok: true })
    let state = (await bench.service.getState({ sessionId: bench.sessionId }) as { value: { linked?: unknown; helpNudgesDismissed?: unknown } }).value
    expect(state.linked).toMatchObject([{ sessionId: HELPER, title: '开发剪辑插件' }])
    expect(state.helpNudgesDismissed).toEqual([HELPER])
    expect(await bench.service.unlinkSession({ sessionId: bench.sessionId, target: HELPER })).toEqual({ ok: true })
    expect(await bench.service.unlinkSession({ sessionId: bench.sessionId, target: HELPER })).toEqual({ ok: false, error: { code: 'member-not-found' } })
    state = (await bench.service.getState({ sessionId: bench.sessionId }) as { value: { linked?: unknown } }).value
    expect(state.linked).toBeUndefined()
  })
})

describe('help reminder setting', () => {
  it('takes 10–120 minutes', async () => {
    const bench = await boot()
    expect(await bench.service.setSettings({ sessionId: bench.sessionId, helpReminderMinutes: 60 })).toMatchObject({ ok: true, value: { helpReminderMinutes: 60 } })
    expect(await bench.service.setSettings({ sessionId: bench.sessionId, helpReminderMinutes: 5 })).toEqual({ ok: false, error: { code: 'invalid-settings' } })
    expect(await bench.service.setSettings({ sessionId: bench.sessionId, helpReminderMinutes: 121 })).toEqual({ ok: false, error: { code: 'invalid-settings' } })
  })
})

describe('help helpers', () => {
  it('reads dsh-session mentions', () => {
    expect(mentionedSessions(`看 ${mention('A', 'abc')} 和 ${mention('B', 'x-y')}`)).toEqual(['abc', 'x-y'])
    expect(mentionedSessions('dsh-session:!!')).toEqual([])
  })

  it('takes a turn\'s last answer before the next human message', () => {
    const say = (seq: number, text: string) => ({ type: 'assistant/message', seq, time: 0, data: { message: { content: [{ type: 'text', text }] } } })
    const events = [
      { type: 'user/message', seq: 0, time: 0, data: { id: 'm', content: [], source: { kind: 'room-help' } } },
      say(1, '先看看'), say(2, '答案'),
      { type: 'user/message', seq: 3, time: 0, data: { id: 'u', content: [], source: { kind: 'user' } } },
      say(4, '别的话题'),
    ] as never
    expect(turnAnswer(events, 'm')).toBe('答案')
    expect(turnAnswer(events, 'missing')).toBe('')
  })
})

describe('asking another room', () => {
  const finish = (text: string) => ({ output: [{ type: 'text', text }], stopReason: 'completed' })

  async function rooms() {
    const ctx = new Context()
    const roomAgent = { followup: vi.fn(), send: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn() }
    ctx.provide('agents', {
      get: () => roomAgent,
      create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
        const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
        return { agent: { id: session.id, session }, dispose: async () => {} }
      }),
    } as never)
    // CLI members answer through the local-agent facade: each run waits on its flight.
    const flights: { provider: string; resolve: (value: unknown) => void }[] = []
    const run = async (_parent: string, provider: string) => {
      let resolve!: (value: unknown) => void
      const result = new Promise((res) => { resolve = res })
      flights.push({ provider, resolve })
      return { id: SessionId(`child-${provider}`), localAgent: undefined, result, dispose: async () => {} }
    }
    ctx.provide('localAgent', { start: vi.fn(run), resume: vi.fn(run), cancel: vi.fn(() => true) } as never)
    await ctx.plugin(SessionStore)
    await ctx.plugin(RoomService)
    const service = ctx.get('room') as RoomService
    const asking = await createRoom(ctx, service)
    const asked = await createRoom(ctx, service)
    await service.invite({ sessionId: asked, provider: 'claude-local', name: '游戏大师' })
    ctx.provide('sessionReferenceResolver', {
      listCandidates: vi.fn(async (_agent: unknown, query: string) => [{ sessionId: asked, label: '游戏开发' }]
        .filter(entry => query === '' || entry.sessionId.includes(query) || entry.label.includes(query))),
    } as never)
    const room = ctx.sessions.get(asking)!
    room.append('user/message', { id: 'h1', content: [{ type: 'text', text: mention('游戏开发', asked) }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    const thread = () => room.snapshotEvents().filter(event => event.type.startsWith('room/help'))
    const inbound = () => ctx.sessions.get(asked)!.snapshotEvents().filter(event => event.type === 'room/help-in').map(event => event.data)
    return { ctx, service, asking, asked, room, caller: { id: asking, session: room }, flights, thread, inbound, roomAgent }
  }

  it('hands a request for a named member to that member and brings its final reply back', async () => {
    const bench = await rooms()
    const sent = await bench.service.askHelp({ sessionId: bench.asking, session: `@[游戏大师（游戏开发）](dsh-session:${Buffer.from(JSON.stringify(bench.asked)).toString('base64url')})`, text: '头一直转圈' }, bench.caller as never)
    expect(sent).toMatch(/Sent to 游戏大师 in the room "游戏开发"/)
    expect(bench.thread()[0]!.data).toMatchObject({ target: { sessionId: bench.asked, room: true, member: '游戏大师' } })
    expect(bench.inbound()).toMatchObject([{ member: '游戏大师', from: 'dsh', text: '头一直转圈', op: 'request' }])
    await vi.waitFor(() => expect(bench.flights).toHaveLength(1))
    bench.flights[0]!.resolve(finish('修好了，v10 已发布'))
    await vi.waitFor(() => expect(bench.thread().at(-1)!.data).toMatchObject({ state: 'replied' }))
    expect(bench.thread().filter(event => event.type === 'room/help-message').map(event => event.data)).toMatchObject([{ kind: 'reply', text: '修好了，v10 已发布' }])
  })

  it('goes to the coordinator without a named member; a paused room holds it and dismissing ends the thread', async () => {
    const bench = await rooms()
    expect(await bench.service.setSettings({ sessionId: bench.asked, paused: true })).toMatchObject({ ok: true })
    expect(await bench.service.askHelp({ sessionId: bench.asking, session: '游戏开发', text: '帮忙看看' }, bench.caller as never)).toMatch(/paused/)
    expect(bench.inbound()).toMatchObject([{ member: 'dsh', held: true }])
    expect(bench.thread().at(-1)!.data).toMatchObject({ state: 'queued' })
    const relay = (await bench.service.getState({ sessionId: bench.asked }) as { value: { relays: { id: string }[] } }).value.relays[0]!
    expect(await bench.service.dismissRelay({ sessionId: bench.asked, relayId: relay.id })).toMatchObject({ ok: true })
    expect(bench.thread().at(-1)!.data).toMatchObject({ state: 'failed', error: '对方房间没有接这条求助' })
  })

  it('moves the asked member on from a round a restart left uncertain, instead of waiting behind it silently', async () => {
    const bench = await rooms()
    const other = bench.ctx.sessions.get(bench.asked)!
    const gm = (await bench.service.getState({ sessionId: bench.asked }) as { value: { members: { name: string; id: string }[] } }).value.members.find(member => member.name === '游戏大师')!
    const lost = other.append('room/dispatch', { id: 'lost', targets: ['游戏大师'], targetIds: [gm.id], text: '旧活', origin: 'human' })
    other.append('room/delivery-state', { id: `${lost.seq}:${gm.id}`, dispatchSeq: lost.seq, memberId: gm.id, state: 'uncertain', error: 'restart' })
    await bench.service.askHelp({ sessionId: bench.asking, session: '游戏开发', member: '游戏大师', text: '在做什么游戏' }, bench.caller as never)
    await vi.waitFor(() => expect(bench.flights).toHaveLength(1))
    const rows = (await bench.service.getState({ sessionId: bench.asked }) as { value: { deliveries: { text: string; status: string }[] } }).value.deliveries
    expect(rows.map(row => [row.text, row.status])).toEqual([['旧活', 'cancelled'], ['在做什么游戏', 'running']])
  })

  it('refuses a member the room does not have', async () => {
    const bench = await rooms()
    expect(await bench.service.askHelp({ sessionId: bench.asking, session: '游戏开发', member: '不存在', text: 'x' }, bench.caller as never)).toMatch(/has no member "不存在"/)
  })
})
