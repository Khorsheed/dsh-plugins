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
    await expect(call('library_read', { what: 'everything' })).rejects.toThrow(/projects \| books \| toc \| roadmap \| pages \| cards \| quiz \| stats/)
    await expect(call('library_write', { what: 'notes' })).rejects.toThrow(/project \| book \| roadmap \| page \| cards \| quiz \| binding/)
  })

  it('surfaces the service refusal verbatim', async () => {
    await seed()
    await expect(call('library_write', { what: 'quiz', quiz: { questions: [{ id: 'q1', kind: 'free', prompt: 'p', answer: 'a', target: { kind: 'asked' }, evidence: { kind: 'knowledge' } }] } }))
      .rejects.toThrow(/cardIds/)
  })
})

describe('the bound context', () => {
  it('names the bound book, its current node and the weak cards', async () => {
    const { project, book } = await seed()
    await service.draftRoadmap({ projectId: project, bookId: book, nodes: [{ id: 'n1', title: '离子通道', kind: 'quiz' }] })
    await service.adoptRoadmap({ projectId: project, bookId: book })
    await service.writeCards({ projectId: project, bookId: book, cards: [{ kind: 'concept', term: '不应期', gloss: 'g', source: { type: 'chat' } }] })
    const text = renderBindingContext(service, 's_learn')
    expect(text).toContain('Principles of Neural Science')
    expect(text).toContain('Current node: 离子通道')
    expect(text).toContain('不应期 [1]')
    expect(renderBindingContext(service, 's_other')).toMatch(/not bound/)
  })
})
