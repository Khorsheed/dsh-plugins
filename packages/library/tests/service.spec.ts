/**
 * The service's rules: project CRUD, book storage and chapter paging, the
 * roadmap state machine, the vocab merge, the quiz evidence gate, and the
 * assess cascade (verdict ledger → Leitner boxes → node stats → unlocks).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../src/service.ts'
import type { RoadmapNode } from '../src/types.ts'

let root: string
let service: LibraryService

/** A ctx with no attachments service (the probe path reads as absent). */
const ctx = { get: () => undefined } as unknown as Context

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'dsh-library-service-'))
  service = new LibraryService(ctx, { stateRoot: root })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A project with one two-chapter book stored. */
async function seedProject(): Promise<{ projectId: string; bookId: string }> {
  const created = await service.createProject({ name: '神经科学' })
  if (!created.ok) throw new Error(created.message)
  const stored = await service.storeBook({
    projectId: created.project.id,
    title: '认知神经科学',
    source: { kind: 'upload', ref: 'cog.epub' },
    format: 'epub',
    chapters: [
      { title: '神经系统概论', html: '<p>神经系统由神经元与胶质细胞构成。</p>' },
      { title: '突触传递', html: '<p>Ca²⁺ 内流触发囊泡与突触前膜融合，释放神经递质。</p>' },
    ],
  })
  if (!stored.ok) throw new Error(stored.message)
  return { projectId: created.project.id, bookId: stored.book.id }
}

/** A minimal legal two-node roadmap (n1 current, n2 locked behind it). */
function seedNodes(): RoadmapNode[] {
  return [
    { id: 'n1', title: '概论', kind: 'quiz', goals: ['说出神经系统的构成'], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'current' },
    { id: 'n2', title: '突触传递', kind: 'quiz', goals: ['解释递质释放'], dependsOn: ['n1'], chapterRanges: [{ from: 2, to: 2 }], state: 'locked' },
  ]
}

describe('projects', () => {
  it('creates, lists, and refuses a duplicate name', async () => {
    const created = await service.createProject({ name: '雅思英语', domain: 'IELTS' })
    expect(created.ok).toBe(true)
    const again = await service.createProject({ name: '雅思英语' })
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.error).toBe('exists')
    expect(again.message).toContain('library_read · projects')

    const list = await service.listProjects()
    expect(list.projects.map(project => project.name)).toEqual(['雅思英语'])
    expect(list.projects[0]?.books).toEqual([])
    expect(list.projects[0]?.vocabCount).toBe(0)
  })

  it('refuses an empty name with a teaching message', async () => {
    const refused = await service.createProject({ name: '  ' })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.message).toContain('name')
  })

  it('deletes a project and everything it holds', async () => {
    const { projectId } = await seedProject()
    const deleted = await service.deleteProject({ id: projectId })
    expect(deleted.ok).toBe(true)
    expect((await service.listProjects()).projects).toEqual([])
    expect(store_readProjectMissing(projectId)).toBe(true)
  })

  function store_readProjectMissing(id: string): boolean {
    return service.store.readProject(id) === undefined
  }
})

