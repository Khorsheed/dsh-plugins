/**
 * The three model tools over a real service: the `what` enums validate and
 * teach, project / book default to the calling session's binding, refusals
 * surface as thrown text, and the per-turn bound context renders.
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
  const created = (await call('library_write', { what: 'project', project: { name: '神经科学', template: 'subject' } })) as { project: { id: string } }
  const book = (await call('library_write', {
    what: 'book',
    project: created.project.id,
    book: {
      title: 'Principles of Neural Science',
      edition: '6th',
      bookKind: 'knowledge',
      toc: ['Ion Channels', { title: 'The Action Potential' }],
      tocSource: { by: 'web', url: 'https://neurology.mhmedical.com/book.aspx?bookID=3024' },
    },
  })) as { book: { id: string } }
  await call('library_write', { what: 'binding', binding: { project: created.project.id, book: book.book.id } })
  return { project: created.project.id, book: book.book.id }
}

describe('the tool set', () => {
  it('is exactly the three verbs, in order', () => {
    expect(tools.map(tool => tool.name)).toEqual(['library_read', 'library_write', 'library_assess'])
    expect(LIBRARY_TOOL_NAMES).toEqual(['library_read', 'library_write', 'library_assess'])
  })

  it('the Config schema defaults to all tools and a quiet-nothing scope', () => {
    expect(Config({})).toEqual({ tools: 'all', hideSections: [], denyTools: [] })
    expect(Config({ tools: 'none' }).tools).toBe('none')
  })
})

describe('editing a project', () => {
  it('library_write · project with an id renames it instead of creating one', async () => {
    const { project } = await seed()
    const edited = (await call('library_write', { what: 'project', project: { id: project, name: '神经科学 × 人工智能', goal: '' } })) as { project: { name: string; goal?: string } }
    expect(edited.project.name).toBe('神经科学 × 人工智能')
    expect(edited.project.goal).toBeUndefined()
    const listed = (await call('library_read', { what: 'projects' })) as { projects: unknown[] }
    expect(listed.projects).toHaveLength(1)
    await expect(call('library_write', { what: 'project', project: { id: project } })).rejects.toThrow(/name\?, goal\?/)
  })
})

describe('binding defaults', () => {
  it('an unbound session is taught to ask and bind', async () => {
    await expect(call('library_read', { what: 'roadmap' })).rejects.toThrow(/library_write · binding/)
  })

  it('a bound session reads and writes without naming project or book', async () => {
    await seed()
    const toc = (await call('library_read', { what: 'toc' })) as { toc: { n: number; title: string }[] }
    expect(toc.toc.map(row => row.n)).toEqual([1, 2])
    const draft = (await call('library_write', { what: 'roadmap', roadmap: { nodes: [{ id: 'n1', title: '离子通道', kind: 'quiz', chapterRanges: [{ from: 1, to: 1 }] }] } })) as { draft: { status: string } }
    expect(draft.draft.status).toBe('draft')
    const recorded = (await call('library_write', { what: 'cards', cards: [{ kind: 'concept', term: '不应期', gloss: 'Na⁺ 失活', source: { type: 'chat', note: '说老是记混' }, weaken: true }] })) as { added: { bookId?: string; sources: { ref?: string }[] }[] }
    expect(recorded.added[0]?.bookId).toBeDefined()
    // A chat card remembers the session it came from.
    expect(recorded.added[0]?.sources[0]?.ref).toBe('s_learn')
    const records = await service.recentRecords({})
    expect(records.records[0]?.session).toBe('s_learn')
    const read = (await call('library_read', { what: 'cards', query: '不应期' })) as { cards: { term: string; weakness: number; sources: string[] }[] }
    expect(read.cards[0]).toMatchObject({ term: '不应期', weakness: 1, sources: ['chat: 说老是记混'] })
  })

  it('binds from top-level project / book, and unbinds only on an explicit null', async () => {
    const { project, book } = await seed()
    await call('library_write', { what: 'binding', project, book })
    expect(service.getBinding('s_learn')).toEqual({ projectId: project, bookId: book })
    await expect(call('library_write', { what: 'binding' })).rejects.toThrow(/needs the project/)
    expect(service.getBinding('s_learn')).toEqual({ projectId: project, bookId: book })
    await call('library_write', { what: 'binding', binding: null })
    expect(service.getBinding('s_learn')).toBeUndefined()
  })

  it('the projects read reports this session\'s binding', async () => {
    const { project } = await seed()
    const listed = (await call('library_read', { what: 'projects' })) as { binding: { projectId: string } | null }
    expect(listed.binding?.projectId).toBe(project)
  })
})

describe('resources', () => {
  it('a bound session adds, lists and removes a shelf link without naming the project', async () => {
    await seed()
    const added = (await call('library_write', { what: 'resource', op: 'add', resource: { title: 'MuJoCo', url: 'https://mujoco.org', kind: 'tool', note: '仿真物理引擎' } })) as { resource: { id: string; addedBy: string } }
    expect(added.resource.addedBy).toBe('coach')
    const listed = (await call('library_read', { what: 'resources' })) as { resources: { title: string }[] }
    expect(listed.resources.map(resource => resource.title)).toEqual(['MuJoCo'])
    await expect(call('library_write', { what: 'resource', op: 'add', resource: { title: 'x', url: 'https://mujoco.org', kind: 'tool' } })).rejects.toThrow(/already on this project's shelf/)
    const removed = (await call('library_write', { what: 'resource', op: 'remove', resource: { id: added.resource.id } })) as { id: string }
    expect(removed.id).toBe(added.resource.id)
    expect(((await call('library_read', { what: 'resources' })) as { resources: unknown[] }).resources).toEqual([])
  })

  it('teaches the payload shape and the op', async () => {
    await seed()
    await expect(call('library_write', { what: 'resource', op: 'add', resource: { title: 'x' } })).rejects.toThrow(/op=add takes resource/)
    await expect(call('library_write', { what: 'resource', op: 'remove', resource: {} })).rejects.toThrow(/op=remove takes resource/)
    await expect(call('library_write', { what: 'resource', resource: {} })).rejects.toThrow(/op: add \| remove/)
  })
})

describe('project paths through the tools', () => {
  it('drafts the project\'s path with covers (book: null), reads it back, keeps the chapterRanges sugar for a book', async () => {
    const { book } = await seed()
    const draft = (await call('library_write', {
      what: 'roadmap',
      book: null,
      roadmap: {
        nodes: [
          { id: 's1', title: 'RL 直觉', kind: 'practice', covers: [{ kind: 'topic', text: '奖励 = 行为塑造' }], acceptance: ['跑满 20 万步'] },
          { id: 's2', title: '快慢回路', kind: 'quiz', covers: [{ kind: 'topic', text: '讲授' }], dependsOn: ['s1'] },
        ],
      },
    })) as { draft: { bookId?: string; nodes: { id: string }[] } }
    expect(draft.draft.bookId).toBeUndefined()
    expect(draft.draft.nodes.map(node => node.id)).toEqual(['s1', 's2'])
    const seen = (await call('library_read', { what: 'roadmap', book: null })) as { draft?: { nodes: { id: string }[] } }
    expect(seen.draft?.nodes.map(node => node.id)).toEqual(['s1', 's2'])
    // chapterRanges on the bound book's own path wrap into its one book cover.
    const bookDraft = (await call('library_write', { what: 'roadmap', roadmap: { nodes: [{ id: 'n1', title: '离子通道', kind: 'quiz', chapterRanges: [{ from: 1, to: 1 }] }] } })) as { draft: { bookId?: string; nodes: { covers: { kind: string; bookId?: string }[] }[] } }
    expect(bookDraft.draft.bookId).toBe(book)
    expect(bookDraft.draft.nodes[0]?.covers[0]).toMatchObject({ kind: 'book', bookId: book })
  })

  it('assesses a practice station by node through library_assess', async () => {
    const { project } = await seed()
    await call('library_write', { what: 'roadmap', book: null, roadmap: { nodes: [{ id: 's1', title: 'RL 直觉', kind: 'practice', covers: [{ kind: 'topic', text: '讲授' }], acceptance: ['跑满 20 万步'] }] } })
    const adopted = await service.adoptRoadmap({ projectId: project })
    if (!adopted.ok) throw new Error(adopted.message)
    const assessed = (await call('library_assess', { node: 's1', verdicts: [{ task: 's1', criterion: '跑满 20 万步', pass: true, evidence: '终端输出', by: 'llm' }] })) as { completed?: string }
    expect(assessed.completed).toBe('s1')
    await expect(call('library_assess', { verdicts: [{ task: 'x', criterion: 'x', pass: true, evidence: 'x', by: 'llm' }] })).rejects.toThrow(/quiz/)
  })
})

describe('photo pages', () => {
  it('records a page from the session\'s latest photo when the model names none', async () => {
    await seed()
    await expect(call('library_write', { what: 'page', page: { text: 'x', marks: [] } })).rejects.toThrow(/send the page photo/)
    const ref = { attachmentId: 'sha256:abc', mediaType: 'image/jpeg', width: 10, height: 20, bytes: 99 }
    images.observe('s_learn', { type: 'user/message', data: { content: [{ type: 'image', attachment: ref }] } })
    const recorded = (await call('library_write', { what: 'page', page: { attachment: { attachmentId: 'abc', mediaType: 'image/jpeg' }, text: 'held at the inn', marks: [{ text: 'held', gloss: '举办' }] } })) as { page: { attachment: unknown } }
    expect(recorded.page.attachment).toEqual(ref)
  })
})

describe('teaching errors', () => {
  it('rejects an unknown what with the valid list', async () => {
    await expect(call('library_read', { what: 'everything' })).rejects.toThrow(/projects \| books \| resources \| toc \| roadmap \| pages \| cards \| quiz \| stats/)
    await expect(call('library_write', { what: 'notes' })).rejects.toThrow(/project \| book \| roadmap \| page \| cards \| quiz \| resource \| binding/)
  })

  it('surfaces the service refusal verbatim', async () => {
    await seed()
    await expect(call('library_write', { what: 'quiz', quiz: { questions: [{ id: 'q1', kind: 'free', prompt: 'p', answer: 'a', target: { kind: 'asked' }, evidence: { kind: 'knowledge' } }] } }))
      .rejects.toThrow(/cardIds/)
  })
})

describe('payload transport', () => {
  it('accepts a roadmap payload as JSON text — models stringify deep parameters', async () => {
    await seed()
    const roadmap = { nodes: [{ id: 'n1', title: '离子通道', kind: 'quiz', chapterRanges: [{ from: 1, to: 1 }] }] }
    const draft = (await call('library_write', { what: 'roadmap', roadmap: JSON.stringify(roadmap) })) as { draft: { status: string } }
    expect(draft.draft.status).toBe('draft')
  })

  it('accepts cards as JSON text', async () => {
    await seed()
    const cards = [{ kind: 'concept', term: '不应期', gloss: 'Na⁺ 失活', source: { type: 'chat' } }]
    const recorded = (await call('library_write', { what: 'cards', cards: JSON.stringify(cards) })) as { added: { term: string }[] }
    expect(recorded.added[0]?.term).toBe('不应期')
  })

  it('a refusal names what arrived: nothing, unparseable text, or the wrong shape', async () => {
    await seed()
    await expect(call('library_write', { what: 'roadmap' })).rejects.toThrow(/no roadmap field arrived — set the roadmap field itself/)
    await expect(call('library_write', { what: 'roadmap', roadmap: '{not json' })).rejects.toThrow(/not valid JSON/)
    await expect(call('library_write', { what: 'cards' })).rejects.toThrow(/no cards field arrived/)
  })

  it('a book cover may name its book as book or bookId; a missing reference teaches, never crashes', async () => {
    const { book } = await seed()
    // A book cover missing its reference teaches — never a store-level crash.
    await expect(call('library_write', {
      what: 'roadmap',
      book: null,
      roadmap: { nodes: [{ id: 'n1', title: '离子通道', kind: 'quiz', covers: [{ kind: 'book', ranges: [{ from: 1, to: 1 }] }] }] },
    })).rejects.toThrow(/no bookId/)
    // The natural shorthand { kind: "book", book } lands as bookId.
    const ok = (await call('library_write', {
      what: 'roadmap',
      book: null,
      roadmap: { nodes: [{ id: 'n1', title: '离子通道', kind: 'quiz', covers: [{ kind: 'book', book, ranges: [{ from: 1, to: 1 }] }] }] },
    })) as { draft: { nodes: { covers: { bookId?: string }[] }[] } }
    expect(ok.draft.nodes[0]?.covers[0]?.bookId).toBe(book)
  })
})

describe('the bound context', () => {
  it('names the bound book, its current node and the weak cards', async () => {
    const { project, book } = await seed()
    await service.draftRoadmap({ projectId: project, bookId: book, nodes: [{ id: 'n1', title: '离子通道', kind: 'quiz', covers: [{ kind: 'book', bookId: book, ranges: [] }] }] })
    await service.adoptRoadmap({ projectId: project, bookId: book })
    await service.writeCards({ projectId: project, bookId: book, cards: [{ kind: 'concept', term: '不应期', gloss: 'g', source: { type: 'chat' } }] })
    const text = renderBindingContext(service, 's_learn')
    expect(text).toContain('Principles of Neural Science')
    expect(text).toContain('Current node: 离子通道')
    expect(text).toContain('不应期 [1]')
    expect(renderBindingContext(service, 's_other')).toMatch(/not bound/)
  })
})
