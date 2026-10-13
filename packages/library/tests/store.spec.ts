/**
 * The store's mechanics: the version-guarded index, per-project and per-book
 * documents, drafts beside adopted roadmaps, the tolerant JSONL ledgers, the
 * bindings, and the lock — all against a temp state root.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  normalizeNodeCover,
  normalizeResource,
  resolveLibraryStateRoot,
} from '../src/store.ts'
import type { LibraryBook, LibraryCard, LibraryProject, LibraryResource, LibraryRoadmap } from '../src/types.ts'

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

const resource: LibraryResource = {
  id: 'res_one',
  title: 'NumPy 快速教程',
  url: 'https://numpy.org/doc/stable/user/quickstart.html',
  kind: 'article',
  note: '热身站的读物，只看数组与广播两节',
  addedBy: 'coach',
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
      nodes: [{ id: 'n1', title: '概论', kind: 'quiz', goals: [], dependsOn: [], covers: [{ kind: 'book', bookId: book.id, ranges: [{ from: 1, to: 1 }] }], state: 'current', quizStats: { attempts: 0 } }],
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

describe('the project-level path (v3)', () => {
  const projectPath: LibraryRoadmap = {
    status: 'adopted',
    nodes: [
      { id: 's1', title: '热身', kind: 'practice', goals: [], dependsOn: [], covers: [{ kind: 'topic', text: '教练带写' }], state: 'current', acceptance: ['跑通脚本'] },
      { id: 's2', title: '快慢回路', kind: 'quiz', goals: [], dependsOn: ['s1'], covers: [{ kind: 'book', bookId: book.id, ranges: [{ from: 1, to: 1 }] }], state: 'locked', quizStats: { attempts: 0 } },
    ],
    generatedAt: '2026-10-06T00:00:00.000Z',
  }

  it('round-trips a roadmap at the project root, draft beside it', async () => {
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.writeRoadmap(project.id, projectPath)
      store.writeRoadmap(project.id, { ...projectPath, status: 'draft', note: '每周 2 站' })
    })
    expect(store.readRoadmap(project.id)?.nodes[0]?.acceptance).toEqual(['跑通脚本'])
    expect(store.readRoadmap(project.id)?.nodes[0]?.covers).toEqual([{ kind: 'topic', text: '教练带写' }])
    expect(store.readRoadmap(project.id, undefined, 'draft')?.note).toBe('每周 2 站')
    store.removeDraft(project.id)
    expect(store.readRoadmap(project.id, undefined, 'draft')).toBeUndefined()
    expect(store.readRoadmap(project.id)?.status).toBe('adopted')
  })

  it('normalizeNodeCover drops an unusable cover and keeps provenance', () => {
    expect(normalizeNodeCover({ kind: 'url' })).toBeUndefined()
    expect(normalizeNodeCover({ kind: 'wiki', url: 'https://x.example' })).toBeUndefined()
    expect(normalizeNodeCover({ kind: 'url', url: 'https://x.example', by: 'web', verifiedAt: '2026-10-13T00:00:00.000Z' })).toEqual({ kind: 'url', url: 'https://x.example', by: 'web', verifiedAt: '2026-10-13T00:00:00.000Z' })
  })
})

describe('the v2 → v3 migration', () => {
  /** A v2 fixture: one project whose book holds an adopted path, a draft, cards and a quiz. */
  function seedV2(): void {
    const dir = join(root, 'projects', project.id)
    mkdirSync(join(dir, 'books', book.id), { recursive: true })
    mkdirSync(join(dir, 'quizzes'), { recursive: true })
    writeFileSync(join(root, 'state.json'), JSON.stringify({ version: 2, projects: [project] }))
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project))
    writeFileSync(join(dir, 'books', book.id, 'book.json'), JSON.stringify(book))
    writeFileSync(join(dir, 'books', book.id, 'roadmap.json'), JSON.stringify({
      bookId: book.id,
      status: 'adopted',
      generatedAt: '2026-10-06T00:00:00.000Z',
      adoptedAt: '2026-10-07T00:00:00.000Z',
      passRatio: 0.7,
      nodes: [
        { id: 'n1', title: '离子通道', kind: 'quiz', goals: ['说清离子通道'], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'done', quizStats: { attempts: 2, lastRatio: 0.9, bestRatio: 0.9 } },
        { id: 'n2', title: '动作电位', kind: 'quiz', goals: [], dependsOn: ['n1'], chapterRanges: [{ from: 2, to: 2 }], state: 'current', quizStats: { attempts: 0 } },
      ],
    }))
    writeFileSync(join(dir, 'books', book.id, 'roadmap.draft.json'), JSON.stringify({
      bookId: book.id,
      status: 'draft',
      generatedAt: '2026-10-08T00:00:00.000Z',
      nodes: [{ id: 'r1', title: '导论', kind: 'read', goals: [], dependsOn: [], chapterRanges: [], state: 'locked' }],
    }))
    writeFileSync(join(dir, 'cards.jsonl'), `${JSON.stringify(card)}\n`)
    writeFileSync(join(dir, 'quizzes', 'q_one.json'), JSON.stringify({
      id: 'q_one',
      scope: { bookId: book.id, nodeId: 'n1' },
      questions: [{ id: 'q1', kind: 'free', prompt: 'p', answer: 'a', target: { kind: 'topic' }, evidence: { kind: 'knowledge' } }],
      createdAt: '2026-10-07T00:00:00.000Z',
    }))
  }

  it('reads a v2 root tolerantly before any migration runs', () => {
    seedV2()
    expect(store.readIndex().projects.map(p => p.id)).toEqual([project.id])
    const roadmap = store.readRoadmap(project.id, book.id)
    expect(roadmap?.nodes[0]?.covers).toEqual([{ kind: 'book', bookId: book.id, ranges: [{ from: 1, to: 1 }] }])
    expect(roadmap?.nodes[0]?.state).toBe('done')
    expect(roadmap?.nodes[0]?.quizStats).toEqual({ attempts: 2, lastRatio: 0.9, bestRatio: 0.9 })
  })

  it('rewrites chapterRanges into covers, keeps every other byte, and bumps the version', async () => {
    seedV2()
    expect(await store.migrateState()).toBe(true)
    const indexRaw = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')) as { version: number }
    expect(indexRaw.version).toBe(3)
    const adopted = store.readRoadmap(project.id, book.id)
    expect(adopted?.passRatio).toBe(0.7)
    expect(adopted?.adoptedAt).toBe('2026-10-07T00:00:00.000Z')
    expect(adopted?.nodes.map(node => [node.id, node.state])).toEqual([['n1', 'done'], ['n2', 'current']])
    expect(adopted?.nodes[1]?.covers).toEqual([{ kind: 'book', bookId: book.id, ranges: [{ from: 2, to: 2 }] }])
    // A node with empty chapterRanges keeps an empty-ranges book cover.
    const draft = store.readRoadmap(project.id, book.id, 'draft')
    expect(draft?.nodes[0]?.covers).toEqual([{ kind: 'book', bookId: book.id, ranges: [] }])
    // The raw files carry covers and no chapterRanges anymore.
    const raw = JSON.parse(readFileSync(join(root, 'projects', project.id, 'books', book.id, 'roadmap.json'), 'utf8')) as { nodes: Record<string, unknown>[] }
    expect(raw.nodes[0]?.covers).toBeDefined()
    expect(raw.nodes[0]?.chapterRanges).toBeUndefined()
    // Cards and quizzes are untouched.
    expect(store.readCards(project.id).map(entry => entry.id)).toEqual([card.id])
    expect(store.readQuiz(project.id, 'q_one')?.scope).toEqual({ bookId: book.id, nodeId: 'n1' })
  })

  it('is idempotent, leaves v1 alone, and no-ops on a fresh root', async () => {
    seedV2()
    expect(await store.migrateState()).toBe(true)
    expect(await store.migrateState()).toBe(false)
    expect(store.readRoadmap(project.id, book.id)?.nodes[0]?.covers).toEqual([{ kind: 'book', bookId: book.id, ranges: [{ from: 1, to: 1 }] }])
    // v1 (never deployed) still reads as empty and is not migrated.
    writeFileSync(join(root, 'state.json'), JSON.stringify({ version: 1, projects: [project] }))
    expect(await store.migrateState()).toBe(false)
    expect(store.readIndex().projects).toEqual([])
    // A root without an index at all.
    rmSync(join(root, 'state.json'))
    expect(await store.migrateState()).toBe(false)
  })
})

