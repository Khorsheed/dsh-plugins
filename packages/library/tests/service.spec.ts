/**
 * The service's rules: registered books, draft → adopt roadmaps, photo pages
 * that card their marks, card dedupe (exact merge, near-duplicate held back),
 * weakness and review scheduling, the two-axis quiz checks, the assess
 * cascade, bindings and undo.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cardKey, keySimilarity } from '../src/cards.ts'
import { LibraryService } from '../src/service.ts'
import type { LibraryQuizQuestion, LibraryTemplate } from '../src/types.ts'

let root: string
let service: LibraryService

/** A ctx with no attachments service (the probe path reads as absent); `effect` is a no-op here (teardown wiring is pinned against a real Context in capabilities-dispose.spec.ts). */
const ctx = { get: () => undefined, effect: () => () => {} } as unknown as Context

const photo = { attachmentId: 'att_p16', mediaType: 'image/jpeg', bytes: 1000, width: 1200, height: 1600 }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-library-service-'))
  service = new LibraryService(ctx, { stateRoot: root })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A project with one registered book. */
async function seed(template: LibraryTemplate = 'subject', bookKind: 'knowledge' | 'material' = 'knowledge'): Promise<{ projectId: string; bookId: string }> {
  const created = await service.createProject({ name: template === 'language' ? '雅思' : '神经科学', template })
  if (!created.ok) throw new Error(created.message)
  const book = await service.putBook({
    projectId: created.project.id,
    title: bookKind === 'material' ? 'Cambridge IELTS 5' : 'Principles of Neural Science',
    edition: bookKind === 'material' ? undefined : '6th',
    bookKind,
    toc: bookKind === 'material'
      ? [{ title: 'Johnson\'s Dictionary', part: 'Test 1' }, { title: 'Nature or Nurture?', part: 'Test 1' }]
      : [{ title: 'Ion Channels' }, { title: 'Propagated Signaling: The Action Potential' }, { title: 'Overview of Synaptic Transmission' }],
    tocSource: { by: 'web', url: 'https://example.org/toc' },
  })
  if (!book.ok) throw new Error(book.message)
  return { projectId: created.project.id, bookId: book.book.id }
}

/** Draft and adopt a two-quiz-node path (n1 → n2). */
async function adopt(projectId: string, bookId: string): Promise<void> {
  const draft = await service.draftRoadmap({
    projectId,
    bookId,
    nodes: [
      { id: 'n1', title: '离子通道', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [{ from: 1, to: 1 }] }] },
      { id: 'n2', title: '动作电位', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [{ from: 2, to: 2 }] }], dependsOn: ['n1'] },
    ],
    note: '每周 3 章',
  })
  if (!draft.ok) throw new Error(draft.message)
  const adopted = await service.adoptRoadmap({ projectId, bookId })
  if (!adopted.ok) throw new Error(adopted.message)
}

function question(overrides: Partial<LibraryQuizQuestion> = {}): LibraryQuizQuestion {
  return {
    id: 'q1',
    kind: 'free',
    prompt: '为什么绝对不应期里再强的刺激也不行？',
    answer: 'Na⁺ 通道失活，需复极化解除',
    target: { kind: 'topic' },
    evidence: { kind: 'knowledge' },
    ...overrides,
  }
}

describe('cards.ts', () => {
  it('folds case, width, punctuation and regular plurals into one key', () => {
    expect(cardKey('Instalments')).toBe(cardKey('instalment'))
    expect(cardKey('「不应期」')).toBe('不应期')
    expect(cardKey('theories')).toBe('theory')
  })

  it('sees containment and shared units as near, unrelated terms as far', () => {
    expect(keySimilarity(cardKey('不应期'), cardKey('绝对/相对不应期'))).toBe(1)
    expect(keySimilarity(cardKey('heyday'), cardKey('garret'))).toBe(0)
  })
})

describe('projects', () => {
  it('takes its look from the template, and changes it on request', async () => {
    const created = await service.createProject({ name: '雅思', template: 'language' })
    if (!created.ok) throw new Error(created.message)
    expect([created.project.color, created.project.icon]).toEqual(['ember', 'globe'])
    const updated = await service.updateProject({ id: created.project.id, patch: { color: 'moss', icon: 'pen' } })
    expect(updated.ok && [updated.project.color, updated.project.icon]).toEqual(['moss', 'pen'])
    expect((await service.updateProject({ id: created.project.id, patch: { color: 'neon' as never } })).ok).toBe(false)
  })

  it('can be renamed and refocused, and an empty goal clears it', async () => {
    const created = await service.createProject({ name: '神经科学', template: 'subject', goal: '读完 PNS 第 II 部分' })
    if (!created.ok) throw new Error(created.message)
    const renamed = await service.updateProject({ id: created.project.id, patch: { name: ' 神经科学 × 人工智能 ', goal: '读懂神经网络的生物学来源', template: 'custom' } })
    expect(renamed.ok && [renamed.project.name, renamed.project.goal, renamed.project.template]).toEqual(['神经科学 × 人工智能', '读懂神经网络的生物学来源', 'custom'])
    const cleared = await service.updateProject({ id: created.project.id, patch: { goal: '' } })
    expect(cleared.ok && 'goal' in cleared.project).toBe(false)
    expect((await service.updateProject({ id: created.project.id, patch: { name: '  ' } })).ok).toBe(false)
    expect((await service.listProjects()).projects.map(project => project.name)).toContain('神经科学 × 人工智能')
  })
})

describe('the project list', () => {
  it('puts the most recently used project first', async () => {
    const first = await service.createProject({ name: '神经科学' })
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = await service.createProject({ name: '雅思' })
    if (!first.ok || !second.ok) throw new Error('create')
    expect((await service.listProjects()).projects.map(project => project.name)).toEqual(['雅思', '神经科学'])
    await new Promise(resolve => setTimeout(resolve, 5))
    await service.writeCards({ projectId: first.project.id, cards: [{ kind: 'concept', term: '不应期', gloss: 'g', source: { type: 'chat' } }] })
    expect((await service.listProjects()).projects.map(project => project.name)).toEqual(['神经科学', '雅思'])
  })
})

