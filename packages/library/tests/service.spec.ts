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
  const book = await service.putResource({
    projectId: created.project.id,
    kind: 'book',
    title: bookKind === 'material' ? 'Cambridge IELTS 5' : 'Principles of Neural Science',
    ...(bookKind === 'material' ? {} : { edition: '6th' }),
    bookKind,
    toc: bookKind === 'material'
      ? [{ title: 'Johnson\'s Dictionary', part: 'Test 1' }, { title: 'Nature or Nurture?', part: 'Test 1' }]
      : [{ title: 'Ion Channels' }, { title: 'Propagated Signaling: The Action Potential' }, { title: 'Overview of Synaptic Transmission' }],
    tocSource: { by: 'web', url: 'https://example.org/toc' },
  })
  if (!book.ok) throw new Error(book.message)
  return { projectId: created.project.id, bookId: book.resource.id }
}

/** Draft and adopt a two-quiz-node path (n1 → n2). */
async function adopt(projectId: string, bookId: string): Promise<void> {
  const draft = await service.draftRoadmap({
    projectId,
    resourceId: bookId,
    nodes: [
      { id: 'n1', title: '离子通道', gate: 'quiz', covers: [{ ref: bookId, locator: '1' }] },
      { id: 'n2', title: '动作电位', gate: 'quiz', covers: [{ ref: bookId, locator: '2' }], dependsOn: ['n1'] },
    ],
    note: '每周 3 章',
  })
  if (!draft.ok) throw new Error(draft.message)
  const adopted = await service.adoptRoadmap({ projectId, resourceId: bookId })
  if (!adopted.ok) throw new Error(adopted.message)
}

/** A coach-authored textbook in the project: its own outline, no web check. */
async function authored(projectId: string, title = '强化学习入门（自编）'): Promise<string> {
  const written = await service.putResource({
    projectId,
    kind: 'book',
    title,
    origin: 'authored',
    toc: [{ title: '奖励与回报' }, { title: '策略梯度' }, { title: '实战 CartPole' }],
    tocSource: { by: 'model' },
  })
  if (!written.ok) throw new Error(written.message)
  return written.resource.id
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
    const bare = await service.putResource({ projectId, kind: 'book', title: 'X', bookKind: 'knowledge', toc: [], tocSource: { by: 'model' } })
    expect(bare.ok).toBe(false)
    const noUrl = await service.putResource({ projectId, kind: 'book', title: 'Y', bookKind: 'knowledge', toc: [{ title: 'a' }], tocSource: { by: 'web' } })
    expect(!noUrl.ok && noUrl.message).toMatch(/url/)
  })

  it('a draft does nothing until adopted; adoption starts the roots', async () => {
    const { projectId, bookId } = await seed()
    const cover = { ref: bookId }
    await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'n1', title: 'a', gate: 'quiz', covers: [cover] }, { id: 'n2', title: 'b', gate: 'quiz', covers: [cover], dependsOn: ['n1'] }] })
    const before = await service.getRoadmap({ projectId, resourceId: bookId })
    expect(before.roadmap).toBeUndefined()
    expect(before.draft?.status).toBe('draft')
    const adopted = await service.adoptRoadmap({ projectId, resourceId: bookId })
    expect(adopted.ok && adopted.roadmap.nodes.map(node => node.state)).toEqual(['current', 'locked'])
    expect((await service.getRoadmap({ projectId, resourceId: bookId })).draft).toBeUndefined()
  })

  it('re-adopting keeps the progress of surviving nodes', async () => {
    const { projectId, bookId } = await seed()
    const cover = { ref: bookId }
    await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'r1', title: '导论', gate: 'read', covers: [cover] }, { id: 'n1', title: 'a', gate: 'quiz', covers: [cover] }] })
    await service.adoptRoadmap({ projectId, resourceId: bookId })
    await service.markNodeRead({ projectId, resourceId: bookId, nodeId: 'r1' })
    await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'r1', title: '导论', gate: 'read', covers: [cover] }, { id: 'n1', title: 'a', gate: 'quiz', covers: [cover] }, { id: 'n2', title: 'b', gate: 'quiz', covers: [cover], dependsOn: ['n1'] }, { id: 'r2', title: '概述', gate: 'read', covers: [cover], dependsOn: ['n2'] }] })
    const again = await service.adoptRoadmap({ projectId, resourceId: bookId })
    // A read node is a side stop: open at once, whatever it follows.
    expect(again.ok && again.roadmap.nodes.map(node => node.state)).toEqual(['done', 'current', 'locked', 'current'])
  })

  it('never lets a read node gate a level, and keeps extras and the cover abbreviation', async () => {
    const { projectId, bookId } = await seed()
    const cover = { ref: bookId }
    const gated = await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'r1', title: '怎么用这本书', gate: 'read', covers: [cover] }, { id: 'n1', title: 'a', gate: 'quiz', covers: [cover], dependsOn: ['r1'] }] })
    expect(!gated.ok && gated.message).toMatch(/never gates a level/)
    const book = await service.putResource({
      projectId, resourceId: bookId, kind: 'book', title: 'Principles of Neural Science', short: 'PNS', bookKind: 'knowledge', tocSource: { by: 'model' },
      toc: [{ title: 'Ion Channels' }], extras: [{ title: '怎么用这本书', note: '考试结构与评分', when: 'before' }, { title: 'Answer key', where: 'p.152', when: 'reference' }],
    })
    expect(book.ok && [book.resource.meta?.short, book.resource.meta?.extras?.map(extra => extra.when)]).toEqual(['PNS', ['before', 'reference']])
  })

  it('keeps a goal written as a bare string and drops part-heading rows', async () => {
    const { projectId } = await seed()
    const book = await service.putResource({
      projectId, kind: 'book', title: 'PNS', bookKind: 'knowledge', tocSource: { by: 'model' },
      toc: [{ title: 'Part II: Cells', part: 'Part II: Cells' }, { title: 'Ion Channels', part: 'Part II: Cells' }],
    })
    if (!book.ok) throw new Error(book.message)
    expect(book.resource.toc?.map(row => row.title)).toEqual(['Ion Channels'])
    const draft = await service.draftRoadmap({ projectId, resourceId: book.resource.id, nodes: [{ id: 'n1', title: 'a', gate: 'quiz', goals: '说清离子通道', covers: [{ ref: book.resource.id }] }] })
    expect(draft.ok && draft.draft.nodes[0]?.goals).toEqual(['说清离子通道'])
    expect((await service.getRoadmap({ projectId, resourceId: book.resource.id })).draft?.nodes[0]?.goals).toEqual(['说清离子通道'])
  })

  it('refuses locators outside the contents and forward dependencies', async () => {
    const { projectId, bookId } = await seed()
    const outside = await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'n1', title: 'a', gate: 'quiz', covers: [{ ref: bookId, locator: '1-9' }] }] })
    expect(!outside.ok && outside.message).toMatch(/3 rows/)
    const forward = await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'n1', title: 'a', gate: 'quiz', covers: [{ ref: bookId }], dependsOn: ['n2'] }, { id: 'n2', title: 'b', gate: 'quiz', covers: [{ ref: bookId }] }] })
    expect(!forward.ok && forward.message).toMatch(/AFTER/)
  })
})

