import { readFileSync } from 'node:fs'
import { attach, provideAttachedSessions } from './attached-sessions.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { normalize } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { createToolResultMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { FilePreviewService, createFilePreviewReadSurface } from '@khorsheed/dsh-file-preview'

/** The UTF-8 bytes of `text`, as a backend's raw read primitives return them. */
function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Build one tool/call event with JSON-serialized arguments. */
function toolCall(seq: number, name: string, args: unknown, turn = 1, step = 1): SessionEvent<'tool/call'> {
  return {
    seq,
    time: seq,
    type: 'tool/call',
    data: { turn, step, callId: `call-${seq}` as ToolCallId, name, arguments: JSON.stringify(args) },
  }
}

/** Build one tool/result event; `meta` is the tool-private presentation meta. */
function toolResult(seq: number, callSeq: number, meta: JsonValue, turn = 1, step = 2): SessionEvent<'tool/result'> {
  return {
    seq,
    time: seq,
    type: 'tool/result',
    data: {
      turn,
      step,
      message: createToolResultMessage({ callId: `call-${callSeq}` as ToolCallId, content: [{ type: 'text', text: 'ok' }], isError: false }),
      meta,
    },
  }
}

/**
 * A fs double rooted at `/work` with real containment: display paths resolve
 * against the anchor, normalization folds `..`, and anything escaping the
 * root rejects — the same contract the host backend enforces for the live
 * path, so both consumers inherit the same traversal behavior. `files` maps
 * anchored absolute paths to their text content; anything else stats absent.
 */
function makeContainedFs(files: Readonly<Record<string, string>>, root = '/work') {
  const resolve = vi.fn(async (path: string, opts?: { cwd?: string }) => {
    const anchored = path.startsWith('/') ? path : `${opts?.cwd ?? root}/${path}`
    const normalized = normalize(anchored)
    if (normalized !== root && !normalized.startsWith(`${root}/`)) {
      throw new Error(`path escapes the sandbox root: ${path}`)
    }
    return { displayPath: normalized }
  })
  const stat = vi.fn(async (target: { displayPath: string }) => {
    const content = files[target.displayPath]
    return content === undefined
      ? undefined
      : { version: 'v1', type: 'file' as const, size: bytesOf(content).length }
  })
  const readByteRange = vi.fn(async (target: { displayPath: string }, range: { offset: number; length: number }) => {
    const bytes = bytesOf(files[target.displayPath] ?? '')
    return bytes.subarray(range.offset, range.offset + range.length)
  })
  const readBytes = vi.fn(async (target: { displayPath: string }, _signal: unknown, maxBytes: number) => {
    return bytesOf(files[target.displayPath] ?? '').subarray(0, maxBytes)
  })
  const fs = { resolve, stat, readByteRange, readBytes } as unknown as FileSystem
  return { fs, resolve, stat, readByteRange, readBytes }
}

/** The fixture session's events: writes, an edit with a presentation diff, a
 * read, two bash redirect writes in one command, and a write whose file was
 * deleted since (history, not a product). */
function fixtureEvents(): SessionEvent[] {
  return [
    toolCall(1, 'write', { file_path: 'notes.md', content: 'hello\nworld\n' }, 1, 1),
    toolResult(2, 1, { diffs: [] }, 1, 2),
    toolCall(3, 'bash', { command: 'echo a > /work/bash-a.txt; echo b > /work/bash-b.txt' }, 1, 3),
    toolResult(4, 3, undefined, 1, 4),
    toolCall(5, 'read', { file_path: 'notes.md' }, 2, 1),
    toolResult(6, 5, undefined, 2, 2),
    toolCall(7, 'edit', { file_path: 'notes.md', old_string: 'world', new_string: 'brave world' }, 2, 3),
    toolResult(8, 7, { diffs: [{ path: 'notes.md', oldText: 'hello\nworld\n', newText: 'hello\nbrave world\n' }] }, 2, 4),
    toolCall(9, 'write', { file_path: 'src/a.ts', content: 'const a = 1\n' }, 2, 5),
    toolResult(10, 9, { diffs: [] }, 2, 6),
    toolCall(11, 'write', { file_path: 'deleted.txt', content: 'gone\n' }, 3, 1),
    toolResult(12, 11, { diffs: [] }, 3, 2),
  ]
}

