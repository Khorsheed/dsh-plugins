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
import type { LibraryAssessResult, LibraryAssessment, LibraryAttempt, LibraryCard, LibraryProjectSummary, LibraryResource, LibraryRoadmap, LibraryVerdict } from '../../src/types.ts'
import './preview.css'

const params = new URLSearchParams(location.search)
const width = Number(params.get('w') ?? 390)
if (params.get('theme') === 'dark') document.body.dataset.previewTheme = 'dark'
if (params.get('touch') === '1') document.body.dataset.previewTouch = '1'

const t = (key: string, values: Record<string, string> = {}) => ((zh as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match)
const now = Date.now()
const iso = (days: number) => new Date(now + days * 86_400_000).toISOString()

const cam5: LibraryResource = {
  id: 'r_cam5', title: '剑桥雅思 5', kind: 'book',
  meta: {
    bookKind: 'material', short: '剑5',
    extras: [
      { title: '怎么用这本书', note: '考试结构、评分与成绩对照', where: 'p.4', when: 'before' },
      { title: 'Answer key', where: 'p.152', when: 'reference' },
    ],
  },
  toc: ['Johnson\'s Dictionary', 'Nature or Nurture?', 'The Truth about the Environment', 'Bakelite', 'What\'s so funny?'].map((title, index) => ({ n: index + 1, title, part: index < 3 ? 'Test 1' : 'Test 2' })),
  tocSource: { by: 'web', url: 'https://engnovate.com/ielts-reading-tests/cambridge-ielts-05-academic-reading-test-1/' },
  createdAt: iso(-10),
}
const avu: LibraryResource = {
  id: 'r_avu', title: 'Academic Vocabulary in Use', kind: 'book',
  meta: { bookKind: 'knowledge' },
  toc: ['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4'].map((title, index) => ({ n: index + 1, title })),
  tocSource: { by: 'web', url: 'https://example.org' },
  createdAt: iso(-5),
}
const pns: LibraryResource = {
  id: 'r_pns', title: 'Principles of Neural Science', kind: 'book',
  meta: { bookKind: 'knowledge', short: 'PNS', edition: '6th' },
  toc: ['Ion Channels', 'Membrane Potential', 'Propagated Signaling: The Action Potential', 'Overview of Synaptic Transmission'].map((title, index) => ({ n: index + 1, title })),
  tocSource: { by: 'web', url: 'https://neurology.mhmedical.com/book.aspx?bookID=3024' },
  createdAt: iso(-20),
}
const resources: LibraryResource[] = [cam5, avu, pns]

type NodeSpec = { id: string; title: string; gate: 'quiz' | 'read'; state: 'done' | 'current' | 'locked'; locator: string; deps?: string[]; stats?: { attempts: number; lastRatio: number; bestRatio: number }; points?: { id: string; title: string }[] }
const node = (resourceId: string, spec: NodeSpec) => ({
  id: spec.id, title: spec.title, gate: spec.gate, state: spec.state,
  goals: spec.gate === 'quiz' ? ['说清楚机制', '能举例'] : [],
  dependsOn: spec.deps ?? [],
  covers: [{ ref: resourceId, locator: spec.locator }],
  ...(spec.gate === 'quiz' ? { quizStats: spec.stats ?? { attempts: 0 } } : {}),
  ...(spec.points === undefined ? {} : { points: spec.points }),
})
const cam5Path: LibraryRoadmap = {
  primaryResourceId: 'r_cam5', status: 'adopted', generatedAt: iso(-9), adoptedAt: iso(-9),
  nodes: [
    node('r_cam5', { id: 't1p1', title: 'T1 · P1 Johnson\'s Dictionary', gate: 'quiz', state: 'done', locator: '1', stats: { attempts: 2, lastRatio: 0.75, bestRatio: 1 }, points: [{ id: 'detail', title: '细节定位' }] }),
    node('r_cam5', { id: 'r1', title: '阅读题型总览', gate: 'read', state: 'done', locator: '1' }),
    node('r_cam5', { id: 't1p2', title: 'T1 · P2 Nature or Nurture?', gate: 'quiz', state: 'current', locator: '2', deps: ['t1p1'], stats: { attempts: 1, lastRatio: 0.5, bestRatio: 0.5 }, points: [{ id: 'inference', title: '词义推断' }, { id: 'reference', title: '指代关系' }, { id: 'attitude', title: '作者态度' }] }),
    node('r_cam5', { id: 't1p3', title: 'T1 · P3 The Truth about the Environment', gate: 'quiz', state: 'locked', locator: '3', deps: ['t1p2'] }),
    node('r_cam5', { id: 't2p1', title: 'T2 · P1 Bakelite', gate: 'quiz', state: 'locked', locator: '4', deps: ['t1p3'] }),
    node('r_cam5', { id: 't2p2', title: 'T2 · P2 What\'s so funny?', gate: 'quiz', state: 'locked', locator: '5', deps: ['t2p1'] }),
  ],
}
const avuPath: LibraryRoadmap = {
  primaryResourceId: 'r_avu', status: 'adopted', generatedAt: iso(-4), adoptedAt: iso(-4),
  nodes: [
    node('r_avu', { id: 'u1', title: 'Unit 1 学习词汇', gate: 'quiz', state: 'current', locator: '1', points: [{ id: 'collocation', title: '搭配' }, { id: 'word-family', title: '词族' }] }),
    node('r_avu', { id: 'u2', title: 'Unit 2 学术写作词', gate: 'quiz', state: 'locked', locator: '2', deps: ['u1'] }),
  ],
}
// The draft card is where the learner reviews the point split before adopting.
const pnsDraft: LibraryRoadmap = {
  primaryResourceId: 'r_pns', status: 'draft', generatedAt: iso(0), note: '每周 3 章，约 2 周',
  nodes: [
    node('r_pns', { id: 'c8', title: '第 8 章 离子通道', gate: 'quiz', state: 'locked', locator: '1', points: [{ id: 'gating', title: '门控机制' }, { id: 'selectivity', title: '选择性通透' }, { id: 'structure', title: '通道结构' }] }),
    node('r_pns', { id: 'c9', title: '第 9 章 膜电位', gate: 'quiz', state: 'locked', locator: '2', deps: ['c8'], points: [{ id: 'resting', title: '静息电位' }, { id: 'nernst', title: '能斯特方程' }] }),
    node('r_pns', { id: 'c10', title: '第 10 章 动作电位', gate: 'quiz', state: 'locked', locator: '3', deps: ['c9'], points: [{ id: 'phases', title: '电位时相' }, { id: 'refractory', title: '不应期' }] }),
  ],
}
const roadmaps: Record<string, { roadmap?: LibraryRoadmap; draft?: LibraryRoadmap }> = { r_cam5: { roadmap: cam5Path }, r_avu: { roadmap: avuPath }, r_pns: { draft: pnsDraft } }

const quizQuestion = (id: string, prompt: string, point: string, options?: string[], answer = ''): LibraryAssessment['questions'][number] => ({
  id, kind: options === undefined ? 'free' : 'choice', prompt, point,
  ...(options === undefined ? {} : { options }),
  answer: answer || (options?.[1] ?? ''),
  target: { kind: 'topic' },
  evidence: { kind: 'photo', pageId: 'pg_16', quote: '…anxious to define and circumscribe the various worlds to conquer…' },
})
const quizzes: LibraryAssessment[] = [
  {
    id: 'q_t1p1', type: 'quiz', scope: { resourceId: 'r_cam5', nodeId: 't1p1' }, focus: 'book', createdAt: iso(-7),
    questions: [
      quizQuestion('q1', 'Johnson 的词典哪一年出版？', 'detail', ['1747', '1755', '1762', '1773'], '1755'),
      quizQuestion('q2', '词典序号的体裁是？', 'detail', ['诗歌', '散文', '戏剧', '书信'], '散文'),
      quizQuestion('q3', '词典收词大约多少？', 'detail', ['两万', '四万', '八万', '十万'], '四万'),
    ],
  },
  {
    id: 'q_t1p2', type: 'quiz', scope: { resourceId: 'r_cam5', nodeId: 't1p2' }, focus: 'book', createdAt: iso(-1),
    questions: [
      quizQuestion('q1', '「nature」一段里 environmental 指什么？', 'inference', ['自然界的', '后天的、环境的', '遗传的', '偶然的'], '后天的、环境的'),
      quizQuestion('q2', '第二段「this view」指的是哪种观点？', 'reference', ['先天决定论', '后天塑造论', '两者混合论', '不可知论'], '后天塑造论'),
      quizQuestion('q3', '作者对 nurture 派的态度是？', 'attitude', ['全力支持', '温和质疑', '强烈反对', '中立罗列'], '温和质疑'),
      quizQuestion('q4', '「held」在这里的意思是？（答案出错的坏题）', 'inference', ['握住', '举办', '认为', '保持'], '认为'),
      { ...quizQuestion('q5', '求 $g(x) = \\sqrt{(x+1)/(x-2)}$ 的定义域，用区间表示写出', 'inference'), answer: '$[-1, 2) \\cup (2, +\\infty)$', evidence: { kind: 'knowledge' } },
    ],
  },
  {
    id: 'q_avu1', type: 'quiz', scope: { resourceId: 'r_avu', nodeId: 'u1' }, focus: 'mixed', createdAt: iso(0),
    questions: [
      quizQuestion('q1', 'make / do / take 里哪个和 decision 搭配？', 'collocation', ['make', 'do', 'take', 'get'], 'take'),
      quizQuestion('q2', 'economic / economical 的区别是？', 'word-family'),
      quizQuestion('q3', '「解决问题」最地道的动词搭配是？', 'collocation', ['solve', 'resolve', 'settle', '都对'], '都对'),
    ],
  },
]
const attempts: LibraryAttempt[] = [
  {
    id: 'a_t1p2', assessmentId: 'q_t1p2', at: iso(-0.02), ratio: 0.5,
    verdicts: [
      { task: 'q1', criterion: 'environmental 的语境义', pass: true, evidence: '-', by: 'self' },
      { task: 'q2', criterion: 'this view 的指代', pass: false, evidence: '-', by: 'self' },
      { task: 'q3', criterion: '作者态度', pass: false, evidence: '-', by: 'self' },
      { task: 'q4', criterion: 'held 词义', pass: false, evidence: '-', by: 'user', void: true },
      { task: 'q5', criterion: '实验结论', pass: true, evidence: '-', by: 'self' },
    ],
  },
  {
    id: 'a_t1p1', assessmentId: 'q_t1p1', at: iso(-1), ratio: 0.67,
    verdicts: [
      { task: 'q1', criterion: '出版年', pass: true, evidence: '-', by: 'self' },
      { task: 'q2', criterion: '体裁', pass: false, evidence: '-', by: 'self' },
      { task: 'q3', criterion: '收词量', pass: true, evidence: '-', by: 'self' },
    ],
  },
]

const card = (id: string, term: string, gloss: string, weakness: number, nodeId: string | undefined, resourceId: string | undefined, note: string): LibraryCard => ({
  id, kind: 'word', term, aliases: [], gloss,
  contexts: [{ sentence: '…anxious to define and circumscribe the various worlds to conquer…', ...(resourceId === undefined ? {} : { resourceId }), ...(nodeId === undefined ? {} : { nodeId }) }],
  ...(resourceId === undefined ? {} : { resourceId }),
  sources: [{ type: 'photo', note, at: iso(-3) }, { type: 'quiz', note: '答错一次', weakened: true, at: iso(-1) }],
  weakness, mastery: { box: 0, dueAt: iso(-1), streak: 0 }, status: 'active', createdAt: iso(-3), updatedAt: iso(-1),
})
const cards: LibraryCard[] = [
  card('c1', 'circumscribe', '限定、划定界限', 2, 't1p2', 'r_cam5', 'p.16'),
  card('c2', 'held', '举办（本句义）', 2, 't1p2', 'r_cam5', 'p.16'),
  card('c3', 'heyday', '全盛期', 0, 't1p1', 'r_cam5', 'p.17'),
  card('c4', 'instalments', '分期付款', 1, 't1p2', 'r_cam5', 'p.16'),
  card('c5', 'resolve', '解决（正式）', 1, 'u1', 'r_avu', 'p.4'),
]

const summary = (partial: Partial<LibraryProjectSummary> & Pick<LibraryProjectSummary, 'id' | 'name' | 'template'>): LibraryProjectSummary => ({
  createdAt: iso(-10), lastActiveAt: iso(0), cardCount: cards.length, dueCount: 2, resources: [], ...partial,
})
const projects: LibraryProjectSummary[] = [
  summary({
    id: 'p_ielts', name: '雅思', template: 'language', color: 'ember', icon: 'globe', goal: '学术类 7 分，12 月 14 日',
    resources: [
      { id: 'r_cam5', title: cam5.title, kind: 'book', roadmap: { done: 2, total: 6 }, current: { id: 't1p2', title: 'T1 · P2 Nature or Nurture?' }, hasDraft: false },
      { id: 'r_avu', title: avu.title, kind: 'book', roadmap: { done: 0, total: 2 }, current: { id: 'u1', title: 'Unit 1 学习词汇' }, hasDraft: false },
      { id: 'r_pns', title: pns.title, kind: 'book', hasDraft: true },
    ],
  }),
]

const ok = (value: unknown) => Promise.resolve({ ok: true, value })
const done = (value: object) => ok({ ok: true, ...value })
const instance = createLibraryStore().create('preview')
const useStore = (selector: (state: never) => unknown) => useSyncExternalStore(instance.subscribe, () => selector(instance.getSnapshot() as never))

const resultFixture: LibraryAssessResult = {
  attempt: attempts[0]!,
  cardUpdates: [
    { id: 'c1', term: 'circumscribe', weakness: 2, mastery: { box: 0, dueAt: iso(1), streak: 0 } },
    { id: 'c2', term: 'held', weakness: 2, mastery: { box: 0, dueAt: iso(1), streak: 0 }, created: true },
  ],
  unlocked: [],
  passRatio: 0.8,
}

const face = {
  sessionId: 'preview', useStore, actions: instance.actions, t,
  listProjects: () => ok({ projects }),
  getProject: (id: string) => done({ project: projects.find(project => project.id === id), resources }),
  createProject: () => done({ project: projects[0] }),
  updateProject: () => done({ project: projects[0] }),
  deleteProject: () => done({ id: 'p_ielts' }),
  removeResource: () => done({ id: 'r_avu' }),
  getRoadmap: (_project: string, resourceId?: string) => ok(resourceId === undefined ? {} : (roadmaps[resourceId] ?? {})),
  adoptRoadmap: () => done({}), discardDraft: () => done({}), markNodeRead: () => done({ unlocked: [] }),
  listResources: () => ok({ resources }),
  listPages: () => ok({ pages: [] }),
  readPagePhoto: () => ok({ ok: false, error: 'unavailable', message: 'preview' }),
  listCards: (query: { projectId: string; nodeId?: string; source?: string; due?: boolean; weakMin?: number; query?: string; kind?: string; limit?: number }) => {
    let list = cards
    if (query.nodeId !== undefined) list = list.filter(entry => entry.contexts.some(context => context.nodeId === query.nodeId))
    if (query.source !== undefined) list = list.filter(entry => entry.sources.some(source => source.type === query.source))
    if (query.due === true) list = list.filter(entry => entry.mastery.dueAt <= iso(0))
    if (query.weakMin !== undefined) list = list.filter(entry => entry.weakness >= query.weakMin!)
    if (query.query) list = list.filter(entry => entry.term.includes(query.query!))
    if (query.kind !== undefined) list = list.filter(entry => entry.kind === query.kind)
    const total = list.length
    return ok({ cards: list.slice(0, query.limit ?? 200), total })
  },
  dueCards: () => ok({ cards: cards.filter(entry => entry.mastery.dueAt <= iso(0)).map(entry => ({ ...entry, projectId: 'p_ielts' })) }),
  editCard: () => done({}), undoCards: () => done({ removed: 0, reverted: 0 }), reviewCard: () => done({}),
  listAssessments: (_project: string, resourceId?: string, nodeId?: string, type?: string) => ok({
    assessments: quizzes.filter(quiz =>
      (resourceId === undefined || quiz.scope.resourceId === resourceId)
      && (nodeId === undefined || quiz.scope.nodeId === nodeId)
      && (type === undefined || quiz.type === type)),
  }),
  getAssessment: (_project: string, assessmentId: string) => done({ assessment: quizzes.find(quiz => quiz.id === assessmentId) }),
  listAttempts: () => ok({ attempts }),
  putAttempt: () => done(resultFixture),
  recentRecords: () => ok({ records: [] }),
  latestActivity: () => ok({}),
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