describe('resources', () => {
  it('puts a link on the shelf, validates url / kind / title, and refuses a duplicate', async () => {
    const { projectId } = await seed()
    const noProject = await service.putResource({ projectId: 'p_none', title: 'x', url: 'https://x.example', kind: 'article', origin: 'picked' })
    expect(!noProject.ok && noProject.error).toBe('not-found')
    const badUrl = await service.putResource({ projectId, title: 'x', url: 'ftp://x.example', kind: 'article', origin: 'picked' })
    expect(!badUrl.ok && badUrl.message).toMatch(/https?:\/\//)
    const badKind = await service.putResource({ projectId, title: 'x', url: 'https://x.example', kind: 'zine' as never, origin: 'picked' })
    expect(!badKind.ok && badKind.message).toMatch(/article \| video/)
    const bare = await service.putResource({ projectId, title: '  ', url: 'https://x.example', kind: 'article', origin: 'picked' })
    expect(!bare.ok && bare.message).toMatch(/title/)
    const added = await service.putResource({ projectId, title: 'NumPy 快速教程', url: 'https://numpy.org/quickstart', kind: 'article', note: '热身站的读物', origin: 'picked' })
    if (!added.ok) throw new Error(added.message)
    expect(added.resource.id).toMatch(/^r_/)
    const dupe = await service.putResource({ projectId, title: 'same link', url: 'https://numpy.org/quickstart', kind: 'video', origin: 'learner' })
    expect(!dupe.ok && dupe.error).toBe('exists')
  })

  it('lists oldest first, ledgers the add, and removes only what exists', async () => {
    const { projectId, bookId } = await seed()
    // The sort key is createdAt at millisecond precision — every write must get
    // its own tick, seed's book included: wait until the clock passes the
    // previous write's stamp (a blind sleep still ties under gate load).
    const tickPast = async (isoStamp: string): Promise<void> => {
      const stamp = Date.parse(isoStamp)
      while (Date.now() <= stamp) await new Promise(resolve => setTimeout(resolve, 1))
    }
    const book = await service.getResource({ projectId, resourceId: bookId })
    if (!book.ok) throw new Error(book.message)
    await tickPast(book.resource.createdAt)
    const first = await service.putResource({ projectId, title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool', origin: 'picked' })
    if (!first.ok) throw new Error(first.message)
    await tickPast(first.resource.createdAt)
    const second = await service.putResource({ projectId, title: 'LeRobot', url: 'https://github.com/huggingface/lerobot', kind: 'repo', origin: 'picked' })
    if (!second.ok) throw new Error(second.message)
    expect((await service.listResources({ projectId })).resources.map(resource => resource.title)).toEqual(['Principles of Neural Science', 'MuJoCo', 'LeRobot'])
    const events = await service.listEvents({ projectId, types: ['resource.added'] })
    expect(events.events.map(event => event.id)).toEqual([second.resource.id, first.resource.id, bookId])
    const missing = await service.removeResource({ projectId, resourceId: 'r_none' })
    expect(!missing.ok && missing.error).toBe('not-found')
    expect((await service.removeResource({ projectId, resourceId: first.resource.id })).ok).toBe(true)
    expect((await service.listResources({ projectId })).resources.map(resource => resource.title)).toEqual(['Principles of Neural Science', 'LeRobot'])
  })

  it('numbers textbooks in study order: appended, inserted at seq, moved, and closed up on removal', async () => {
    const { projectId, bookId } = await seed()
    const order = async (): Promise<string[]> => (await service.listResources({ projectId })).resources
      .filter(resource => resource.seq !== undefined).map(resource => `${resource.seq}:${resource.title}`)
    expect(await order()).toEqual(['1:Principles of Neural Science'])
    const rl = await authored(projectId)
    const first = await service.putResource({ projectId, kind: 'book', title: '普林斯顿微积分读本', origin: 'learner', seq: 1, toc: [{ title: '函数' }], tocSource: { by: 'model' } })
    if (!first.ok) throw new Error(first.message)
    expect(first.resource).toMatchObject({ seq: 1, origin: 'learner' })
    expect(await order()).toEqual(['1:普林斯顿微积分读本', '2:Principles of Neural Science', '3:强化学习入门（自编）'])
    // A link never takes a place in the order.
    const link = await service.putResource({ projectId, title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool', seq: 1 })
    expect(link.ok && link.resource.seq).toBeUndefined()
    const moved = await service.moveResource({ projectId, resourceId: rl, seq: 1 })
    expect(moved.ok).toBe(true)
    expect(await order()).toEqual(['1:强化学习入门（自编）', '2:普林斯顿微积分读本', '3:Principles of Neural Science'])
    const clamped = await service.moveResource({ projectId, resourceId: rl, seq: 99 })
    expect(clamped.ok).toBe(true)
    expect((await order()).at(-1)).toBe('3:强化学习入门（自编）')
    const linkMove = await service.moveResource({ projectId, resourceId: link.ok ? link.resource.id : '', seq: 1 })
    expect(!linkMove.ok && linkMove.message).toMatch(/only textbooks/)
    expect((await service.removeResource({ projectId, resourceId: bookId })).ok).toBe(true)
    expect(await order()).toEqual(['1:普林斯顿微积分读本', '2:强化学习入门（自编）'])
    const badOrigin = await service.putResource({ projectId, kind: 'book', title: 'x', origin: 'stolen' as never, toc: [{ title: 'a' }], tocSource: { by: 'model' } })
    expect(!badOrigin.ok && badOrigin.message).toMatch(/learner \| picked \| authored/)
  })
})

describe('textbook paths', () => {
  it('a path always belongs to a textbook: drafts, adopts, reads and discards one; refuses one without', async () => {
    const { projectId, bookId } = await seed()
    const rl = await authored(projectId)
    const orphan = await service.draftRoadmap({ projectId, resourceId: '', nodes: [{ id: 's1', title: 'x', gate: 'read', covers: [{ ref: 'topic:x' }] }] })
    expect(!orphan.ok && orphan.message).toMatch(/belongs to one textbook/)
    expect(!orphan.ok && orphan.message).toContain(rl)
    const draft = await service.draftRoadmap({
      projectId,
      resourceId: rl,
      nodes: [
        { id: 's1', title: 'NumPy 热身', gate: 'acceptance', goals: ['能写 50 行脚本'], covers: [{ ref: 'topic:教练带写 RobotArm 类' }], acceptance: ['跑通三关节脚本'] },
        { id: 's2', title: '快慢回路', gate: 'quiz', covers: [{ ref: rl, locator: '1' }, { ref: bookId, locator: '2' }], dependsOn: ['s1'] },
      ],
      note: '每周 2 站',
    })
    if (!draft.ok) throw new Error(draft.message)
    expect(draft.draft.primaryResourceId).toBe(rl)
    const seen = await service.getRoadmap({ projectId, resourceId: rl })
    expect(seen.draft?.nodes.map(node => node.id)).toEqual(['s1', 's2'])
    expect(seen.roadmap).toBeUndefined()
    const adopted = await service.adoptRoadmap({ projectId, resourceId: rl })
    expect(adopted.ok && adopted.roadmap.nodes.map(node => node.state)).toEqual(['current', 'locked'])
    expect((await service.getRoadmap({ projectId, resourceId: rl })).draft).toBeUndefined()
    // Another textbook's path is a separate one — untouched.
    expect((await service.getRoadmap({ projectId, resourceId: bookId })).roadmap).toBeUndefined()
    await service.draftRoadmap({ projectId, resourceId: rl, nodes: [{ id: 's9', title: 'x', gate: 'read', covers: [{ ref: 'topic:x' }] }] })
    expect((await service.discardDraft({ projectId, resourceId: rl })).ok).toBe(true)
    expect((await service.getRoadmap({ projectId, resourceId: rl })).draft).toBeUndefined()
  })

  it('a new draft replaces the textbook\'s previous one, and the project page counts it', async () => {
    const { projectId, bookId } = await seed()
    await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'a', title: 'a', gate: 'quiz', covers: [{ ref: bookId, locator: '1' }] }] })
    await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [
      { id: 'b', title: 'b', gate: 'quiz', covers: [{ ref: bookId, locator: '1' }] },
      { id: 'c', title: 'c', gate: 'quiz', covers: [{ ref: bookId, locator: '2' }], dependsOn: ['b'] },
    ] })
    expect((await service.getRoadmap({ projectId, resourceId: bookId })).draft?.nodes.map(node => node.id)).toEqual(['b', 'c'])
    const detail = await service.getProject({ id: projectId })
    expect(detail.ok && detail.project.resources[0]).toMatchObject({ hasDraft: true, draftTotal: 2, seq: 1, origin: 'picked' })
  })

  it('a station may carry side references beside its own rows — the path stays on its textbook', async () => {
    const { projectId, bookId } = await seed()
    const drafted = await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [
      { id: 'n1', title: '离子通道', gate: 'quiz', covers: [{ ref: bookId, locator: '1' }, { ref: 'https://video.example/ion', by: 'web' }, { ref: 'topic:补讲 Nernst 方程' }] },
      { id: 'appx', title: '附录 A 选读', gate: 'read', covers: [{ ref: 'topic:附录 A ε-δ' }] },
    ] })
    expect(drafted.ok && drafted.draft.primaryResourceId).toBe(bookId)
  })

  it('a link without contents never carries a path', async () => {
    const { projectId } = await seed()
    const link = await service.putResource({ projectId, title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool' })
    if (!link.ok) throw new Error(link.message)
    const refused = await service.draftRoadmap({ projectId, resourceId: link.resource.id, nodes: [{ id: 'n1', title: 'a', gate: 'read', covers: [{ ref: link.resource.id }] }] })
    expect(!refused.ok && refused.message).toMatch(/never carries a path/)
  })

  it('a read node completes by 读完', async () => {
    const { projectId } = await seed()
    const rl = await authored(projectId)
    await service.draftRoadmap({ projectId, resourceId: rl, nodes: [{ id: 'r1', title: '套件评测', gate: 'read', covers: [{ ref: 'https://so-arm.example', by: 'web' }] }] })
    await service.adoptRoadmap({ projectId, resourceId: rl })
    const read = await service.markNodeRead({ projectId, resourceId: rl, nodeId: 'r1' })
    expect(read.ok && read.roadmap.nodes[0]?.state).toBe('done')
  })

  it('validates covers: existing resources, urls, topic text, acceptance rules', async () => {
    const { projectId, bookId } = await seed()
    const draft = (covers: readonly unknown[], gate: 'quiz' | 'read' | 'acceptance' = 'quiz', acceptance?: readonly string[]) =>
      service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 's1', title: 'a', gate, covers: covers as never, ...(acceptance === undefined ? {} : { acceptance }) }] })
    const badBook = await draft([{ ref: 'b_none' }])
    expect(!badBook.ok && badBook.message).toMatch(/not on the project's shelf/)
    const outOfRange = await draft([{ ref: bookId, locator: '1-99' }])
    expect(!outOfRange.ok && outOfRange.message).toMatch(/3 rows/)
    const badResource = await draft([{ ref: 'r_none' }])
    expect(!badResource.ok && badResource.message).toMatch(/not on the project's shelf/)
    const malformed = await draft([{ ref: 'ftp://x.example' }])
    expect(!malformed.ok && malformed.message).toMatch(/neither a shelf resource id/)
    const blankTopic = await draft([{ ref: 'topic:  ' }])
    expect(!blankTopic.ok && blankTopic.message).toMatch(/no text/)
    const unknown = await draft([{ ref: ' ' }])
    expect(!unknown.ok && unknown.message).toMatch(/no ref/)
    const noAcceptance = await draft([{ ref: 'topic:x' }], 'acceptance')
    expect(!noAcceptance.ok && noAcceptance.message).toMatch(/acceptance/)
    const misplaced = await draft([{ ref: 'topic:x' }], 'quiz', ['x'])
    expect(!misplaced.ok && misplaced.message).toMatch(/gate: "acceptance"/)
    expect(!misplaced.ok && misplaced.message).toMatch(/goals/)
    const empty = await draft([])
    expect(!empty.ok && empty.message).toMatch(/at least one cover/)
    // A resource cover resolves against the shelf.
    const added = await service.putResource({ projectId, title: 'Gymnasium 文档', url: 'https://gymnasium.example', kind: 'tool', origin: 'picked' })
    if (!added.ok) throw new Error(added.message)
    const ok = await draft([{ ref: added.resource.id }])
    expect(ok.ok).toBe(true)
  })
})

