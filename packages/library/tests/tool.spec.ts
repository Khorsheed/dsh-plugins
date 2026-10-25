/**
 * The model tools over a real service: one library_<noun> per write with its
 * own schema (required fields reject at the schema line), project / resource
 * default to the calling session's binding (a resource id resolves its owner),
 * refusals surface as thrown text, and the per-turn bound context renders.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../src/service.ts'
import { chaptersLocator, LIBRARY_TOOL_NAMES, libraryToolDefinitions, splitTocText } from '../src/tool-definition.ts'
import { ImageRefCache } from '../src/image-refs.ts'
import { Config, renderBindingContext } from '../src/tool.ts'

let root: string
let service: LibraryService
let tools: ReturnType<typeof libraryToolDefinitions>
let images: ImageRefCache

/** A ctx with no attachments service; `effect` is a no-op here (the real-Context teardown wiring is pinned in capabilities-dispose.spec.ts). */
const ctx = { get: () => undefined, effect: () => () => {} } as unknown as Context

/** A calling session, as the registry hands it to execute. */
const exec = { agent: { session: { id: 's_learn' } } }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-library-tools-'))
  service = new LibraryService(ctx, { stateRoot: root })
  images = new ImageRefCache()
  tools = libraryToolDefinitions(service, images)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Call one tool by name with raw args, from the session. */
async function call(name: string, args: Record<string, unknown>, from: unknown = exec): Promise<unknown> {
  const tool = tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`no tool ${name}`)
  return tool.execute(args as never, from as never)
}

/** Seed: a project, a registered book, the session bound to it. */
async function seed(): Promise<{ project: string; book: string }> {
  const created = (await call('library_project', { name: '神经科学', template: 'subject' })) as { project: { id: string } }
  const book = (await call('library_resource', {
    op: 'create',
    project: created.project.id,
    kind: 'book',
    title: 'Principles of Neural Science',
    edition: '6th',
    bookKind: 'knowledge',
    toc: ['Ion Channels', { title: 'The Action Potential' }],
    tocSource: { by: 'web', url: 'https://neurology.mhmedical.com/book.aspx?bookID=3024' },
  })) as { resource: { id: string } }
  await call('library_binding', { binding: { project: created.project.id, resource: book.resource.id } })
  return { project: created.project.id, book: book.resource.id }
}

describe('the tool set', () => {
  it('is one read, one write per noun, one assess — in workflow order', () => {
    const expected = ['library_read', 'library_project', 'library_resource', 'library_roadmap', 'library_notes', 'library_page', 'library_cards', 'library_quiz', 'library_binding', 'library_assess']
    expect(tools.map(tool => tool.name)).toEqual(expected)
    expect(LIBRARY_TOOL_NAMES).toEqual(expected)
  })

  it('the Config schema defaults to all tools and a quiet-nothing scope', () => {
    expect(Config({})).toEqual({ tools: 'all', hideSections: [], denyTools: [] })
    expect(Config({ tools: 'none' }).tools).toBe('none')
  })
})

describe('editing a project', () => {
  it('library_project with an id renames it instead of creating one', async () => {
    const { project } = await seed()
    const edited = (await call('library_project', { id: project, name: '神经科学 × 人工智能', goal: '' })) as { project: { name: string; goal?: string } }
    expect(edited.project.name).toBe('神经科学 × 人工智能')
    expect(edited.project.goal).toBeUndefined()
    const listed = (await call('library_read', { what: 'projects' })) as { projects: unknown[] }
    expect(listed.projects).toHaveLength(1)
    await expect(call('library_project', { id: project })).rejects.toThrow(/fields to change/)
  })

  it('the edit target is projectId (id stays a silent alias)', async () => {
    const { project } = await seed()
    const edited = (await call('library_project', { projectId: project, goal: '覆盖神经科学' })) as { project: { goal?: string } }
    expect(edited.project.goal).toBe('覆盖神经科学')
  })

  it('an unknown id with a name creates and says so — a slug is a create in disguise, never a failure', async () => {
    await seed()
    const created = (await call('library_project', { id: 'math', name: '数学', template: 'subject' })) as { project: { id: string }; note: string }
    expect(created.project.id).toMatch(/^p_/)
    expect(created.note).toMatch(/no project "math" existed/)
    await expect(call('library_project', { projectId: 'p_nope', goal: 'x' })).rejects.toThrow(/no project/)
  })
})