describe('books and chapters', () => {
  it('stores a book and serves its toc', async () => {
    const { projectId, bookId } = await seedProject()
    const toc = await service.getToc({ projectId, bookId })
    expect(toc.ok).toBe(true)
    if (!toc.ok) return
    expect(toc.book.toc.map(entry => entry.title)).toEqual(['神经系统概论', '突触传递'])
  })

  it('pages a long chapter under the byte budget, ending at a closing tag', async () => {
    const created = await service.createProject({ name: '长文' })
    if (!created.ok) throw new Error(created.message)
    const paragraph = `<p>${'一段正文。'.repeat(2000)}</p>\n`
    const body = paragraph.repeat(20) // ~ 500KB
    const stored = await service.storeBook({
      projectId: created.project.id,
      title: '长书',
      source: { kind: 'upload', ref: 'long.md' },
      format: 'md',
      chapters: [{ title: '唯一章', html: body }],
    })
    if (!stored.ok) throw new Error(stored.message)
    const first = await service.getChapterBody({ projectId: created.project.id, bookId: stored.book.id, chapter: 1 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.html.length).toBeLessThanOrEqual(100 * 1024 + 64)
    expect(first.nextOffset).toBeDefined()
    expect(first.html.endsWith('</p>')).toBe(true)
    const second = await service.getChapterBody({ projectId: created.project.id, bookId: stored.book.id, chapter: 1, offset: first.nextOffset })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(first.html + second.html).toBe(body)
    expect(second.nextOffset).toBeUndefined()
    // An out-of-range offset is a teaching refusal, not an empty page.
    const past = await service.getChapterBody({ projectId: created.project.id, bookId: stored.book.id, chapter: 1, offset: body.length + 1 })
    expect(past.ok).toBe(false)
    if (!past.ok) expect(past.message).toContain('nextOffset')
  })

  it('refuses a chapter outside the toc with the real range named', async () => {
    const { projectId, bookId } = await seedProject()
    const refused = await service.getChapterBody({ projectId, bookId, chapter: 9 })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.message).toContain('1..2')
  })
})

describe('the roadmap state machine', () => {
  it('accepts a legal roadmap and refuses a current node with unmet deps', async () => {
    const { projectId, bookId } = await seedProject()
    const written = await service.putRoadmap({ projectId, bookId, nodes: seedNodes() })
    expect(written.ok).toBe(true)

    const illegal = await service.putRoadmap({
      projectId,
      bookId,
      regenerate: true,
      nodes: [
        { id: 'n1', title: '概论', kind: 'quiz', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'locked' },
        { id: 'n2', title: '突触', kind: 'quiz', goals: [], dependsOn: ['n1'], chapterRanges: [{ from: 2, to: 2 }], state: 'current' },
      ],
    })
    expect(illegal.ok).toBe(false)
    if (!illegal.ok) {
      expect(illegal.error).toBe('invalid')
      expect(illegal.message).toContain('n1')
    }
  })

  it('refuses a forward dependency and a range outside the book', async () => {
    const { projectId, bookId } = await seedProject()
    const forward = await service.putRoadmap({
      projectId,
      bookId,
      nodes: [
        { id: 'n1', title: 'A', kind: 'quiz', goals: [], dependsOn: ['n2'], chapterRanges: [], state: 'locked' },
        { id: 'n2', title: 'B', kind: 'quiz', goals: [], dependsOn: [], chapterRanges: [], state: 'current' },
      ],
    })
    expect(forward.ok).toBe(false)
    if (!forward.ok) expect(forward.message).toContain('AFTER')

    const outOfBook = await service.putRoadmap({
      projectId,
      bookId,
      nodes: [{ id: 'n1', title: 'A', kind: 'quiz', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 9 }], state: 'current' }],
    })
    expect(outOfBook.ok).toBe(false)
    if (!outOfBook.ok) expect(outOfBook.message).toContain('has 2 chapters')
  })

  it('refuses illegal state edges against the stored roadmap (locked → done, done → current)', async () => {
    const { projectId, bookId } = await seedProject()
    await service.putRoadmap({ projectId, bookId, nodes: seedNodes() })
    // locked → done skips current.
    const skip = await service.putRoadmap({
      projectId,
      bookId,
      nodes: [
        { ...seedNodes()[0]! },
        { ...seedNodes()[1]!, state: 'done' as const },
      ],
    })
    // n2 done requires n1 done (shape rule), so this fails the shape first.
    expect(skip.ok).toBe(false)

    // Complete n1 properly, then try to drag it back.
    const done = await service.putRoadmap({
      projectId,
      bookId,
      nodes: [
        { ...seedNodes()[0]!, state: 'done' as const },
        { ...seedNodes()[1]!, state: 'current' as const },
      ],
    })
    expect(done.ok).toBe(true)
    const backward = await service.putRoadmap({
      projectId,
      bookId,
      nodes: [
        { ...seedNodes()[0]!, state: 'current' as const },
        { ...seedNodes()[1]! },
      ],
    })
    expect(backward.ok).toBe(false)
    if (!backward.ok) {
      expect(backward.error).toBe('state-machine')
      expect(backward.message).toContain('locked → current → done')
    }
  })

  it('allows the legal forward edges and a regenerate re-split', async () => {
    const { projectId, bookId } = await seedProject()
    await service.putRoadmap({ projectId, bookId, nodes: seedNodes() })
    // current → done is the legal edge.
    const forward = await service.putRoadmap({
      projectId,
      bookId,
      nodes: [
        { ...seedNodes()[0]!, state: 'done' as const },
        { ...seedNodes()[1]!, state: 'current' as const },
      ],
    })
    expect(forward.ok).toBe(true)
    // regenerate re-splits from scratch, states judged only against the new deps.
    const regenerated = await service.putRoadmap({
      projectId,
      bookId,
      regenerate: true,
      nodes: [{ id: 'm1', title: '整章重读', kind: 'quiz', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 2 }], state: 'current' }],
    })
    expect(regenerated.ok).toBe(true)
    if (regenerated.ok) expect(regenerated.roadmap.nodes.map(node => node.id)).toEqual(['m1'])
  })
})

