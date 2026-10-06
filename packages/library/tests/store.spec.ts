/**
 * The store's mechanics: the version-guarded index, per-project documents,
 * externalized chapter bodies, atomic writes, the append-only ledgers, and the
 * lock — all against a temp state root.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireLibraryLock,
  assertLibraryId,
  emptyLibraryIndex,
  LibraryStore,
  LibraryStoreError,
  normalizeLibraryIndex,
  resolveLibraryStateRoot,
} from '../src/store.ts'
import type { LibraryBook, LibraryProject } from '../src/types.ts'

let root: string
let store: LibraryStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-library-store-'))
  store = new LibraryStore({ stateRoot: root })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const project: LibraryProject = { id: 'p_one', name: '神经科学', createdAt: '2026-10-06T00:00:00.000Z' }

const book: LibraryBook = {
  id: 'b_one',
  title: '认知神经科学',
  source: { kind: 'upload', ref: 'cog.epub' },
  format: 'epub',
  toc: [
    { n: 1, title: '神经系统概论', chars: 12 },
    { n: 2, title: '神经元与信号传导', chars: 18 },
  ],
  createdAt: '2026-10-06T00:00:00.000Z',
}

describe('state root resolution', () => {
  it('prefers the explicit override, then $DSH_HOME, then the cwd', () => {
    expect(resolveLibraryStateRoot('/tmp/elsewhere')).toBe('/tmp/elsewhere')
    const home = process.env.DSH_HOME
    process.env.DSH_HOME = '/home/user/dsh'
    try {
      expect(resolveLibraryStateRoot(undefined)).toBe('/home/user/dsh/state/dsh-library')
    } finally {
      if (home === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = home
    }
  })
})

describe('the index (state.json)', () => {
  it('reads a missing file as empty', () => {
    expect(store.readIndex()).toEqual(emptyLibraryIndex())
  })

  it('refuses a corrupt file rather than clobbering it', () => {
    writeFileSync(join(root, 'state.json'), '{ not json')
    expect(() => store.readIndex()).toThrowError(LibraryStoreError)
    try {
      store.readIndex()
    } catch (error) {
      expect((error as LibraryStoreError).kind).toBe('corrupt')
    }
    // The hand-edited file is still there.
    expect(readFileSync(join(root, 'state.json'), 'utf8')).toBe('{ not json')
  })

  it('normalizes a version mismatch to empty (a newer file is not this build\'s)', () => {
    expect(normalizeLibraryIndex({ version: 99, projects: [{ id: 'p_x', name: 'x' }] }).projects).toEqual([])
  })
})

describe('project documents and externalized bodies', () => {
  it('writes and reads a project, a book and its chapters', async () => {
    await store.withIndexLock(() => {
      store.writeProject(project)
      store.writeIndex({ version: 1, projects: [project] })
    })
    await store.withProjectLock(project.id, () => {
      store.writeBook(project.id, book, [
        { n: 1, html: '<p>概论正文</p>' },
        { n: 2, html: '<p>信号传导正文</p>' },
      ])
    })
    expect(store.readProject(project.id)).toEqual(project)
    expect(store.readBook(project.id, book.id)).toEqual(book)
    expect(store.readChapter(project.id, book.id, 2)).toBe('<p>信号传导正文</p>')
    expect(store.listBooks(project.id).map(b => b.id)).toEqual([book.id])
    // No temp file survives an atomic write.
    expect(readdirSync(root, { recursive: true }).map(String).filter(name => name.includes('.tmp'))).toEqual([])
  })

  it('keeps writes atomic: the temp file is renamed, not written in place', async () => {
    await store.withIndexLock(() => {
      store.writeProject(project)
    })
    const file = join(root, 'projects', project.id, 'project.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(project)))
    // A torn temp file from a dead writer does not shadow the committed one.
    writeFileSync(`${file}.99999.tmp`, '{ torn')
    expect(store.readProject(project.id)).toEqual(project)
  })
})

describe('the append-only ledgers', () => {
  it('appends vocab lines without rewriting, tolerantly skipping torn lines', async () => {
    await store.withProjectLock(project.id, async () => {
      store.appendVocab(project.id, [{
        id: 'v_one',
        kind: 'vocab',
        term: 'synapse',
        note: '突触',
        chapterRef: 'ch:3',
        source: { kind: 'photo', attachmentId: 'sha256:abc' },
        mastery: { box: 0, dueAt: '2026-10-06T00:00:00.000Z', streak: 0 },
        createdAt: '2026-10-06T00:00:00.000Z',
      }])
      store.appendVocab(project.id, [{
        id: 'v_two',
        kind: 'keypoint',
        term: '重点',
        note: 'Ca²⁺ 触发释放',
        chapterRef: 'ch:3',
        source: { kind: 'model' },
        mastery: { box: 1, dueAt: '2026-10-07T00:00:00.000Z', streak: 1 },
        createdAt: '2026-10-06T00:00:00.000Z',
      }])
    })
    const file = join(root, 'projects', project.id, 'vocab.jsonl')
    // Two appends, two lines — the file is a log, not a document.
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2)
    // A torn line (a crash mid-append) is skipped, never fails the read.
    writeFileSync(file, readFileSync(file, 'utf8') + '{ torn\n')
    const entries = store.readVocab(project.id)
    expect(entries.map(entry => entry.id)).toEqual(['v_one', 'v_two'])
    expect(entries[0]?.source.attachmentId).toBe('sha256:abc')
  })

  it('rewrites vocab atomically (mastery updates), replacing the whole ledger', async () => {
    await store.withProjectLock(project.id, async () => {
      store.appendVocab(project.id, [{
        id: 'v_one', kind: 'vocab', term: 'a', note: 'A', chapterRef: 'ch:1',
        source: { kind: 'manual' }, mastery: { box: 0, dueAt: 'x', streak: 0 }, createdAt: 'x',
      } as never])
      store.rewriteVocab(project.id, [{
        id: 'v_one', kind: 'vocab', term: 'a', note: 'A', chapterRef: 'ch:1',
        source: { kind: 'manual' }, mastery: { box: 1, dueAt: 'y', streak: 1 }, createdAt: 'x',
      } as never])
    })
    expect(store.readVocab(project.id)[0]?.mastery.box).toBe(1)
  })
})

describe('ids and locks', () => {
  it('rejects ids that would escape the directory', () => {
    expect(() => assertLibraryId('../etc', 'project id')).toThrowError(/not a usable id/)
    expect(() => assertLibraryId('a/b', 'project id')).toThrowError(/not a usable id/)
    expect(() => assertLibraryId('p_ok-1.2', 'project id')).not.toThrow()
    expect(() => store.readProject('../state')).toThrowError(LibraryStoreError)
  })

  it('serializes concurrent project mutations on the per-project lock', async () => {
    const order: string[] = []
    await Promise.all([
      store.withProjectLock(project.id, async () => {
        order.push('a:in')
        await new Promise(resolve => setTimeout(resolve, 30))
        order.push('a:out')
      }),
      store.withProjectLock(project.id, async () => {
        order.push('b:in')
        order.push('b:out')
      }),
    ])
    // The second critical section never interleaves the first.
    expect(order).toEqual(['a:in', 'a:out', 'b:in', 'b:out'])
  })

  it('a released lock can be re-acquired', async () => {
    const lockPath = join(root, 'x.lock')
    const first = await acquireLibraryLock(lockPath)
    first.release()
    const second = await acquireLibraryLock(lockPath)
    second.release()
  })

  it('reclaims a stale lock whose owner is dead', async () => {
    const lockPath = join(root, 'stale.lock')
    writeFileSync(lockPath, `${JSON.stringify({ pid: 999999, at: Date.now() - 120_000 })}\n`)
    const lock = await acquireLibraryLock(lockPath)
    lock.release()
  })
})