describe('books and roadmaps', () => {
  it('registers a book with its contents and refuses one without', async () => {
    const { projectId } = await seed()
    const bare = await service.putBook({ projectId, title: 'X', bookKind: 'knowledge', toc: [], tocSource: { by: 'model' } })
    expect(bare.ok).toBe(false)
    const noUrl = await service.putBook({ projectId, title: 'Y', bookKind: 'knowledge', toc: [{ title: 'a' }], tocSource: { by: 'web' } })
    expect(!noUrl.ok && noUrl.message).toMatch(/url/)
  })

  it('a draft does nothing until adopted; adoption starts the roots', async () => {
    const { projectId, bookId } = await seed()
    const cover = { kind: 'book' as const, bookId, ranges: [] }
    await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'n1', title: 'a', kind: 'quiz', covers: [cover] }, { id: 'n2', title: 'b', kind: 'quiz', covers: [cover], dependsOn: ['n1'] }] })
    const before = await service.getRoadmap({ projectId, bookId })
    expect(before.roadmap).toBeUndefined()
    expect(before.draft?.status).toBe('draft')
    const adopted = await service.adoptRoadmap({ projectId, bookId })
    expect(adopted.ok && adopted.roadmap.nodes.map(node => node.state)).toEqual(['current', 'locked'])
    expect((await service.getRoadmap({ projectId, bookId })).draft).toBeUndefined()
  })

  it('re-adopting keeps the progress of surviving nodes', async () => {
    const { projectId, bookId } = await seed()
    const cover = { kind: 'book' as const, bookId, ranges: [] }
    await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'r1', title: '导论', kind: 'read', covers: [cover] }, { id: 'n1', title: 'a', kind: 'quiz', covers: [cover] }] })
    await service.adoptRoadmap({ projectId, bookId })
    await service.markNodeRead({ projectId, bookId, nodeId: 'r1' })
    await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'r1', title: '导论', kind: 'read', covers: [cover] }, { id: 'n1', title: 'a', kind: 'quiz', covers: [cover] }, { id: 'n2', title: 'b', kind: 'quiz', covers: [cover], dependsOn: ['n1'] }, { id: 'r2', title: '概述', kind: 'read', covers: [cover], dependsOn: ['n2'] }] })
    const again = await service.adoptRoadmap({ projectId, bookId })
    // A read node is a side stop: open at once, whatever it follows.
    expect(again.ok && again.roadmap.nodes.map(node => node.state)).toEqual(['done', 'current', 'locked', 'current'])
  })

  it('never lets a read node gate a level, and keeps extras and the cover abbreviation', async () => {
    const { projectId, bookId } = await seed()
    const cover = { kind: 'book' as const, bookId, ranges: [] }
    const gated = await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'r1', title: '怎么用这本书', kind: 'read', covers: [cover] }, { id: 'n1', title: 'a', kind: 'quiz', covers: [cover], dependsOn: ['r1'] }] })
    expect(!gated.ok && gated.message).toMatch(/never gates a level/)
    const book = await service.putBook({
      projectId, bookId, title: 'Principles of Neural Science', short: 'PNS', bookKind: 'knowledge', tocSource: { by: 'model' },
      toc: [{ title: 'Ion Channels' }], extras: [{ title: '怎么用这本书', note: '考试结构与评分', when: 'before' }, { title: 'Answer key', where: 'p.152', when: 'reference' }],
    })
    expect(book.ok && [book.book.short, book.book.extras?.map(extra => extra.when)]).toEqual(['PNS', ['before', 'reference']])
  })

  it('keeps a goal written as a bare string and drops part-heading rows', async () => {
    const { projectId } = await seed()
    const book = await service.putBook({
      projectId, title: 'PNS', bookKind: 'knowledge', tocSource: { by: 'model' },
      toc: [{ title: 'Part II: Cells', part: 'Part II: Cells' }, { title: 'Ion Channels', part: 'Part II: Cells' }],
    })
    if (!book.ok) throw new Error(book.message)
    expect(book.book.toc.map(row => row.title)).toEqual(['Ion Channels'])
    const draft = await service.draftRoadmap({ projectId, bookId: book.book.id, nodes: [{ id: 'n1', title: 'a', kind: 'quiz', goals: '说清离子通道', covers: [{ kind: 'book', bookId: book.book.id, ranges: [] }] }] })
    expect(draft.ok && draft.draft.nodes[0]?.goals).toEqual(['说清离子通道'])
    expect((await service.getRoadmap({ projectId, bookId: book.book.id })).draft?.nodes[0]?.goals).toEqual(['说清离子通道'])
  })

  it('refuses ranges outside the contents and forward dependencies', async () => {
    const { projectId, bookId } = await seed()
    const outside = await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'n1', title: 'a', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [{ from: 1, to: 9 }] }] }] })
    expect(!outside.ok && outside.message).toMatch(/3 rows/)
    const forward = await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'n1', title: 'a', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [] }], dependsOn: ['n2'] }, { id: 'n2', title: 'b', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [] }] }] })
    expect(!forward.ok && forward.message).toMatch(/AFTER/)
  })
})

