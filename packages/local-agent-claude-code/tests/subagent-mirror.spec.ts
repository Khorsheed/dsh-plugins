/**
 * A Claude Code member's own subagents as grandchild sessions
 * (member-cli-subagents M4). Synthetic records only (subagent-fixtures.ts):
 * the mirror pairs each subagent with the member's `Agent` call through the
 * meta file's `toolUseId`, tails its transcript as one step per API call,
 * closes a foreground subagent when the member's tool result arrives, and
 * leaves a background one open until the meta reports it finished. Every
 * grandchild log passes the released-log check.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { cliSubagentSessionId, MIRROR_INTERRUPTED_TOOL_RESULT, openMirrorTurn } from '@khorsheed/dsh-local-agent'
import type { LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent } from '@khorsheed/dsh-local-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { startClaudeCliRun } from '../src/claude-cli-provider.ts'
import { ClaudeSubagentMirror } from '../src/subagent-mirror.ts'
import { expectValidReleasedLog } from './expect-valid-log.ts'
import { fakeSessionPersistence } from './fake-persistence.ts'
import {
  appendTranscript,
  callLines,
  FIXTURE_CLI_SESSION,
  headLines,
  memberAgentCall,
  memberAgentResult,
  subagentSignal,
  twoCallTranscript,
  usageOf,
  writeMeta,
} from './subagent-fixtures.ts'

const MEMBER = 'member-claude'

interface Stage {
  ctx: Context
  homeDir: string
  member: Session
  mirror(transport?: 'live' | 'exec'): ClaudeSubagentMirror
  grandchild(agentId: string): Session | undefined
}

const mirrors: ClaudeSubagentMirror[] = []
afterEach(() => { for (const mirror of mirrors.splice(0)) mirror.dispose() })

async function stage(): Promise<Stage> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const homeDir = mkdtempSync(join(tmpdir(), 'claude-subagents-'))
  const member = ctx.sessions.create(SessionId(MEMBER), {
    meta: { cwd: '/home/user/work', parentSession: SessionId('room-parent'), origin: 'subagent', delegationDepth: 1 },
  } as never)
  openMirrorTurn(member, 1, 'live')
  return {
    ctx,
    homeDir,
    member,
    mirror: (transport = 'live') => {
      const mirror = new ClaudeSubagentMirror({ ctx, member, homeDir, transport, tailDelayMs: 0, pollMs: 60_000 })
      mirror.setCliSession(FIXTURE_CLI_SESSION)
      mirrors.push(mirror)
      return mirror
    },
    grandchild: agentId => ctx.sessions.get(SessionId(cliSubagentSessionId(MEMBER, agentId))),
  }
}

const executions = (session: Session): Array<LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent> =>
  session.snapshotEvents().filter(event => event.type === 'local-agent/execution').map(event => event.data as LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent)

const ofType = (session: Session, type: string): SessionEvent[] => session.snapshotEvents().filter(event => event.type === type)

/** The grandchild's steps, as `[kinds of the message's blocks]` per step. */
function steps(session: Session): string[][] {
  return ofType(session, 'assistant/message').map(event =>
    ((event.data as { message: { content: Array<{ type: string }> } }).message.content).map(block => block.type))
}