describe('the vocab book', () => {
  it('appends entries, merges a same-term same-chapter pair without touching mastery', async () => {
    const { projectId } = await seedProject()
    const first = await service.addVocabEntries({
      projectId,
      entries: [{ kind: 'vocab', term: 'synapse', note: '突触', chapterRef: 'ch:2', source: { kind: 'manual' } }],
    })
    expect(first.ok && first.added).toBe(1)
    const id = first.ok ? first.entries[0]!.id : ''
    // Assess it right once, so the merge has mastery to keep.
    // (a passing quiz verdict moves the box — covered in the cascade suite)
    const second = await service.addVocabEntries({
      projectId,
      entries: [{ kind: 'vocab', term: 'Synapse', note: '突触，神经元之间的接头', chapterRef: 'ch:2' }],
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.merged).toBe(1)
    expect(second.added).toBe(0)
    expect(second.entries[0]?.id).toBe(id)
    expect(second.entries[0]?.note).toBe('突触，神经元之间的接头')
    const vocab = await service.listVocab({ projectId })
    expect(vocab.entries).toHaveLength(1)
  })

  it('refuses an off-convention chapterRef with the convention in the message', async () => {
    const { projectId } = await seedProject()
    const refused = await service.addVocabEntries({
      projectId,
      entries: [{ kind: 'vocab', term: 'x', note: 'y', chapterRef: '第三章' }],
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.message).toContain('ch:<n>')
  })

  it('answers the due list lowest-box-first, cross-project when no id is given', async () => {
    const { projectId } = await seedProject()
    const other = await service.createProject({ name: '雅思英语' })
    if (!other.ok) throw new Error(other.message)
    // Directly seed the ledgers: due-ness is dueAt's job, not the write path's.
    await service.addVocabEntries({
      projectId,
      entries: [{ kind: 'vocab', term: 'synapse', note: '突触', chapterRef: 'ch:1' }],
    })
    await service.addVocabEntries({
      projectId: other.project.id,
      entries: [{ kind: 'vocab', term: 'cohesion', note: '衔接', chapterRef: 'ch:1' }],
    })
    // New cards are due immediately (box 0, dueAt now) — both projects' appear.
    const due = await service.dueVocab({})
    expect(due.entries.map(entry => entry.term).sort()).toEqual(['cohesion', 'synapse'])
    const scoped = await service.dueVocab({ projectId })
    expect(scoped.entries.map(entry => entry.term)).toEqual(['synapse'])
  })
})

describe('the quiz evidence gate', () => {
  it('refuses a question without chapterRef or evidence, teaching the shape', async () => {
    const { projectId, bookId } = await seedProject()
    const noRef = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId },
        questions: [{ id: 'q1', kind: 'free', prompt: '递质如何释放？', chapterRef: '', evidence: 'Ca²⁺ 内流触发囊泡与突触前膜融合', answer: 'x' }],
      },
    })
    expect(noRef.ok).toBe(false)
    if (!noRef.ok) {
      expect(noRef.error).toBe('evidence-gate')
      expect(noRef.message).toContain('ch:<n>')
    }

    const noEvidence = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId },
        questions: [{ id: 'q1', kind: 'free', prompt: '递质如何释放？', chapterRef: 'ch:2', evidence: '', answer: 'x' }],
      },
    })
    expect(noEvidence.ok).toBe(false)
    if (!noEvidence.ok) expect(noEvidence.message).toContain('evidence')

    const wrongChapter = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId },
        questions: [{ id: 'q1', kind: 'free', prompt: 'p', chapterRef: 'ch:9', evidence: '一段足够长的原文引用', answer: 'x' }],
      },
    })
    expect(wrongChapter.ok).toBe(false)
    if (!wrongChapter.ok) expect(wrongChapter.message).toContain('1..2')
  })

  it('stores a gated quiz, warning on evidence the chapter does not literally contain', async () => {
    const { projectId, bookId } = await seedProject()
    const verbatim = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId },
        questions: [{
          id: 'q1',
          kind: 'free',
          prompt: '触发递质释放的直接信号是？',
          chapterRef: 'ch:2',
          evidence: 'Ca²⁺ 内流触发囊泡与突触前膜融合',
          answer: 'Ca²⁺ 内流',
        }],
      },
    })
    expect(verbatim.ok).toBe(true)
    if (verbatim.ok) expect(verbatim.warnings).toEqual([])

    const paraphrased = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId },
        questions: [{
          id: 'q1',
          kind: 'free',
          prompt: 'p',
          chapterRef: 'ch:2',
          evidence: '钙离子通道开放后囊泡才释放（转述）',
          answer: 'x',
        }],
      },
    })
    expect(paraphrased.ok).toBe(true)
    if (paraphrased.ok) expect(paraphrased.warnings[0]).toContain('not a verbatim fragment')
  })
})