describe('resources', () => {
  it('puts a link on the shelf, validates url / kind / title, and refuses a duplicate', async () => {
    const { projectId } = await seed()
    const noProject = await service.addResource({ projectId: 'p_none', resource: { title: 'x', url: 'https://x.example', kind: 'article', addedBy: 'coach' } })
    expect(!noProject.ok && noProject.error).toBe('not-found')
    const badUrl = await service.addResource({ projectId, resource: { title: 'x', url: 'ftp://x.example', kind: 'article', addedBy: 'coach' } })
    expect(!badUrl.ok && badUrl.message).toMatch(/https?:\/\//)
    const badKind = await service.addResource({ projectId, resource: { title: 'x', url: 'https://x.example', kind: 'zine' as never, addedBy: 'coach' } })
    expect(!badKind.ok && badKind.message).toMatch(/article \| video/)
    const bare = await service.addResource({ projectId, resource: { title: '  ', url: 'https://x.example', kind: 'article', addedBy: 'coach' } })
    expect(!bare.ok && bare.message).toMatch(/title/)
    const added = await service.addResource({ projectId, resource: { title: 'NumPy 快速教程', url: 'https://numpy.org/quickstart', kind: 'article', note: '热身站的读物', addedBy: 'coach' } })
    if (!added.ok) throw new Error(added.message)
    expect(added.resource.id).toMatch(/^res_/)
    const dupe = await service.addResource({ projectId, resource: { title: 'same link', url: 'https://numpy.org/quickstart', kind: 'video', addedBy: 'learner' } })
    expect(!dupe.ok && dupe.error).toBe('exists')
  })

  it('lists oldest first, ledgers the add, and removes only what exists', async () => {
    const { projectId } = await seed()
    const first = await service.addResource({ projectId, resource: { title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool', addedBy: 'coach' } })
    const second = await service.addResource({ projectId, resource: { title: 'LeRobot', url: 'https://github.com/huggingface/lerobot', kind: 'repo', addedBy: 'coach' } })
    if (!first.ok || !second.ok) throw new Error('add')
    expect((await service.listResources({ projectId })).resources.map(resource => resource.title)).toEqual(['MuJoCo', 'LeRobot'])
    const events = await service.listEvents({ projectId, types: ['resource.added'] })
    expect(events.events.map(event => event.id)).toEqual([second.resource.id, first.resource.id])
    const missing = await service.removeResource({ projectId, resourceId: 'res_none' })
    expect(!missing.ok && missing.error).toBe('not-found')
    expect((await service.removeResource({ projectId, resourceId: first.resource.id })).ok).toBe(true)
    expect((await service.listResources({ projectId })).resources.map(resource => resource.title)).toEqual(['LeRobot'])
  })
})

describe('project paths', () => {
  it('drafts, adopts, reads and discards the project\'s own path (no book anywhere)', async () => {
    const { projectId, bookId } = await seed()
    const draft = await service.draftRoadmap({
      projectId,
      nodes: [
        { id: 's1', title: 'NumPy 热身', kind: 'practice', goals: ['能写 50 行脚本'], covers: [{ kind: 'topic', text: '教练带写 RobotArm 类' }], acceptance: ['跑通三关节脚本'] },
        { id: 's2', title: '快慢回路', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [{ from: 2, to: 2 }] }], dependsOn: ['s1'] },
      ],
      note: '每周 2 站',
    })
    if (!draft.ok) throw new Error(draft.message)
    expect(draft.draft.bookId).toBeUndefined()
    const seen = await service.getRoadmap({ projectId })
    expect(seen.draft?.nodes.map(node => node.id)).toEqual(['s1', 's2'])
    expect(seen.roadmap).toBeUndefined()
    const adopted = await service.adoptRoadmap({ projectId })
    expect(adopted.ok && adopted.roadmap.nodes.map(node => node.state)).toEqual(['current', 'locked'])
    expect((await service.getRoadmap({ projectId })).draft).toBeUndefined()
    // The book's own path is a separate scope — untouched by the project's.
    expect((await service.getRoadmap({ projectId, bookId })).roadmap).toBeUndefined()
    await service.draftRoadmap({ projectId, nodes: [{ id: 's9', title: 'x', kind: 'read', covers: [{ kind: 'topic', text: 'x' }] }] })
    expect((await service.discardDraft({ projectId })).ok).toBe(true)
    expect((await service.getRoadmap({ projectId })).draft).toBeUndefined()
  })

  it('a project path whose stations all cover the same single book is sent to the book', async () => {
    const { projectId, bookId } = await seed()
    const cover = { kind: 'book', bookId, ranges: [{ from: 1, to: 2 }] } as const
    const parked = await service.draftRoadmap({ projectId, nodes: [
      { id: 's1', title: '极限', kind: 'quiz', covers: [cover] },
      { id: 's2', title: '微分', kind: 'quiz', covers: [cover], dependsOn: ['s1'] },
    ] })
    expect(!parked.ok && parked.message).toMatch(/book's OWN path/)
    expect(!parked.ok && parked.message).toContain(bookId)
    // A second book or any non-book cover keeps it a genuine project path.
    const mixed = await service.draftRoadmap({ projectId, nodes: [
      { id: 's1', title: '极限', kind: 'quiz', covers: [cover] },
      { id: 's2', title: '串讲', kind: 'quiz', covers: [{ kind: 'topic', text: '讲授' }], dependsOn: ['s1'] },
    ] })
    expect(mixed.ok).toBe(true)
  })

  it('a read node on the project path completes by 读完', async () => {
    const { projectId } = await seed()
    await service.draftRoadmap({ projectId, nodes: [{ id: 'r1', title: '套件评测', kind: 'read', covers: [{ kind: 'url', url: 'https://so-arm.example', by: 'web' }] }] })
    await service.adoptRoadmap({ projectId })
    const read = await service.markNodeRead({ projectId, nodeId: 'r1' })
    expect(read.ok && read.roadmap.nodes[0]?.state).toBe('done')
  })

  it('a book-level draft stays the special case: one cover naming that one book', async () => {
    const { projectId, bookId } = await seed()
    const mixed = await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'n1', title: 'a', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [] }, { kind: 'topic', text: '讲授' }] }] })
    expect(!mixed.ok && mixed.message).toMatch(/PROJECT's path/)
    const topicOnly = await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'n1', title: 'a', kind: 'quiz', covers: [{ kind: 'topic', text: '讲授' }] }] })
    expect(!topicOnly.ok && topicOnly.message).toMatch(/PROJECT's path/)
  })

  it('validates covers: existing books and resources, urls, topic text, acceptance rules', async () => {
    const { projectId, bookId } = await seed()
    const draft = (covers: readonly unknown[], kind: 'quiz' | 'read' | 'practice' = 'quiz', acceptance?: readonly string[]) =>
      service.draftRoadmap({ projectId, nodes: [{ id: 's1', title: 'a', kind, covers: covers as never, ...(acceptance === undefined ? {} : { acceptance }) }] })
    const badBook = await draft([{ kind: 'book', bookId: 'b_none', ranges: [] }])
    expect(!badBook.ok && badBook.message).toMatch(/does not hold/)
    const outOfRange = await draft([{ kind: 'book', bookId, ranges: [{ from: 1, to: 99 }] }])
    expect(!outOfRange.ok && outOfRange.message).toMatch(/3 rows/)
    const badResource = await draft([{ kind: 'resource', resourceId: 'res_none' }])
    expect(!badResource.ok && badResource.message).toMatch(/not on the project's shelf/)
    const badUrl = await draft([{ kind: 'url', url: 'ftp://x.example' }])
    expect(!badUrl.ok && badUrl.message).toMatch(/http/)
    const blankTopic = await draft([{ kind: 'topic', text: '  ' }])
    expect(!blankTopic.ok && blankTopic.message).toMatch(/no text/)
    const unknown = await draft([{ kind: 'wiki', url: 'https://x.example' }])
    expect(!unknown.ok && unknown.message).toMatch(/unknown kind/)
    const noAcceptance = await draft([{ kind: 'topic', text: 'x' }], 'practice')
    expect(!noAcceptance.ok && noAcceptance.message).toMatch(/acceptance/)
    const misplaced = await draft([{ kind: 'topic', text: 'x' }], 'quiz', ['x'])
    expect(!misplaced.ok && misplaced.message).toMatch(/kind: "practice" only/)
    expect(!misplaced.ok && misplaced.message).toMatch(/goals/)
    const empty = await draft([])
    expect(!empty.ok && empty.message).toMatch(/at least one cover/)
    // A resource cover resolves against the shelf.
    const added = await service.addResource({ projectId, resource: { title: 'Gymnasium 文档', url: 'https://gymnasium.example', kind: 'tool', addedBy: 'coach' } })
    if (!added.ok) throw new Error(added.message)
    const ok = await draft([{ kind: 'resource', resourceId: added.resource.id }])
    expect(ok.ok).toBe(true)
  })
})