describe('station notes (讲义)', () => {
  it('writes and rewrites a station\'s notes on the adopted path; a re-plan keeps them', async () => {
    const { projectId, bookId } = await seed()
    await adopt(projectId, bookId)
    const written = await service.putNotes({ projectId, resourceId: bookId, nodeId: 'n1', text: '## 离子通道\n\n先讲通透…' })
    expect(written.ok && written.notes.revisions).toBe(1)
    const seen = await service.getRoadmap({ projectId, resourceId: bookId })
    expect(seen.roadmap?.nodes[0]?.notes?.text).toContain('离子通道')
    const rewritten = await service.putNotes({ projectId, resourceId: bookId, nodeId: 'n1', text: '## 离子通道（补讲版）' })
    expect(rewritten.ok && rewritten.notes.revisions).toBe(2)
    // A re-plan that keeps the station's id also keeps its 讲义.
    await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [
      { id: 'n1', title: '离子通道（重排）', gate: 'quiz', covers: [{ ref: bookId, locator: '1' }] },
      { id: 'n2', title: '动作电位', gate: 'quiz', covers: [{ ref: bookId, locator: '2' }], dependsOn: ['n1'] },
    ] })
    await service.adoptRoadmap({ projectId, resourceId: bookId })
    const replanned = await service.getRoadmap({ projectId, resourceId: bookId })
    expect(replanned.roadmap?.nodes[0]?.notes?.revisions).toBe(2)
  })

  it('writes notes on an authored textbook\'s station (they are its text), and teaches the bad calls', async () => {
    const { projectId, bookId } = await seed()
    const rl = await authored(projectId)
    const draft = await service.draftRoadmap({ projectId, resourceId: rl, nodes: [
      { id: 's1', title: '奖励', gate: 'quiz', covers: [{ ref: rl, locator: '1' }] },
      { id: 's2', title: '串讲', gate: 'quiz', covers: [{ ref: 'topic:讲授' }], dependsOn: ['s1'] },
    ] })
    if (!draft.ok) throw new Error(draft.message)
    await service.adoptRoadmap({ projectId, resourceId: rl })
    const written = await service.putNotes({ projectId, resourceId: rl, nodeId: 's2', text: '讲授站讲义正文' })
    expect(written.ok).toBe(true)
    expect((await service.getRoadmap({ projectId, resourceId: rl })).roadmap?.nodes[1]?.notes?.text).toBe('讲授站讲义正文')
    // The bad calls teach.
    const noNode = await service.putNotes({ projectId, resourceId: rl, nodeId: 's9', text: 'x' })
    expect(!noNode.ok && noNode.message).toMatch(/no node/)
    const empty = await service.putNotes({ projectId, resourceId: rl, nodeId: 's2', text: '   ' })
    expect(!empty.ok && empty.message).toMatch(/need text/)
    const noPath = await service.putNotes({ projectId, resourceId: bookId, nodeId: 'n1', text: 'x' })
    expect(!noPath.ok && noPath.message).toMatch(/no node/)
  })
})

