/**
 * The store's mechanics: the version-guarded index, per-project and per-book
 * documents, drafts beside adopted roadmaps, the tolerant JSONL ledgers, the
 * bindings, and the lock — all against a temp state root.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireLibraryLock,
  assertLibraryId,
  emptyLibraryIndex,
  LibraryStore,
  LibraryStoreError,
  normalizeBook,
  normalizeCard,
  normalizeLibraryIndex,
  resolveLibraryStateRoot,
} from '../src/store.ts'
import type { LibraryBook, LibraryCard, LibraryProject, LibraryRoadmap } from '../src/types.ts'

let root: string
let store: LibraryStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-library-store-'))
  store = new LibraryStore({ stateRoot: root })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const project: LibraryProject = { id: 'p_one', name: '神经科学', template: 'subject', createdAt: '2026-10-06T00:00:00.000Z' }

const book: LibraryBook = {
  id: 'b_one',
  title: 'Principles of Neural Science',
  edition: '6th',
  bookKind: 'knowledge',
  toc: [{ n: 1, title: 'The Brain and Behavior', part: 'I' }, { n: 2, title: 'Genes and Behavior', part: 'I' }],
  tocSource: { by: 'web', url: 'https://neurology.mhmedical.com/book.aspx?bookID=3024' },
  createdAt: '2026-10-06T00:00:00.000Z',
}

const card: LibraryCard = {
  id: 'c_one',
  kind: 'concept',
  term: '不应期',
  aliases: [],
  gloss: 'Na⁺ 通道失活期间不能再次发放',
  contexts: [],
  sources: [{ type: 'chat', at: '2026-10-06T00:00:00.000Z' }],
  weakness: 1,
  mastery: { box: 0, dueAt: '2026-10-06T00:00:00.000Z', streak: 0 },
  status: 'active',
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
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
    expect(readFileSync(join(root, 'state.json'), 'utf8')).toBe('{ not json')
  })

  it('reads another schema version (the never-deployed v1) as empty', () => {
    expect(normalizeLibraryIndex({ version: 1, projects: [{ id: 'p_x', name: 'x' }] }).projects).toEqual([])
  })
})

describe('documents', () => {
  it('round-trips a project and a registered book (no bodies anywhere)', async () => {
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.writeBook(project.id, book)
    })
    expect(store.readProject(project.id)).toEqual(project)
    expect(store.listBooks(project.id)).toEqual([book])
  })

  it('renumbers contents rows and defaults an unknown kind to knowledge', () => {
    const normalized = normalizeBook({ ...book, bookKind: 'zine', toc: [{ title: 'b' }, { n: 9, title: 'c' }] })
    expect(normalized?.bookKind).toBe('knowledge')
    expect(normalized?.toc.map(row => row.n)).toEqual([1, 2])
  })

  it('keeps a draft beside the adopted path, and drops it on demand', async () => {
    const adopted: LibraryRoadmap = {
      bookId: book.id,
      status: 'adopted',
      nodes: [{ id: 'n1', title: '概论', kind: 'quiz', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'current', quizStats: { attempts: 0 } }],
      generatedAt: '2026-10-06T00:00:00.000Z',
    }
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.writeBook(project.id, book)
      store.writeRoadmap(project.id, adopted)
      store.writeRoadmap(project.id, { ...adopted, status: 'draft', note: '每周 3 章' })
    })
    expect(store.readRoadmap(project.id, book.id)?.status).toBe('adopted')
    expect(store.readRoadmap(project.id, book.id, 'draft')?.note).toBe('每周 3 章')
    store.removeDraft(project.id, book.id)
    expect(store.readRoadmap(project.id, book.id, 'draft')).toBeUndefined()
    expect(store.readRoadmap(project.id, book.id)).toBeDefined()
  })
})

describe('the ledgers', () => {
  it('reads cards tolerantly: a torn line is skipped, a bad one dropped', async () => {
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.writeCards(project.id, [card])
    })
    const file = join(root, 'projects', project.id, 'cards.jsonl')
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"id":"c_torn","ter\n${JSON.stringify({ id: 'c_bad' })}\n`)
    expect(store.readCards(project.id).map(entry => entry.id)).toEqual(['c_one'])
  })

  it('clamps weakness and box into range', () => {
    const normalized = normalizeCard({ ...card, weakness: 9, mastery: { box: -2, dueAt: card.mastery.dueAt, streak: 1 } })
    expect(normalized?.weakness).toBe(3)
    expect(normalized?.mastery.box).toBe(0)
  })

  it('appends pages under their book', async () => {
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.writeBook(project.id, book)
      store.appendPage(project.id, {
        id: 'pg_one',
        bookId: book.id,
        attachment: { attachmentId: 'att', mediaType: 'image/jpeg', bytes: 10, width: 4, height: 3 },
        text: 'page',
        marks: [{ text: 'held', uncertain: true }],
        cardIds: [],
        at: '2026-10-06T00:00:00.000Z',
      })
    })
    expect(store.readPages(project.id, book.id)[0]?.marks[0]).toEqual({ text: 'held', uncertain: true })
  })

  it('round-trips bindings and drops rows that do not parse', async () => {
    await store.withBindingsLock(() => {
      store.writeBindings(new Map([['s1', { projectId: project.id, bookId: book.id }]]))
    })
    expect(store.readBindings().get('s1')).toEqual({ projectId: project.id, bookId: book.id })
    writeFileSync(join(root, 'bindings.json'), JSON.stringify({ s2: { projectId: '../x' }, s3: { projectId: 'p_ok' } }))
    expect([...store.readBindings().keys()]).toEqual(['s3'])
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
