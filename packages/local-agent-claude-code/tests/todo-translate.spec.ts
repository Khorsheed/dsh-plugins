/**
 * Golden tests for the TodoWrite → todo/write translation adapter: the fold
 * intercepts TodoWrite tool_use blocks and the member child session carries
 * native todo/write whole-list snapshots (idempotent, multi-round-safe), while
 * every other tool keeps folding to a text line.
 */
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { fakeSessionPersistence } from './fake-persistence.ts'
import { tasksContributor } from '@khorsheed/dsh-local-agent/src/client/member-dock.ts'
import { parseClaudeStreamJson, startClaudeCliRun, todosFromTodoWrite } from '../src/claude-cli-provider.ts'

/** Claude's documented TodoWrite input shape. */
function todoWriteInput(todos: readonly { content: string; status: string; activeForm?: string }[]): object {
  return { todos: todos.map(todo => ({ activeForm: `${todo.content}中`, ...todo })) }
}

/** One assistant stream-json event carrying the given content blocks. */
function assistantEvent(blocks: unknown[]): string {
  return JSON.stringify({ type: 'assistant', message: { content: blocks } })
}

function todoWriteEvent(todos: readonly { content: string; status: string }[]): string {
  return assistantEvent([{ type: 'tool_use', id: 'tu1', name: 'TodoWrite', input: todoWriteInput(todos) }])
}

const V1 = [
  { content: '读代码', status: 'in_progress' },
  { content: '改实现', status: 'pending' },
  { content: '跑测试', status: 'pending' },
]
const V2 = [
  { content: '读代码', status: 'completed' },
  { content: '改实现', status: 'in_progress' },
  { content: '跑测试', status: 'pending' },
]

/** A full one-round stream: init, TodoWrite, a Bash call, a reply, result. */
function roundStream(todos: readonly { content: string; status: string }[] | undefined): string {
  return [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
    ...todos === undefined ? [] : [todoWriteEvent(todos)],
    assistantEvent([{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'pnpm test' } }]),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'ok' }] } }),
    assistantEvent([{ type: 'text', text: 'done' }]),
    JSON.stringify({ type: 'result', is_error: false, session_id: 's1', usage: { input_tokens: 5, output_tokens: 3 } }),
  ].join('\n')
}

describe('todosFromTodoWrite', () => {
  it('translates the documented shape, dropping activeForm', () => {
    expect(todosFromTodoWrite(todoWriteInput(V1))).toEqual([
      { content: '读代码', status: 'in_progress' },
      { content: '改实现', status: 'pending' },
      { content: '跑测试', status: 'pending' },
    ])
  })

  it('maps unknown statuses to pending and declines shape-skewed input', () => {
    expect(todosFromTodoWrite({ todos: [{ content: 'x', status: 'doing' }] }))
      .toEqual([{ content: 'x', status: 'pending' }])
    expect(todosFromTodoWrite({})).toBeUndefined()
    expect(todosFromTodoWrite({ todos: 'nope' })).toBeUndefined()
    expect(todosFromTodoWrite({ todos: [{ status: 'pending' }] })).toBeUndefined()
    expect(todosFromTodoWrite('garbage')).toBeUndefined()
  })
})

describe('TodoWrite interception in the fold', () => {
  it('golden: TodoWrite blocks become todo snapshots, never text lines', () => {
    const parsed = parseClaudeStreamJson(roundStream(V1))
    expect(parsed.todos).toEqual([
      { content: '读代码', status: 'in_progress' },
      { content: '改实现', status: 'pending' },
      { content: '跑测试', status: 'pending' },
    ])
    // The tool text fold carries Bash only; TodoWrite left no line.
    expect(parsed.lines).toEqual([
      { kind: 'tool', id: 'tu2', name: 'Bash', args: 'pnpm test', result: 'ok' },
      { kind: 'text', text: 'done' },
    ])
    expect(parsed.todoSkew).toBeUndefined()
  })

  it('last TodoWrite in the stream wins', () => {
    const parsed = parseClaudeStreamJson(roundStream(V1).replace('done', 'x') + '\n' + todoWriteEvent(V2))
    expect(parsed.todos?.[1]?.status).toBe('in_progress')
    expect(parsed.todos?.[0]?.status).toBe('completed')
  })

  it('shape-skewed TodoWrite degrades to the text fold and flags the skew', () => {
    const skewed = assistantEvent([{ type: 'tool_use', id: 'tu1', name: 'TodoWrite', input: { todos: 'nope' } }])
    const parsed = parseClaudeStreamJson(skewed)
    expect(parsed.todos).toBeUndefined()
    expect(parsed.todoSkew).toBe(true)
    expect(parsed.lines).toEqual([{ kind: 'tool', id: 'tu1', name: 'TodoWrite' }])
  })
})