describe('the evidence gate on covers', () => {
  /** Adopt a one-station path on the seeded book itself (a lone book's stations ride the book). */
  async function station(kind: 'knowledge' | 'material'): Promise<{ projectId: string; bookId: string }> {
    const seeded = await seed('subject', kind)
    const draft = await service.draftRoadmap({ projectId: seeded.projectId, resourceId: seeded.bookId, nodes: [{ id: 's1', title: '一站', gate: 'quiz', covers: [{ ref: seeded.bookId }] }] })
    if (!draft.ok) throw new Error(draft.message)
    const adopted = await service.adoptRoadmap({ projectId: seeded.projectId, resourceId: seeded.bookId })
    if (!adopted.ok) throw new Error(adopted.message)
    return seeded
  }

  it('a station covering a material book refuses a memory-backed content question', async () => {
    const { projectId, bookId } = await station('material')
    const memory = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 's1' }, questions: [question()] } })
    expect(!memory.ok && memory.message).toMatch(/material book/)
  })

  it('a station on its knowledge book allows domain knowledge — a side url or teaching never changes that', async () => {
    const { projectId, bookId } = await seed()
    const draft = await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 's1', title: '一站', gate: 'quiz', covers: [{ ref: bookId, locator: '1' }, { ref: 'topic:讲授' }, { ref: 'https://video.example/ion' }] }] })
    if (!draft.ok) throw new Error(draft.message)
    await service.adoptRoadmap({ projectId, resourceId: bookId })
    const stored = await service.putQuiz({ projectId, quiz: { scope: { nodeId: 's1' }, questions: [question()] } })
    expect(stored.ok).toBe(true)
  })

  it('a station resting on a url alone demands a verbatim quote for content questions', async () => {
    const { projectId } = await seed()
    const rl = await authored(projectId)
    const draft = await service.draftRoadmap({ projectId, resourceId: rl, nodes: [{ id: 's1', title: 'RL 直觉', gate: 'quiz', covers: [{ ref: 'https://gymnasium.example', title: 'Gymnasium 文档', by: 'web', verifiedAt: '2026-10-13T00:00:00.000Z' }] }] })
    if (!draft.ok) throw new Error(draft.message)
    await service.adoptRoadmap({ projectId, resourceId: rl })
    const memory = await service.putQuiz({ projectId, quiz: { scope: { nodeId: 's1' }, questions: [question()] } })
    expect(!memory.ok && memory.message).toMatch(/web text/)
    const quoted = await service.putQuiz({ projectId, quiz: { scope: { nodeId: 's1' }, questions: [question({ evidence: { kind: 'web', url: 'https://gymnasium.example', quote: 'a long enough quote' } })] } })
    expect(quoted.ok).toBe(true)
  })

  it('a free quiz (no resource, no node) may rest on domain knowledge, and reads back', async () => {
    const { projectId } = await seed()
    const stored = await service.putQuiz({ projectId, quiz: { scope: {}, questions: [question()] } })
    if (!stored.ok) throw new Error(stored.message)
    expect(stored.quiz.scope.resourceId).toBeUndefined()
    const read = await service.getAssessment({ projectId, assessmentId: stored.quiz.id })
    expect(read.ok && read.assessment.questions).toHaveLength(1)
    expect((await service.listAssessments({ projectId })).assessments.map(quiz => quiz.id)).toContain(stored.quiz.id)
  })

  it('a node-scoped quiz on a book\'s own path reads the same gate through its cover', async () => {
    const { projectId, bookId } = await seed('language', 'material')
    await adopt(projectId, bookId)
    const memory = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [question()] } })
    expect(!memory.ok && memory.message).toMatch(/material book/)
    const recorded = await service.recordPage({ projectId, resourceId: bookId, attachment: photo, text: 'anxious to define and circumscribe the various worlds', marks: [{ text: 'circumscribe', gloss: '限定' }] })
    if (!recorded.ok) throw new Error(recorded.message)
    const grounded = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [question({ evidence: { kind: 'photo', pageId: recorded.page.id, quote: 'define and circumscribe the various worlds' } })] } })
    expect(grounded.ok).toBe(true)
  })
})