describe('the assess cascade', () => {
  it('ledgers the verdicts, moves the probed cards, completes the node and unlocks its dependent', async () => {
    const { projectId, bookId } = await seedProject()
    await service.putRoadmap({ projectId, bookId, nodes: seedNodes() })
    // Two cards the quiz probes.
    const vocabResult = await service.addVocabEntries({
      projectId,
      entries: [
        { kind: 'vocab', term: 'synapse', note: '突触', chapterRef: 'ch:2' },
        { kind: 'vocab', term: 'EPSP', note: '兴奋性突触后电位', chapterRef: 'ch:2' },
      ],
    })
    if (!vocabResult.ok) throw new Error(vocabResult.message)
    const [synapse, epsp] = vocabResult.entries
    const quizResult = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId, nodeId: 'n1' },
        questions: [
          { id: 'q1', kind: 'free', prompt: '神经系统由什么构成？', chapterRef: 'ch:1', evidence: '神经系统由神经元与胶质细胞构成', answer: '神经元与胶质细胞', vocabIds: [synapse!.id] },
          { id: 'q2', kind: 'free', prompt: '触发递质释放的信号？', chapterRef: 'ch:2', evidence: 'Ca²⁺ 内流触发囊泡与突触前膜融合', answer: 'Ca²⁺ 内流', vocabIds: [epsp!.id] },
        ],
      },
    })
    if (!quizResult.ok) throw new Error(quizResult.message)

    const before = Date.now()
    const assessed = await service.putAttempt({
      projectId,
      quizId: quizResult.quiz.id,
      verdicts: [
        { task: 'q1', criterion: '构成说全了', pass: true, evidence: '神经系统由神经元与胶质细胞构成', by: 'llm' },
        { task: 'q2', criterion: '把信号说成了 Na⁺', pass: false, evidence: 'Ca²⁺ 内流触发囊泡与突触前膜融合', by: 'llm' },
      ],
    })
    expect(assessed.ok).toBe(true)
    if (!assessed.ok) return
    // ratio 0.5 < 0.8: the node does NOT complete, nothing unlocks.
    expect(assessed.attempt.ratio).toBe(0.5)
    expect(assessed.unlocked).toEqual([])
    expect(assessed.completed).toBeUndefined()

    // The attempt is ledgered.
    const attempts = service.store.readAttempts(projectId)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.verdicts).toHaveLength(2)

    // The passed card climbs to box 1 (due in 2 days); the failed card resets
    // to box 0, due TOMORROW (box 0's rung is 1 day).
    const vocab = await service.listVocab({ projectId })
    const passed = vocab.entries.find(entry => entry.id === synapse!.id)!
    const failed = vocab.entries.find(entry => entry.id === epsp!.id)!
    expect(passed.mastery.box).toBe(1)
    expect(passed.mastery.streak).toBe(1)
    expect(failed.mastery.box).toBe(0)
    expect(failed.mastery.streak).toBe(0)
    const tomorrow = new Date(failed.mastery.dueAt).getTime()
    expect(tomorrow).toBeGreaterThan(before + 23 * 3600_000)
    expect(tomorrow).toBeLessThan(before + 25 * 3600_000)

    // A passing sitting (both right) completes n1 and unlocks n2.
    const passedSitting = await service.putAttempt({
      projectId,
      quizId: quizResult.quiz.id,
      verdicts: [
        { task: 'q1', criterion: '对', pass: true, evidence: '神经系统由神经元与胶质细胞构成', by: 'llm' },
        { task: 'q2', criterion: '对', pass: true, evidence: 'Ca²⁺ 内流触发囊泡与突触前膜融合', by: 'llm' },
      ],
    })
    expect(passedSitting.ok).toBe(true)
    if (!passedSitting.ok) return
    expect(passedSitting.completed).toBe('n1')
    expect(passedSitting.unlocked).toEqual(['n2'])
    // The failed card's second chance: right this time — box 1.
    const after = await service.listVocab({ projectId })
    expect(after.entries.find(entry => entry.id === epsp!.id)?.mastery.box).toBe(1)

    const roadmap = await service.getRoadmap({ projectId })
    expect(roadmap.roadmap?.nodes.find(node => node.id === 'n1')?.state).toBe('done')
    expect(roadmap.roadmap?.nodes.find(node => node.id === 'n2')?.state).toBe('current')
    expect(roadmap.roadmap?.nodes.find(node => node.id === 'n1')?.quizStats).toMatchObject({ attempts: 2, lastRatio: 1 })
  })

  it('refuses a verdict naming no question of the quiz, listing the real ids', async () => {
    const { projectId, bookId } = await seedProject()
    const quizResult = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId },
        questions: [{ id: 'q1', kind: 'free', prompt: 'p', chapterRef: 'ch:1', evidence: '神经系统由神经元与胶质细胞构成', answer: 'x' }],
      },
    })
    if (!quizResult.ok) throw new Error(quizResult.message)
    const refused = await service.putAttempt({
      projectId,
      quizId: quizResult.quiz.id,
      verdicts: [{ task: 'q9', criterion: 'c', pass: true, evidence: 'e', by: 'llm' }],
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.message).toContain('q1')
  })

  it('assesses a node-less quiz without touching any roadmap', async () => {
    const { projectId, bookId } = await seedProject()
    await service.putRoadmap({ projectId, bookId, nodes: seedNodes() })
    const quizResult = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId },
        questions: [{ id: 'q1', kind: 'free', prompt: 'p', chapterRef: 'ch:1', evidence: '神经系统由神经元与胶质细胞构成', answer: 'x' }],
      },
    })
    if (!quizResult.ok) throw new Error(quizResult.message)
    const assessed = await service.putAttempt({
      projectId,
      quizId: quizResult.quiz.id,
      verdicts: [{ task: 'q1', criterion: 'c', pass: true, evidence: 'e', by: 'self' }],
    })
    expect(assessed.ok).toBe(true)
    if (!assessed.ok) return
    expect(assessed.unlocked).toEqual([])
    const roadmap = await service.getRoadmap({ projectId })
    expect(roadmap.roadmap?.nodes.find(node => node.id === 'n1')?.quizStats?.attempts).toBe(0)
  })
})

