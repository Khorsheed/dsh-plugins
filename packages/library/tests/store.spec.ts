/**
 * The store's mechanics: the version-guarded index, per-project and
 * per-resource documents, drafts beside adopted roadmaps, the tolerant JSONL
 * ledgers, the bindings, and the lock — plus the read-old/write-new contract
 * that keeps the legacy (v2/v3/v4) layout readable — all against a temp state
 * root.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireLibraryLock,
  assertLibraryId,
  emptyLibraryIndex,
  LibraryStore,
  LibraryStoreError,
  normalizeCard,
  normalizeLibraryIndex,
  normalizeNodeCover,
  normalizeQuizOptions,
  normalizeResource,
  normalizeRoadmap,
  resolveLibraryStateRoot,
} from '../src/store.ts'
import { LIBRARY_STATE_VERSION } from '../src/types.ts'
import type { LibraryCard, LibraryProject, LibraryResource, LibraryRoadmap } from '../src/types.ts'

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

/** A thick shelf entry (a book) in the v5 shape: book-ish detail in meta, contents at the top. */
const book: LibraryResource = {
  id: 'b_one',
  title: 'Principles of Neural Science',
  kind: 'book',
  addedBy: 'coach',
  toc: [{ n: 1, title: 'The Brain and Behavior', part: 'I' }, { n: 2, title: 'Genes and Behavior', part: 'I' }],
  tocSource: { by: 'web', url: 'https://neurology.mhmedical.com/book.aspx?bookID=3024' },
  meta: { edition: '6th', bookKind: 'knowledge' },
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

/** A thin shelf entry (a link). */
const link: LibraryResource = {
  id: 'r_one',
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

  it('reads schema versions 2 through 5 tolerantly; anything else reads as empty', () => {
    const fixture = { id: 'p_x', name: 'x' }
    for (const version of [2, 3, 4, 5]) {
      const index = normalizeLibraryIndex({ version, projects: [fixture] })
      expect(index.projects.map(entry => entry.id)).toEqual(['p_x'])
      expect(index.version).toBe(LIBRARY_STATE_VERSION)
    }
    // v1 was never deployed; v6 is from the future — both read as empty.
    expect(normalizeLibraryIndex({ version: 1, projects: [fixture] }).projects).toEqual([])
    expect(normalizeLibraryIndex({ version: LIBRARY_STATE_VERSION + 1, projects: [fixture] }).projects).toEqual([])
  })
})