describe('practice acceptance', () => {
  /** Adopt an authored textbook's path: s1 acceptance (three rubric lines) → s2 quiz. */
  async function seedPath(): Promise<{ projectId: string; rl: string }> {
    const { projectId } = await seed()
    const rl = await authored(projectId)
    const draft = await service.draftRoadmap({
      projectId,
      resourceId: rl,
      nodes: [
        { id: 's1', title: 'RL 直觉', gate: 'acceptance', covers: [{ ref: 'topic:奖励 = 行为塑造' }], acceptance: ['跑满 20 万步', '平均奖励 > 475', '说清 reward 谁写的'] },
        { id: 's2', title: '快慢回路', gate: 'quiz', covers: [{ ref: 'topic:讲授' }], dependsOn: ['s1'] },
      ],
    })
    if (!draft.ok) throw new Error(draft.message)
    const adopted = await service.adoptRoadmap({ projectId, resourceId: rl })
    if (!adopted.ok) throw new Error(adopted.message)
    return { projectId, rl }
  }

  it('judges one verdict per acceptance line, verbatim; partial credit rides the pass ratio', async () => {
    const { projectId, rl } = await seedPath()
    const wrongLine = await service.putAttempt({ projectId, nodeId: 's1', verdicts: [{ task: 's1', criterion: '跑满了', pass: true, evidence: '终端', by: 'llm' }] })
    expect(!wrongLine.ok && wrongLine.message).toMatch(/names no rubric line/)
    // 2 pass + 1 fail = 2/3 ≈ 0.67 < 0.8: no completion, no unlock; the failed line leaves a card.
    const first = await service.putAttempt({ projectId, nodeId: 's1', verdicts: [
      { task: 's1', criterion: '跑满 20 万步', pass: true, evidence: '终端输出', by: 'llm' },
      { task: 's1', criterion: '平均奖励 > 475', pass: true, evidence: '曲线截图', by: 'llm' },
      { task: 's1', criterion: '说清 reward 谁写的', pass: false, evidence: '会话回答', by: 'llm', missedCard: { term: 'CartPole 奖励', gloss: '杆子不倒 +1' } },
    ] })
    if (!first.ok) throw new Error(first.message)
    expect(first.attempt.ratio).toBeCloseTo(2 / 3)
    // A v5 sitting names only its assessment (the station's practice rubric), never the node.
    expect(first.attempt.assessmentId).toBeDefined()
    expect(first.attempt.nodeId).toBeUndefined()
    expect(first.completed).toBeUndefined()
    expect(first.unlocked).toEqual([])
    expect(first.cardUpdates.find(update => update.created === true)?.term).toBe('CartPole 奖励')
    expect((await service.getRoadmap({ projectId, resourceId: rl })).roadmap?.nodes.map(node => node.state)).toEqual(['current', 'locked'])
    // The retake: 2 pass + 1 half credit = (1+1+0.5)/3 ≈ 0.83 ≥ 0.8 — completes, unlocks.
    const second = await service.putAttempt({ projectId, nodeId: 's1', verdicts: [
      { task: 's1', criterion: '跑满 20 万步', pass: true, evidence: '终端输出', by: 'llm' },
      { task: 's1', criterion: '平均奖励 > 475', pass: true, evidence: '曲线截图', by: 'llm' },
      { task: 's1', criterion: '说清 reward 谁写的', pass: false, ratio: 0.5, evidence: '会话回答', by: 'llm' },
    ] })
    if (!second.ok) throw new Error(second.message)
    expect(second.attempt.ratio).toBeCloseTo(5 / 6)
    expect([second.completed, second.unlocked]).toEqual(['s1', ['s2']])
    expect((await service.getRoadmap({ projectId, resourceId: rl })).roadmap?.nodes.map(node => node.state)).toEqual(['done', 'current'])
    // The station's history reads back newest first, and the events ledgered.
    const history = await service.listAttempts({ projectId, nodeId: 's1' })
    expect(history.attempts).toHaveLength(2)
    expect(history.attempts[0]?.ratio).toBeCloseTo(5 / 6)
    expect(history.attempts[1]?.ratio).toBeCloseTo(2 / 3)
    const events = await service.listEvents({ projectId, types: ['node.completed', 'node.unlocked'] })
    expect(events.events.map(event => [event.type, event.id])).toEqual([['node.unlocked', 's2'], ['node.completed', 's1']])
  })

  it('a ref acceptance line machine-checks against its quiz\'s latest sitting; the coach judges the rest', async () => {
    const { projectId, rl } = await seedPath()
    // The quiz must exist before the draft references it.
    const missing = await service.draftRoadmap({ projectId, resourceId: rl, nodes: [{ id: 's1', title: 'RL 直觉', gate: 'acceptance', covers: [{ ref: 'topic:讲授' }], acceptance: [{ line: '完成摸底测验', ref: 'q_nope' }] }] })
    expect(!missing.ok && missing.message).toMatch(/compose it first/)
    const quiz = await service.putQuiz({ projectId, quiz: { scope: {}, questions: [question()] } })
    if (!quiz.ok) throw new Error(quiz.message)
    const draft = await service.draftRoadmap({ projectId, resourceId: rl, nodes: [
      { id: 's1', title: 'RL 直觉', gate: 'acceptance', covers: [{ ref: 'topic:讲授' }], acceptance: [{ line: '完成摸底测验 ≥ 过线', ref: quiz.quiz.id }, '跑满 20 万步'] },
      { id: 's2', title: '快慢回路', gate: 'quiz', covers: [{ ref: 'topic:讲授' }], dependsOn: ['s1'] },
    ] })
    if (!draft.ok) throw new Error(draft.message)
    const adopted = await service.adoptRoadmap({ projectId, resourceId: rl })
    if (!adopted.ok) throw new Error(adopted.message)
    // No sitting yet: the ref line auto-fails (1/2 < 0.8 — no completion).
    const cold = await service.putAttempt({ projectId, nodeId: 's1', verdicts: [{ task: 'L2', criterion: '跑满 20 万步', pass: true, evidence: '终端输出', by: 'llm' }] })
    if (!cold.ok) throw new Error(cold.message)
    expect(cold.attempt.ratio).toBeCloseTo(1 / 2)
    expect(cold.completed).toBeUndefined()
    expect(cold.attempt.verdicts.find(verdict => verdict.task === 'L1')?.by).toBe('auto')
    // A ref line takes no coach verdict.
    const judgedRef = await service.putAttempt({ projectId, nodeId: 's1', verdicts: [{ task: 'L1', criterion: '完成摸底测验 ≥ 过线', pass: true, evidence: 'x', by: 'llm' }] })
    expect(!judgedRef.ok && judgedRef.message).toMatch(/machine-checks/)
    // Pass the quiz, re-run acceptance: L1 auto-passes, L2 judged → done, s2 unlocks.
    const sitting = await service.putAttempt({ projectId, quizId: quiz.quiz.id, verdicts: [{ task: 'q1', criterion: '机制', pass: true, evidence: '领域知识', by: 'llm' }] })
    if (!sitting.ok) throw new Error(sitting.message)
    const done = await service.putAttempt({ projectId, nodeId: 's1', verdicts: [{ task: 'L2', criterion: '跑满 20 万步', pass: true, evidence: '终端输出', by: 'llm' }] })
    if (!done.ok) throw new Error(done.message)
    expect([done.completed, done.unlocked]).toEqual(['s1', ['s2']])
    // The auto verdict survives the read-back normalize.
    const history = await service.listAttempts({ projectId, nodeId: 's1' })
    expect(history.attempts[0]?.verdicts.find(verdict => verdict.task === 'L1')).toMatchObject({ by: 'auto', pass: true })
  })

  it('refuses the wrong shape: both keys, neither, an unknown station, a non-acceptance node', async () => {
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

  it('accepts an acceptance station on a book\'s own path too', async () => {
    const { projectId, bookId } = await seed()
    const draft = await service.draftRoadmap({
      projectId, resourceId: bookId,
      nodes: [{ id: 'p1', title: '动手', gate: 'acceptance', covers: [{ ref: bookId, locator: '1' }], acceptance: ['做完实验'] }],
    })
    if (!draft.ok) throw new Error(draft.message)
    await service.adoptRoadmap({ projectId, resourceId: bookId })
    const assessed = await service.putAttempt({ projectId, nodeId: 'p1', resourceId: bookId, verdicts: [{ task: 'p1', criterion: '做完实验', pass: true, evidence: '照片', by: 'user' }] })
    expect(assessed.ok && assessed.completed).toBe('p1')
  })
})

describe('pages and cards', () => {
  it('cards every certain mark at once and holds uncertain ones back', async () => {
    const { projectId, bookId } = await seed('language', 'material')
    const recorded = await service.recordPage({
      projectId,
      resourceId: bookId,
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
    expect(recorded.cards.added.every(card => card.kind === 'word' && card.resourceId === bookId)).toBe(true)
    expect(recorded.cards.added[2]?.userGloss).toBe('英勇的')
    expect(recorded.page.cardIds).toHaveLength(3)
  })

  it('merges an exact key (a plural away) and stacks the context', async () => {
    const { projectId, bookId } = await seed('language', 'material')
    await service.recordPage({ projectId, resourceId: bookId, attachment: photo, text: 'paid in instalments', marks: [{ text: 'instalments', sentence: 'paid in instalments', gloss: '分期付款' }] })
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
    await service.writeCards({ projectId, resourceId: bookId, cards: [{ kind: 'concept', term: '长度常数 λ', aliases: ['length constant'], gloss: '膜电阻越大 λ 越大', context: { sentence: 'λ = √(rm/ra)' }, source: { type: 'chat' } }] })
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
    const stored = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question()] } })
    expect(stored.ok).toBe(true)
  })

  it('a material book refuses a content question from memory but takes a photo-backed one', async () => {
    const { projectId, bookId } = await seed('language', 'material')
    const memory = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question()] } })
    expect(!memory.ok && memory.message).toMatch(/material book/)
    const recorded = await service.recordPage({ projectId, resourceId: bookId, attachment: photo, text: 'anxious to define and circumscribe the various worlds to conquer', marks: [{ text: 'circumscribe', gloss: '限定' }] })
    if (!recorded.ok) throw new Error(recorded.message)
    const cardId = recorded.cards.added[0]!.id
    const grounded = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question({
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
    const noCards = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question({ target: { kind: 'asked' } })] } })
    expect(!noCards.ok && noCards.message).toMatch(/cardIds/)
    const noUrl = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question({ evidence: { kind: 'web', quote: 'a long enough quote' } })] } })
    expect(!noUrl.ok && noUrl.message).toMatch(/url/)
  })

  it('refuses a choice question whose answer matches no option, and takes a letter key', async () => {
    const { projectId, bookId } = await seed()
    const stray = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question({ kind: 'choice', options: ['环绕', '限定'], answer: '征服' })] } })
    expect(!stray.ok && stray.message).toMatch(/matches no option/)
    const outOfRange = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question({ kind: 'choice', options: ['环绕', '限定'], answer: 'D' })] } })
    expect(!outOfRange.ok && outOfRange.message).toMatch(/matches no option/)
    const lettered = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question({ kind: 'choice', options: ['环绕', '限定'], answer: 'b. 限定' })] } })
    expect(lettered.ok).toBe(true)
  })

  it('warns when the scoped node is still locked', async () => {
    const { projectId, bookId } = await seed()
    await adopt(projectId, bookId)
    const stored = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n2' }, questions: [question()] } })
    expect(stored.ok && stored.warnings[0]).toMatch(/still locked/)
  })

  it('says where a station-less quiz landed: the book page, or the project page for a free one', async () => {
    const { projectId, bookId } = await seed()
    const bookLevel = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question()] } })
    expect(bookLevel.ok && bookLevel.warnings.at(-1)).toMatch(/本书测验/)
    const free = await service.putQuiz({ projectId, quiz: { scope: {}, questions: [question()] } })
    expect(free.ok && free.warnings.at(-1)).toMatch(/自由测验/)
  })

  it('holds a quiz to the learner\'s chosen source', async () => {
    const { projectId, bookId } = await seed()
    const mine = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, focus: 'mine', questions: [question()] } })
    expect(!mine.ok && mine.message).toMatch(/OWN points only/)
    const written = await service.writeCards({ projectId, resourceId: bookId, cards: [{ kind: 'concept', term: '不应期', gloss: 'g', source: { type: 'photo' } }] })
    if (!written.ok) throw new Error(written.message)
    const ok = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, focus: 'mine', questions: [question({ target: { kind: 'marked', cardIds: [written.added[0]!.id] } })] } })
    expect(ok.ok && ok.quiz.focus).toBe('mine')
    const book = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, focus: 'book', questions: [question({ target: { kind: 'marked', cardIds: [written.added[0]!.id] } })] } })
    expect(!book.ok && book.message).toMatch(/book's content only/)
  })

  it('refuses a read node as the quiz scope', async () => {
    const { projectId, bookId } = await seed()
    await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'r1', title: '导读', gate: 'read', covers: [{ ref: bookId }] }] })
    await service.adoptRoadmap({ projectId, resourceId: bookId })
    const scoped = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'r1' }, questions: [question()] } })
    expect(!scoped.ok && scoped.message).toMatch(/read node/)
  })

  it('warns when a math-smelling question carries no $…$ LaTeX', async () => {
    const { projectId, bookId } = await seed()
    const raw = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question({ prompt: '求 g(x) = √(x+1) / (x-2) 的定义域' })] } })
    expect(raw.ok && raw.warnings.some(warning => warning.includes('$…$'))).toBe(true)
    const texed = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId }, questions: [question({ prompt: '求 $g(x) = \\sqrt{(x+1)/(x-2)}$ 的定义域' })] } })
    expect(texed.ok && texed.warnings.every(warning => !warning.includes('$…$'))).toBe(true)
  })
})