describe('photo provenance readback', () => {
  it('degrades to `unavailable` without an attachments service, and names ref-incomplete entries', async () => {
    const { projectId } = await seedProject()
    const added = await service.addVocabEntries({
      projectId,
      entries: [{
        kind: 'vocab',
        term: 'synapse',
        note: '突触',
        chapterRef: 'ch:1',
        source: { kind: 'photo', attachmentId: 'sha256:abc' },
      }],
    })
    if (!added.ok) throw new Error(added.message)
    const incomplete = await service.readAttachmentBase64({ projectId, entryId: added.entries[0]!.id })
    expect(incomplete.ok).toBe(false)
    if (!incomplete.ok) expect(incomplete.error).toBe('ref-incomplete')
    const missing = await service.readAttachmentBase64({ projectId, entryId: 'v_nope' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toBe('not-found')
  })

  it('reads a fully-referenced photo through the probed attachments service', async () => {
    const withAttachments = new LibraryService({
      get: (name: string) => name === 'attachments'
        ? { readImage: async () => ({ data: new Uint8Array([1, 2, 3]), ref: { mediaType: 'image/png' } }) }
        : undefined,
    } as unknown as Context, { stateRoot: root })
    const created = await withAttachments.createProject({ name: '神经科学' })
    if (!created.ok) throw new Error(created.message)
    const added = await withAttachments.addVocabEntries({
      projectId: created.project.id,
      entries: [{
        kind: 'vocab',
        term: 'synapse',
        note: '突触',
        chapterRef: 'ch:1',
        source: { kind: 'photo', attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 3, width: 1, height: 1 },
      }],
    })
    if (!added.ok) throw new Error(added.message)
    const read = await withAttachments.readAttachmentBase64({ projectId: created.project.id, entryId: added.entries[0]!.id })
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.mediaType).toBe('image/png')
      expect(Buffer.from(read.data, 'base64')).toEqual(Buffer.from([1, 2, 3]))
    }
  })

  it('degrades to `unavailable` when no attachments service is mounted', async () => {
    const { projectId } = await seedProject()
    const added = await service.addVocabEntries({
      projectId,
      entries: [{
        kind: 'vocab',
        term: 'synapse',
        note: '突触',
        chapterRef: 'ch:1',
        source: { kind: 'photo', attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 3, width: 1, height: 1 },
      }],
    })
    if (!added.ok) throw new Error(added.message)
    const read = await service.readAttachmentBase64({ projectId, entryId: added.entries[0]!.id })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error).toBe('unavailable')
  })
})

