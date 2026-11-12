import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { appendPluginRecord, SessionId } from '@deepseek-ai/dsh-session'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { BashWriteCollector, BASH_WRITE_RECORD, readBashWrites } from '../src/bash-writes.ts'
import { FilePreviewService } from '../src/index.ts'

const contexts: Context[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

function fs(existing: readonly string[]): FileSystem {
  return {
    resolve: vi.fn(async (path: string) => ({ displayPath: path })),
    stat: vi.fn(async (target: { displayPath: string }) => existing.includes(target.displayPath) ? { version: 'v1', type: 'file' as const } : undefined),
  } as unknown as FileSystem
}

function appendWrite(session: ReturnType<Context['sessions']['create']>, id: string, command: string, error = false): void {
  const callId = ToolCallId(id)
  const args = JSON.stringify({ command })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: args }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
    stream: [],
  }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: args })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text: error ? 'failed' : 'ok' }], isError: error }),
  }, { surfaceOp: 'append' })
}

async function fixture(root?: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  if (root !== undefined) await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const session = ctx.sessions.create(SessionId('bash-write-session'))
  const handle = root === undefined ? undefined : await ctx.sessionPersistence.create(session.header)
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  return { ctx, session, handle }
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('durable bash writes', () => {
  it('records only stat-verified files and reads them without a memory registry', async () => {
    const { ctx, session } = await fixture()
    const stat = vi.fn(async (target: { displayPath: string }) => target.displayPath === '/work/a.html' ? { version: 'v1', type: 'file' as const } : undefined)
    const collector = new BashWriteCollector({ fs: { resolve: async (path: string) => ({ displayPath: path }), stat } as unknown as FileSystem, env: {}, home: '/h' })
    collector.attach(ctx)
    appendWrite(session, 'call-a', 'cat > /work/a.html')
    appendWrite(session, 'call-b', 'echo no > /work/b.html')
    await settle()
    expect([...readBashWrites(session.snapshotEvents())!.keys()]).toEqual(['/work/a.html'])
    expect((await collector.captured(session))?.get('/work/a.html')).toEqual({ turn: 1, step: 1, seq: 3 })
    expect(stat).toHaveBeenCalledTimes(2)
    expect(session.snapshotEvents().filter(event => event.type === BASH_WRITE_RECORD).every(event => event.ignorable === true)).toBe(true)
  })

  it('survives a real JSONL restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'file-preview-bash-jsonl-'))
    dirs.push(root)
    const { ctx, session, handle } = await fixture(root)
    const collector = new BashWriteCollector({ fs: fs(['/work/a.html']), env: {}, home: '/h' })
    collector.attach(ctx)
    appendWrite(session, 'call-a', 'cat > /work/a.html')
    await settle()
    await ctx.sessions.flush(session)
    await handle!.close()
    await ctx.fiber.dispose()

    const reopened = new Context()
    contexts.push(reopened)
    await reopened.plugin(SessionStore)
    await reopened.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const reader = await reopened.sessionPersistence.open(session.id, 'read')
    const events = (await reader.read(0)).events
    await reader.close()
    expect(readBashWrites(events)?.get('/work/a.html')).toEqual({ turn: 1, step: 1, seq: 3 })
    await reopened.fiber.dispose()
  })

  it('serves durable records through list and turnFiles', async () => {
    const { ctx, session } = await fixture()
    Object.assign(ctx, { fs: fs(['/work/a.html']) })
    const service = new FilePreviewService(ctx)
    appendWrite(session, 'call-a', 'cat > /work/a.html')
    await settle()
    const list = await service.list(session.id)
    expect(list.entries.map(entry => entry.path)).toContain('/work/a.html')
    const turns = await service.turnFiles(session.id)
    expect(turns.turns.flatMap(group => group.files.map(file => file.path))).toContain('/work/a.html')
  })

  it('replays legacy events only when no durable record exists', async () => {
    const { session } = await fixture()
    const collector = new BashWriteCollector({ fs: fs(['/work/legacy.html']), env: {}, home: '/h' })
    appendWrite(session, 'legacy-call', 'cat > /work/legacy.html')
    expect(session.snapshotEvents().some(event => event.type === BASH_WRITE_RECORD)).toBe(false)
    expect((await collector.captured(session))?.get('/work/legacy.html')).toEqual({ turn: 1, step: 1, seq: 3 })
  })

  it('rejects malformed records without inventing files', async () => {
    const { session } = await fixture()
    appendPluginRecord(session, BASH_WRITE_RECORD, { version: 1, path: '', turn: 1, step: 1, seq: 1 })
    appendPluginRecord(session, BASH_WRITE_RECORD, { version: 1, path: '/work/bad.html', turn: -1, step: 1, seq: 1 })
    expect(readBashWrites(session.snapshotEvents())).toBeUndefined()
  })
})