describe('quiz points (考点)', () => {
  /** Draft and adopt a one-node path whose quiz station carries two points. */
  async function adoptPointed(projectId: string, bookId: string): Promise<void> {
    const draft = await service.draftRoadmap({
      projectId,
      resourceId: bookId,
      nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', covers: [{ ref: bookId, locator: '1' }], points: [
        { id: 'gating', title: '门控机制' },
        { id: 'selectivity', title: '选择性通透' },
      ] }],
    })
    if (!draft.ok) throw new Error(draft.message)
    const adopted = await service.adoptRoadmap({ projectId, resourceId: bookId })
    if (!adopted.ok) throw new Error(adopted.message)
  }

  it('drafts, adopts and reads back a station\'s points', async () => {
    const { projectId, bookId } = await seed()
    await adoptPointed(projectId, bookId)
    const { roadmap } = await service.getRoadmap({ projectId, resourceId: bookId })
    expect(roadmap?.nodes[0]?.points?.map(point => point.id)).toEqual(['gating', 'selectivity'])
  })

  it('refuses points on a read node, and duplicate or unsafe ids', async () => {
    const { projectId, bookId } = await seed()
    const readNode = await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'r1', title: '导读', gate: 'read', covers: [{ ref: bookId }], points: [{ id: 'p1', title: 'x' }] }] })
    expect(!readNode.ok && readNode.message).toMatch(/quiz-gated/)
    const dup = await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'n1', title: 'x', gate: 'quiz', covers: [{ ref: bookId }], points: [{ id: 'p1', title: 'a' }, { id: 'p1', title: 'b' }] }] })
    expect(!dup.ok && dup.message).toMatch(/duplicate point id/)
    const unsafe = await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'n1', title: 'x', gate: 'quiz', covers: [{ ref: bookId }], points: [{ id: 'not a slug!', title: 'a' }] }] })
    expect(!unsafe.ok && unsafe.message).toMatch(/safe slug/)
  })

  it('demands a known point per question once the station has any, and warns on uncovered points', async () => {
    const { projectId, bookId } = await seed()
    await adoptPointed(projectId, bookId)
    const missing = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [question()] } })
    expect(!missing.ok && missing.message).toMatch(/names no point/)
    const unknown = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [question({ point: 'nope' })] } })
    expect(!unknown.ok && unknown.message).toMatch(/does not hold/)
    const partial = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [question({ point: 'gating' })] } })
    expect(partial.ok && partial.warnings.some(warning => warning.includes('选择性通透'))).toBe(true)
    expect(partial.ok && partial.quiz.questions?.[0]?.point).toBe('gating')
  })

  it('addPoints extends the station\'s split, immediately referenceable and never re-addable', async () => {
    const { projectId, bookId } = await seed()
    await adoptPointed(projectId, bookId)
    const stored = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [question({ point: 'gating' }), question({ id: 'q2', point: 'pharmacology' })], addPoints: [{ id: 'pharmacology', title: '药理学' }] } })
    expect(stored.ok).toBe(true)
    const { roadmap } = await service.getRoadmap({ projectId, resourceId: bookId })
    expect(roadmap?.nodes[0]?.points?.map(point => point.id)).toEqual(['gating', 'selectivity', 'pharmacology'])
    const full = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [question({ point: 'gating' }), question({ id: 'q2', point: 'selectivity' }), question({ id: 'q3', point: 'pharmacology' })] } })
    expect(full.ok && full.warnings.every(warning => !warning.includes('药理学'))).toBe(true)
    const readd = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [question({ point: 'gating' })], addPoints: [{ id: 'gating', title: '重复' }] } })
    expect(!readd.ok && readd.message).toMatch(/already exists/)
  })

  it('refuses points on a station-less quiz', async () => {
    const { projectId } = await seed()
    const free = await service.putQuiz({ projectId, quiz: { scope: {}, questions: [question({ point: 'p1' })], addPoints: [{ id: 'p1', title: 'x' }] } })
    expect(!free.ok && free.message).toMatch(/station quiz/)
  })
})