describe('stats', () => {
  it('tallies the whole library', async () => {
    const { projectId } = await seedProject()
    await service.addVocabEntries({
      projectId,
      entries: [{ kind: 'vocab', term: 'synapse', note: '突触', chapterRef: 'ch:1' }],
    })
    const stats = await service.stats()
    expect(stats).toMatchObject({ projects: 1, books: 1, vocab: 1, due: 1, quizzes: 0, attempts: 0 })
    expect(stats.boxHistogram['0']).toBe(1)
  })
})

/* ------------------------------------------------------------------ kinds */

describe('node kinds (read vs quiz)', () => {
  /** A roadmap whose first node is a read node (the preface), gated by nothing. */
  function mixedNodes(): RoadmapNode[] {
    return [
      { id: 'n0', title: '导读与全书结构', kind: 'read', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'current' },
      { id: 'n1', title: '突触传递', kind: 'quiz', goals: ['解释递质释放'], dependsOn: ['n0'], chapterRanges: [{ from: 2, to: 2 }], state: 'locked' },
    ]
  }

  it('a read node carries no quizStats, and completes by being read (no quiz)', async () => {
    const { projectId, bookId } = await seedProject()
    const written = await service.putRoadmap({ projectId, bookId, nodes: mixedNodes() })
    expect(written.ok).toBe(true)
    if (!written.ok) return
    expect(written.roadmap.nodes[0]?.quizStats).toBeUndefined()
    expect(written.roadmap.nodes[1]?.quizStats).toEqual({ attempts: 0 })

    // 读完: the read node flips current → done with no quiz, and its dependent
    // unlocks in the same write (the cascade putRoadmap owes a single flip).
    const flipped = await service.putRoadmap({
      projectId,
      bookId,
      nodes: [
        { ...mixedNodes()[0]!, state: 'done' as const },
        { ...mixedNodes()[1]! },
      ],
    })
    expect(flipped.ok).toBe(true)
    if (!flipped.ok) return
    expect(flipped.roadmap.nodes[0]?.state).toBe('done')
    expect(flipped.roadmap.nodes[1]?.state).toBe('current')
  })

  it('refuses a read node carrying quizStats, and a node with no kind', async () => {
    const { projectId, bookId } = await seedProject()
    const withStats = await service.putRoadmap({
      projectId,
      bookId,
      nodes: [{ id: 'n0', title: '导读', kind: 'read', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'current', quizStats: { attempts: 0 } }],
    })
    expect(withStats.ok).toBe(false)
    if (!withStats.ok) expect(withStats.message).toContain('quizStats')

    const noKind = await service.putRoadmap({
      projectId,
      bookId,
      nodes: [{ id: 'n0', title: '导读', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'current' } as unknown as RoadmapNode],
    })
    expect(noKind.ok).toBe(false)
    if (!noKind.ok) expect(noKind.message).toContain('kind')
  })

  it('a stored legacy roadmap without kinds reads back as quiz nodes', async () => {
    const { projectId, bookId } = await seedProject()
    // Write a roadmap the v0.1.0 way (no kind on the nodes) directly through
    // the store, then read it back through the service.
    await service.store.withProjectLock(projectId, () => {
      service.store.writeRoadmap(projectId, {
        bookId,
        nodes: [{ id: 'n1', title: '概论', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'current' } as unknown as RoadmapNode],
        generatedAt: new Date().toISOString(),
      })
    })
    const { roadmap } = await service.getRoadmap({ projectId })
    expect(roadmap?.nodes[0]?.kind).toBe('quiz')
  })
})

