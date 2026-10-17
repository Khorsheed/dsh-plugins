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
import { LIBRARY_TOOL_NAMES, libraryToolDefinitions } from '../src/tool-definition.ts'
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
    await seed()
    const toc = (await call('library_read', { what: 'toc' })) as { toc: { n: number; title: string }[] }
    expect(toc.toc.map(row => row.n)).toEqual([1, 2])
    // The chapterRanges sugar still wraps the bound resource's rows into its one cover.
    const draft = (await call('library_roadmap', { nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', chapterRanges: [{ from: 1, to: 1 }] }] })) as { draft: { status: string } }
    expect(draft.draft.status).toBe('draft')
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
    const removed = (await call('library_resource', { op: 'remove', bookId: book })) as { id: string }
    expect(removed.id).toBe(book)
  })

  it('node kind: "practice" reads as gate: "acceptance" (the typed schema requires gate, so the alias rides the JSON-text transport)', async () => {
    await seed()
    const nodes = [{ id: 's1', title: '动手站', kind: 'practice', covers: ['topic:讲授'], acceptance: ['跑通脚本'] }]
    const draft = (await call('library_roadmap', { nodes: JSON.stringify(nodes) })) as { draft: { nodes: { gate?: string }[] } }
    expect(draft.draft.nodes[0]?.gate).toBe('acceptance')
  })
})