/** A stub child emitting the given stream, exiting 0 on a later tick. */
function stubChild(stream: string): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push(stream + '\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  return {
    pid: 4242,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: new Promise<{ exitCode: number; signal: null }>((resolve) => {
      setImmediate(() => { resolve({ exitCode: 0, signal: null }) })
    }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

function fakeCtx(): { ctx: Context; warns: string[] } {
  const warns: string[] = []
  const ctx = new Context()
  ctx.provide('sessionPersistence', fakeSessionPersistence() as never)
  // cordis's logger is service-backed, not provide-overridable: capture warns
  // by wrapping the method (its exporter pipeline is async/buffered).
  const original = ctx.logger.warn.bind(ctx.logger)
  ctx.logger.warn = ((...args: unknown[]) => {
    warns.push(args.map(String).join(' '))
    original(...args as [])
  }) as typeof ctx.logger.warn
  return { ctx, warns }
}

function request(): SubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'plan' }],
    parent: { session: { header: { cwd: '/tmp' } } },
    signal: new AbortController().signal,
  } as unknown as SubagentStartRequest
}

/** Run one round over the child session and flush the settle mirror. */
async function runRound(
  child: Session,
  ctx: Context,
  stream: string,
  turn: number,
): Promise<void> {
  const run = await startClaudeCliRun(request(), {
    cwd: '/tmp',
    env: {},
    permissionMode: 'skip',
    disposeGraceMs: 3_000,
    spawn: () => stubChild(stream),
    childSession: child,
    ctx,
    ...turn > 1 ? { resume: { cliSessionId: 's1', turn } } : {},
  })
  await run.result
  // The settle mirror rides child.done behind the result; wait for it.
  await vi.waitFor(() => {
    expect(child.snapshotEvents().some(event => event.type === 'turn/end')).toBe(true)
  })
  await vi.waitFor(async () => {
    // Flush the post-exit mirror (turn/end + one tick of the mirror queue).
    await new Promise(resolve => setImmediate(resolve))
  })
}

describe('todo/write mirroring into the member child session', () => {
  it('appends one snapshot per distinct TodoWrite state, live+settle idempotent', async () => {
    const child = Session.create(SessionId('child-todo'))
    const { ctx } = fakeCtx()
    await runRound(child, ctx, roundStream(V1), 1)

    const writes = child.snapshotEvents().filter(event => event.type === 'todo/write')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.data).toEqual({
      todos: [
        { content: '读代码', status: 'in_progress' },
        { content: '改实现', status: 'pending' },
        { content: '跑测试', status: 'pending' },
      ],
    })
    // The transcript still carries the task, the Bash fold (as a native
    // tool/call + tool/result pair), and the reply.
    expect(child.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)
    const calls = child.snapshotEvents().filter(event => event.type === 'tool/call')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.data).toMatchObject({ name: 'Bash', arguments: 'pnpm test' })
    expect(JSON.stringify(child.snapshotEvents())).not.toContain('TodoWrite')
  })

  it('multi-round: round 2 TodoWrite replaces the list; an unchanged list re-appends nothing', async () => {
    const child = Session.create(SessionId('child-todo-2'))
    const { ctx } = fakeCtx()
    await runRound(child, ctx, roundStream(V1), 1)
    await runRound(child, ctx, roundStream(V2), 2)

    const writes = child.snapshotEvents().filter(event => event.type === 'todo/write')
    expect(writes).toHaveLength(2)
    expect((writes[1]?.data as { todos: { status: string }[] }).todos[0]?.status).toBe('completed')

    // Round 3 emits the SAME list: the standing snapshot is identical, so
    // nothing crosses.
    await runRound(child, ctx, roundStream(V2), 3)
    expect(child.snapshotEvents().filter(event => event.type === 'todo/write')).toHaveLength(2)
  })

  it('a round without TodoWrite leaves the earlier list standing', async () => {
    const child = Session.create(SessionId('child-todo-3'))
    const { ctx } = fakeCtx()
    await runRound(child, ctx, roundStream(V1), 1)
    await runRound(child, ctx, roundStream(undefined), 2)
    expect(child.snapshotEvents().filter(event => event.type === 'todo/write')).toHaveLength(1)
  })

  it('a shape-skewed TodoWrite folds to text and warns', async () => {
    const child = Session.create(SessionId('child-todo-4'))
    const { ctx, warns } = fakeCtx()
    const skewed = assistantEvent([{ type: 'tool_use', id: 'tu1', name: 'TodoWrite', input: { todos: 'nope' } }])
    await runRound(child, ctx, `${skewed}\n${roundStream(undefined)}`, 1)

    expect(child.snapshotEvents().filter(event => event.type === 'todo/write')).toHaveLength(0)
    const skewedCalls = child.snapshotEvents().filter(event => event.type === 'tool/call')
    expect(skewedCalls.some(event => (event.data as { name: string }).name === 'TodoWrite')).toBe(true)
    expect(warns.some(text => text.includes('TodoWrite'))).toBe(true)
  })
})

describe('the translated state feeds the member dock tasks row', () => {
  it('chain-level: TodoWrite input → dock line', () => {
    // Minimal locale stub for the two task templates.
    const t = (key: string, params?: Record<string, string | number>): string =>
      key === 'member.tasks.summary' ? `任务 ${params?.done}/${params?.total}`
        : key === 'member.tasks.active' ? ` · 进行中：${params?.title}`
          : key
    const todos = todosFromTodoWrite(todoWriteInput(V1))
    expect(todos).toBeDefined()
    expect(tasksContributor({ todos }, t as never)).toEqual({
      id: 'tasks',
      text: '任务 0/3 · 进行中：读代码',
    })
  })
})