describe('station notes (讲义)', () => {
  it('writes and rewrites a station\'s notes on the adopted path; a re-plan keeps them', async () => {
    const { projectId, bookId } = await seed()
    await adopt(projectId, bookId)
    const written = await service.putNotes({ projectId, bookId, nodeId: 'n1', text: '## 离子通道\n\n先讲通透…' })
    expect(written.ok && written.notes.revisions).toBe(1)
    const seen = await service.getRoadmap({ projectId, bookId })
    expect(seen.roadmap?.nodes[0]?.notes?.text).toContain('离子通道')
    const rewritten = await service.putNotes({ projectId, bookId, nodeId: 'n1', text: '## 离子通道（补讲版）' })
    expect(rewritten.ok && rewritten.notes.revisions).toBe(2)
    // A re-plan that keeps the station's id also keeps its 讲义.
    await service.draftRoadmap({ projectId, bookId, nodes: [
      { id: 'n1', title: '离子通道（重排）', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [{ from: 1, to: 1 }] }] },
      { id: 'n2', title: '动作电位', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [{ from: 2, to: 2 }] }], dependsOn: ['n1'] },
    ] })
    await service.adoptRoadmap({ projectId, bookId })
    const replanned = await service.getRoadmap({ projectId, bookId })
    expect(replanned.roadmap?.nodes[0]?.notes?.revisions).toBe(2)
  })

  it('writes notes on a project-path station too, and teaches the bad calls', async () => {
    const { projectId, bookId } = await seed()
    const draft = await service.draftRoadmap({ projectId, nodes: [
      { id: 's1', title: '极限', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [{ from: 1, to: 1 }] }] },
      { id: 's2', title: '串讲', kind: 'quiz', covers: [{ kind: 'topic', text: '讲授' }], dependsOn: ['s1'] },
    ] })
    if (!draft.ok) throw new Error(draft.message)
    await service.adoptRoadmap({ projectId })
    const written = await service.putNotes({ projectId, nodeId: 's2', text: '讲授站讲义正文' })
    expect(written.ok).toBe(true)
    expect((await service.getRoadmap({ projectId })).roadmap?.nodes[1]?.notes?.text).toBe('讲授站讲义正文')
    // The bad calls teach.
    const noNode = await service.putNotes({ projectId, nodeId: 's9', text: 'x' })
    expect(!noNode.ok && noNode.message).toMatch(/no node/)
    const empty = await service.putNotes({ projectId, nodeId: 's2', text: '   ' })
    expect(!empty.ok && empty.message).toMatch(/need text/)
    const noPath = await service.putNotes({ projectId, bookId, nodeId: 'n1', text: 'x' })
    expect(!noPath.ok && noPath.message).toMatch(/no node/)
  })
})