describe('resources', () => {
  it('a bound session adds, lists and removes a shelf link without naming the project', async () => {
    await seed()
    const added = (await call('library_resource', { op: 'create', title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool', note: '仿真物理引擎' })) as { resource: { id: string; addedBy: string } }
    expect(added.resource.addedBy).toBe('coach')
    const listed = (await call('library_read', { what: 'resources' })) as { resources: { title: string }[] }
    expect(listed.resources.map(resource => resource.title)).toEqual(['Principles of Neural Science', 'MuJoCo'])
    await expect(call('library_resource', { op: 'create', title: 'x', url: 'https://mujoco.org', kind: 'tool' })).rejects.toThrow(/already on this project's shelf/)
    const removed = (await call('library_resource', { op: 'remove', resourceId: added.resource.id })) as { id: string }
    expect(removed.id).toBe(added.resource.id)
    expect(((await call('library_read', { what: 'resources' })) as { resources: { title: string }[] }).resources.map(resource => resource.title)).toEqual(['Principles of Neural Science'])
  })

  it('teaches the payload shape and the op', async () => {
    await seed()
    await expect(call('library_resource', { op: 'create', title: 'x' })).rejects.toThrow(/a thin link takes/)
    await expect(call('library_resource', { op: 'remove' })).rejects.toThrow(/op=remove takes the resourceId/)
    await expect(call('library_resource', {})).rejects.toThrow(/missing required property/)
  })
})

describe('project paths through the tools', () => {
  it('drafts the project\'s path with mixed covers, reads it back, keeps the chapterRanges sugar for a book', async () => {
    const { book } = await seed()
    const draft = (await call('library_roadmap', {
      nodes: [
        { id: 's1', title: 'RL 直觉', gate: 'acceptance', covers: ['topic:奖励 = 行为塑造'], acceptance: ['跑满 20 万步'] },
        { id: 's2', title: '快慢回路', gate: 'quiz', covers: ['topic:讲授'], dependsOn: ['s1'] },
      ],
    })) as { draft: { primaryResourceId?: string; nodes: { id: string }[] } }
    expect(draft.draft.primaryResourceId).toBeUndefined()
    expect(draft.draft.nodes.map(node => node.id)).toEqual(['s1', 's2'])
    const seen = (await call('library_read', { what: 'roadmap', book: null })) as { draft?: { nodes: { id: string }[] } }
    expect(seen.draft?.nodes.map(node => node.id)).toEqual(['s1', 's2'])
    // chapterRanges on the bound book's own path wrap into its one resource cover.
    const bookDraft = (await call('library_roadmap', { nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', chapterRanges: [{ from: 1, to: 1 }] }] })) as { draft: { primaryResourceId?: string; nodes: { covers: { ref?: string; locator?: string }[] }[] } }
    expect(bookDraft.draft.primaryResourceId).toBe(book)
    expect(bookDraft.draft.nodes[0]?.covers[0]).toMatchObject({ ref: book, locator: '1' })
  })

  it('assesses an acceptance station by node through library_assess', async () => {
    const { project } = await seed()
    await call('library_roadmap', { nodes: [{ id: 's1', title: 'RL 直觉', gate: 'acceptance', covers: ['topic:讲授'], acceptance: ['跑满 20 万步'] }] })
    const adopted = await service.adoptRoadmap({ projectId: project })
    if (!adopted.ok) throw new Error(adopted.message)
    const assessed = (await call('library_assess', { node: 's1', verdicts: [{ task: 's1', criterion: '跑满 20 万步', pass: true, evidence: '终端输出', by: 'llm' }] })) as { completed?: string }
    expect(assessed.completed).toBe('s1')
    await expect(call('library_assess', { verdicts: [{ task: 'x', criterion: 'x', pass: true, evidence: 'x', by: 'llm' }] })).rejects.toThrow(/quiz/)
  })

  it('covers take the string shorthands: "r_…#1-2", "topic: …", a bare url', async () => {
    const { book } = await seed()
    const draft = (await call('library_roadmap', { nodes: [
      { id: 's1', title: '混合站', gate: 'quiz', covers: [`${book}#1-2`, 'topic: 讲授', 'https://example.org/notes'] },
    ] })) as { draft: { primaryResourceId?: string; nodes: { covers: { ref: string; locator?: string }[] }[] } }
    expect(draft.draft.primaryResourceId).toBeUndefined()
    expect(draft.draft.nodes[0]?.covers).toEqual([
      { ref: book, locator: '1-2' },
      { ref: 'topic: 讲授' },
      { ref: 'https://example.org/notes' },
    ])
  })
})

describe('the roadmap scope reads itself off the covers', () => {
  it('every station on the same single resource lands on that resource\'s path — no resource parameter', async () => {
    const { book } = await seed()
    const draft = (await call('library_roadmap', { nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', covers: [`${book}#1`] }] })) as { draft: { primaryResourceId?: string } }
    expect(draft.draft.primaryResourceId).toBe(book)
  })

  it('mixed covers land on the project\'s own path — even with the session bound to a resource', async () => {
    const { book } = await seed()
    const draft = (await call('library_roadmap', { nodes: [
      { id: 's1', title: '离子通道', gate: 'quiz', covers: [{ ref: book, locator: '1' }] },
      { id: 's2', title: '拓展阅读', gate: 'read', covers: ['https://example.org/notes'] },
    ] })) as { draft: { primaryResourceId?: string } }
    expect(draft.draft.primaryResourceId).toBeUndefined()
  })

  it('an explicit resource string still overrides — and is still validated', async () => {
    const { book } = await seed()
    const draft = (await call('library_roadmap', { resource: book, nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', chapterRanges: [{ from: 1, to: 1 }] }] })) as { draft: { primaryResourceId?: string } }
    expect(draft.draft.primaryResourceId).toBe(book)
    await expect(call('library_roadmap', { resource: book, nodes: [{ id: 's1', title: '杂', gate: 'quiz', covers: ['topic:讲授'] }] })).rejects.toThrow(/draws on more than this one resource/)
  })
})

describe('the question axes default and take shorthands', () => {
  it('a bare question stores topic + knowledge; the flat shorthands fill the axes', async () => {
    await seed()
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
    const drafted = (await call('library_roadmap', { nodes: [{ id: 'n1', title: '极限', gate: 'quiz', covers: [{ ref: registered.resource.id, locator: '1' }] }] })) as { draft: { primaryResourceId?: string }; scopeNote: string }
    expect(drafted.draft.primaryResourceId).toBe(registered.resource.id)
    expect(drafted.scopeNote).toContain('微积分读本')
  })

  it('a resource id alone resolves its project for an unbound, project-less session', async () => {
    const { project, book } = await seed()
    const elsewhere = { agent: { session: { id: 's_elsewhere' } } }
    const drafted = (await call('library_roadmap', { nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', covers: [`${book}#1`] }] }, elsewhere)) as { draft: { primaryResourceId?: string } }
    expect(drafted.draft.primaryResourceId).toBe(book)
    expect(service.getBinding('s_elsewhere')).toEqual({ projectId: project, resourceId: book })
  })

  it('acceptance lines on a quiz station are taught both exits', async () => {
    const { book } = await seed()
    await expect(call('library_roadmap', { nodes: [{ id: 'n1', title: '极限', gate: 'quiz', covers: [`${book}#1`], acceptance: ['会求极限'] }] })).rejects.toThrow(/gate: "acceptance"[\s\S]*goals/)
  })

  it('a draft with several shape problems gets ONE refusal listing them all — not one round trip each', async () => {
    const { book } = await seed()
    await expect(call('library_roadmap', { nodes: [
      { id: 'n1', title: '读', gate: 'read', covers: [`${book}#1`], acceptance: ['读完它'] },
      { id: 'n2', title: '练', gate: 'acceptance', covers: [`${book}#2`] },
      { id: 'n3', title: '考', gate: 'quiz', covers: [`${book}#2`], dependsOn: ['n1'] },
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
    await seed()
    const nodes = [{ id: 'n1', title: '离子通道', kind: 'quiz', chapterRanges: [{ from: 1, to: 1 }] }]
    const draft = (await call('library_roadmap', { nodes: JSON.stringify(nodes) })) as { draft: { status: string } }
    expect(draft.draft.status).toBe('draft')
  })

  it('accepts cards as JSON text', async () => {
    await seed()
    const cards = [{ kind: 'concept', term: '不应期', gloss: 'Na⁺ 失活', source: { type: 'chat' } }]
    const recorded = (await call('library_cards', { cards: JSON.stringify(cards) })) as { added: { term: string }[] }
    expect(recorded.added[0]?.term).toBe('不应期')
  })

  it('a refusal names what arrived: unparseable text or the wrong shape', async () => {
    await seed()
    await expect(call('library_roadmap', { nodes: '{not json' })).rejects.toThrow(/not valid JSON/)
    await expect(call('library_cards', {})).rejects.toThrow(/missing required property/)
  })

  it('a legacy book cover may name its resource as book or bookId; a missing reference teaches, never crashes', async () => {
    const { book } = await seed()
    // The legacy union members ride the JSON-text transport (the typed nodes schema wants { ref }).
    await expect(call('library_roadmap', {
      nodes: JSON.stringify([{ id: 'n1', title: '离子通道', gate: 'quiz', covers: [{ kind: 'book', ranges: [{ from: 1, to: 1 }] }] }]),
    })).rejects.toThrow(/no ref/)
    // The natural shorthand { kind: "book", book } lands as the ref.
    const ok = (await call('library_roadmap', {
      nodes: JSON.stringify([{ id: 'n1', title: '离子通道', gate: 'quiz', covers: [{ kind: 'book', book, ranges: [{ from: 1, to: 1 }] }] }]),
    })) as { draft: { nodes: { covers: { ref?: string }[] }[] } }
    expect(ok.draft.nodes[0]?.covers[0]?.ref).toBe(book)
  })

  it('choice options arriving as { label } objects are stored as plain strings', async () => {
    const { project, book } = await seed()
    await call('library_roadmap', { nodes: [{ id: 'n1', title: '离子通道', gate: 'quiz', covers: [`${book}#1`] }] })
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
      nodes: [{ id: 'n1', title: '函数', gate: 'quiz', covers: [{ ref: added.resource.id, locator: '1' }] }],
    })) as { draft: { nodes: unknown[] } }
    expect(drafted.draft.nodes.length).toBe(1)
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
    await expect(call('library_resource', { op: 'create', kind: 'book' })).rejects.toThrow(/a thick entry/)
    // Prose poured into the id slot.
    await expect(call('library_project', { id: '新建数学项目' })).rejects.toThrow(/fields to change/)
  })
})

describe('station notes through the tools', () => {
  it('library_notes lands on the bound resource\'s path, and on the project path with resource: null', async () => {
    const { project, book } = await seed()
    await call('library_roadmap', { nodes: [
      { id: 'n1', title: '离子通道', gate: 'quiz', covers: [`${book}#1`] },
      { id: 'n2', title: '动作电位', gate: 'quiz', covers: [`${book}#2`], dependsOn: ['n1'] },
    ] })
    const adoptedBook = await service.adoptRoadmap({ projectId: project, resourceId: book })
    if (!adoptedBook.ok) throw new Error(adoptedBook.message)
    const written = (await call('library_notes', { node: 'n1', text: '## 讲义\n\n- 要点' })) as { notes: { revisions: number } }
    expect(written.notes.revisions).toBe(1)
    expect((await service.getRoadmap({ projectId: project, resourceId: book })).roadmap?.nodes[0]?.notes?.text).toContain('要点')
    // The bad calls teach.
    await expect(call('library_notes', { text: 'x' })).rejects.toThrow(/missing required property/)
    await expect(call('library_notes', { node: 'n9', text: 'x' })).rejects.toThrow(/no node/)
    // A project-path station takes resource: null.
    await call('library_roadmap', { resource: null, nodes: [
      { id: 's1', title: '极限', gate: 'quiz', covers: [{ ref: book, locator: '1' }] },
      { id: 's2', title: '串讲', gate: 'quiz', covers: ['topic:讲授'], dependsOn: ['s1'] },
    ] })
    const adoptedProject = await service.adoptRoadmap({ projectId: project })
    if (!adoptedProject.ok) throw new Error(adoptedProject.message)
    const station = (await call('library_notes', { resource: null, node: 's2', text: '讲授站讲义' })) as { notes: { revisions: number } }
    expect(station.notes.revisions).toBe(1)
    expect((await service.getRoadmap({ projectId: project })).roadmap?.nodes[1]?.notes?.text).toBe('讲授站讲义')
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
    expect(text).toContain('Current node: 离子通道')
    expect(text).toContain('不应期 [1]')
    expect(renderBindingContext(service, 's_other')).toMatch(/not bound/)
  })
})