describe('claude subagent mirror: foreground', () => {
  it('pairs by toolUseId, writes one step per API call, and ends done when the member\'s result arrives', async () => {
    const s = await stage()
    const transcript = twoCallTranscript('afg1', '看看 a.txt 写了什么', '结论：占位')
    writeMeta(s.homeDir, 'afg1', { toolUseId: 'tu-fg', agentType: 'Explore', description: '看目录' })
    appendTranscript(s.homeDir, 'afg1', [...transcript.first, ...transcript.second])
    const mirror = s.mirror()
    expect(mirror.observe(memberAgentCall([{ id: 'tu-fg', description: '看目录', type: 'Explore' }]))).toBe(true)
    expect(mirror.observe(subagentSignal('tu-fg'))).toBe(true)
    await mirror.tail()

    const grandchild = s.grandchild('afg1')!
    expect(grandchild).toBeDefined()
    expect(grandchild.header.parentSession).toBe(SessionId(MEMBER))
    expect(grandchild.header.delegationDepth).toBe(2)
    // Running: the resulted call is written, the final text waits.
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call']])
    expect(executions(grandchild).map(record => record.phase)).toEqual(['start'])

    mirror.observe(memberAgentResult('tu-fg', 'afg1', '结论：占位'))
    await mirror.tail()
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call'], ['text']])
    const [start, end] = executions(grandchild) as [LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent]
    expect(start).toMatchObject({ caller: 'cli', operation: 'prompt', callerRef: 'tu-fg', parentSessionId: MEMBER })
    expect(start.cause).toEqual({ kind: 'cli-subagent', sessionId: MEMBER, callId: 'tu-fg', name: 'Explore' })
    expect(end).toMatchObject({ outcome: 'done', turns: [1] })

    // The prompt, the transcript's model, per-call usage, the tool's result.
    expect((ofType(grandchild, 'user/message')[0]!.data as { content: Array<{ text: string }> }).content[0]!.text).toBe('看看 a.txt 写了什么')
    expect((ofType(grandchild, 'request/header')[0]!.data as { header: { config: unknown } }).header.config).toEqual({ provider: 'claude-local', model: 'claude-sonnet-fixture' })
    expect(ofType(grandchild, 'assistant/message').map(event => (event.data as { usage?: unknown }).usage)).toEqual([
      { inputTokens: 10, outputTokens: 30, cacheReadTokens: 200 },
      { inputTokens: 12, outputTokens: 8, cacheReadTokens: 230 },
    ])
    expect(JSON.stringify(ofType(grandchild, 'tool/result')[0]!.data)).toContain('文件内容占位')
    expect(ofType(grandchild, 'turn/end').map(event => (event.data as { reason: { kind: string } }).reason.kind)).toEqual(['completed'])

    // The member: one catalog row, nothing else written.
    const catalog = ofType(s.member, 'subagent/catalog')
    expect(catalog.map(event => event.data)).toEqual([{
      version: 0, childId: grandchild.header.id, childCreatedAt: grandchild.header.createdAt, mode: 'one-shot', label: 'Explore: 看目录',
    }])
    expect(s.member.snapshotEvents().map(event => event.type)).toEqual(['turn/start', 'subagent/catalog'])
    expectValidReleasedLog(grandchild)

    // A repeated pass writes nothing more.
    const count = grandchild.snapshotEvents().length
    await mirror.tail()
    await mirror.settleRound({ processExited: false })
    expect(grandchild.snapshotEvents().length).toBe(count)
  })

  it('tails the transcript incrementally without duplicating a step', async () => {
    const s = await stage()
    const transcript = twoCallTranscript('ainc', '任务', '答')
    const mirror = s.mirror()
    mirror.observe(memberAgentCall([{ id: 'tu-inc', description: '增量' }]))
    // No meta yet: nothing to pair, nothing written.
    await mirror.tail()
    expect(s.grandchild('ainc')).toBeUndefined()

    writeMeta(s.homeDir, 'ainc', { toolUseId: 'tu-inc' })
    // The first API call is still streaming its blocks (thinking only).
    appendTranscript(s.homeDir, 'ainc', transcript.first.slice(0, 5))
    await mirror.tail()
    const grandchild = s.grandchild('ainc')!
    expect(steps(grandchild)).toEqual([])
    expect(ofType(grandchild, 'user/message')).toHaveLength(1)

    appendTranscript(s.homeDir, 'ainc', transcript.first.slice(5))
    await mirror.tail()
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call']])

    appendTranscript(s.homeDir, 'ainc', transcript.second)
    await mirror.tail()
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call']])

    mirror.observe(memberAgentResult('tu-inc', 'ainc', '答'))
    await mirror.tail()
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call'], ['text']])
    expect(ofType(grandchild, 'step/start')).toHaveLength(2)
    expect(ofType(grandchild, 'user/message')).toHaveLength(1)
    expectValidReleasedLog(grandchild)
  })

  it('two subagents in one member call: two grandchildren, each closed by its own result', async () => {
    const s = await stage()
    for (const [agentId, callId] of [['atw1', 'tu-a'], ['atw2', 'tu-b']] as const) {
      const transcript = twoCallTranscript(agentId, `任务 ${agentId}`, `答 ${agentId}`)
      writeMeta(s.homeDir, agentId, { toolUseId: callId, description: `并行 ${agentId}` })
      appendTranscript(s.homeDir, agentId, [...transcript.first, ...transcript.second])
    }
    const mirror = s.mirror()
    mirror.observe(memberAgentCall([{ id: 'tu-a', description: '并行 atw1' }, { id: 'tu-b', description: '并行 atw2' }]))
    mirror.observe(memberAgentResult('tu-b', 'atw2', '答 atw2'))
    await mirror.tail()
    const first = s.grandchild('atw1')!
    const second = s.grandchild('atw2')!
    expect(executions(first).map(record => record.phase)).toEqual(['start'])
    expect(executions(second).map(record => record.phase)).toEqual(['start', 'end'])
    expect((executions(second)[0] as LocalAgentExecutionStartEvent).callerRef).toBe('tu-b')

    mirror.observe(memberAgentResult('tu-a', 'atw1', '答 atw1'))
    await mirror.tail()
    expect(executions(first).map(record => record.phase)).toEqual(['start', 'end'])
    expect(ofType(s.member, 'subagent/catalog').map(event => (event.data as { label: string }).label).sort())
      .toEqual(['general-purpose: 并行 atw1', 'general-purpose: 并行 atw2'])
    for (const grandchild of [first, second]) {
      expect(steps(grandchild)).toEqual([['reasoning', 'tool-call'], ['text']])
      expectValidReleasedLog(grandchild)
    }
  })

  it('a member round that settles before the answer ends the subagent cancelled, its cut-off call interrupted', async () => {
    const s = await stage()
    const agentId = 'acut'
    writeMeta(s.homeDir, agentId, { toolUseId: 'tu-cut' })
    appendTranscript(s.homeDir, agentId, [
      ...headLines(agentId, '长任务'),
      ...callLines(agentId, 'acut-m1', 100, [{ type: 'tool_use', id: 'acut-bash', name: 'Bash', input: { command: 'sleep 100' } }], usageOf(5, 5), 'tool_use'),
    ])
    const mirror = s.mirror()
    mirror.observe(memberAgentCall([{ id: 'tu-cut', description: '长任务' }]))
    await mirror.settleRound({ processExited: false })
    const grandchild = s.grandchild(agentId)!
    const end = executions(grandchild).at(-1) as LocalAgentExecutionEndEvent
    expect(end).toMatchObject({ phase: 'end', outcome: 'cancelled', turns: [1] })
    expect(JSON.stringify(ofType(grandchild, 'tool/result')[0]!.data)).toContain(MIRROR_INTERRUPTED_TOOL_RESULT)
    expect((ofType(grandchild, 'assistant/message')[0]!.data as { interrupted?: boolean }).interrupted).toBe(true)
    expect(ofType(grandchild, 'turn/end').map(event => (event.data as { reason: { kind: string } }).reason.kind)).toEqual(['aborted'])
    expectValidReleasedLog(grandchild)
  })
})