describe('the resource ledger', () => {
  it('appends, reads back and removes a shelf link', async () => {
    const second: LibraryResource = { id: 'res_two', title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool', addedBy: 'learner', createdAt: '2026-10-06T00:00:00.000Z' }
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.appendResource(project.id, resource)
      store.appendResource(project.id, second)
    })
    expect(store.readResources(project.id).map(entry => entry.id)).toEqual(['res_one', 'res_two'])
    await store.withProjectLock(project.id, () => {
      store.removeResource(project.id, 'res_one')
    })
    const left = store.readResources(project.id)
    expect(left.map(entry => entry.id)).toEqual(['res_two'])
    expect(left[0]?.note).toBeUndefined()
    expect(left[0]?.addedBy).toBe('learner')
  })

  it('reads tolerantly: a torn line and a row missing its fields are skipped', async () => {
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.appendResource(project.id, resource)
    })
    const file = join(root, 'projects', project.id, 'resources.jsonl')
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"id":"res_torn","tit\n${JSON.stringify({ id: 'res_bad', url: 'https://x.example' })}\n`)
    expect(store.readResources(project.id).map(entry => entry.id)).toEqual(['res_one'])
  })

  it('normalizeResource requires id, title and url, and defaults a drifted kind', () => {
    expect(normalizeResource({ id: 'res_x', title: 't' })).toBeUndefined()
    expect(normalizeResource({ id: '../x', title: 't', url: 'https://x.example' })).toBeUndefined()
    const drifted = normalizeResource({ id: 'res_x', title: 't', url: 'https://x.example', kind: 'zine', addedBy: 'nobody' })
    expect([drifted?.kind, drifted?.addedBy]).toEqual(['article', 'coach'])
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