describe('the evidence gate on covers', () => {
  /** Adopt a one-station path on the seeded book itself (a lone book's stations ride the book). */
  async function station(kind: 'knowledge' | 'material'): Promise<{ projectId: string; bookId: string }> {
    const seeded = await seed('subject', kind)
    const draft = await service.draftRoadmap({ projectId: seeded.projectId, bookId: seeded.bookId, nodes: [{ id: 's1', title: '一站', kind: 'quiz', covers: [{ kind: 'book', bookId: seeded.bookId, ranges: [] }] }] })
    if (!draft.ok) throw new Error(draft.message)
    const adopted = await service.adoptRoadmap({ projectId: seeded.projectId, bookId: seeded.bookId })
    if (!adopted.ok) throw new Error(adopted.message)
    return seeded
  }

  it('a station covering a material book refuses a memory-backed content question', async () => {
    const { projectId, bookId } = await station('material')
    const memory = await service.putQuiz({ projectId, quiz: { scope: { bookId, nodeId: 's1' }, questions: [question()] } })
    expect(!memory.ok && memory.message).toMatch(/material book/)
  })

  it('a station drawing on knowledge books and teaching allows domain knowledge', async () => {
    const { projectId, bookId } = await seed()
    const draft = await service.draftRoadmap({ projectId, nodes: [{ id: 's1', title: '一站', kind: 'quiz', covers: [{ kind: 'book', bookId, ranges: [{ from: 1, to: 1 }] }, { kind: 'topic', text: '讲授' }] }] })
    if (!draft.ok) throw new Error(draft.message)
    await service.adoptRoadmap({ projectId })
    const stored = await service.putQuiz({ projectId, quiz: { scope: { nodeId: 's1' }, questions: [question()] } })
    expect(stored.ok).toBe(true)
  })

  it('a station covering a url demands a verbatim quote for content questions', async () => {
    const { projectId } = await seed()
    const draft = await service.draftRoadmap({ projectId, nodes: [{ id: 's1', title: 'RL 直觉', kind: 'quiz', covers: [{ kind: 'url', url: 'https://gymnasium.example', title: 'Gymnasium 文档', by: 'web', verifiedAt: '2026-10-13T00:00:00.000Z' }] }] })
    if (!draft.ok) throw new Error(draft.message)
    await service.adoptRoadmap({ projectId })
    const memory = await service.putQuiz({ projectId, quiz: { scope: { nodeId: 's1' }, questions: [question()] } })
    expect(!memory.ok && memory.message).toMatch(/web text/)
    const quoted = await service.putQuiz({ projectId, quiz: { scope: { nodeId: 's1' }, questions: [question({ evidence: { kind: 'web', url: 'https://gymnasium.example', quote: 'a long enough quote' } })] } })
    expect(quoted.ok).toBe(true)
  })

  it('a free quiz (no book, no node) may rest on domain knowledge, and reads back', async () => {
    const { projectId } = await seed()
    const stored = await service.putQuiz({ projectId, quiz: { scope: {}, questions: [question()] } })
    if (!stored.ok) throw new Error(stored.message)
    expect(stored.quiz.scope.bookId).toBeUndefined()
    const read = await service.getQuiz({ projectId, quizId: stored.quiz.id })
    expect(read.ok && read.quiz.questions).toHaveLength(1)
    expect((await service.listQuizzes({ projectId })).quizzes.map(quiz => quiz.id)).toContain(stored.quiz.id)
  })

  it('a node-scoped quiz on a book\'s own path reads the same gate through its cover', async () => {
    const { projectId, bookId } = await seed('language', 'material')
    await adopt(projectId, bookId)
    const memory = await service.putQuiz({ projectId, quiz: { scope: { bookId, nodeId: 'n1' }, questions: [question()] } })
    expect(!memory.ok && memory.message).toMatch(/material book/)
    const recorded = await service.recordPage({ projectId, bookId, attachment: photo, text: 'anxious to define and circumscribe the various worlds', marks: [{ text: 'circumscribe', gloss: '限定' }] })
    if (!recorded.ok) throw new Error(recorded.message)
    const grounded = await service.putQuiz({ projectId, quiz: { scope: { bookId, nodeId: 'n1' }, questions: [question({ evidence: { kind: 'photo', pageId: recorded.page.id, quote: 'define and circumscribe the various worlds' } })] } })
    expect(grounded.ok).toBe(true)
  })
})

describe('practice acceptance', () => {
  /** Adopt a project path: s1 practice (three acceptance lines) → s2 quiz. */
  async function seedPath(): Promise<{ projectId: string }> {
    const { projectId } = await seed()
    const draft = await service.draftRoadmap({
      projectId,
      nodes: [
        { id: 's1', title: 'RL 直觉', kind: 'practice', covers: [{ kind: 'topic', text: '奖励 = 行为塑造' }], acceptance: ['跑满 20 万步', '平均奖励 > 475', '说清 reward 谁写的'] },
        { id: 's2', title: '快慢回路', kind: 'quiz', covers: [{ kind: 'topic', text: '讲授' }], dependsOn: ['s1'] },
      ],
    })
    if (!draft.ok) throw new Error(draft.message)
    const adopted = await service.adoptRoadmap({ projectId })
    if (!adopted.ok) throw new Error(adopted.message)
    return { projectId }
  }

  it('judges one verdict per acceptance line, verbatim; partial credit rides the pass ratio', async () => {
    const { projectId } = await seedPath()
    const wrongLine = await service.putAttempt({ projectId, nodeId: 's1', verdicts: [{ task: 's1', criterion: '跑满了', pass: true, evidence: '终端', by: 'llm' }] })
    expect(!wrongLine.ok && wrongLine.message).toMatch(/acceptance lines, verbatim/)
    // 2 pass + 1 fail = 2/3 ≈ 0.67 < 0.8: no completion, no unlock; the failed line leaves a card.
    const first = await service.putAttempt({ projectId, nodeId: 's1', verdicts: [
      { task: 's1', criterion: '跑满 20 万步', pass: true, evidence: '终端输出', by: 'llm' },
      { task: 's1', criterion: '平均奖励 > 475', pass: true, evidence: '曲线截图', by: 'llm' },
      { task: 's1', criterion: '说清 reward 谁写的', pass: false, evidence: '会话回答', by: 'llm', missedCard: { term: 'CartPole 奖励', gloss: '杆子不倒 +1' } },
    ] })
    if (!first.ok) throw new Error(first.message)
    expect(first.attempt.ratio).toBeCloseTo(2 / 3)
    expect(first.attempt.nodeId).toBe('s1')
    expect(first.attempt.quizId).toBeUndefined()
    expect(first.completed).toBeUndefined()
    expect(first.unlocked).toEqual([])
    expect(first.cardUpdates.find(update => update.created === true)?.term).toBe('CartPole 奖励')
    expect((await service.getRoadmap({ projectId })).roadmap?.nodes.map(node => node.state)).toEqual(['current', 'locked'])
    // The retake: 2 pass + 1 half credit = (1+1+0.5)/3 ≈ 0.83 ≥ 0.8 — completes, unlocks.
    const second = await service.putAttempt({ projectId, nodeId: 's1', verdicts: [
      { task: 's1', criterion: '跑满 20 万步', pass: true, evidence: '终端输出', by: 'llm' },
      { task: 's1', criterion: '平均奖励 > 475', pass: true, evidence: '曲线截图', by: 'llm' },
      { task: 's1', criterion: '说清 reward 谁写的', pass: false, ratio: 0.5, evidence: '会话回答', by: 'llm' },
    ] })
    if (!second.ok) throw new Error(second.message)
    expect(second.attempt.ratio).toBeCloseTo(5 / 6)
    expect([second.completed, second.unlocked]).toEqual(['s1', ['s2']])
    expect((await service.getRoadmap({ projectId })).roadmap?.nodes.map(node => node.state)).toEqual(['done', 'current'])
    // The station's history reads back newest first, and the events ledgered.
    const history = await service.listAttempts({ projectId, nodeId: 's1' })
    expect(history.attempts).toHaveLength(2)
    expect(history.attempts[0]?.ratio).toBeCloseTo(5 / 6)
    expect(history.attempts[1]?.ratio).toBeCloseTo(2 / 3)
    const events = await service.listEvents({ projectId, types: ['node.completed', 'node.unlocked'] })
    expect(events.events.map(event => [event.type, event.id])).toEqual([['node.unlocked', 's2'], ['node.completed', 's1']])
  })

  it('refuses the wrong shape: both keys, neither, an unknown station, a non-practice node', async () => {
    const { projectId } = await seedPath()
    const verdicts = [{ task: 's1', criterion: '跑满 20 万步', pass: true, evidence: 'x', by: 'llm' as const }]
    expect(!((await service.putAttempt({ projectId, quizId: 'q_1', nodeId: 's1', verdicts })).ok)).toBe(true)
    const neither = await service.putAttempt({ projectId, verdicts })
    expect(!neither.ok && neither.message).toMatch(/exactly one/)
    const unknown = await service.putAttempt({ projectId, nodeId: 's9', verdicts })
    expect(!unknown.ok && unknown.error).toBe('not-found')
    const quizNode = await service.putAttempt({ projectId, nodeId: 's2', verdicts })
    expect(!quizNode.ok && quizNode.error).toBe('state-machine')
  })

  it('accepts a practice station on a book\'s own path too', async () => {
    const { projectId, bookId } = await seed()
    const draft = await service.draftRoadmap({
      projectId, bookId,
      nodes: [{ id: 'p1', title: '动手', kind: 'practice', covers: [{ kind: 'book', bookId, ranges: [{ from: 1, to: 1 }] }], acceptance: ['做完实验'] }],
    })
    if (!draft.ok) throw new Error(draft.message)
    await service.adoptRoadmap({ projectId, bookId })
    const assessed = await service.putAttempt({ projectId, nodeId: 'p1', bookId, verdicts: [{ task: 'p1', criterion: '做完实验', pass: true, evidence: '照片', by: 'user' }] })
    expect(assessed.ok && assessed.completed).toBe('p1')
  })
})

