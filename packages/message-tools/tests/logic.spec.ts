import { describe, expect, it } from 'vitest'
import { editEvent, withdrawEvent } from '../src/events.ts'
import { foldEffectiveMessages, joinText } from '../src/projection.ts'
import { foldTurnFiles, summarizeFiles } from '../src/files.ts'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveSnapshot, loadSnapshots, restoreSnapshot, dropSnapshot } from '../src/snapshot.ts'

describe('events', () => {
  it('builds an edit event referencing the original seq', () => {
    const e = editEvent(7, 'new text', 1000)
    expect(e.type).toBe('user/message/edited')
    expect(e.data.targetSeq).toBe(7)
    expect(e.data.content).toEqual([{ type: 'text', text: 'new text' }])
    expect(e.data.ts).toBe(1000)
  })

  it('builds a withdraw event referencing the original seq', () => {
    const e = withdrawEvent(7, 1001)
    expect(e.type).toBe('user/message/withdrawn')
    expect(e.data.targetSeq).toBe(7)
  })
})

describe('projection', () => {
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 0 } },
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] } },
    { seq: 2, type: 'assistant/message', data: { message: { role: 'assistant' } } },
    { seq: 3, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] } },
    { seq: 4, type: 'user/message/edited', data: { targetSeq: 1, content: [{ type: 'text', text: 'first-edited' }], ts: 500 } },
    { seq: 5, type: 'user/message/withdrawn', data: { targetSeq: 3, ts: 600 } },
  ]

  it('keeps original messages, applies edits, marks withdrawals', () => {
    const m = foldEffectiveMessages(events)
    expect(m.get(1)).toEqual({ seq: 1, state: 'edited', text: 'first-edited', editedAt: 500 })
    expect(m.get(3)).toEqual({ seq: 3, state: 'withdrawn', withdrawnAt: 600 })
  })

  it('skips non-user messages', () => {
    const m = foldEffectiveMessages([{ seq: 0, type: 'assistant/message', data: {} }])
    expect(m.size).toBe(0)
  })

  it('joins text blocks', () => {
    expect(joinText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('ab')
    expect(joinText(undefined)).toBe('')
  })
})

describe('files', () => {
  const toolEvents = [
    { seq: 0, type: 'tool/call' as const, data: { name: 'write', turn: 0, arguments: '{"file_path":"/work/a.ts"}' } },
    { seq: 1, type: 'tool/call' as const, data: { name: 'edit', turn: 0, arguments: '{"file_path":"/work/b.ts"}' } },
    { seq: 2, type: 'tool/call' as const, data: { name: 'read', turn: 0, arguments: '{"file_path":"/work/c.ts"}' } },
    { seq: 3, type: 'tool/call' as const, data: { name: 'write', turn: 1, arguments: '{"file_path":"/work/next.ts"}' } },
  ]

  it('folds write/edit files within the turn range', () => {
    const files = foldTurnFiles(toolEvents, 0, 1)
    expect(files.map(f => f.path)).toEqual(['/work/a.ts', '/work/b.ts'])
    expect(files[0]?.op).toBe('write')
    expect(files[1]?.op).toBe('edit')
  })

  it('summarizes files for the confirm dialog', () => {
    const summary = summarizeFiles([{ path: '/work/a.ts', op: 'write', seq: 0, turn: 0 }])
    expect(summary).toContain('/work/a.ts')
    expect(summary).toContain('新建')
    expect(summarizeFiles([])).toBe('')
  })
})