describe('documents', () => {
  it('round-trips a project and a shelved book (the v5 resources/ layout)', async () => {
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.writeResource(project.id, book)
    })
    expect(store.readProject(project.id)).toEqual(project)
    expect(store.listResources(project.id)).toEqual([book])
    // The v5 layout: one resources/<id>.json per shelf entry, no books/ directory.
    expect(existsSync(join(root, 'projects', project.id, 'resources', `${book.id}.json`))).toBe(true)
    expect(existsSync(join(root, 'projects', project.id, 'books', book.id))).toBe(false)
  })

  it('renumbers contents rows and drops an unreadable bookKind', () => {
    const normalized = normalizeResource({ id: 'b_x', title: 'X', bookKind: 'zine', toc: [{ title: 'b' }, { n: 9, title: 'c' }] })
    expect(normalized?.kind).toBe('book')
    expect(normalized?.meta?.bookKind).toBeUndefined()
    expect(normalized?.toc?.map(row => row.n)).toEqual([1, 2])
  })

  it('keeps a node\'s 讲义 through normalize, and drops a malformed one', () => {
    const node = { id: 'n1', title: '概论', gate: 'quiz', goals: [], dependsOn: [], covers: [{ ref: book.id, locator: '1' }], state: 'current' }
    const kept = normalizeRoadmap({ status: 'adopted', generatedAt: '2026-10-06T00:00:00.000Z', nodes: [{ ...node, notes: { text: '## 讲义', updatedAt: '2026-10-15T00:00:00.000Z', revisions: 2 } }] })
    expect(kept?.nodes[0]?.notes).toEqual({ text: '## 讲义', updatedAt: '2026-10-15T00:00:00.000Z', revisions: 2 })
    const torn = normalizeRoadmap({ status: 'adopted', generatedAt: '2026-10-06T00:00:00.000Z', nodes: [{ ...node, notes: { revisions: 'x' } }] })
    expect(torn?.nodes[0]?.notes).toBeUndefined()
  })

  it('normalizes quiz options from strings, { label } objects, and letter-keyed maps alike', () => {
    expect(normalizeQuizOptions(['甲', '乙'])).toEqual(['甲', '乙'])
    expect(normalizeQuizOptions([{ label: 'A) 甲' }, { label: 'B) 乙' }])).toEqual(['甲', '乙'])
    expect(normalizeQuizOptions({ A: '甲', B: '乙' })).toEqual(['甲', '乙'])
    expect(normalizeQuizOptions(undefined)).toBeUndefined()
    expect(normalizeQuizOptions(['甲', 42])).toBeUndefined()
  })

  it('keeps a draft beside the adopted path, and drops it on demand', async () => {
    const adopted: LibraryRoadmap = {
      primaryResourceId: book.id,
      status: 'adopted',
      nodes: [{ id: 'n1', title: '概论', gate: 'quiz', goals: [], dependsOn: [], covers: [{ ref: book.id, locator: '1' }], state: 'current', quizStats: { attempts: 0 } }],
      generatedAt: '2026-10-06T00:00:00.000Z',
    }
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.writeResource(project.id, book)
      store.writeRoadmap(project.id, adopted)
      store.writeRoadmap(project.id, { ...adopted, status: 'draft', note: '每周 3 章' })
    })
    expect(store.readRoadmap(project.id, book.id)?.status).toBe('adopted')
    expect(store.readRoadmap(project.id, book.id, 'draft')?.note).toBe('每周 3 章')
    // The v5 layout: roadmaps/<resourceId>.json beside roadmaps/<resourceId>.draft.json.
    expect(existsSync(join(root, 'projects', project.id, 'roadmaps', `${book.id}.json`))).toBe(true)
    expect(existsSync(join(root, 'projects', project.id, 'roadmaps', `${book.id}.draft.json`))).toBe(true)
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

  it('appends pages under their resource (pages/<id>.jsonl)', async () => {
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.writeResource(project.id, book)
      store.appendPage(project.id, {
        id: 'pg_one',
        resourceId: book.id,
        attachment: { attachmentId: 'att', mediaType: 'image/jpeg', bytes: 10, width: 4, height: 3 },
        text: 'page',
        marks: [{ text: 'held', uncertain: true }],
        cardIds: [],
        at: '2026-10-06T00:00:00.000Z',
      })
    })
    expect(store.readPages(project.id, book.id)[0]?.marks[0]).toEqual({ text: 'held', uncertain: true })
    expect(existsSync(join(root, 'projects', project.id, 'pages', `${book.id}.jsonl`))).toBe(true)
  })

  it('round-trips bindings and drops rows that do not parse', async () => {
    await store.withBindingsLock(() => {
      store.writeBindings(new Map([['s1', { projectId: project.id, resourceId: book.id }]]))
    })
    expect(store.readBindings().get('s1')).toEqual({ projectId: project.id, resourceId: book.id })
    writeFileSync(join(root, 'bindings.json'), JSON.stringify({ s2: { projectId: '../x' }, s3: { projectId: 'p_ok' } }))
    expect([...store.readBindings().keys()]).toEqual(['s3'])
  })
})