describe('pages and cards', () => {
  it('cards every certain mark at once and holds uncertain ones back', async () => {
    const { projectId, bookId } = await seed('language', 'material')
    const recorded = await service.recordPage({
      projectId,
      bookId,
      label: 'p.16',
      attachment: photo,
      text: 'at a breakfast held at the Golden Anchor Inn near Holborn Bar. He was to be paid £1,575 in instalments.',
      marks: [
        { text: 'held', sentence: 'at a breakfast held at the Golden Anchor Inn', gloss: '举办' },
        { text: 'instalments', sentence: 'He was to be paid £1,575 in instalments', gloss: '分期付款' },
        { text: 'heroic', handNote: '英勇的' },
        { text: 'down the middle', uncertain: true },
      ],
    })
    if (!recorded.ok) throw new Error(recorded.message)
    expect(recorded.cards.added.map(card => card.term)).toEqual(['held', 'instalments', 'heroic'])
    expect(recorded.uncertain).toEqual(['down the middle'])
    expect(recorded.cards.added.every(card => card.kind === 'word' && card.bookId === bookId)).toBe(true)
    expect(recorded.cards.added[2]?.userGloss).toBe('英勇的')
    expect(recorded.page.cardIds).toHaveLength(3)
  })

  it('merges an exact key (a plural away) and stacks the context', async () => {
    const { projectId, bookId } = await seed('language', 'material')
    await service.recordPage({ projectId, bookId, attachment: photo, text: 'paid in instalments', marks: [{ text: 'instalments', sentence: 'paid in instalments', gloss: '分期付款' }] })
    const again = await service.writeCards({ projectId, cards: [{ kind: 'word', term: 'instalment', gloss: '分期', context: { sentence: 'pay by instalment' }, source: { type: 'manual' } }] })
    if (!again.ok) throw new Error(again.message)
    expect(again.added).toHaveLength(0)
    expect(again.merged[0]?.contexts.map(context => context.sentence)).toEqual(['paid in instalments', 'pay by instalment'])
    expect(again.merged[0]?.gloss).toBe('分期付款')
  })

  it('holds a near-duplicate back with candidates, then honors mergeInto / asNew', async () => {
    const { projectId } = await seed()
    const first = await service.writeCards({ projectId, cards: [{ kind: 'concept', term: '绝对/相对不应期', gloss: '绝对看 Na⁺ 失活，相对看 K⁺ 还没关', source: { type: 'chat', note: '说老是记混' }, weaken: true }] })
    if (!first.ok) throw new Error(first.message)
    const near = await service.writeCards({ projectId, cards: [{ kind: 'concept', term: '不应期', gloss: '…', source: { type: 'photo' } }] })
    if (!near.ok) throw new Error(near.message)
    expect(near.added).toHaveLength(0)
    expect(near.pending[0]?.candidates[0]?.id).toBe(first.added[0]?.id)
    const merged = await service.writeCards({ projectId, cards: [{ kind: 'concept', term: '不应期', gloss: '…', source: { type: 'chat' }, weaken: true, mergeInto: first.added[0]!.id }] })
    expect(merged.ok && merged.merged[0]?.weakness).toBe(2)
    expect(merged.ok && merged.merged[0]?.aliases).toContain('不应期')
    const separate = await service.writeCards({ projectId, cards: [{ kind: 'concept', term: '不应期', gloss: '…', source: { type: 'manual' }, asNew: true }] })
    expect(separate.ok && separate.added).toHaveLength(1)
  })

  it('a chat card starts weak; search finds it by alias and sentence', async () => {
    const { projectId, bookId } = await seed()
    await service.writeCards({ projectId, bookId, cards: [{ kind: 'concept', term: '长度常数 λ', aliases: ['length constant'], gloss: '膜电阻越大 λ 越大', context: { sentence: 'λ = √(rm/ra)' }, source: { type: 'chat' } }] })
    const byAlias = await service.listCards({ projectId, query: 'Length Constant' })
    expect(byAlias.cards[0]?.weakness).toBe(1)
    expect((await service.listCards({ projectId, query: 'rm/ra' })).total).toBe(1)
    expect((await service.listCards({ projectId, query: '突触' })).total).toBe(0)
  })

  it('undo removes what a recording created and reverts what it merged', async () => {
    const { projectId } = await seed()
    const first = await service.writeCards({ projectId, cards: [{ kind: 'concept', term: '阈值', gloss: 'g', source: { type: 'chat' } }] })
    if (!first.ok) throw new Error(first.message)
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = await service.writeCards({ projectId, cards: [
      { kind: 'concept', term: '阈值', gloss: 'g', source: { type: 'chat' }, weaken: true },
      { kind: 'concept', term: '髓鞘', gloss: 'g', source: { type: 'chat' } },
    ] })
    if (!second.ok) throw new Error(second.message)
    const events = await service.listEvents({ projectId, types: ['cards.recorded'] })
    const latest = events.events[0]!
    const undone = await service.undoCards({ projectId, ids: latest.ids ?? [], at: latest.at })
    expect(undone.ok && [undone.removed, undone.reverted]).toEqual([1, 1])
    const left = await service.listCards({ projectId })
    expect(left.cards.map(card => [card.term, card.weakness])).toEqual([['阈值', 1]])
  })

  it('reviews move only the schedule', async () => {
    const { projectId } = await seed()
    const written = await service.writeCards({ projectId, cards: [{ kind: 'concept', term: '阈值', gloss: 'g', source: { type: 'chat' } }] })
    if (!written.ok) throw new Error(written.message)
    const id = written.added[0]!.id
    const recalled = await service.reviewCard({ projectId, cardId: id, rating: 'recalled' })
    expect(recalled.ok && [recalled.card.mastery.box, recalled.card.weakness]).toEqual([1, 1])
    const forgot = await service.reviewCard({ projectId, cardId: id, rating: 'forgot' })
    expect(forgot.ok && forgot.card.mastery.box).toBe(0)
  })
})