describe('binding defaults', () => {
  it('an unbound session is taught to ask and bind', async () => {
    await expect(call('library_read', { what: 'roadmap' })).rejects.toThrow(/library_binding/)
  })

  it('a bound session reads and writes without naming project or resource', async () => {
    const { project } = await seed()
    // Free-floating chat cards are a language project's (a subject's land on points).
    await service.updateProject({ id: project, patch: { template: 'language' } })
    const toc = (await call('library_read', { what: 'toc' })) as { toc: { n: number; title: string }[] }
    expect(toc.toc.map(row => row.n)).toEqual([1, 2])
    const draft = (await call('library_roadmap', { resource: (await service.listResources({ projectId: service.getBinding('s_learn')!.projectId })).resources[0]!.id, nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', chapters: '1' }] })) as { stations: number }
    expect(draft.stations).toBe(1)
    const recorded = (await call('library_cards', { cards: [{ kind: 'concept', term: '不应期', gloss: 'Na⁺ 失活', source: { type: 'chat', note: '说老是记混' }, weaken: true }] })) as { added: { resourceId?: string; sources: { ref?: string }[] }[] }
    expect(recorded.added[0]?.resourceId).toBeDefined()
    // A chat card remembers the session it came from.
    expect(recorded.added[0]?.sources[0]?.ref).toBe('s_learn')
    const records = await service.recentRecords({})
    expect(records.records[0]?.session).toBe('s_learn')
    const read = (await call('library_read', { what: 'cards', query: '不应期' })) as { cards: { term: string; weakness: number; sources: string[] }[] }
    expect(read.cards[0]).toMatchObject({ term: '不应期', weakness: 1, sources: ['chat: 说老是记混'] })
  })

  it('binds from top-level project / resource, and unbinds only on an explicit null', async () => {
    const { project, book } = await seed()
    await call('library_binding', { project, resource: book })
    expect(service.getBinding('s_learn')).toEqual({ projectId: project, resourceId: book })
    await expect(call('library_binding', {})).rejects.toThrow(/needs the project/)
    expect(service.getBinding('s_learn')).toEqual({ projectId: project, resourceId: book })
    await call('library_binding', { binding: null })
    expect(service.getBinding('s_learn')).toBeUndefined()
    await call('library_binding', { project, resource: book })
    await call('library_binding', { unbind: true })
    expect(service.getBinding('s_learn')).toBeUndefined()
  })

  it('the projects read reports this session\'s binding', async () => {
    const { project } = await seed()
    const listed = (await call('library_read', { what: 'projects' })) as { binding: { projectId: string } | null }
    expect(listed.binding?.projectId).toBe(project)
  })
})

describe('the v4 spellings still parse (aliases)', () => {
  it('book on the binding, bookId on remove, what: "books" on the read', async () => {
    const { project, book } = await seed()
    await call('library_binding', { project, book })
    expect(service.getBinding('s_learn')).toEqual({ projectId: project, resourceId: book })
    const listed = (await call('library_read', { what: 'books' })) as { resources: { title: string }[] }
    expect(listed.resources.map(resource => resource.title)).toContain('Principles of Neural Science')
    // Correcting a shelved textbook needs only the changed field: title and contents stay.
    const noted = (await call('library_resource', { op: 'create', resourceId: book, note: '按 three.js 方向修正' })) as { resource: { title: string; note: string; toc: unknown[] } }
    expect([noted.resource.title, noted.resource.note, noted.resource.toc.length]).toEqual(['Principles of Neural Science', '按 three.js 方向修正', 2])
    const removed = (await call('library_resource', { op: 'remove', bookId: book })) as { id: string }
    expect(removed.id).toBe(book)
  })

  it('node kind: "practice" reads as gate: "acceptance"; covers and chapterRanges still parse (the JSON-text transport)', async () => {
    const { project, book } = await seed()
    const nodes = [
      { id: 's1', title: '动手站', kind: 'practice', covers: ['topic:讲授'], acceptance: ['跑通脚本'] },
      { id: 's2', title: '离子通道', gate: 'quiz', chapterRanges: [{ from: 1, to: 2 }] },
    ]
    await call('library_roadmap', { resource: book, nodes: JSON.stringify(nodes) })
    const draft = (await service.getRoadmap({ projectId: project, resourceId: book })).draft
    expect(draft?.nodes[0]?.gate).toBe('acceptance')
    expect(draft?.nodes[1]?.covers).toEqual([{ ref: book, locator: '1-2' }])
  })
})

describe('resources', () => {
  it('a bound session adds, lists and removes a shelf link without naming the project', async () => {
    await seed()
    const added = (await call('library_resource', { op: 'create', title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool', note: '仿真物理引擎' })) as { resource: { id: string; origin: string } }
    expect(added.resource.origin).toBe('picked')
    const listed = (await call('library_read', { what: 'resources' })) as { resources: { title: string }[] }
    expect(listed.resources.map(resource => resource.title)).toEqual(['Principles of Neural Science', 'MuJoCo'])
    await expect(call('library_resource', { op: 'create', title: 'x', url: 'https://mujoco.org', kind: 'tool' })).rejects.toThrow(/already on this project's shelf/)
    const removed = (await call('library_resource', { op: 'remove', resourceId: added.resource.id })) as { id: string }
    expect(removed.id).toBe(added.resource.id)
    expect(((await call('library_read', { what: 'resources' })) as { resources: { title: string }[] }).resources.map(resource => resource.title)).toEqual(['Principles of Neural Science'])
  })

  it('teaches the payload shape and the op', async () => {
    await seed()
    await expect(call('library_resource', { op: 'create', title: 'x' })).rejects.toThrow(/a link takes/)
    await expect(call('library_resource', { op: 'move', resourceId: 'r_x' })).rejects.toThrow(/op=move takes resourceId and seq/)
    await expect(call('library_resource', { op: 'remove' })).rejects.toThrow(/op=remove takes the resourceId/)
    await expect(call('library_resource', {})).rejects.toThrow(/missing required property/)
  })

  it('shelves textbooks in study order with their origin, and moves one', async () => {
    const { book } = await seed()
    const own = (await call('library_resource', { op: 'create', kind: 'book', title: '概率论', origin: 'learner', seq: 1, toc: '分布\n期望', tocSource: { by: 'model' } })) as { resource: { id: string; seq: number; origin: string } }
    expect(own.resource).toMatchObject({ seq: 1, origin: 'learner' })
    // The older addedBy still parses.
    const legacy = (await call('library_resource', { op: 'create', kind: 'course', title: 'CS231n', addedBy: 'coach', toc: 'L1\nL2', tocSource: { by: 'model' } })) as { resource: { seq: number; origin: string } }
    expect(legacy.resource).toMatchObject({ seq: 3, origin: 'picked' })
    const moved = (await call('library_resource', { op: 'move', resourceId: book, seq: 1 })) as { order: string[] }
    expect(moved.order).toEqual([`1. ${book} 《Principles of Neural Science》`, expect.stringContaining('2. '), expect.stringContaining('3. ')])
  })
})

describe('textbook paths through the tools', () => {
  it('a station names its rows as chapters and its side references as also — both land as covers on the textbook\'s path', async () => {
    const { project, book } = await seed()
    const drafted = (await call('library_roadmap', { resource: book, nodes: [
      { id: 'n1', title: '离子通道', gate: 'quiz', chapters: '1', also: ['https://video.example/ion', 'topic: 补讲 Nernst'] },
      { id: 'n2', title: '动作电位', gate: 'quiz', chapters: 2, dependsOn: ['n1'] },
      { id: 'appx', title: '附录选读', gate: 'read', also: 'topic: 附录 A' },
      { id: 'whole', title: '通读', gate: 'read' },
    ] })) as { placedOn: string; stations: number; waitingForAdoption: string[] }
    expect(drafted.placedOn).toContain('Principles of Neural Science')
    expect(drafted.stations).toBe(4)
    expect(drafted.waitingForAdoption).toEqual(['1. 《Principles of Neural Science》 4 stations'])
    const draft = (await service.getRoadmap({ projectId: project, resourceId: book })).draft
    expect(draft?.nodes.map(node => node.covers)).toEqual([
      [{ ref: book, locator: '1' }, { ref: 'https://video.example/ion' }, { ref: 'topic: 补讲 Nernst' }],
      [{ ref: book, locator: '2' }],
      [{ ref: 'topic: 附录 A' }],
      [{ ref: book }],
    ])
  })

  it('a path needs its textbook: the schema requires resource, an empty one teaches the shelf', async () => {
    const { book } = await seed()
    await expect(call('library_roadmap', { nodes: [{ id: 'n1', title: 'x', gate: 'quiz', chapters: '1' }] })).rejects.toThrow(/missing required property/)
    await expect(call('library_roadmap', { resource: '', nodes: [{ id: 'n1', title: 'x', gate: 'quiz', chapters: '1' }] })).rejects.toThrow(new RegExp(`belongs to one textbook[\\s\\S]*${book}`))
    const link = (await call('library_resource', { op: 'create', title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool' })) as { resource: { id: string } }
    await expect(call('library_roadmap', { resource: link.resource.id, nodes: [{ id: 'n1', title: 'x', gate: 'read' }] })).rejects.toThrow(/never carries a path/)
  })

  it('a second draft replaces the first and says so', async () => {
    const { book } = await seed()
    await call('library_roadmap', { resource: book, nodes: [{ id: 'n1', title: 'a', gate: 'quiz', chapters: '1' }] })
    const again = (await call('library_roadmap', { resource: book, nodes: [{ id: 'n1', title: 'b', gate: 'quiz', chapters: '1-2' }] })) as { replacedDraft?: boolean }
    expect(again.replacedDraft).toBe(true)
  })

  it('assesses an acceptance station by node through library_assess', async () => {
    const { project, book } = await seed()
    await call('library_roadmap', { resource: book, nodes: [{ id: 's1', title: 'RL 直觉', gate: 'acceptance', also: ['topic:讲授'], acceptance: ['跑满 20 万步'] }] })
    const adopted = await service.adoptRoadmap({ projectId: project, resourceId: book })
    if (!adopted.ok) throw new Error(adopted.message)
    const assessed = (await call('library_assess', { node: 's1', verdicts: [{ task: 's1', criterion: '跑满 20 万步', pass: true, evidence: '终端输出', by: 'llm' }] })) as { completed?: string }
    expect(assessed.completed).toBe('s1')
    await expect(call('library_assess', { verdicts: [{ task: 'x', criterion: 'x', pass: true, evidence: 'x', by: 'llm' }] })).rejects.toThrow(/quiz/)
  })

  it('the older covers shorthands still parse: "r_…#1-2", "topic: …", a bare url', async () => {
    const { project, book } = await seed()
    await call('library_roadmap', { resource: book, nodes: JSON.stringify([
      { id: 's1', title: '混合站', gate: 'quiz', covers: [`${book}#1-2`, 'topic: 讲授', 'https://example.org/notes'] },
    ]) })
    expect((await service.getRoadmap({ projectId: project, resourceId: book })).draft?.nodes[0]?.covers).toEqual([
      { ref: book, locator: '1-2' },
      { ref: 'topic: 讲授' },
      { ref: 'https://example.org/notes' },
    ])
  })
})

describe('the question axes default and take shorthands', () => {
  it('a bare question stores topic + knowledge; the flat shorthands fill the axes', async () => {
    const { project } = await seed()
    await service.updateProject({ id: project, patch: { template: 'language' } })
    const cards = (await call('library_cards', { cards: [{ kind: 'concept', term: '垂线检验', gloss: '每条竖线至多交一点', source: { type: 'chat' } }] })) as { added: { id: string }[] }
    const cardId = cards.added[0]!.id
    const stored = (await call('library_quiz', { questions: [
      { id: 'q1', kind: 'free', prompt: '为什么会失活？', answer: 'Na⁺ 通道构象' },
      { id: 'q2', kind: 'free', prompt: '垂线检验说什么？', answer: '每条竖线至多交一点', cardIds: [cardId] },
      { id: 'q3', kind: 'free', prompt: '书上怎么说？', answer: '原文', url: 'https://example.org/ch1', quote: 'a long enough quote from the page' },
      { id: 'q4', kind: 'free', prompt: 'p4', answer: 'a4', target: 'topic', evidence: 'knowledge' },
    ] })) as { quiz: { id: string } }
    const read = (await call('library_read', { what: 'quiz', quiz: stored.quiz.id })) as { questions: { id: string; target: { kind: string; cardIds?: string[] }; evidence: { kind: string; url?: string; quote?: string } }[] }
    expect(read.questions.map(question => [question.id, question.target.kind, question.evidence.kind])).toEqual([
      ['q1', 'topic', 'knowledge'],
      ['q2', 'marked', 'knowledge'],
      ['q3', 'topic', 'web'],
      ['q4', 'topic', 'knowledge'],
    ])
    expect(read.questions[1]?.target.cardIds).toEqual([cardId])
    expect(read.questions[2]?.evidence).toMatchObject({ url: 'https://example.org/ch1', quote: 'a long enough quote from the page' })
  })

  it('a defaulted question still hits the verbatim gate on a material book', async () => {
    await seed()
    const material = (await call('library_resource', { op: 'create', kind: 'book', title: 'Cambridge IELTS 5', bookKind: 'material', toc: ['Test 1'], tocSource: { by: 'model' } })) as { resource: { id: string } }
    await expect(call('library_quiz', { resource: material.resource.id, questions: [{ id: 'q1', kind: 'free', prompt: '第二段说了什么？', answer: 'x' }] })).rejects.toThrow(/material book/)
  })
})

describe('the write chain strings itself', () => {
  it('create → register → draft needs no id passing: each write binds the unbound session', async () => {
    const created = (await call('library_project', { name: '数学', template: 'subject' })) as { project: { id: string } }
    expect(service.getBinding('s_learn')).toEqual({ projectId: created.project.id })
    const registered = (await call('library_resource', { op: 'create', kind: 'book', title: '微积分读本', bookKind: 'knowledge', toc: ['极限', '导数'], tocSource: { by: 'model' } })) as { resource: { id: string } }
    expect(service.getBinding('s_learn')).toEqual({ projectId: created.project.id, resourceId: registered.resource.id })
    const drafted = (await call('library_roadmap', { resource: registered.resource.id, nodes: [{ id: 'n1', title: '极限', gate: 'quiz', chapters: '1' }] })) as { placedOn: string }
    expect(drafted.placedOn).toContain('微积分读本')
  })

  it('a resource id alone resolves its project for an unbound, project-less session', async () => {
    const { project, book } = await seed()
    const elsewhere = { agent: { session: { id: 's_elsewhere' } } }
    const drafted = (await call('library_roadmap', { resource: book, nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', chapters: '1' }] }, elsewhere)) as { placedOn: string }
    expect(drafted.placedOn).toContain(book)
    expect(service.getBinding('s_elsewhere')).toEqual({ projectId: project, resourceId: book })
  })

  it('acceptance lines on a quiz station are taught both exits', async () => {
    const { book } = await seed()
    await expect(call('library_roadmap', { resource: book, nodes: [{ id: 'n1', title: '极限', gate: 'quiz', chapters: '1', acceptance: ['会求极限'] }] })).rejects.toThrow(/gate: "acceptance"[\s\S]*goals/)
  })

  it('a draft with several shape problems gets ONE refusal listing them all — not one round trip each', async () => {
    const { book } = await seed()
    await expect(call('library_roadmap', { resource: book, nodes: [
      { id: 'n1', title: '读', gate: 'read', chapters: '1', acceptance: ['读完它'] },
      { id: 'n2', title: '练', gate: 'acceptance', chapters: '2' },
      { id: 'n3', title: '考', gate: 'quiz', chapters: '2', dependsOn: ['n1'] },
    ] })).rejects.toThrow(/3 shape errors[\s\S]*carries acceptance[\s\S]*it needs acceptance[\s\S]*depends on read node/)
  })
})

describe('photo pages', () => {
  it('records a page from the session\'s latest photo when the model names none', async () => {
    await seed()
    await expect(call('library_page', { text: 'x', marks: [] })).rejects.toThrow(/send the page photo/)
    const ref = { attachmentId: 'sha256:abc', mediaType: 'image/jpeg', width: 10, height: 20, bytes: 99 }
    images.observe('s_learn', { type: 'user/message', data: { content: [{ type: 'image', attachment: ref }] } })
    const recorded = (await call('library_page', { text: 'held at the inn', marks: [{ text: 'held', gloss: '举办' }] })) as { page: { attachment: unknown } }
    expect(recorded.page.attachment).toEqual(ref)
  })
})

describe('teaching errors', () => {
  it('rejects an unknown read-what with the valid list', async () => {
    await expect(call('library_read', { what: 'everything' })).rejects.toThrow(/projects \| resources \| toc \| roadmap \| pages \| cards \| quiz \| stats/)
  })

  it('a missing required field is rejected at the schema line', async () => {
    await expect(call('library_read', {})).rejects.toThrow(/missing required property/)
    await expect(call('library_resource', {})).rejects.toThrow(/missing required property/)
    await expect(call('library_quiz', {})).rejects.toThrow(/missing required property/)
  })

  it('surfaces the service refusal verbatim', async () => {
    await seed()
    await expect(call('library_quiz', { questions: [{ id: 'q1', kind: 'free', prompt: 'p', answer: 'a', target: { kind: 'asked' }, evidence: { kind: 'knowledge' } }] }))
      .rejects.toThrow(/cardIds/)
  })

  it('a quiz with several bad questions gets ONE refusal listing them all', async () => {
    await seed()
    await expect(call('library_quiz', {
      questions: [
        { id: 'q1', kind: 'choice', prompt: 'p', options: ['A) 甲'], answer: 'A) 甲', target: { kind: 'topic' }, evidence: { kind: 'knowledge' } },
        { id: 'q1', kind: 'fill', prompt: '', answer: 'a', target: { kind: 'topic' }, evidence: { kind: 'knowledge' } },
      ],
    })).rejects.toThrow(/problems in questions[\s\S]*fewer than two options[\s\S]*unique id[\s\S]*prompt and an answer/)
  })
})

describe('payload transport', () => {
  it('accepts a roadmap\'s nodes as JSON text — models stringify deep parameters', async () => {
    const { book } = await seed()
    const nodes = [{ id: 'n1', title: '离子通道', gate: 'quiz', chapters: '1' }]
    const draft = (await call('library_roadmap', { resource: book, nodes: JSON.stringify(nodes) })) as { stations: number }
    expect(draft.stations).toBe(1)
  })

  it('accepts cards as JSON text', async () => {
    const { project } = await seed()
    await service.updateProject({ id: project, patch: { template: 'language' } })
    const cards = [{ kind: 'concept', term: '不应期', gloss: 'Na⁺ 失活', source: { type: 'chat' } }]
    const recorded = (await call('library_cards', { cards: JSON.stringify(cards) })) as { added: { term: string }[] }
    expect(recorded.added[0]?.term).toBe('不应期')
  })

  it('a refusal names what arrived: unparseable text or the wrong shape', async () => {
    await seed()
    await expect(call('library_roadmap', { resource: 'r_x', nodes: '{not json' })).rejects.toThrow(/not valid JSON/)
    await expect(call('library_cards', {})).rejects.toThrow(/missing required property/)
  })

  it('a legacy book cover may name its resource as book or bookId; a missing reference teaches, never crashes', async () => {
    const { book } = await seed()
    // The legacy union members ride the JSON-text transport (the typed nodes schema wants { ref }).
    await expect(call('library_roadmap', {
      resource: book,
      nodes: JSON.stringify([{ id: 'n1', title: '离子通道', gate: 'quiz', covers: [{ kind: 'book', ranges: [{ from: 1, to: 1 }] }] }]),
    })).rejects.toThrow(/no ref/)
    // The natural shorthand { kind: "book", book } lands as the ref.
    await call('library_roadmap', {
      resource: book,
      nodes: JSON.stringify([{ id: 'n1', title: '离子通道', gate: 'quiz', covers: [{ kind: 'book', book, ranges: [{ from: 1, to: 1 }] }] }]),
    })
    const project = service.getBinding('s_learn')!.projectId
    expect((await service.getRoadmap({ projectId: project, resourceId: book })).draft?.nodes[0]?.covers[0]?.ref).toBe(book)
  })

  it('choice options arriving as { label } objects are stored as plain strings', async () => {
    const { project, book } = await seed()
    await call('library_roadmap', { resource: book, nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', chapters: '1' }] })
    const adopted = await service.adoptRoadmap({ projectId: project, resourceId: book })
    if (!adopted.ok) throw new Error(adopted.message)
    const written = (await call('library_quiz', {
      node: 'n1',
      questions: [{
        id: 'q1', kind: 'choice', prompt: 'p',
        options: [{ label: 'A) 甲' }, { label: 'B) 乙' }],
        answer: 'A) 甲',
        target: { kind: 'topic' },
        evidence: { kind: 'knowledge' },
      }],
    })) as { quiz: { questions: { options?: string[] }[] } }
    expect(written.quiz.questions[0]?.options).toEqual(['甲', '乙'])
  })

  it('accepts a book\'s contents as one newline-joined string — the payload models mangle most', async () => {
    const { project } = await seed()
    const added = (await call('library_resource', {
      op: 'create',
      project,
      kind: 'book',
      title: '普林斯顿微积分读本',
      bookKind: 'knowledge',
      toc: '引言\n极限导论\n\n求极限',
      tocSource: { by: 'web', url: 'https://example.org/toc' },
    })) as { resource: { toc: { title: string }[] } }
    expect(added.resource.toc.map(row => row.title)).toEqual(['引言', '极限导论', '求极限'])
  })

  it('unwraps a list payload wrapped as { items: [...] } — a toc keeps its parts', async () => {
    const { project } = await seed()
    const added = (await call('library_resource', {
      op: 'create',
      project,
      kind: 'book',
      title: '普林斯顿微积分读本 · 修订版',
      bookKind: 'knowledge',
      toc: { items: [{ title: '第1章 函数、图像和直线', part: '第一部分：预备与基础' }, '第2章 三角函数复习'] },
      tocSource: { by: 'model' },
    })) as { resource: { toc: { title: string; part?: string }[] } }
    expect(added.resource.toc.map(row => row.title)).toEqual(['第1章 函数、图像和直线', '第2章 三角函数复习'])
    expect(added.resource.toc[0]?.part).toBe('第一部分：预备与基础')
  })
})

describe('the per-noun tools take flat fields', () => {
  it('creates a project, registers a book, drafts a path and writes notes without any wrapper object', async () => {
    const created = (await call('library_project', { name: '数学', template: 'subject' })) as { project: { id: string } }
    const added = (await call('library_resource', {
      op: 'create',
      project: created.project.id,
      kind: 'book',
      title: '普林斯顿微积分读本',
      bookKind: 'knowledge',
      toc: '第1章 函数\n第2章 极限',
      tocSource: { by: 'web', url: 'https://example.org/toc' },
    })) as { resource: { id: string; toc: { title: string }[] } }
    expect(added.resource.toc.map(row => row.title)).toEqual(['第1章 函数', '第2章 极限'])
    await call('library_binding', { binding: { project: created.project.id, resource: added.resource.id } })
    const drafted = (await call('library_roadmap', {
      resource: added.resource.id,
      nodes: [{ id: 'n1', title: '函数', gate: 'quiz', chapters: '1' }],
    })) as { stations: number }
    expect(drafted.stations).toBe(1)
    const adopted = await service.adoptRoadmap({ projectId: created.project.id, resourceId: added.resource.id })
    if (!adopted.ok) throw new Error(adopted.message)
    const noted = (await call('library_notes', { node: 'n1', text: '## 函数讲义' })) as { notes: { revisions: number } }
    expect(noted.notes.revisions).toBe(1)
    const res = (await call('library_resource', { op: 'create', title: 'Gymnasium 文档', url: 'https://gymnasium.example', kind: 'tool' })) as { resource: { id: string } }
    expect((await call('library_resource', { op: 'remove', resourceId: res.resource.id })) as { ok: boolean })
  })

  it('the observed failure modes now reject at the schema line or teach the field', async () => {
    await seed()
    // The thick-entry fields forgotten entirely (the live "满屏报错" session's shape) — the tool's own lesson, not a runtime crash.
    await expect(call('library_resource', { op: 'create', kind: 'book' })).rejects.toThrow(/a textbook \(kind/)
    // Prose poured into the id slot.
    await expect(call('library_project', { id: '新建数学项目' })).rejects.toThrow(/fields to change/)
  })
})

describe('station notes through the tools', () => {
  it('library_notes lands on the bound textbook\'s path, or on the one named', async () => {
    const { project, book } = await seed()
    await call('library_roadmap', { resource: book, nodes: [
      { id: 'n1', title: '离子通道', gate: 'quiz', chapters: '1' },
      { id: 'n2', title: '动作电位', gate: 'quiz', chapters: '2', dependsOn: ['n1'] },
    ] })
    const adoptedBook = await service.adoptRoadmap({ projectId: project, resourceId: book })
    if (!adoptedBook.ok) throw new Error(adoptedBook.message)
    const written = (await call('library_notes', { node: 'n1', text: '## 讲义\n\n- 要点' })) as { notes: { revisions: number } }
    expect(written.notes.revisions).toBe(1)
    expect((await service.getRoadmap({ projectId: project, resourceId: book })).roadmap?.nodes[0]?.notes?.text).toContain('要点')
    // The bad calls teach.
    await expect(call('library_notes', { text: 'x' })).rejects.toThrow(/missing required property/)
    await expect(call('library_notes', { node: 'n9', text: 'x' })).rejects.toThrow(/no station .* its stations:/)
    // An authored textbook's station: its 讲义 are the text.
    const rl = (await call('library_resource', { op: 'create', kind: 'book', title: '强化学习入门', origin: 'authored', toc: '奖励\n策略梯度', tocSource: { by: 'model' } })) as { resource: { id: string } }
    await call('library_roadmap', { resource: rl.resource.id, nodes: [{ id: 's1', title: '奖励', gate: 'quiz', chapters: '1' }] })
    const adoptedRl = await service.adoptRoadmap({ projectId: project, resourceId: rl.resource.id })
    if (!adoptedRl.ok) throw new Error(adoptedRl.message)
    const station = (await call('library_notes', { resource: rl.resource.id, node: 's1', text: '自编教材正文' })) as { notes: { revisions: number } }
    expect(station.notes.revisions).toBe(1)
  })
})

describe('the bound context', () => {
  it('names the bound book, its current node and the weak cards', async () => {
    const { project, book } = await seed()
    await service.draftRoadmap({ projectId: project, resourceId: book, nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', covers: [{ ref: book }] }] })
    await service.adoptRoadmap({ projectId: project, resourceId: book })
    await service.writeCards({ projectId: project, resourceId: book, cards: [{ kind: 'concept', term: '不应期', gloss: 'g', source: { type: 'chat' } }] })
    const text = renderBindingContext(service, 's_learn')
    expect(text).toContain('Principles of Neural Science')
    expect(text).toContain(`1. 《Principles of Neural Science》 (${book}) path adopted, 0/1 done, current: 离子通道 (n1)`)
    expect(text).toContain('不应期 [1]')
    // A waiting draft on another textbook shows up too — the coach reads what the learner has not adopted.
    const rl = await service.putResource({ projectId: project, kind: 'book', title: '强化学习入门', origin: 'authored', toc: [{ title: '奖励' }], tocSource: { by: 'model' } })
    if (!rl.ok) throw new Error(rl.message)
    await service.draftRoadmap({ projectId: project, resourceId: rl.resource.id, nodes: [{ id: 's1', title: '奖励', gate: 'quiz', covers: [{ ref: rl.resource.id, locator: '1' }] }] })
    expect(renderBindingContext(service, 's_learn')).toContain('2. 《强化学习入门》')
    expect(renderBindingContext(service, 's_learn')).toContain('draft 1 stations, waiting for the learner to adopt')
    expect(renderBindingContext(service, 's_other')).toMatch(/not bound/)
  })
})

describe('live-run failure modes (3080, 2026-10-19)', () => {
  it('a contents joined on one line with ；/; or literal \\n escapes splits into rows; too few rows warn', async () => {
    expect(splitTocText('1. 函数；2. 三角；3. 极限；4. 多项式极限')).toEqual(['1. 函数', '2. 三角', '3. 极限', '4. 多项式极限'])
    expect(splitTocText('Ch1\\nCh2\\nCh3')).toEqual(['Ch1', 'Ch2', 'Ch3'])
    expect(splitTocText('一个标题；带分号')).toEqual(['一个标题；带分号'])
    const { project } = await seed()
    const joined = (await call('library_resource', { op: 'create', project, kind: 'book', title: '普林斯顿微积分读本', toc: '1. 函数；2. 三角；3. 极限', tocSource: { by: 'model' } })) as { contentsRows: number; warning?: string }
    expect(joined.contentsRows).toBe(3)
    expect(joined.warning).toBeUndefined()
    const thin = (await call('library_resource', { op: 'create', project, kind: 'book', title: '只有一行的书', toc: '全书', tocSource: { by: 'model' } })) as { warning?: string }
    expect(thin.warning).toMatch(/only 1 row/)
  })

  it('chapters read any dash or separator; words become a topic side reference; stray points on a non-quiz station are dropped with a note', async () => {
    expect(chaptersLocator('15–16')).toEqual({ locator: '15-16' })
    expect(chaptersLocator('3-4、7')).toEqual({ locator: '3-4,7' })
    expect(chaptersLocator('27-30 + 附录A')).toEqual({ locator: '27-30', rest: '附录A' })
    const { project, book } = await seed()
    const drafted = (await call('library_roadmap', { resource: book, nodes: [
      { id: 'n1', title: '离子通道', gate: 'quiz', chapters: '第1章', points: [{ id: 'p1', title: '门控' }, { id: 'pad1', title: '补充一' }, { id: 'pad2', title: '补充二' }] },
      { id: 'n2', title: '动手', gate: 'acceptance', chapters: '2 + 附录A', acceptance: ['做完实验'], points: [{ id: 'p2', title: 'x' }] },
    ] })) as { adjusted?: string[] }
    expect(drafted.adjusted?.join('\n')).toMatch(/points dropped on 动手[\s\S]*附录A/)
    const draft = (await service.getRoadmap({ projectId: project, resourceId: book })).draft
    expect(draft?.nodes[0]?.points).toEqual([{ id: 'p1', title: '门控' }, { id: 'pad1', title: '补充一' }, { id: 'pad2', title: '补充二' }])
    expect(draft?.nodes[1]?.points).toBeUndefined()
    expect(draft?.nodes[1]?.covers).toEqual([{ ref: book, locator: '2' }, { ref: 'topic: 附录A' }])
  })

  it('a joined contents earns the out-of-range refusal that says to fix the contents, never drop the chapters', async () => {
    const { project } = await seed()
    const one = (await call('library_resource', { op: 'create', project, kind: 'book', title: '只有一行的书', toc: '全书', tocSource: { by: 'model' } })) as { resource: { id: string } }
    await expect(call('library_roadmap', { resource: one.resource.id, nodes: [{ id: 'n1', title: 'a', gate: 'quiz', chapters: '1-2' }] })).rejects.toThrow(/fix the contents first[\s\S]*never drop the chapters/)
  })

  it('a question missing its answer is named by the teaching refusal, not an opaque schema branch error', async () => {
    await seed()
    await expect(call('library_quiz', { questions: [
      { id: 'q1', kind: 'free', prompt: 'p1', answer: 'a1' },
      { id: 'q2', kind: 'free', prompt: 'p2' },
    ] })).rejects.toThrow(/q2[\s\S]*answer/)
  })

  it('binding to a resource id the shelf does not hold binds the project and says so', async () => {
    const { project } = await seed()
    const bound = (await call('library_binding', { project, resource: 'calculus_lifesaver' })) as { binding: { projectId: string; resourceId?: string }; note: string }
    expect(bound.binding).toEqual({ projectId: project })
    expect(bound.note).toMatch(/bound the project only/)
  })
})

describe('knowledge points through the tools', () => {
  it('library_cards with a point lands as a point note in a subject project; the context lists the station\'s points', async () => {
    const { project, book } = await seed()
    await call('library_roadmap', { resource: book, nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', chapters: '1', points: [{ id: 'gate', title: '门控' }, { id: 'pad1', title: '补充一' }, { id: 'pad2', title: '补充二' }] }] })
    await service.adoptRoadmap({ projectId: project, resourceId: book })
    const noted = (await call('library_cards', { cards: [{ point: 'gate', term: '失活 vs 关闭', gloss: '把两态混了' }] })) as { pointNotes: { point: string; state: string }[] }
    expect(noted.pointNotes).toEqual([{ point: '门控', state: 'weak', changed: ['门控: untested → weak'] }])
    expect((await service.listCards({ projectId: project })).cards).toEqual([])
    const text = renderBindingContext(service, 's_learn')
    expect(text).toContain('门控 (gate): weak')
    expect(text).toContain('Subject:')
  })
})

describe('the learner\'s record stays the learner\'s (3080, 2026-10-20)', () => {
  it('a subject project refuses a free-floating chat card and teaches the station\'s points and the coach\'s own slips', async () => {
    const { project, book } = await seed()
    await call('library_roadmap', { resource: book, nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', chapters: '1', points: [{ id: 'gate', title: '门控' }, { id: 'pad1', title: '补充一' }, { id: 'pad2', title: '补充二' }] }] })
    await service.adoptRoadmap({ projectId: project, resourceId: book })
    await expect(call('library_cards', { cards: [{ kind: 'concept', term: '单位圆 tan θ（避免答案/解析不一致）', gloss: '出题时答案字段写错', source: { type: 'chat' } }] }))
      .rejects.toThrow(/lands on the station's knowledge point[\s\S]*gate \(门控\)[\s\S]*never your own slip/)
    expect((await service.listCards({ projectId: project })).cards).toEqual([])
  })
})

describe('a reused session and the book type (3080, 2026-10-20)', () => {
  it('switching a session to another project tells the coach the earlier talk is not this project\'s material', async () => {
    const { project } = await seed()
    const other = (await call('library_project', { name: '数学', template: 'subject' })) as { project: { id: string } }
    await call('library_binding', { project: other.project.id })
    expect(service.getBinding('s_learn')).toMatchObject({ projectId: other.project.id, previousProjectId: project })
    expect(renderBindingContext(service, 's_learn')).toMatch(/worked on another project 「神经科学」[\s\S]*never quiz, teach or note from it here/)
  })

  it('a textbook is knowledge unless said otherwise; the learner switches it', async () => {
    const { project } = await seed()
    const added = (await call('library_resource', { op: 'create', kind: 'book', title: '认知神经科学', origin: 'learner', toc: '简史\n细胞\n解剖', tocSource: { by: 'model' } })) as { resource: { id: string; meta?: { bookKind?: string } } }
    expect(added.resource.meta?.bookKind).toBe('knowledge')
    const flipped = await service.setBookKind({ projectId: project, resourceId: added.resource.id, bookKind: 'material' })
    expect(flipped.ok && flipped.resource.meta?.bookKind).toBe('material')
  })
})