describe('the assess cascade', () => {
  it('moves target cards, cards a card-less miss, and unlocks at the pass ratio', async () => {
    const { projectId, bookId } = await seed()
    await adopt(projectId, bookId)
    const weak = await service.writeCards({ projectId, resourceId: bookId, cards: [{ kind: 'concept', term: '绝对/相对不应期', gloss: 'g', source: { type: 'chat' }, weaken: true }] })
    if (!weak.ok) throw new Error(weak.message)
    const cardId = weak.added[0]!.id
    const quiz = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [
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

    const retake = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [question({ id: 'q1' })] } })
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
    expect((await service.setBinding('s1', { projectId, resourceId: bookId })).ok).toBe(true)
    expect(service.getBinding('s1')).toEqual({ projectId, resourceId: bookId })
    expect((await service.setBinding('s1', { projectId, resourceId: 'b_none' })).ok).toBe(false)
    await service.setBinding('s1', null)
    expect(service.getBinding('s1')).toBeUndefined()
  })

  it('summarizes the bound book and its weak cards synchronously', async () => {
    const { projectId, bookId } = await seed()
    await adopt(projectId, bookId)
    await service.writeCards({ projectId, resourceId: bookId, cards: [{ kind: 'concept', term: '不应期', gloss: 'g', source: { type: 'chat' } }] })
    await service.setBinding('s1', { projectId, resourceId: bookId })
    const summary = service.bindingSummary('s1')
    expect(summary.resource?.title).toBe('Principles of Neural Science')
    expect(summary.textbooks[0]?.current?.id).toBe('n1')
    expect(summary.weakCards.map(card => card.term)).toEqual(['不应期'])
  })

  it('a project-only binding reports every textbook\'s path state in study order', async () => {
    const { projectId } = await seed()
    const rl = await authored(projectId)
    const draft = await service.draftRoadmap({
      projectId,
      resourceId: rl,
      nodes: [{ id: 's1', title: 'RL 直觉', gate: 'acceptance', covers: [{ ref: 'topic:讲授' }], acceptance: ['跑通'] }],
    })
    if (!draft.ok) throw new Error(draft.message)
    await service.adoptRoadmap({ projectId, resourceId: rl })
    await service.setBinding('s2', { projectId })
    const summary = service.bindingSummary('s2')
    expect(summary.resource).toBeUndefined()
    expect(summary.textbooks.map(textbook => [textbook.seq, textbook.title, textbook.current?.title])).toEqual([
      [1, 'Principles of Neural Science', undefined],
      [2, '强化学习入门（自编）', 'RL 直觉'],
    ])
  })
})