describe('quizzes: the two axes', () => {
  it('a knowledge book takes a topic question from domain knowledge', async () => {
    const { projectId, bookId } = await seed()
    const stored = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question()] } })
    expect(stored.ok).toBe(true)
  })

  it('a material book refuses a content question from memory but takes a photo-backed one', async () => {
    const { projectId, bookId } = await seed('language', 'material')
    const memory = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question()] } })
    expect(!memory.ok && memory.message).toMatch(/material book/)
    const recorded = await service.recordPage({ projectId, bookId, attachment: photo, text: 'anxious to define and circumscribe the various worlds to conquer', marks: [{ text: 'circumscribe', gloss: '限定' }] })
    if (!recorded.ok) throw new Error(recorded.message)
    const cardId = recorded.cards.added[0]!.id
    const grounded = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question({
      kind: 'choice',
      prompt: 'circumscribe 最接近？',
      options: ['环绕', '限定'],
      answer: '限定',
      target: { kind: 'marked', cardIds: [cardId] },
      evidence: { kind: 'photo', pageId: recorded.page.id, quote: 'define and circumscribe the various worlds' },
    })] } })
    expect(grounded.ok && grounded.warnings).toEqual([expect.stringContaining('本书测验')])
  })

  it('names what is wrong: no cards for a card target, no url for web evidence, a misquote', async () => {
    const { projectId, bookId } = await seed()
    const noCards = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question({ target: { kind: 'asked' } })] } })
    expect(!noCards.ok && noCards.message).toMatch(/cardIds/)
    const noUrl = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question({ evidence: { kind: 'web', quote: 'a long enough quote' } })] } })
    expect(!noUrl.ok && noUrl.message).toMatch(/url/)
  })

  it('refuses a choice question whose answer matches no option, and takes a letter key', async () => {
    const { projectId, bookId } = await seed()
    const stray = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question({ kind: 'choice', options: ['环绕', '限定'], answer: '征服' })] } })
    expect(!stray.ok && stray.message).toMatch(/matches no option/)
    const outOfRange = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question({ kind: 'choice', options: ['环绕', '限定'], answer: 'D' })] } })
    expect(!outOfRange.ok && outOfRange.message).toMatch(/matches no option/)
    const lettered = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question({ kind: 'choice', options: ['环绕', '限定'], answer: 'b. 限定' })] } })
    expect(lettered.ok).toBe(true)
  })

  it('warns when the scoped node is still locked', async () => {
    const { projectId, bookId } = await seed()
    await adopt(projectId, bookId)
    const stored = await service.putQuiz({ projectId, quiz: { scope: { bookId, nodeId: 'n2' }, questions: [question()] } })
    expect(stored.ok && stored.warnings[0]).toMatch(/still locked/)
  })

  it('says where a station-less quiz landed: the book page, or the project page for a free one', async () => {
    const { projectId, bookId } = await seed()
    const bookLevel = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question()] } })
    expect(bookLevel.ok && bookLevel.warnings.at(-1)).toMatch(/本书测验/)
    const free = await service.putQuiz({ projectId, quiz: { scope: {}, questions: [question()] } })
    expect(free.ok && free.warnings.at(-1)).toMatch(/自由测验/)
  })

  it('holds a quiz to the learner\'s chosen source', async () => {
    const { projectId, bookId } = await seed()
    const mine = await service.putQuiz({ projectId, quiz: { scope: { bookId }, focus: 'mine', questions: [question()] } })
    expect(!mine.ok && mine.message).toMatch(/OWN points only/)
    const written = await service.writeCards({ projectId, bookId, cards: [{ kind: 'concept', term: '不应期', gloss: 'g', source: { type: 'photo' } }] })
    if (!written.ok) throw new Error(written.message)
    const ok = await service.putQuiz({ projectId, quiz: { scope: { bookId }, focus: 'mine', questions: [question({ target: { kind: 'marked', cardIds: [written.added[0]!.id] } })] } })
    expect(ok.ok && ok.quiz.focus).toBe('mine')
    const book = await service.putQuiz({ projectId, quiz: { scope: { bookId }, focus: 'book', questions: [question({ target: { kind: 'marked', cardIds: [written.added[0]!.id] } })] } })
    expect(!book.ok && book.message).toMatch(/book's content only/)
  })

  it('refuses a read node as the quiz scope', async () => {
    const { projectId, bookId } = await seed()
    await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'r1', title: '导读', kind: 'read', covers: [{ kind: 'book', bookId, ranges: [] }] }] })
    await service.adoptRoadmap({ projectId, bookId })
    const scoped = await service.putQuiz({ projectId, quiz: { scope: { bookId, nodeId: 'r1' }, questions: [question()] } })
    expect(!scoped.ok && scoped.message).toMatch(/read node/)
  })
})