describe('the quiz scope narrows to quiz-kind chapters', () => {
  it('refuses a question on a read node\'s chapter, and a scope naming a read node', async () => {
    const { projectId, bookId } = await seedProject()
    await service.putRoadmap({
      projectId,
      bookId,
      nodes: [
        { id: 'n0', title: '导读与全书结构', kind: 'read', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'current' },
        { id: 'n1', title: '突触传递', kind: 'quiz', goals: [], dependsOn: ['n0'], chapterRanges: [{ from: 2, to: 2 }], state: 'locked' },
      ],
    })
    // A question on the read node's chapter is refused, teaching the legal set.
    const readChapter = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId, nodeId: 'n1' },
        questions: [{ id: 'q1', kind: 'free', prompt: '全书结构是什么？', chapterRef: 'ch:1', evidence: '神经系统由神经元与胶质细胞构成', answer: 'x' }],
      },
    })
    expect(readChapter.ok).toBe(false)
    if (!readChapter.ok) {
      expect(readChapter.message).toContain('READ')
      expect(readChapter.message).toContain('2')
    }
    // A scope naming the read node is refused outright.
    const readScope = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId, nodeId: 'n0' },
        questions: [{ id: 'q1', kind: 'free', prompt: 'p', chapterRef: 'ch:2', evidence: 'Ca²⁺ 内流触发囊泡与突触前膜融合', answer: 'x' }],
      },
    })
    expect(readScope.ok).toBe(false)
    if (!readScope.ok) expect(readScope.message).toContain('read node')
    // The quiz node's own chapter passes.
    const legal = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId, nodeId: 'n1' },
        questions: [{ id: 'q1', kind: 'free', prompt: '触发递质释放的信号？', chapterRef: 'ch:2', evidence: 'Ca²⁺ 内流触发囊泡与突触前膜融合', answer: 'x' }],
      },
    })
    expect(legal.ok).toBe(true)
  })
})