describe('the project-level path', () => {
  const projectPath: LibraryRoadmap = {
    status: 'adopted',
    nodes: [
      { id: 's1', title: '热身', gate: 'acceptance', goals: [], dependsOn: [], covers: [{ ref: 'topic:教练带写' }], state: 'current', acceptance: ['跑通脚本'] },
      { id: 's2', title: '快慢回路', gate: 'quiz', goals: [], dependsOn: ['s1'], covers: [{ ref: book.id, locator: '1' }], state: 'locked', quizStats: { attempts: 0 } },
    ],
    generatedAt: '2026-10-06T00:00:00.000Z',
  }

  it('round-trips a roadmap at the project scope, draft beside it', async () => {
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.writeRoadmap(project.id, projectPath)
      store.writeRoadmap(project.id, { ...projectPath, status: 'draft', note: '每周 2 站' })
    })
    expect(store.readRoadmap(project.id)?.nodes[0]?.acceptance).toEqual(['跑通脚本'])
    expect(store.readRoadmap(project.id)?.nodes[0]?.covers).toEqual([{ ref: 'topic:教练带写' }])
    expect(store.readRoadmap(project.id, undefined, 'draft')?.note).toBe('每周 2 站')
    // The v5 layout: the project's own path is roadmaps/project.json.
    expect(existsSync(join(root, 'projects', project.id, 'roadmaps', 'project.json'))).toBe(true)
    store.removeDraft(project.id)
    expect(store.readRoadmap(project.id, undefined, 'draft')).toBeUndefined()
    expect(store.readRoadmap(project.id)?.status).toBe('adopted')
  })

  it('normalizeNodeCover reads the v5 shape and every legacy union member into { ref, locator? }', () => {
    expect(normalizeNodeCover({ kind: 'url' })).toBeUndefined()
    expect(normalizeNodeCover({ kind: 'wiki', url: 'https://x.example' })).toBeUndefined()
    expect(normalizeNodeCover({ kind: 'url', url: 'https://x.example', by: 'web', verifiedAt: '2026-10-13T00:00:00.000Z' }))
      .toEqual({ ref: 'https://x.example', by: 'web', verifiedAt: '2026-10-13T00:00:00.000Z' })
    expect(normalizeNodeCover({ kind: 'book', bookId: 'b_1', ranges: [{ from: 1, to: 2 }, { from: 5, to: 5 }] })).toEqual({ ref: 'b_1', locator: '1-2,5' })
    expect(normalizeNodeCover({ kind: 'book', bookId: 'b_1', ranges: [] })).toEqual({ ref: 'b_1' })
    expect(normalizeNodeCover({ kind: 'resource', resourceId: 'r_1' })).toEqual({ ref: 'r_1' })
    expect(normalizeNodeCover({ kind: 'topic', text: '讲授' })).toEqual({ ref: 'topic:讲授' })
    expect(normalizeNodeCover({ ref: 'b_1', locator: '3' })).toEqual({ ref: 'b_1', locator: '3' })
  })
})