/** The fixture disk: everything the log wrote except `deleted.txt`. */
const FIXTURE_FILES: Readonly<Record<string, string>> = {
  '/work/notes.md': 'hello\nbrave world\n',
  '/work/bash-a.txt': 'a\n',
  '/work/bash-b.txt': 'b\n',
  '/work/src/a.ts': 'const a = 1\n',
  '/work/big.txt': 'x'.repeat(600 * 1024),
  '/work/blob.pdf': '%PDF-1.7 fake',
  '/work/nul.txt': 'a\u0000b',
  '/work/page.html': '<script>alert(1)</script><p>hi</p>',
  '/work/shot.png': 'fake-png-bytes',
}

/** A loose session double carrying only the fields the service reads. */
function fakeSession(id: string, cwd: string | undefined, events: readonly SessionEvent[]): Session {
  return { id, header: { cwd }, snapshotEvents: () => events } as unknown as Session
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** Drive the live Remote path over the fixture session: the service's
 * collector replays the log on session/created exactly as on a host restart. */
async function makeServiceSide(fs: FileSystem, events: readonly SessionEvent[]) {
  const ctx = new Context()
  provideAttachedSessions(ctx)
  Object.assign(ctx, { fs })
  const service = new FilePreviewService(ctx, { maxReadBytes: 64 })
  const session = fakeSession('s1', '/work', events)
  ctx.emit('session/created', session)
  await flush()
  const agent = attach(session)
  return { service, agent }
}

describe('createFilePreviewReadSurface — parity with the live path', () => {
  it('list and turnFiles are byte-identical to the Remote verbs over the same session', async () => {
    const events = fixtureEvents()
    const { fs } = makeContainedFs(FIXTURE_FILES)
    const { service, agent } = await makeServiceSide(fs, events)
    const surface = createFilePreviewReadSurface({ events: () => events, cwd: '/work', fs, maxReadBytes: 64 })

    const [serviceList, surfaceList] = [await service.list(agent), await surface.list()]
    expect(surfaceList).toEqual(serviceList)
    // The merge is pinned concretely too, not only by mutual agreement: the
    // two bash-redirect writes joined the fold, the deleted file fell out.
    expect(surfaceList.entries.map(entry => entry.path)).toEqual([
      'notes.md', 'src/a.ts', '/work/bash-a.txt', '/work/bash-b.txt',
    ])
    expect(surfaceList.asOfSeq).toBe(12)

    const [serviceTurns, surfaceTurns] = [await service.turnFiles(agent), await surface.turnFiles()]
    expect(surfaceTurns).toEqual(serviceTurns)
    expect(surfaceTurns.turns.map(group => group.turn)).toEqual([1, 2])
    const turn1 = surfaceTurns.turns[0]
    expect(turn1?.files.map(file => file.path)).toEqual(['notes.md', '/work/bash-a.txt', '/work/bash-b.txt'])
  })

  it('read is byte-identical to the Remote read across every outcome kind', async () => {
    const events = fixtureEvents()
    const { fs } = makeContainedFs(FIXTURE_FILES)
    const { service, agent } = await makeServiceSide(fs, events)
    const surface = createFilePreviewReadSurface({ events: () => events, cwd: '/work', fs, maxReadBytes: 64 })
    const signal = new AbortController().signal

    for (const path of ['notes.md', 'page.html', 'blob.pdf', 'nul.txt', 'big.txt', 'deleted.txt', 'gone.md', 'shot.png', '']) {
      const viaService = await service.read(agent, path, signal)
      const viaSurface = await surface.read(path, signal)
      expect(viaSurface).toEqual(viaService)
    }
    // Spot-check the classified kinds the loop asserted pairwise.
    expect((await surface.read('notes.md', signal)).kind).toBe('text')
    expect((await surface.read('page.html', signal)).htmlScripted).toBe(true)
    expect((await surface.read('big.txt', signal)).kind).toBe('too-large')
    expect((await surface.read('deleted.txt', signal)).kind).toBe('missing')
    // No issuer on either side: the image degrades to `binary`, exactly as
    // headless does, and never points at the legacy image route.
    const image = await surface.read('shot.png', signal)
    expect(image.kind).toBe('binary')
    expect(JSON.stringify(image)).not.toContain('/file-preview-image')
  })

  it('applies the same path containment as the live path (escape attempts classify alike)', async () => {
    const events = fixtureEvents()
    const { fs } = makeContainedFs(FIXTURE_FILES)
    const { service, agent } = await makeServiceSide(fs, events)
    const surface = createFilePreviewReadSurface({ events: () => events, cwd: '/work', fs, maxReadBytes: 64 })
    const signal = new AbortController().signal

    for (const path of ['../escape.txt', '../../etc/passwd', 'src/../../../escape.txt']) {
      const viaService = await service.read(agent, path, signal)
      const viaSurface = await surface.read(path, signal)
      expect(viaSurface).toEqual(viaService)
      expect(viaSurface.kind).toBe('error')
      expect(viaSurface.message).toContain('escapes the sandbox root')
    }
    // An escape attempt recorded in the log is not a product: the existence
    // probe treats it as absent and the list drops it.
    const escapeEvents = [
      ...events,
      toolCall(13, 'write', { file_path: '../escape.txt', content: 'x\n' }, 4, 1),
      toolResult(14, 13, { diffs: [] }, 4, 2),
    ]
    const ctx = new Context()
    provideAttachedSessions(ctx)
    Object.assign(ctx, { fs })
    const service2 = new FilePreviewService(ctx, { maxReadBytes: 64 })
    const session2 = fakeSession('s2', '/work', escapeEvents)
    ctx.emit('session/created', session2)
    await flush()
    const surface2 = createFilePreviewReadSurface({ events: () => escapeEvents, cwd: '/work', fs, maxReadBytes: 64 })
    const surfaceList = await surface2.list()
    expect(surfaceList).toEqual(await service2.list(attach(session2)))
    expect(surfaceList.entries.some(entry => entry.path === '../escape.txt')).toBe(false)
    expect((await surface2.turnFiles()).turns.some(group => group.files.some(file => file.path === '../escape.txt'))).toBe(false)
  })

  it('re-derives from the reader when the log grows (watermark invalidation)', async () => {
    const events = fixtureEvents()
    const files: Record<string, string> = { ...FIXTURE_FILES }
    const { fs } = makeContainedFs(files)
    const surface = createFilePreviewReadSurface({ events: () => events, cwd: '/work', fs, maxReadBytes: 64 })
    const before = await surface.list()
    expect(before.asOfSeq).toBe(12)
    events.push(
      toolCall(13, 'write', { file_path: 'src/b.ts', content: 'const b = 2\n' }, 4, 1),
      toolResult(14, 13, { diffs: [] }, 4, 2),
    )
    files['/work/src/b.ts'] = 'const b = 2\n'
    const after = await surface.list()
    expect(after.asOfSeq).toBe(14)
    expect(after.entries.map(entry => entry.path)).toContain('src/b.ts')
  })
})

describe('createFilePreviewReadSurface — images', () => {
  const events = fixtureEvents()

  it('carries the injected issuer address in the existing url field', async () => {
    const { fs } = makeContainedFs(FIXTURE_FILES)
    const surface = createFilePreviewReadSurface({
      events: () => events,
      cwd: '/work',
      fs,
      imageUrl: path => `/authorized-images/${encodeURIComponent(path)}`,
    })
    const result = await surface.read('shot.png')
    expect(result).toEqual({
      path: 'shot.png',
      kind: 'image',
      url: '/authorized-images/shot.png',
      size: bytesOf('fake-png-bytes').length,
    })
  })

  it('degrades the one read to binary when the issuer returns undefined for it', async () => {
    const { fs } = makeContainedFs(FIXTURE_FILES)
    const surface = createFilePreviewReadSurface({
      events: () => events,
      cwd: '/work',
      fs,
      imageUrl: path => (path === 'shot.png' ? undefined : `/authorized-images/${encodeURIComponent(path)}`),
    })
    const result = await surface.read('shot.png')
    expect(result.kind).toBe('binary')
    expect(result.url).toBeUndefined()
  })

  it('reads image bytes through the authorized byte read, with containment and caps', async () => {
    const { fs } = makeContainedFs(FIXTURE_FILES)
    const surface = createFilePreviewReadSurface({ events: () => events, cwd: '/work', fs, maxReadBytes: 64 })
    const ok = await surface.readImageBytes('shot.png')
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.mime).toBe('image/png')
      expect(new TextDecoder().decode(ok.bytes)).toBe('fake-png-bytes')
      expect(ok.size).toBe(bytesOf('fake-png-bytes').length)
    }
    // Images have their own cap: past the text cap they still serve; past
    // the image cap they stat over and never read.
    const bigFs = makeContainedFs({ ...FIXTURE_FILES, '/work/big.png': 'x'.repeat(1024) })
    const roomy = createFilePreviewReadSurface({ events: () => events, cwd: '/work', fs: bigFs.fs, maxReadBytes: 64 })
    expect((await roomy.readImageBytes('big.png')).ok).toBe(true)
    const tight = makeContainedFs({ ...FIXTURE_FILES, '/work/big.png': 'x'.repeat(1024) })
    const bigSurface = createFilePreviewReadSurface({ events: () => events, cwd: '/work', fs: tight.fs, maxReadBytes: 64, imageMaxReadBytes: 512 })
    const tooLarge = await bigSurface.readImageBytes('big.png')
    expect(tooLarge).toEqual({ path: 'big.png', ok: false, reason: 'too-large', size: 1024 })
    expect(tight.readBytes).not.toHaveBeenCalled()
    // Containment is the same resolve's: an escape rejects into `error`.
    const escape = await surface.readImageBytes('../escape.png')
    expect(escape.ok).toBe(false)
    if (!escape.ok) expect(escape.message).toContain('escapes the sandbox root')
  })

  it('classifies the byte-read failures (not-image, missing, error)', async () => {
    const { fs } = makeContainedFs(FIXTURE_FILES)
    const surface = createFilePreviewReadSurface({ events: () => events, cwd: '/work', fs })
    expect(await surface.readImageBytes('notes.md')).toEqual({ path: 'notes.md', ok: false, reason: 'not-image' })
    expect(await surface.readImageBytes('gone.png')).toEqual({ path: 'gone.png', ok: false, reason: 'missing' })
    const failing = makeContainedFs(FIXTURE_FILES)
    failing.resolve.mockRejectedValueOnce(new Error('backend denied'))
    const surface2 = createFilePreviewReadSurface({ events: () => events, cwd: '/work', fs: failing.fs })
    expect(await surface2.readImageBytes('shot.png')).toEqual({ path: 'shot.png', ok: false, reason: 'error', message: 'backend denied' })
  })
})

