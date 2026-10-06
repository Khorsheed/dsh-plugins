/**
 * The three model tools over a real service: the `what` enums validate and
 * teach, refusals surface as thrown text the model reads, and the origin tag
 * is applied by the row (here asserted off the definitions' builder + the
 * row's tagging idiom).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../src/service.ts'
import { LIBRARY_TOOL_NAMES, libraryToolDefinitions } from '../src/tool-definition.ts'
import { Config, loadLibrarySkill } from '../src/tool.ts'

let root: string
let service: LibraryService
let tools: ReturnType<typeof libraryToolDefinitions>

const ctx = { get: () => undefined } as unknown as Context

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-library-tools-'))
  service = new LibraryService(ctx, { stateRoot: root })
  tools = libraryToolDefinitions(service)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Call one tool by name with raw args (as the model would). */
async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`no tool ${name}`)
  // The registry validates before execute; the tests call execute directly, so
  // the args reach it as-is (the teaching errors are the contract under test).
  return tool.execute(args as never, {} as never)
}

/** Seed: one project + one book. */
async function seed(): Promise<{ project: string; book: string }> {
  const created = (await call('library_write', { what: 'project', project: { name: '神经科学' } })) as { ok: true; project: { id: string } }
  const stored = (await call('library_write', {
    what: 'book',
    book: {
      project: created.project.id,
      title: '认知神经科学',
      format: 'md',
      chapters: [
        { title: '概论', html: '<p>神经系统由神经元与胶质细胞构成。</p>' },
        { title: '突触', html: '<p>Ca²⁺ 内流触发囊泡与突触前膜融合。</p>' },
      ],
    },
  })) as { ok: true; book: { id: string } }
  return { project: created.project.id, book: stored.book.id }
}

describe('the tool set', () => {
  it('is exactly the three verbs, in order', () => {
    expect(tools.map(tool => tool.name)).toEqual(['library_read', 'library_write', 'library_assess'])
    expect(LIBRARY_TOOL_NAMES).toEqual(['library_read', 'library_write', 'library_assess'])
  })

  it('the Config schema defaults tools to all and accepts none', () => {
    // Schemastery schemas are callable: Config(value) validates + defaults.
    expect(Config({})).toEqual({ tools: 'all' })
    expect(Config({ tools: 'none' })).toEqual({ tools: 'none' })
  })
})

describe('library_read', () => {
  it('rejects an unknown what with the valid list in the message', async () => {
    await expect(call('library_read', { what: 'everything' })).rejects.toThrow(/projects.*books.*toc.*chapter.*roadmap.*vocab.*due.*quiz.*stats/)
  })

  it('reads the project wall and a chapter page', async () => {
    const { project } = await seed()
    const wall = (await call('library_read', { what: 'projects' })) as { projects: { id: string; name: string }[] }
    expect(wall.projects[0]?.name).toBe('神经科学')
    const chapter = (await call('library_read', { what: 'chapter', project, book: (await service.listProjects()).projects[0]!.books[0]!, chapter: 2 })) as { title: string; html: string }
    expect(chapter.title).toBe('突触')
    expect(chapter.html).toContain('Ca²⁺')
  })

  it('teaches the missing project argument', async () => {
    await expect(call('library_read', { what: 'roadmap' })).rejects.toThrow(/project is required.*library_read · projects/)
  })
})

describe('library_write', () => {
  it('rejects an unknown what with the valid list in the message', async () => {
    await expect(call('library_write', { what: 'settings' })).rejects.toThrow(/project.*book.*roadmap.*notes.*quiz/)
  })

  it('writes notes and reads them back (vocab)', async () => {
    const { project } = await seed()
    const written = (await call('library_write', {
      what: 'notes',
      notes: { project, entries: [{ kind: 'vocab', term: 'synapse', note: '突触', chapterRef: 'ch:2' }] },
    })) as { ok: true; added: number }
    expect(written.added).toBe(1)
    const vocab = (await call('library_read', { what: 'vocab', project })) as { entries: { term: string }[] }
    expect(vocab.entries.map(entry => entry.term)).toEqual(['synapse'])
  })

  it('the evidence gate fires through the tool, with the lesson as the error text', async () => {
    const { project, book } = await seed()
    await expect(call('library_write', {
      what: 'quiz',
      quiz: {
        project,
        scope: { book },
        questions: [{ id: 'q1', kind: 'free', prompt: '递质如何释放？', chapterRef: '', evidence: '', answer: 'x' }],
      },
    })).rejects.toThrow(/ch:<n>/)
  })
})

describe('library_assess', () => {
  it('ledgers a sitting and unlocks the next node at the pass ratio', async () => {
    const { project, book } = await seed()
    await call('library_write', {
      what: 'roadmap',
      roadmap: {
        project,
        book,
        nodes: [
          { id: 'n1', title: '概论', goals: [], chapterRanges: [{ from: 1, to: 1 }], dependsOn: [], state: 'current' },
          { id: 'n2', title: '突触', goals: [], chapterRanges: [{ from: 2, to: 2 }], dependsOn: ['n1'], state: 'locked' },
        ],
      },
    })
    const quiz = (await call('library_write', {
      what: 'quiz',
      quiz: {
        project,
        scope: { book, node: 'n1' },
        questions: [{ id: 'q1', kind: 'free', prompt: '神经系统由什么构成？', chapterRef: 'ch:1', evidence: '神经系统由神经元与胶质细胞构成', answer: '神经元与胶质细胞' }],
      },
    })) as { ok: true; quiz: { id: string } }
    const assessed = (await call('library_assess', {
      project,
      quiz: quiz.quiz.id,
      verdicts: [{ task: 'q1', criterion: '构成说全了', pass: true, evidence: '神经系统由神经元与胶质细胞构成', by: 'llm' }],
    })) as { ok: true; unlocked: string[]; completed?: string }
    expect(assessed.completed).toBe('n1')
    expect(assessed.unlocked).toEqual(['n2'])
  })

  it('rejects a verdict naming no question of the quiz, listing the real ones', async () => {
    const { project, book } = await seed()
    const quiz = (await call('library_write', {
      what: 'quiz',
      quiz: {
        project,
        scope: { book },
        questions: [{ id: 'q1', kind: 'free', prompt: 'p', chapterRef: 'ch:1', evidence: '神经系统由神经元与胶质细胞构成', answer: 'x' }],
      },
    })) as { ok: true; quiz: { id: string } }
    await expect(call('library_assess', {
      project,
      quiz: quiz.quiz.id,
      verdicts: [{ task: 'qq', criterion: 'c', pass: true, evidence: 'e', by: 'llm' }],
    })).rejects.toThrow(/q1/)
  })
})

describe('the shipped skill', () => {
  it('loads from skills/library/SKILL.md with frontmatter intact', () => {
    const skill = loadLibrarySkill()
    expect(skill).toBeDefined()
    expect(skill?.name).toBe('library')
    expect(skill?.description).toContain('library_read')
    expect(skill?.content).toContain('chapterRef is `ch:<n>`')
    expect(skill?.content).toContain('library_assess')
  })
})