describe('claude subagent mirror: background', () => {
  it('stays open past the member\'s round and ends done when the meta reports finished', async () => {
    const s = await stage()
    const transcript = twoCallTranscript('abg1', '后台任务', '后台结论')
    writeMeta(s.homeDir, 'abg1', { toolUseId: 'tu-bg', description: '后台' })
    appendTranscript(s.homeDir, 'abg1', transcript.first)
    const mirror = s.mirror()
    mirror.observe(memberAgentCall([{ id: 'tu-bg', description: '后台', background: true }]))
    // The launch notice comes back at once: it is not the subagent's answer.
    mirror.observe(memberAgentResult('tu-bg', 'abg1', 'Async agent launched successfully.', true))
    await mirror.settleRound({ processExited: false })
    const grandchild = s.grandchild('abg1')!
    expect(executions(grandchild).map(record => record.phase)).toEqual(['start'])
    expect((executions(grandchild)[0] as LocalAgentExecutionStartEvent).cause).toMatchObject({ background: true, callId: 'tu-bg' })
    expect(mirror.open).toBe(true)

    appendTranscript(s.homeDir, 'abg1', transcript.second)
    await mirror.tail()
    expect(executions(grandchild).map(record => record.phase)).toEqual(['start'])

    writeMeta(s.homeDir, 'abg1', { toolUseId: 'tu-bg', description: '后台', finished: true })
    await mirror.tail()
    expect(executions(grandchild).map(record => record.phase)).toEqual(['start', 'end'])
    expect((executions(grandchild)[1] as LocalAgentExecutionEndEvent).outcome).toBe('done')
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call'], ['text']])
    expect(mirror.open).toBe(false)
    expectValidReleasedLog(grandchild)
  })

  it('an async_launched result alone marks the call background (no run_in_background on the input)', async () => {
    const s = await stage()
    const transcript = twoCallTranscript('abg2', '任务', '答')
    writeMeta(s.homeDir, 'abg2', { toolUseId: 'tu-bg2' })
    appendTranscript(s.homeDir, 'abg2', transcript.first)
    const mirror = s.mirror()
    mirror.observe(memberAgentCall([{ id: 'tu-bg2', description: '默认后台' }]))
    mirror.observe(memberAgentResult('tu-bg2', 'abg2', 'Async agent launched successfully.', true))
    await mirror.tail()
    await mirror.settleRound({ processExited: false })
    expect(executions(s.grandchild('abg2')!).map(record => record.phase)).toEqual(['start'])
  })

  it('ends uncertain when the member\'s process goes away first', async () => {
    const s = await stage()
    const transcript = twoCallTranscript('abg3', '任务', '答')
    writeMeta(s.homeDir, 'abg3', { toolUseId: 'tu-bg3' })
    appendTranscript(s.homeDir, 'abg3', transcript.first)
    const mirror = s.mirror()
    mirror.observe(memberAgentCall([{ id: 'tu-bg3', description: '后台', background: true }]))
    await mirror.settleRound({ processExited: false })
    await mirror.lost()
    const grandchild = s.grandchild('abg3')!
    expect((executions(grandchild).at(-1) as LocalAgentExecutionEndEvent).outcome).toBe('uncertain')
    expectValidReleasedLog(grandchild)
  })

  it('on the exec path an unfinished background subagent ends cancelled at settle (the process exited)', async () => {
    const s = await stage()
    const transcript = twoCallTranscript('abg4', '任务', '答')
    writeMeta(s.homeDir, 'abg4', { toolUseId: 'tu-bg4' })
    appendTranscript(s.homeDir, 'abg4', transcript.first)
    const mirror = s.mirror('exec')
    mirror.observe(memberAgentCall([{ id: 'tu-bg4', description: '后台', background: true }]))
    await mirror.settleRound({ processExited: true })
    const grandchild = s.grandchild('abg4')!
    expect((executions(grandchild).at(-1) as LocalAgentExecutionEndEvent).outcome).toBe('cancelled')
    expect(mirror.open).toBe(false)
    expectValidReleasedLog(grandchild)
  })
})