describe('the assess cascade', () => {
  it('moves target cards, cards a card-less miss, and unlocks at the pass ratio', async () => {
    const { projectId, bookId } = await seed()
    await adopt(projectId, bookId)
    const weak = await service.writeCards({ projectId, bookId, cards: [{ kind: 'concept', term: '绝对/相对不应期', gloss: 'g', source: { type: 'chat' }, weaken: true }] })
    if (!weak.ok) throw new Error(weak.message)
    const cardId = weak.added[0]!.id
    const quiz = await service.putQuiz({ projectId, quiz: { scope: { bookId, nodeId: 'n1' }, questions: [
      question({ id: 'q1', target: { kind: 'asked', cardIds: [cardId] } }),
      question({ id: 'q2', prompt: 'Na⁺ 通道三态？', answer: '关闭、开放、失活' }),
      question({ id: 'q3', prompt: '坏题', answer: 'x' }),
    ] } })
    if (!quiz.ok) throw new Error(quiz.message)
    const assessed = await service.putAttempt({ projectId, quizId: quiz.quiz.id, verdicts: [
      { task: 'q1', criterion: '机制', pass: true, evidence: '领域知识', by: 'llm' },
      { task: 'q2', criterion: '三态', pass: false, evidence: '领域知识', by: 'llm', missedCard: { term: 'Na⁺ 通道三态', gloss: '关闭→开放→失活' } },
      { task: 'q3', criterion: '作废', pass: false, evidence: '-', by: 'user', void: true },
    ] })
    if (!assessed.ok) throw new Error(assessed.message)
    // 1 of 2 counted (q3 void) = 0.5 < 0.8: no unlock yet.
    expect(assessed.attempt.ratio).toBe(0.5)
    expect(assessed.completed).toBeUndefined()
    const moved = assessed.cardUpdates.find(update => update.id === cardId)
    expect(moved?.weakness).toBe(0)
    expect(moved?.mastery.box).toBe(1)
    const created = assessed.cardUpdates.find(update => update.created === true)
    expect(created?.term).toBe('Na⁺ 通道三态')
    expect((await service.recentRecords({})).records[0]?.source).toBe('quiz')

    const retake = await service.putQuiz({ projectId, quiz: { scope: { bookId, nodeId: 'n1' }, questions: [question({ id: 'q1' })] } })
    if (!retake.ok) throw new Error(retake.message)
    const passed = await service.putAttempt({ projectId, quizId: retake.quiz.id, verdicts: [{ task: 'q1', criterion: 'x', pass: true, evidence: 'y', by: 'llm' }] })
    expect(passed.ok && [passed.completed, passed.unlocked]).toEqual(['n1', ['n2']])
  })
})

describe('activity', () => {
  it('reports the newest event across projects, or nothing', async () => {
    expect(await service.latestActivity()).toEqual({})
    const { projectId } = await seed()
    const first = await service.latestActivity()
    expect(first.at).toBeDefined()
    await service.writeCards({ projectId, cards: [{ kind: 'concept', term: '阈值', gloss: 'g', source: { type: 'chat' } }] })
    const next = await service.latestActivity()
    expect(next.at !== undefined && first.at !== undefined && next.at >= first.at).toBe(true)
  })
})

describe('bindings', () => {
  it('binds a session to a project and book, and refuses a missing book', async () => {
    const { projectId, bookId } = await seed()
    expect((await service.setBinding('s1', { projectId, bookId })).ok).toBe(true)
    expect(service.getBinding('s1')).toEqual({ projectId, bookId })
    expect((await service.setBinding('s1', { projectId, bookId: 'b_none' })).ok).toBe(false)
    await service.setBinding('s1', null)
    expect(service.getBinding('s1')).toBeUndefined()
  })

  it('summarizes the bound book and its weak cards synchronously', async () => {
    const { projectId, bookId } = await seed()
    await adopt(projectId, bookId)
    await service.writeCards({ projectId, bookId, cards: [{ kind: 'concept', term: '不应期', gloss: 'g', source: { type: 'chat' } }] })
    await service.setBinding('s1', { projectId, bookId })
    const summary = service.bindingSummary('s1')
    expect(summary.book?.title).toBe('Principles of Neural Science')
    expect(summary.progress?.current?.id).toBe('n1')
    expect(summary.weakCards.map(card => card.term)).toEqual(['不应期'])
  })

  it('a project-only binding reports the project path\'s current station', async () => {
    const { projectId } = await seed()
    const draft = await service.draftRoadmap({
      projectId,
      nodes: [{ id: 's1', title: 'RL 直觉', kind: 'practice', covers: [{ kind: 'topic', text: '讲授' }], acceptance: ['跑通'] }],
    })
    if (!draft.ok) throw new Error(draft.message)
    await service.adoptRoadmap({ projectId })
    await service.setBinding('s2', { projectId })
    const summary = service.bindingSummary('s2')
    expect(summary.book).toBeUndefined()
    expect(summary.progress?.current?.id).toBe('s1')
    expect(summary.progress?.current?.title).toBe('RL 直觉')
  })
})