describe('knowledge-point mastery (proposal 2026-10-19-library-point-mastery)', () => {
  /** A knowledge-book station with two points, adopted, and a paper on it. */
  async function station(): Promise<{ projectId: string; bookId: string; quizId: string }> {
    const { projectId, bookId } = await seed()
    await service.draftRoadmap({ projectId, resourceId: bookId, nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', covers: [{ ref: bookId, locator: '1' }], points: [{ id: 'gate', title: '门控' }, { id: 'sel', title: '选择性' }] }] })
    await service.adoptRoadmap({ projectId, resourceId: bookId })
    const quiz = await service.putQuiz({ projectId, quiz: { scope: { resourceId: bookId, nodeId: 'n1' }, questions: [
      question({ id: 'q1', kind: 'fill', answer: '失活', point: 'gate' }),
      question({ id: 'q2', kind: 'fill', answer: 'K+', point: 'sel' }),
    ] } })
    if (!quiz.ok) throw new Error(quiz.message)
    return { projectId, bookId, quizId: quiz.quiz.id }
  }

  it('a miss with no named concept leaves no card — it waits to be retaken, and its point turns weak (ledgered)', async () => {
    const { projectId, quizId } = await station()
    const assessed = await service.putAttempt({ projectId, quizId, verdicts: [
      { task: 'q1', criterion: '门控', pass: false, evidence: 'e', by: 'self' },
      { task: 'q2', criterion: '选择性', pass: true, evidence: 'e', by: 'self' },
    ] })
    if (!assessed.ok) throw new Error(assessed.message)
    expect(assessed.cardUpdates).toEqual([])
    expect((await service.listCards({ projectId })).cards).toEqual([])
    expect(assessed.pointChanges?.map(change => [change.pointId, change.from, change.to])).toEqual([['gate', 'untested', 'weak'], ['sel', 'untested', 'mastered']])
    const events = await service.listEvents({ projectId, types: ['point.changed'] })
    expect(events.events.map(event => [event.id, event.to, event.count])).toEqual([['sel', 'mastered', 0], ['gate', 'weak', 1]])
  })

  it('a retake re-asks the open misses, masters the point when right, and never touches the pass record', async () => {
    const { projectId, bookId, quizId } = await station()
    await service.putAttempt({ projectId, quizId, verdicts: [
      { task: 'q1', criterion: '门控', pass: false, evidence: 'e', by: 'self' },
      { task: 'q2', criterion: '选择性', pass: true, evidence: 'e', by: 'self' },
    ] })
    const statsBefore = (await service.getRoadmap({ projectId, resourceId: bookId })).roadmap?.nodes[0]?.quizStats
    const retake = await service.createRetake({ projectId, resourceId: bookId, nodeId: 'n1' })
    if (!retake.ok) throw new Error(retake.message)
    expect(retake.assessment.type).toBe('retake')
    expect(retake.assessment.questions?.map(item => [item.id, item.origin])).toEqual([['r1', { assessmentId: quizId, questionId: 'q1' }]])
    const done = await service.putAttempt({ projectId, assessmentId: retake.assessment.id, verdicts: [{ task: 'r1', criterion: '门控', pass: true, evidence: 'e', by: 'self' }] })
    if (!done.ok) throw new Error(done.message)
    expect(done.pointChanges?.map(change => [change.pointId, change.to])).toEqual([['gate', 'mastered']])
    expect(done.completed).toBeUndefined()
    expect((await service.getRoadmap({ projectId, resourceId: bookId })).roadmap?.nodes[0]?.quizStats).toEqual(statsBefore)
    const none = await service.createRetake({ projectId, resourceId: bookId, nodeId: 'n1' })
    expect(!none.ok && none.message).toMatch(/no open misses/)
  })

  it('a coach note lands on its point and weakens it; an unknown point teaches the station\'s points', async () => {
    const { projectId, bookId } = await station()
    const noted = await service.notePoint({ projectId, resourceId: bookId, nodeId: 'n1', pointId: 'gate', text: '把失活和关闭混了', term: '失活 vs 关闭' })
    if (!noted.ok) throw new Error(noted.message)
    expect(noted.point.state).toBe('weak')
    expect(noted.changes.map(change => change.to)).toEqual(['weak'])
    expect((await service.getRoadmap({ projectId, resourceId: bookId })).roadmap?.nodes[0]?.points?.[0]?.notes?.[0]).toMatchObject({ text: '把失活和关闭混了', term: '失活 vs 关闭' })
    const bad = await service.notePoint({ projectId, resourceId: bookId, nodeId: 'n1', pointId: 'nope', text: 'x' })
    expect(!bad.ok && bad.message).toMatch(/gate \(门控\)/)
  })
})
