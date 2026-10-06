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

/** A ctx with no attachments service (the probe path reads as absent). */
const ctx = { get: () => undefined } as unknown as Context

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
      { id: 'n1', title: '离子通道', kind: 'quiz', chapterRanges: [{ from: 1, to: 1 }] },
      { id: 'n2', title: '动作电位', kind: 'quiz', chapterRanges: [{ from: 2, to: 2 }], dependsOn: ['n1'] },
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
    await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'n1', title: 'a', kind: 'quiz' }, { id: 'n2', title: 'b', kind: 'quiz', dependsOn: ['n1'] }] })
    const before = await service.getRoadmap({ projectId, bookId })
    expect(before.roadmap).toBeUndefined()
    expect(before.draft?.status).toBe('draft')
    const adopted = await service.adoptRoadmap({ projectId, bookId })
    expect(adopted.ok && adopted.roadmap.nodes.map(node => node.state)).toEqual(['current', 'locked'])
    expect((await service.getRoadmap({ projectId, bookId })).draft).toBeUndefined()
  })

  it('re-adopting keeps the progress of surviving nodes', async () => {
    const { projectId, bookId } = await seed()
    await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'r1', title: '怎么用这本书', kind: 'read' }, { id: 'n1', title: 'a', kind: 'quiz', dependsOn: ['r1'] }] })
    await service.adoptRoadmap({ projectId, bookId })
    await service.markNodeRead({ projectId, bookId, nodeId: 'r1' })
    await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'r1', title: '怎么用这本书', kind: 'read' }, { id: 'n1', title: 'a', kind: 'quiz', dependsOn: ['r1'] }, { id: 'n2', title: 'b', kind: 'quiz', dependsOn: ['n1'] }] })
    const again = await service.adoptRoadmap({ projectId, bookId })
    expect(again.ok && again.roadmap.nodes.map(node => node.state)).toEqual(['done', 'current', 'locked'])
  })

  it('keeps a goal written as a bare string and drops part-heading rows', async () => {
    const { projectId } = await seed()
    const book = await service.putBook({
      projectId, title: 'PNS', bookKind: 'knowledge', tocSource: { by: 'model' },
      toc: [{ title: 'Part II: Cells', part: 'Part II: Cells' }, { title: 'Ion Channels', part: 'Part II: Cells' }],
    })
    if (!book.ok) throw new Error(book.message)
    expect(book.book.toc.map(row => row.title)).toEqual(['Ion Channels'])
    const draft = await service.draftRoadmap({ projectId, bookId: book.book.id, nodes: [{ id: 'n1', title: 'a', kind: 'quiz', goals: '说清离子通道' }] })
    expect(draft.ok && draft.draft.nodes[0]?.goals).toEqual(['说清离子通道'])
    expect((await service.getRoadmap({ projectId, bookId: book.book.id })).draft?.nodes[0]?.goals).toEqual(['说清离子通道'])
  })

  it('refuses ranges outside the contents and forward dependencies', async () => {
    const { projectId, bookId } = await seed()
    const outside = await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'n1', title: 'a', kind: 'quiz', chapterRanges: [{ from: 1, to: 9 }] }] })
    expect(!outside.ok && outside.message).toMatch(/3 rows/)
    const forward = await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'n1', title: 'a', kind: 'quiz', dependsOn: ['n2'] }, { id: 'n2', title: 'b', kind: 'quiz' }] })
    expect(!forward.ok && forward.message).toMatch(/AFTER/)
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
    expect(grounded.ok && grounded.warnings).toEqual([])
  })

  it('names what is wrong: no cards for a card target, no url for web evidence, a misquote', async () => {
    const { projectId, bookId } = await seed()
    const noCards = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question({ target: { kind: 'asked' } })] } })
    expect(!noCards.ok && noCards.message).toMatch(/cardIds/)
    const noUrl = await service.putQuiz({ projectId, quiz: { scope: { bookId }, questions: [question({ evidence: { kind: 'web', quote: 'a long enough quote' } })] } })
    expect(!noUrl.ok && noUrl.message).toMatch(/url/)
  })

  it('warns when the scoped node is still locked', async () => {
    const { projectId, bookId } = await seed()
    await adopt(projectId, bookId)
    const stored = await service.putQuiz({ projectId, quiz: { scope: { bookId, nodeId: 'n2' }, questions: [question()] } })
    expect(stored.ok && stored.warnings[0]).toMatch(/still locked/)
  })

  it('refuses a read node as the quiz scope', async () => {
    const { projectId, bookId } = await seed()
    await service.draftRoadmap({ projectId, bookId, nodes: [{ id: 'r1', title: '导读', kind: 'read' }] })
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
})
