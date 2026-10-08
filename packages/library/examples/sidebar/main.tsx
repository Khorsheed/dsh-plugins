// Component fixture only: the real LibraryPane over an in-memory host face.
// No production server, credentials or host writes. Query parameters:
//   ?w=390        frame width in px (default 390)
//   &theme=dark   dark palette
//   &touch=1      the touch values the mobile package sets (--dsh-panel-*)
//   &route=<json> start on this route (pushed over 今日)
import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { LibraryPane } from '../../src/client/LibraryPane.tsx'
import { createLibraryStore, type LibraryRoute } from '../../src/client/store.ts'
import { zh } from '../../src/client/locales.ts'
import type { LibraryBook, LibraryCard, LibraryQuiz, LibraryRoadmap } from '../../src/types.ts'
import './preview.css'

const params = new URLSearchParams(location.search)
const width = Number(params.get('w') ?? 390)
if (params.get('theme') === 'dark') document.body.dataset.previewTheme = 'dark'
if (params.get('touch') === '1') document.body.dataset.previewTouch = '1'

const t = (key: string, values: Record<string, string> = {}) => ((zh as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match)
const now = Date.now()
const iso = (days: number) => new Date(now + days * 86_400_000).toISOString()

const pns: LibraryBook = {
  id: 'b_pns', title: 'Principles of Neural Science', short: 'PNS', edition: '6th', bookKind: 'knowledge',
  toc: ['Ion Channels', 'Membrane Potential', 'Propagated Signaling: The Action Potential', 'Overview of Synaptic Transmission', 'Transmitter Release'].map((title, index) => ({ n: index + 1, title })),
  tocSource: { by: 'web', url: 'https://neurology.mhmedical.com/book.aspx?bookID=3024' }, createdAt: iso(-20),
}
const cam5: LibraryBook = {
  id: 'b_cam5', title: '剑桥雅思 5', short: '剑5', bookKind: 'material',
  extras: [
    { title: '怎么用这本书', note: '考试结构、评分与成绩对照', where: 'p.4', when: 'before' },
    { title: 'Answer key', where: 'p.152', when: 'reference' },
    { title: 'Tapescripts', where: 'p.128', when: 'reference' },
  ],
  toc: ['Johnson\'s Dictionary', 'Nature or Nurture?', 'The Truth about the Environment', 'Bakelite', 'What\'s so funny?'].map((title, index) => ({ n: index + 1, title, part: index < 3 ? 'Test 1' : 'Test 2' })),
  tocSource: { by: 'web', url: 'https://engnovate.com/ielts-reading-tests/cambridge-ielts-05-academic-reading-test-1/' }, createdAt: iso(-10),
}
const avu: LibraryBook = {
  id: 'b_avu', title: 'Academic Vocabulary in Use', bookKind: 'knowledge',
  toc: ['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4'].map((title, index) => ({ n: index + 1, title })), tocSource: { by: 'web', url: 'https://example.org' }, createdAt: iso(-5),
}
const node = (id: string, title: string, kind: 'quiz' | 'read', state: 'done' | 'current' | 'locked', from: number, deps: string[] = []) => ({
  id, title, kind, state, goals: kind === 'quiz' ? ['说清楚机制', '能举例'] : [], dependsOn: deps, chapterRanges: [{ from, to: from }],
  ...(kind === 'quiz' ? { quizStats: state === 'done' ? { attempts: 1, lastRatio: 0.9, bestRatio: 0.9 } : { attempts: 0 } } : {}),
})
const roadmaps: Record<string, { roadmap?: LibraryRoadmap; draft?: LibraryRoadmap }> = {
  b_cam5: { roadmap: { bookId: 'b_cam5', status: 'adopted', generatedAt: iso(-9), nodes: [
    node('t1p1', 'T1 · P1 Johnson\'s Dictionary', 'quiz', 'done', 1),
    node('r1', '阅读题型总览', 'read', 'done', 1),
    node('t1p2', 'T1 · P2 Nature or Nurture?', 'quiz', 'current', 2, ['t1p1']),
    node('t1p3', 'T1 · P3 The Truth about the Environment', 'quiz', 'locked', 3, ['t1p2']),
    node('t2p1', 'T2 · P1 Bakelite', 'quiz', 'locked', 4, ['t1p3']),
    node('t2p2', 'T2 · P2 What\'s so funny?', 'quiz', 'locked', 5, ['t2p1']),
  ] } },
  b_pns: { draft: { bookId: 'b_pns', status: 'draft', generatedAt: iso(0), note: '每周 3 章，约 2 周', nodes: [
    node('c8', '第 8 章 离子通道', 'quiz', 'locked', 1),
    node('c9', '第 9 章 膜电位', 'quiz', 'locked', 2, ['c8']),
    node('c10', '第 10 章 动作电位', 'quiz', 'locked', 3, ['c9']),
    node('c11', '第 11 章 突触传递概述', 'read', 'locked', 4, ['c10']),
  ] } },
  b_avu: {},
}
const card = (id: string, kind: 'word' | 'concept', term: string, gloss: string, sentence: string | undefined, sources: LibraryCard['sources'], weakness: number, box: number, due: number, bookId?: string): LibraryCard => ({
  id, kind, term, aliases: [], gloss, contexts: sentence === undefined ? [] : [{ sentence, ...(bookId === undefined ? {} : { bookId }) }],
  ...(bookId === undefined ? {} : { bookId }), sources, weakness, mastery: { box, dueAt: iso(due), streak: 0 }, status: 'active', createdAt: iso(-3), updatedAt: iso(-1),
})
const cards: Record<string, LibraryCard[]> = {
  p_ielts: [
    card('c1', 'word', 'circumscribe', '限定、划定界限', '…the English middle class, who were anxious to define and circumscribe the various worlds to conquer…', [{ type: 'photo', note: 'p.16', at: iso(-3) }, { type: 'quiz', note: '语境义选成了「环绕」', weakened: true, at: iso(-1) }], 2, 0, 0, 'b_cam5'),
    { ...card('c2', 'word', 'held', '举办（本句义）', '…at a breakfast held at the Golden Anchor Inn near Holborn Bar…', [{ type: 'photo', note: 'p.16', at: iso(-3) }, { type: 'chat', note: '问为什么不是「握住」', weakened: true, at: iso(-2) }], 2, 1, 0, 'b_cam5'), mastery: { box: 1, dueAt: iso(0), streak: 1 } },
    card('c3', 'word', 'heyday', '全盛期', '…at the very beginning of the heyday of the middle class.', [{ type: 'photo', note: 'p.16', at: iso(-3) }], 0, 3, 0, 'b_cam5'),
    card('c6', 'word', 'garret', '阁楼、顶楼小屋', '…described the garret where Johnson worked…', [{ type: 'photo', note: 'p.16', at: iso(-3) }], 0, 2, 3, 'b_cam5'),
    card('c4', 'concept', '小作文的时态', '图表有年份按过去时，预测用 is expected to', undefined, [{ type: 'chat', note: '写作课上问的', weakened: true, at: iso(-1) }], 1, 0, 0),
  ],
  p_neuro: [
    card('c5', 'concept', '绝对 / 相对不应期', '绝对看 Na⁺ 失活，相对看 K⁺ 还没关', undefined, [{ type: 'chat', note: '说老是记混', weakened: true, at: iso(0) }], 3, 0, 0, 'b_pns'),
  ],
}
const quiz: LibraryQuiz = { id: 'q_1', scope: { bookId: 'b_cam5', nodeId: 't1p2' }, createdAt: iso(0), questions: [
  { id: 'q1', kind: 'choice', prompt: '这句话里的 circumscribe 最接近哪个意思？', options: ['环绕、包围', '限定、划定界限', '描述、记录', '征服、占领'], answer: 'B',
    explanation: 'circum-（周围）+ scribe（画）：在周围画一圈，引申为限定范围。', target: { kind: 'marked', cardIds: ['c1'] },
    evidence: { kind: 'photo', pageId: 'pg_16', quote: '…anxious to define and circumscribe the various worlds to conquer…' } },
  { id: 'q2', kind: 'fill', prompt: 'He was to be paid £1,575 in ______.', answer: 'instalments', target: { kind: 'marked', cardIds: ['c3'] }, evidence: { kind: 'photo', pageId: 'pg_16', quote: 'He was to be paid £1,575 in instalments' } },
  { id: 'q3', kind: 'free', prompt: '用自己的话解释：为什么 Johnson 觉得不需要学院（academy）？', answer: '他认为自己一个人就能完成词典', target: { kind: 'topic' }, evidence: { kind: 'web', url: 'https://example.org', quote: 'Johnson decided he did not need an academy to settle arguments about language' } },
] }
const projects = [
  { id: 'p_ielts', name: '雅思', template: 'language', color: 'ember', icon: 'globe', goal: '学术类 7 分，12 月 14 日', createdAt: iso(-10), cardCount: 4, dueCount: 3,
    books: [
      { id: 'b_cam5', title: '剑桥雅思 5', short: '剑5', roadmap: { done: 2, total: 6 }, current: { id: 't1p2', title: 'T1 · P2 Nature or Nurture?' }, hasDraft: false },
      { id: 'b_avu', title: 'Academic Vocabulary in Use', hasDraft: false },
    ] },
  { id: 'p_neuro', name: '神经科学', template: 'subject', createdAt: iso(-20), cardCount: 1, dueCount: 1,
    books: [{ id: 'b_pns', title: 'Principles of Neural Science', hasDraft: true }] },
]
const bookOf: Record<string, LibraryBook[]> = { p_ielts: [cam5, avu], p_neuro: [pns] }

const ok = (value: unknown) => Promise.resolve({ ok: true, value })
const done = (value: object) => ok({ ok: true, ...value })
const instance = createLibraryStore().create('preview')
const useStore = (selector: (state: never) => unknown) => useSyncExternalStore(instance.subscribe, () => selector(instance.getSnapshot() as never))
const face = {
  sessionId: 'preview', useStore, actions: instance.actions, t,
  listProjects: () => ok({ projects }),
  getProject: (id: string) => done({ project: projects.find(project => project.id === id), books: bookOf[id] ?? [] }),
  createProject: () => done({ project: projects[0] }),
  getRoadmap: (_project: string, bookId: string) => ok(roadmaps[bookId] ?? {}),
  adoptRoadmap: () => done({}), discardDraft: () => done({}), markNodeRead: () => done({ unlocked: [] }),
  listPages: () => ok({ pages: [
    { id: 'pg_16', bookId: 'b_cam5', label: 'p.16', attachment: { attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }, text: '', marks: [...Array.from({ length: 14 }, (_, i) => ({ text: `m${i}` })), { text: 'single-handed', uncertain: true }], cardIds: [], at: iso(-3) },
    { id: 'pg_17', bookId: 'b_cam5', label: 'p.17', attachment: { attachmentId: 'b', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }, text: '', marks: Array.from({ length: 6 }, (_, i) => ({ text: `m${i}` })), cardIds: [], at: iso(-3) },
  ] }),
  readPagePhoto: () => ok({ ok: false, error: 'unavailable', message: 'preview' }),
  listCards: (query: { projectId: string; source?: string; due?: boolean; weakMin?: number; query?: string }) => {
    let list = cards[query.projectId] ?? []
    if (query.source !== undefined) list = list.filter(entry => entry.sources.some(source => source.type === query.source))
    if (query.due === true) list = list.filter(entry => entry.mastery.dueAt <= iso(0))
    if (query.weakMin !== undefined) list = list.filter(entry => entry.weakness >= query.weakMin!)
    if (query.query) list = list.filter(entry => entry.term.includes(query.query!))
    if ((query as { kind?: string }).kind !== undefined) list = list.filter(entry => entry.kind === (query as { kind?: string }).kind)
    return ok({ cards: list, total: list.length })
  },
  dueCards: (projectId?: string) => ok({ cards: Object.entries(cards).filter(([id]) => projectId === undefined || id === projectId).flatMap(([id, list]) => list.filter(entry => entry.mastery.dueAt <= iso(0)).map(entry => ({ ...entry, projectId: id }))) }),
  editCard: () => done({}), undoCards: () => done({}), reviewCard: () => done({}),
  listQuizzes: () => ok({ quizzes: [quiz] }),
  getQuiz: () => done({ quiz }),
  putAttempt: () => done({ attempt: { id: 'a', quizId: 'q_1', verdicts: [], ratio: 0.67, at: iso(0) }, cardUpdates: [
    { id: 'c1', term: 'circumscribe', weakness: 1, mastery: { box: 1, dueAt: iso(2), streak: 1 } },
    { id: 'c3', term: 'heyday', weakness: 1, mastery: { box: 0, dueAt: iso(1), streak: 0 } },
  ], unlocked: [], passRatio: 0.8 }),
  recentRecords: () => ok({ records: [
    { at: iso(-0.01), type: 'cards.recorded', source: 'chat', title: '绝对 / 相对不应期', projectId: 'p_neuro', projectName: '神经科学' },
    { at: iso(-1), type: 'cards.recorded', source: 'quiz', title: 'settle ≈ resolve', projectId: 'p_ielts', projectName: '雅思' },
  ] }),
  updateProject: () => done({}),
  boundTarget: () => ok(null), bindTarget: () => done({ binding: null }),
  primeConversation: () => true,
  sendMessage: () => true,
  sendPhoto: () => true,
}

const route = params.get('route')
if (route !== null) for (const step of JSON.parse(route) as LibraryRoute[]) instance.actions.push(step)

createRoot(document.getElementById('root')!).render(
  <div className="frame" style={{ width }}><LibraryPane {...(face as never)} /></div>,
)