describe('claude subagent mirror: degrade', () => {
  it('no records, a half-written meta, or an unknown call: nothing is written and nothing throws', async () => {
    const s = await stage()
    const mirror = s.mirror()
    mirror.observe(memberAgentCall([{ id: 'tu-none', description: '无记录' }]))
    await mirror.tail()
    const dir = join(s.homeDir, 'projects')
    expect(s.member.snapshotEvents().map(event => event.type)).toEqual(['turn/start'])
    // A meta for a call this member never made is not paired.
    writeMeta(s.homeDir, 'aother', { toolUseId: 'tu-someone-else' })
    appendTranscript(s.homeDir, 'aother', headLines('aother', '别人的'))
    await mirror.tail()
    expect(s.grandchild('aother')).toBeUndefined()
    await mirror.settleRound({ processExited: false })
    expect(s.member.snapshotEvents().map(event => event.type)).toEqual(['turn/start'])
    expect(dir).toBeTruthy()
  })
})

describe('claude exec round mirrors the member\'s subagents at settle', () => {
  it('member steps are unchanged; the subagent lands in its grandchild', async () => {
    const stream = [
      { type: 'system', subtype: 'init', session_id: FIXTURE_CLI_SESSION, model: 'claude-opus-fixture' },
      memberAgentCall([{ id: 'tu-exec', description: '看目录', type: 'Explore' }]),
      subagentSignal('tu-exec'),
      memberAgentResult('tu-exec', 'aexec', '结论'),
      { type: 'assistant', message: { id: 'member-m2', content: [{ type: 'text', text: '完成。' }], usage: usageOf(60, 4) } },
      { type: 'result', is_error: false, session_id: FIXTURE_CLI_SESSION, usage: { input_tokens: 110, output_tokens: 24 } },
    ].map(event => JSON.stringify(event)).join('\n') + '\n'

    const run = async (withHome: boolean): Promise<{ member: Session; ctx: Context; homeDir: string }> => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      ctx.provide('sessionPersistence', fakeSessionPersistence())
      const homeDir = mkdtempSync(join(tmpdir(), 'claude-subagents-exec-'))
      const transcript = twoCallTranscript('aexec', '看目录', '结论')
      writeMeta(homeDir, 'aexec', { toolUseId: 'tu-exec', agentType: 'Explore', description: '看目录' })
      appendTranscript(homeDir, 'aexec', [...transcript.first, ...transcript.second])
      const member = ctx.sessions.create(SessionId(MEMBER), {
        meta: { cwd: '/home/user/work', parentSession: SessionId('room-parent'), origin: 'subagent', delegationDepth: 1 },
      } as never)
      const result = await (await startClaudeCliRun({
        prompt: [{ type: 'text', text: '做事' }],
        parent: { session: { header: { cwd: '/home/user/work' } } },
        signal: new AbortController().signal,
      } as unknown as SubagentStartRequest, {
        cwd: '/home/user/work',
        env: {},
        permissionMode: 'skip',
        disposeGraceMs: 1_000,
        spawn: () => streamChild(stream),
        childSession: member,
        ctx,
        ...withHome ? { homeDir } : {},
      })).result
      expect(result.stopReason).toBe('completed')
      const deadline = Date.now() + 5_000
      while (member.snapshotEvents().at(-1)?.type !== 'turn/end') {
        if (Date.now() > deadline) throw new Error('the member turn never closed')
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      return { member, ctx, homeDir }
    }

    const without = await run(false)
    const withSubagents = await run(true)
    const content = (member: Session): unknown[] => member.snapshotEvents()
      .filter(event => event.type !== 'subagent/catalog')
      .map(event => ({ type: event.type, data: event.data }))
    const normalize = (value: unknown[]): unknown => JSON.parse(JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>').replace(/"(at|startedAt|endedAt|createdAt|timestamp)":\d+/g, '"$1":0'))
    expect(normalize(content(withSubagents.member))).toEqual(normalize(content(without.member)))
    expect(ofType(without.member, 'subagent/catalog')).toHaveLength(0)
    expect(ofType(withSubagents.member, 'subagent/catalog')).toHaveLength(1)
    // The catalog row lands inside the member's round, before its turn closes.
    const types = withSubagents.member.snapshotEvents().map(event => event.type)
    expect(types.indexOf('subagent/catalog')).toBeLessThan(types.lastIndexOf('turn/end'))

    const grandchild = withSubagents.ctx.sessions.get(SessionId(cliSubagentSessionId(MEMBER, 'aexec')))!
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call'], ['text']])
    const end = executions(grandchild).at(-1) as LocalAgentExecutionEndEvent
    expect(end).toMatchObject({ phase: 'end', outcome: 'done' })
    expectValidReleasedLog(grandchild)
    expectValidReleasedLog(withSubagents.member)
  })
})

function streamChild(stream: string): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push(stream)
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  return {
    pid: 4400,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: stream, nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: new Promise<{ exitCode: number; signal: null }>((resolve) => { setImmediate(() => { resolve({ exitCode: 0, signal: null }) }) }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}