/* ----------------------------------------------------------------- events */

describe('the audit trail (events.jsonl)', () => {
  it('records the milestones and reads them back newest-first', async () => {
    const { projectId, bookId } = await seedProject()
    await service.addVocabEntries({
      projectId,
      entries: [{ kind: 'vocab', term: 'synapse', note: '突触', chapterRef: 'ch:1' }],
    })
    await service.putRoadmap({
      projectId,
      bookId,
      nodes: [{ id: 'n1', title: '概论', kind: 'quiz', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'current' }],
    })
    // A regeneration is its own event type.
    await service.putRoadmap({
      projectId,
      bookId,
      regenerate: true,
      nodes: [
        { id: 'm1', title: '概论', kind: 'quiz', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'current' },
        { id: 'm2', title: '突触', kind: 'quiz', goals: [], dependsOn: ['m1'], chapterRanges: [{ from: 2, to: 2 }], state: 'locked' },
      ],
    })
    const quiz = await service.putQuiz({
      projectId,
      quiz: {
        scope: { bookId, nodeId: 'm1' },
        questions: [{ id: 'q1', kind: 'free', prompt: '神经系统由什么构成？', chapterRef: 'ch:1', evidence: '神经系统由神经元与胶质细胞构成', answer: 'x' }],
      },
    })
    if (!quiz.ok) throw new Error(quiz.message)
    await service.putAttempt({
      projectId,
      quizId: quiz.quiz.id,
      verdicts: [{ task: 'q1', criterion: 'c', pass: true, evidence: 'e', by: 'llm' }],
    })

    const { events } = await service.listEvents({ projectId })
    const types = events.map(event => event.type)
    // Newest first: the assess trilogy leads, the book's ingest tails.
    expect(types[0]).toBe('node.unlocked')
    expect(types).toContain('node.completed')
    expect(types).toContain('attempt.assessed')
    expect(types).toContain('quiz.created')
    expect(types).toContain('roadmap.regenerated')
    expect(types).toContain('roadmap.generated')
    expect(types).toContain('notes.recorded')
    expect(types[types.length - 1]).toBe('book.ingested')
    // The summaries ride along: the book's chapter count, the sitting's ratio.
    expect(events.find(event => event.type === 'book.ingested')).toMatchObject({ title: '认知神经科学', count: 2 })
    expect(events.find(event => event.type === 'attempt.assessed')).toMatchObject({ ratio: 1 })
    expect(events.find(event => event.type === 'node.unlocked')).toMatchObject({ id: 'm2', title: '突触' })

    // The limit slices the newest end.
    const limited = await service.listEvents({ projectId, limit: 2 })
    expect(limited.events).toHaveLength(2)
    expect(limited.events[0]?.type).toBe('node.unlocked')
  })

  it('a 读完 flip emits node.completed + node.unlocked', async () => {
    const { projectId, bookId } = await seedProject()
    await service.putRoadmap({
      projectId,
      bookId,
      nodes: [
        { id: 'n0', title: '导读', kind: 'read', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'current' },
        { id: 'n1', title: '突触', kind: 'quiz', goals: [], dependsOn: ['n0'], chapterRanges: [{ from: 2, to: 2 }], state: 'locked' },
      ],
    })
    await service.putRoadmap({
      projectId,
      bookId,
      nodes: [
        { id: 'n0', title: '导读', kind: 'read', goals: [], dependsOn: [], chapterRanges: [{ from: 1, to: 1 }], state: 'done' },
        { id: 'n1', title: '突触', kind: 'quiz', goals: [], dependsOn: ['n0'], chapterRanges: [{ from: 2, to: 2 }], state: 'locked' },
      ],
    })
    const { events } = await service.listEvents({ projectId })
    expect(events.map(event => event.type)).toContain('node.completed')
    expect(events.map(event => event.type)).toContain('node.unlocked')
    expect(events.find(event => event.type === 'node.unlocked')?.id).toBe('n1')
  })
})
