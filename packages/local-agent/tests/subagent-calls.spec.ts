/**
 * The read side of a member CLI's own subagents (member-cli-subagents M5):
 * grandchild logs written by the real CLI-subagent writer (`openCliSubagent`
 * and the shared mirror writer) fold into one call per grandchild execution —
 * its state, usage, ordinal and ordered steps — and the member's catalog
 * rows name the grandchildren. No provider, no registry: the writer degrades
 * to the bare sessions service, which is all the read needs.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { openCliSubagent } from '../src/cli-subagent.ts'
import { grandchildIdsOf, subagentCallsOf, SUBAGENT_STEP_LIMIT, toolArgumentSummary } from '../src/subagent-calls.ts'

const SOURCE = { provider: 'fake-cli', model: 'sub-model' }
const usage = (inputTokens: number, outputTokens: number, cacheReadTokens?: number): TokenUsage =>
  ({ inputTokens, outputTokens, ...cacheReadTokens === undefined ? {} : { cacheReadTokens } } as TokenUsage)

async function member(): Promise<{ ctx: Context; member: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('child-1'), { meta: { cwd: '/home/user/work', parentSession: SessionId('room-1'), origin: 'subagent', delegationDepth: 1 } } as never)
  return { ctx, member: session }
}

const read = (m: Session, sessions: Context['sessions']) => subagentCallsOf(grandchildIdsOf(String(m.id), m.snapshotEvents())
  .map(sessionId => ({ sessionId, events: sessions.get(SessionId(sessionId))!.snapshotEvents() })))

describe('memberSubagentCalls: the grandchild fold', () => {
  it('one call: state, usage, ordered steps (request, tool, reply), the label split into type and description', async () => {
    const { ctx, member: m } = await member()
    const handle = await openCliSubagent(ctx, m, { provider: 'fake-cli', key: 'agent-0', name: 'explore', description: '查找可剪的停顿' })
    const execution = handle.beginExecution({ callId: 'call-1', admittedAt: 1_000 })
    execution.mirror({
      blocks: [
        { kind: 'think', text: '决定先列出素材文件\n第二行', generation: { startedAt: 1_000, endedAt: 13_000 } },
        { kind: 'tool', id: 't1', name: 'Glob', args: '{"pattern":"projects/**/*.json"}', result: '6 files', timing: { startedAt: 13_000, endedAt: 13_200, source: 'provider' } },
      ],
      usage: usage(100, 20, 1_000),
    }, SOURCE)
    expect(read(m, ctx.sessions)).toMatchObject([{ callId: 'call-1', state: 'running', ordinal: 1, turn: 1, name: 'explore', description: '查找可剪的停顿' }])
    execution.mirror({ blocks: [{ kind: 'think', text: '整理' }, { kind: 'text', text: '共找到 14 处停顿' }], usage: usage(200, 40) }, SOURCE)
    execution.end('done', { endedAt: 60_000 })
    const [only] = read(m, ctx.sessions)
    expect(only).toEqual({
      callId: 'call-1',
      sessionId: 'child-1.sub.agent-0',
      executionId: execution.executionId,
      name: 'explore',
      description: '查找可剪的停顿',
      ordinal: 1,
      turn: 1,
      state: 'done',
      startedAt: 1_000,
      endedAt: 60_000,
      usage: { inputTokens: 300, outputTokens: 60, cacheReadTokens: 1_000 },
      steps: [
        { kind: 'request', index: 1, text: '决定先列出素材文件', durationMs: 12_000 },
        { kind: 'tool', name: 'Glob', summary: 'projects/**/*.json', durationMs: 200 },
        { kind: 'request', index: 2, text: '整理' },
        { kind: 'reply', text: '共找到 14 处停顿' },
      ],
    })
  })

  it('a resumed subagent: one session, a second call with ordinal 2; outcomes map to the card states', async () => {
    const { ctx, member: m } = await member()
    const identity = { provider: 'fake-cli', key: 'agent-0', name: 'explore', description: '查找' }
    const first = (await openCliSubagent(ctx, m, identity)).beginExecution({ callId: 'call-1' })
    first.mirror({ blocks: [{ kind: 'text', text: 'a' }] }, SOURCE)
    first.end('cancelled')
    const second = (await openCliSubagent(ctx, m, identity)).beginExecution({ callId: 'call-2', resumed: true })
    second.mirror({ blocks: [{ kind: 'text', text: 'b' }] }, SOURCE)
    second.end('uncertain')
    const calls = read(m, ctx.sessions)
    expect(calls.map(c => [c.callId, c.ordinal, c.state, c.turn, c.sessionId])).toEqual([
      ['call-1', 1, 'cancelled', 1, 'child-1.sub.agent-0'],
      ['call-2', 2, 'lost', 2, 'child-1.sub.agent-0'],
    ])
    // A cut-off call's last text is not a reply handed back.
    expect(calls[0]!.steps).toEqual([{ kind: 'request', index: 1, text: 'a' }])
  })

  it('a swarm: one entry per subagent with its group place and background flag', async () => {
    const { ctx, member: m } = await member()
    for (const index of [0, 1, 2]) {
      const handle = await openCliSubagent(ctx, m, { provider: 'fake-cli', key: `agent-${index}`, name: 'coder', description: `片段 ${index + 1}` })
      handle.beginExecution({ callId: 'call-swarm', group: { index, size: 3 }, background: index === 2 })
    }
    const calls = read(m, ctx.sessions)
    expect(calls.map(c => [c.callId, c.group, c.background, c.description])).toEqual([
      ['call-swarm', { index: 0, size: 3 }, undefined, '片段 1'],
      ['call-swarm', { index: 1, size: 3 }, undefined, '片段 2'],
      ['call-swarm', { index: 2, size: 3 }, true, '片段 3'],
    ])
    expect(calls.every(c => c.state === 'running' && c.steps.length === 0 && c.usage === undefined)).toBe(true)
  })

  it('keeps the latest steps past the limit and says how many were left out', async () => {
    const { ctx, member: m } = await member()
    const execution = (await openCliSubagent(ctx, m, { provider: 'fake-cli', key: 'agent-0' })).beginExecution({ callId: 'call-1' })
    for (let index = 0; index < SUBAGENT_STEP_LIMIT; index += 1) {
      execution.mirror({ blocks: [{ kind: 'tool', id: `t${index}`, name: 'Read', args: `{"file_path":"f${index}"}`, result: 'x' }] }, SOURCE)
    }
    const [only] = read(m, ctx.sessions)
    expect(only!.steps).toHaveLength(SUBAGENT_STEP_LIMIT)
    expect(only!.stepsOmitted).toBe(SUBAGENT_STEP_LIMIT)
    expect(only!.steps.at(-1)).toEqual({ kind: 'tool', name: 'Read', summary: `f${SUBAGENT_STEP_LIMIT - 1}` })
    expect(only!.name).toBeUndefined()
  })

  it('names only the grandchildren the writer derives from this member', async () => {
    const { ctx, member: m } = await member()
    m.append('subagent/catalog', { version: 0, childId: SessionId('elsewhere'), childCreatedAt: 0, mode: 'one-shot' } as never)
    await openCliSubagent(ctx, m, { provider: 'fake-cli', key: 'agent-0' })
    expect(grandchildIdsOf('child-1', m.snapshotEvents())).toEqual(['child-1.sub.agent-0'])
    expect(read(m, ctx.sessions)).toEqual([])
  })

  it('summarizes a tool call by the argument a reader recognizes', () => {
    expect(toolArgumentSummary('{"file_path":"/a/b.ts","limit":3}')).toBe('/a/b.ts')
    expect(toolArgumentSummary('{"command":"pnpm test\\nmore"}')).toBe('pnpm test')
    expect(toolArgumentSummary('{"x":1}')).toBeUndefined()
    expect(toolArgumentSummary('ls -la')).toBe('ls -la')
  })
})