describe('host event writing', () => {
  const fakeSession = () => {
    const appended: Array<{ type: string; data: unknown; opts?: { ignorable?: boolean } }> = []
    return {
      appended,
      append(type: string, data: unknown, opts?: { ignorable?: boolean }) {
        appended.push({ type, data, opts })
        return { seq: appended.length }
      },
    }
  }

  it('appends edited with ignorable marker', async () => {
    const { apply } = await import('../src/host.ts')
    const ctx = { provide: (k: string, v: unknown) => { (ctx as never as Record<string, unknown>)[k] = v } } as never
    apply(ctx as never)
    const session = fakeSession()
    const mt = (ctx as never as { messageTools: { edit: (s: typeof session, seq: number, text: string) => { seq: number } } }).messageTools
    mt.edit(session, 7, 'new text')
    expect(session.appended[0]?.type).toBe('user/message/edited')
    expect(session.appended[0]?.opts).toEqual({ ignorable: true })
    expect((session.appended[0]?.data as { targetSeq: number }).targetSeq).toBe(7)
  })

  it('withdraw snapshots affected files', async () => {
    const { apply } = await import('../src/host.ts')
    const ctx = { provide: (k: string, v: unknown) => { (ctx as never as Record<string, unknown>)[k] = v } } as never
    apply(ctx as never)
    const appended: Array<{ type: string; opts?: { ignorable?: boolean } }> = []
    const session = { append: (type: string, _d: unknown, opts?: { ignorable?: boolean }) => { appended.push({ type, opts }); return { seq: 9 } } }
    const dir = mkdtempSync(join(tmpdir(), 'mt-snaphost-'))
    const work = mkdtempSync(join(tmpdir(), 'mt-workhost-'))
    writeFileSync(join(work, 'a.ts'), 'before')
    const mt = (ctx as never as { messageTools: { withdraw: (s: unknown, seq: number, o: { stateDir: string; files: Array<{ path: string; op: 'write' | 'edit'; resolve: (p: string) => string }> }) => { seq: number } } }).messageTools
    mt.withdraw(session, 7, {
      stateDir: dir,
      files: [{ path: 'a.ts', op: 'edit', resolve: (p) => join(work, p) }],
    })
    expect(appended[0]?.type).toBe('user/message/withdrawn')
    expect(appended[0]?.opts).toEqual({ ignorable: true })
    // Snapshot captured: restore brings the file back to 'before'.
    const { loadSnapshots, restoreSnapshot } = await import('../src/snapshot.ts')
    const snap = loadSnapshots(dir).get(9)
    expect(snap?.entries[0]?.content).toBe('before')
    writeFileSync(join(work, 'a.ts'), 'after')
    if (snap) restoreSnapshot(snap, (p) => join(work, p))
    expect(readFileSync(join(work, 'a.ts'), 'utf8')).toBe('before')
    rmSync(dir, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  it('appends withdrawn with ignorable marker', async () => {
    const { apply } = await import('../src/host.ts')
    const ctx = { provide: (k: string, v: unknown) => { (ctx as never as Record<string, unknown>)[k] = v } } as never
    apply(ctx as never)
    const session = fakeSession()
    const mt = (ctx as never as { messageTools: { withdraw: (s: typeof session, seq: number, o: { stateDir: string; files: never[] }) => { seq: number } } }).messageTools
    mt.withdraw(session, 7, { stateDir: tmpdir(), files: [] })
    expect(session.appended[0]?.type).toBe('user/message/withdrawn')
    expect(session.appended[0]?.opts).toEqual({ ignorable: true })
    expect((session.appended[0]?.data as { targetSeq: number }).targetSeq).toBe(7)
  })
})

describe('file snapshot', () => {
  function tmpState() {
    return mkdtempSync(join(tmpdir(), 'mt-snap-'))
  }

  it('saves and loads a snapshot keyed by withdrawal seq', () => {
    const dir = tmpState()
    saveSnapshot(dir, { withdrawalSeq: 7, takenAt: 100, entries: [{ path: 'a.ts', content: 'v1', op: 'write' }] })
    const loaded = loadSnapshots(dir)
    expect(loaded.get(7)?.entries[0]?.content).toBe('v1')
    rmSync(dir, { recursive: true, force: true })
  })

  it('restores file content to the pre-withdrawal state', () => {
    const dir = tmpState()
    const work = mkdtempSync(join(tmpdir(), 'mt-work-'))
    const abs = join(work, 'a.ts')
    writeFileSync(abs, 'current')
    const snapshot = { withdrawalSeq: 7, takenAt: 100, entries: [{ path: 'a.ts', content: 'original', op: 'edit' }] }
    restoreSnapshot(snapshot, (p) => join(work, p))
    expect(readFileSync(abs, 'utf8')).toBe('original')
    rmSync(dir, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  it('drops a snapshot after undo', () => {
    const dir = tmpState()
    saveSnapshot(dir, { withdrawalSeq: 7, takenAt: 100, entries: [{ path: 'a.ts', content: 'v1', op: 'write' }] })
    dropSnapshot(dir, 7)
    expect(loadSnapshots(dir).has(7)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('treats a corrupt snapshot file as empty', () => {
    const dir = tmpState()
    writeFileSync(join(dir, 'message-tools-snapshots.json'), '{ nope')
    expect(loadSnapshots(dir).size).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })
})