describe('the legacy layout reads (read-old, write-new)', () => {
  /** A v3 root written by hand: books/<id>/book.json + roadmap.json, quizzes/<id>.json, a root resources.jsonl. */
  function seedV3(): void {
    const dir = join(root, 'projects', project.id)
    mkdirSync(join(dir, 'books', 'b_1'), { recursive: true })
    mkdirSync(join(dir, 'quizzes'), { recursive: true })
    writeFileSync(join(root, 'state.json'), JSON.stringify({ version: 3, projects: [project] }))
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project))
    writeFileSync(join(dir, 'books', 'b_1', 'book.json'), JSON.stringify({
      id: 'b_1',
      title: 'Principles of Neural Science',
      edition: '6th',
      bookKind: 'knowledge',
      short: 'PNS',
      toc: [{ n: 1, title: 'Ion Channels' }, { n: 2, title: 'The Action Potential' }],
      tocSource: { by: 'web', url: 'https://example.org/toc' },
      createdAt: '2026-10-06T00:00:00.000Z',
    }))
    writeFileSync(join(dir, 'books', 'b_1', 'roadmap.json'), JSON.stringify({
      bookId: 'b_1',
      status: 'adopted',
      generatedAt: '2026-10-06T00:00:00.000Z',
      nodes: [
        { id: 'p1', title: '动手', kind: 'practice', goals: [], dependsOn: [], covers: [{ kind: 'book', bookId: 'b_1', ranges: [{ from: 1, to: 2 }] }], state: 'current', acceptance: ['做完实验'] },
      ],
    }))
    writeFileSync(join(dir, 'quizzes', 'q_1.json'), JSON.stringify({
      id: 'q_1',
      scope: { bookId: 'b_1', nodeId: 'n1' },
      questions: [{ id: 'q1', kind: 'free', prompt: 'p', answer: 'a', target: { kind: 'topic' }, evidence: { kind: 'knowledge' } }],
      createdAt: '2026-10-07T00:00:00.000Z',
    }))
    // The thin-links ledger, with a torn line and a field-less row for the tolerant read.
    writeFileSync(join(dir, 'resources.jsonl'), `${JSON.stringify({ id: 'r_old', title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool', addedBy: 'learner', createdAt: '2026-10-08T00:00:00.000Z' })}\n{"id":"r_torn","tit\n${JSON.stringify({ id: 'r_bad', url: 'https://x.example' })}\n`)
  }

  it('reads the legacy book and the legacy thin link off one shelf', () => {
    seedV3()
    const resources = store.listResources(project.id)
    expect(resources.map(entry => entry.id)).toEqual(['b_1', 'r_old'])
    expect(resources[0]).toMatchObject({ kind: 'book', meta: { bookKind: 'knowledge', short: 'PNS', edition: '6th' } })
    expect(resources[0]?.toc?.map(row => row.title)).toEqual(['Ion Channels', 'The Action Potential'])
    expect(resources[1]).toMatchObject({ kind: 'tool', url: 'https://mujoco.org', addedBy: 'learner' })
  })

  it('reads the legacy roadmap: bookId → primaryResourceId, kind: practice → gate: acceptance, cover unions → { ref, locator }', () => {
    seedV3()
    const roadmap = store.readRoadmap(project.id, 'b_1')
    expect(roadmap?.primaryResourceId).toBe('b_1')
    expect(roadmap?.nodes[0]?.gate).toBe('acceptance')
    expect(roadmap?.nodes[0]?.covers).toEqual([{ ref: 'b_1', locator: '1-2' }])
    expect(roadmap?.nodes[0]?.acceptance).toEqual(['做完实验'])
  })

  it('reads the legacy quiz file as a type=quiz assessment scoped on the resource', () => {
    seedV3()
    const assessment = store.readAssessment(project.id, 'q_1')
    expect(assessment?.type).toBe('quiz')
    expect(assessment?.scope).toEqual({ nodeId: 'n1', resourceId: 'b_1' })
    expect(store.listAssessments(project.id).map(entry => entry.id)).toEqual(['q_1'])
  })

  it('a v5 write shadows the legacy twin and lands in the new layout (the legacy file stays)', async () => {
    seedV3()
    const legacy = store.readResource(project.id, 'b_1')
    if (legacy === undefined) throw new Error('read')
    await store.withProjectLock(project.id, () => {
      store.writeResource(project.id, { ...legacy, title: 'PNS (corrected)' })
      store.writeRoadmap(project.id, { primaryResourceId: 'b_1', status: 'draft', nodes: [], generatedAt: '2026-10-17T00:00:00.000Z' })
    })
    expect(existsSync(join(root, 'projects', project.id, 'resources', 'b_1.json'))).toBe(true)
    expect(existsSync(join(root, 'projects', project.id, 'roadmaps', 'b_1.draft.json'))).toBe(true)
    expect(store.readResource(project.id, 'b_1')?.title).toBe('PNS (corrected)')
    expect(store.readRoadmap(project.id, 'b_1', 'draft')?.generatedAt).toBe('2026-10-17T00:00:00.000Z')
    expect(existsSync(join(root, 'projects', project.id, 'books', 'b_1', 'book.json'))).toBe(true)
  })
})