describe('createFilePreviewReadSurface — lifecycle and source discipline', () => {
  const events = fixtureEvents()

  it('is reachable without any session-runtime lookup (source pin)', () => {
    const source = readFileSync(new URL('../src/read-surface.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('@deepseek-ai/dsh-agent')
    expect(source).not.toContain('agents.get')
    expect(source).not.toContain('agents.resolve')
    expect(source).not.toContain('resolveAgent')
    expect(source).not.toContain('.resume(')
    expect(createFilePreviewReadSurface.length).toBe(1)
  })

  it('answers an empty log with the same shapes the Remote face gives', async () => {
    const { fs } = makeContainedFs(FIXTURE_FILES)
    const surface = createFilePreviewReadSurface({ events: () => [], cwd: '/work', fs })
    expect(await surface.list()).toEqual({ entries: [], asOfSeq: -1, truncated: false })
    expect(await surface.turnFiles()).toEqual({ turns: [], asOfSeq: -1 })
  })

  it('drops its derived caches on dispose and stays usable', async () => {
    // A bash write to a missing file: its replay resolves with NO options
    // (absolute candidate), which the existence probes never do — the no-opts
    // resolve count observes the capture cache directly.
    const bashEvents = [
      toolCall(1, 'bash', { command: 'echo a > /work/nope.txt' }, 1, 1),
      toolResult(2, 1, undefined, 1, 2),
    ]
    const { fs, resolve } = makeContainedFs(FIXTURE_FILES)
    const noOptsCalls = () => resolve.mock.calls.filter(call => call.length === 1).length
    const surface = createFilePreviewReadSurface({ events: () => bashEvents, cwd: '/work', fs })
    await surface.list()
    expect(noOptsCalls()).toBe(1)
    await surface.list()
    expect(noOptsCalls()).toBe(1) // capture cache hit: no replay
    surface.dispose()
    await surface.list() // caches dropped: the replay runs again
    expect(noOptsCalls()).toBe(2)
  })

  it('keeps the list log-derived only when bash capture is disabled', async () => {
    const { fs } = makeContainedFs(FIXTURE_FILES)
    const surface = createFilePreviewReadSurface({ events: () => events, cwd: '/work', fs, captureBashWrites: false })
    const list = await surface.list()
    expect(list.entries.map(entry => entry.path)).toEqual(['notes.md', 'src/a.ts'])
  })
})
