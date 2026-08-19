import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { BashWriteCollector } from '../src/bash-writes.ts'
import { FilePreviewService } from '@khorsheed/dsh-file-preview'

/** A minimal session double carrying only the fields the collector reads. */
function fakeSession(id: string, cwd: string | undefined, events: readonly SessionEvent[] = []): Session {
  return { id, header: { cwd }, events } as unknown as Session
}

function toolCall(callId: string, command: string, seq: number, turn = 1, step = 1): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    time: 0,
    data: { turn, step, callId, name: 'bash', arguments: JSON.stringify({ command }) },
  } as unknown as SessionEvent
}

function toolResult(callId: string, seq: number): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    time: 0,
    data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId } } },
  } as unknown as SessionEvent
}

/** A fs double: resolve returns a displayPath target; stat answers for the set. */
function makeFs(existing: readonly string[]): FileSystem {
  return {
    resolve: vi.fn(async (path: string) => ({ displayPath: path })),
    stat: vi.fn(async (target: { displayPath: string }) => (
      existing.includes(target.displayPath)
        ? { version: 'v1', type: 'file' as const }
        : undefined
    )),
  } as unknown as FileSystem
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('BashWriteCollector', () => {
  it('captures a bash-written file once its result settles', async () => {
    const ctx = new Context()
    const collector = new BashWriteCollector({ fs: makeFs(['/tmp/x.html']), env: {}, home: '/h' })
    collector.attach(ctx)
    const session = fakeSession('s1', '/work')
    ctx.emit('session/event', session, toolCall('c1', 'cat > /tmp/x.html <<\'EOF\'\nhi\nEOF\n', 1))
    ctx.emit('session/event', session, toolResult('c1', 2))
    await flush()
    const captured = collector.captured('s1')
    expect(captured?.get('/tmp/x.html')).toEqual({ turn: 1, step: 1, seq: 1 })
  })

  it('drops candidates that do not exist (prefer a miss over a false positive)', async () => {
    const ctx = new Context()
    const collector = new BashWriteCollector({ fs: makeFs([]), env: {}, home: '/h' })
    collector.attach(ctx)
    const session = fakeSession('s1', '/work')
    ctx.emit('session/event', session, toolCall('c1', 'echo hi > /tmp/gone.html', 1))
    ctx.emit('session/event', session, toolResult('c1', 2))
    await flush()
    expect(collector.captured('s1')?.size).toBeUndefined()
  })

  it('ignores non-bash calls', async () => {
    const ctx = new Context()
    const collector = new BashWriteCollector({ fs: makeFs(['/work/a.md']), env: {}, home: '/h' })
    collector.attach(ctx)
    const session = fakeSession('s1', '/work')
    const write = {
      type: 'tool/call', seq: 1, time: 0,
      data: { turn: 1, step: 1, callId: 'w1', name: 'write', arguments: JSON.stringify({ file_path: '/work/a.md', content: 'x' }) },
    } as unknown as SessionEvent
    ctx.emit('session/event', session, write)
    ctx.emit('session/event', session, toolResult('w1', 2))
    await flush()
    expect(collector.captured('s1')).toBeUndefined()
  })

  it('replays the session history on session/created (host restart recovery)', async () => {
    const ctx = new Context()
    const collector = new BashWriteCollector({ fs: makeFs(['/tmp/x.html']), env: {}, home: '/h' })
    collector.attach(ctx)
    const session = fakeSession('s1', '/work', [
      toolCall('c1', 'cat > /tmp/x.html', 1),
      toolResult('c1', 2),
    ])
    ctx.emit('session/created', session)
    await flush()
    expect(collector.captured('s1')?.get('/tmp/x.html')).toEqual({ turn: 1, step: 1, seq: 1 })
  })

  it('disposes its listeners', async () => {
    const ctx = new Context()
    const collector = new BashWriteCollector({ fs: makeFs(['/tmp/x.html']), env: {}, home: '/h' })
    const dispose = collector.attach(ctx)
    const session = fakeSession('s1', '/work')
    dispose()
    ctx.emit('session/event', session, toolCall('c1', 'cat > /tmp/x.html', 1))
    ctx.emit('session/event', session, toolResult('c1', 2))
    await flush()
    expect(collector.captured('s1')).toBeUndefined()
  })
})

describe('FilePreviewService.list with the collector', () => {
  it('merges verified bash writes into the fold entries', async () => {
    const ctx = new Context()
    Object.assign(ctx, { fs: makeFs(['/tmp/whale.html']) })
    const service = new FilePreviewService(ctx)
    const session = fakeSession('s1', '/work')
    ctx.emit('session/event', session, toolCall('c1', 'cat > /tmp/whale.html', 1))
    ctx.emit('session/event', session, toolResult('c1', 2))
    await flush()
    const list = service.list({ session } as unknown as Agent)
    expect(list.entries.map(entry => entry.path)).toContain('/tmp/whale.html')
    const entry = list.entries.find(e => e.path === '/tmp/whale.html')
    expect(entry).toMatchObject({ op: 'write', turn: 1, step: 1, diffs: [] })
  })

  it('does not collect when captureBashWrites is disabled', async () => {
    const ctx = new Context()
    Object.assign(ctx, { fs: makeFs(['/tmp/whale.html']) })
    const service = new FilePreviewService(ctx, { captureBashWrites: false })
    const session = fakeSession('s1', '/work')
    ctx.emit('session/event', session, toolCall('c1', 'cat > /tmp/whale.html', 1))
    ctx.emit('session/event', session, toolResult('c1', 2))
    await flush()
    const list = service.list({ session } as unknown as Agent)
    expect(list.entries).toEqual([])
  })
})

describe('FilePreviewService.turnFiles', () => {
  it('returns per-turn groups with exact turn attribution and captured merge', async () => {
    const ctx = new Context()
    Object.assign(ctx, { fs: makeFs(['/tmp/bash.html']) })
    const service = new FilePreviewService(ctx)
    const write2 = {
      type: 'tool/call', seq: 1, time: 0,
      data: { turn: 2, step: 1, callId: 'w2', name: 'write', arguments: JSON.stringify({ file_path: '/work/a.md', content: 'x' }) },
    } as unknown as SessionEvent
    const edit5 = {
      type: 'tool/call', seq: 2, time: 0,
      data: { turn: 5, step: 1, callId: 'w5', name: 'edit', arguments: JSON.stringify({ file_path: '/work/a.md', new_string: 'y', old_string: 'x' }) },
    } as unknown as SessionEvent
    // write/edit live in the session history (the fold's source); the bash
    // call/result flow through the event firehose to the collector.
    const session = fakeSession('s1', '/work', [write2, edit5])
    ctx.emit('session/event', session, toolCall('b1', 'cat > /tmp/bash.html', 3, 5))
    ctx.emit('session/event', session, toolResult('b1', 4))
    await flush()
    const map = service.turnFiles({ session } as unknown as Agent)
    const turn2 = map.turns.find(group => group.turn === 2)
    const turn5 = map.turns.find(group => group.turn === 5)
    // Exact attribution: turn 2 has the write, turn 5 has the edit AND the bash capture.
    expect(turn2?.files.map(file => file.path)).toEqual(['/work/a.md'])
    expect(turn5?.files.map(file => file.path).sort()).toEqual(['/tmp/bash.html', '/work/a.md'])
  })
})