describe('the v2 → covers migration', () => {
  /** A v2 fixture: one project whose book holds an adopted path, a draft, cards and a quiz. */
  function seedV2(): void {
    const dir = join(root, 'projects', project.id)
    mkdirSync(join(dir, 'books', book.id), { recursive: true })
    mkdirSync(join(dir, 'quizzes'), { recursive: true })
    writeFileSync(join(root, 'state.json'), JSON.stringify({ version: 2, projects: [project] }))
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project))
    writeFileSync(join(dir, 'books', book.id, 'book.json'), JSON.stringify({
      id: book.id,
      title: book.title,
      edition: '6th',
      bookKind: 'knowledge',
      toc: [{ n: 1, title: 'The Brain and Behavior', part: 'I' }, { n: 2, title: 'Genes and Behavior', part: 'I' }],
      tocSource: { by: 'web', url: 'https://neurology.mhmedical.com/book.aspx?bookID=3024' },
      createdAt: '2026-10-06T00:00:00.000Z',
    }))
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
    expect(roadmap?.nodes[0]?.covers).toEqual([{ ref: book.id, locator: '1' }])
    expect(roadmap?.nodes[0]?.state).toBe('done')
    expect(roadmap?.nodes[0]?.quizStats).toEqual({ attempts: 2, lastRatio: 0.9, bestRatio: 0.9 })
  })

  it('rewrites chapterRanges into covers, keeps every other byte, and bumps the version', async () => {
    seedV2()
    expect(await store.migrateState()).toBe(true)
    const indexRaw = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')) as { version: number }
    expect(indexRaw.version).toBe(LIBRARY_STATE_VERSION)
    const adopted = store.readRoadmap(project.id, book.id)
    expect(adopted?.passRatio).toBe(0.7)
    expect(adopted?.adoptedAt).toBe('2026-10-07T00:00:00.000Z')
    expect(adopted?.nodes.map(node => [node.id, node.state])).toEqual([['n1', 'done'], ['n2', 'current']])
    expect(adopted?.nodes[1]?.covers).toEqual([{ ref: book.id, locator: '2' }])
    // A node with empty chapterRanges keeps an empty (locator-less) book cover.
    const draft = store.readRoadmap(project.id, book.id, 'draft')
    expect(draft?.nodes[0]?.covers).toEqual([{ ref: book.id }])
    // The raw files carry covers and no chapterRanges anymore.
    const raw = JSON.parse(readFileSync(join(root, 'projects', project.id, 'books', book.id, 'roadmap.json'), 'utf8')) as { nodes: Record<string, unknown>[] }
    expect(raw.nodes[0]?.covers).toBeDefined()
    expect(raw.nodes[0]?.chapterRanges).toBeUndefined()
    // Cards and quizzes are untouched (the quiz reads through as a type=quiz assessment).
    expect(store.readCards(project.id).map(entry => entry.id)).toEqual([card.id])
    expect(store.readAssessment(project.id, 'q_one')?.scope).toEqual({ nodeId: 'n1', resourceId: book.id })
  })

  it('is idempotent, leaves v1 alone, and no-ops on a fresh root', async () => {
    seedV2()
    expect(await store.migrateState()).toBe(true)
    expect(await store.migrateState()).toBe(false)
    expect(store.readRoadmap(project.id, book.id)?.nodes[0]?.covers).toEqual([{ ref: book.id, locator: '1' }])
    // v1 (never deployed) still reads as empty and is not migrated.
    writeFileSync(join(root, 'state.json'), JSON.stringify({ version: 1, projects: [project] }))
    expect(await store.migrateState()).toBe(false)
    expect(store.readIndex().projects).toEqual([])
    // A root without an index at all.
    rmSync(join(root, 'state.json'))
    expect(await store.migrateState()).toBe(false)
  })
})

describe('the shelf (one resources/<id>.json per entry)', () => {
  const second: LibraryResource = { id: 'r_two', title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool', addedBy: 'learner', createdAt: '2026-10-07T00:00:00.000Z' }

  it('writes, lists and removes a shelf link', async () => {
    await store.withProjectLock(project.id, () => {
      store.writeProject(project)
      store.writeResource(project.id, link)
      store.writeResource(project.id, second)
    })
    expect(store.listResources(project.id).map(entry => entry.id)).toEqual(['r_one', 'r_two'])
    await store.withProjectLock(project.id, () => {
      store.removeResource(project.id, 'r_one')
    })
    const left = store.listResources(project.id)
    expect(left.map(entry => entry.id)).toEqual(['r_two'])
    expect(left[0]?.note).toBeUndefined()
    expect(left[0]?.addedBy).toBe('learner')
  })

  it('normalizeResource requires id and title (a thin link may omit the url), and defaults a drifted kind', () => {
    const bare = normalizeResource({ id: 'r_x', title: 't', kind: 'article' })
    expect(bare?.url).toBeUndefined()
    expect(normalizeResource({ title: 't', url: 'https://x.example' })).toBeUndefined()
    expect(normalizeResource({ id: '../x', title: 't', url: 'https://x.example' })).toBeUndefined()
    const drifted = normalizeResource({ id: 'r_x', title: 't', url: 'https://x.example', kind: 'zine', addedBy: 'nobody' })
    expect([drifted?.kind, drifted?.addedBy]).toEqual(['article', undefined])
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
