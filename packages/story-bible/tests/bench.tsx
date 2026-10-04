/**
 * The client specs' shared bench: a fake host face over an in-memory
 * 《梦境监护者》/《星海修理铺》 fixture — the story Remote's every verb as
 * a vi.fn with real fixture data behind it, a real StoryUiStore bound the
 * way the slot runtime binds it, and the zh dictionary's plain translate.
 */
import { vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StoryTabProps } from '../src/client/contract.ts'
import { StoryUiStore, type StoryUiState } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import type {
  ChapterRow, CharacterRecord, ExperienceEntry, LedgerResult, MemoryRecord, MentionEntry, PendingItem,
  StoryError, WorkIndexEntry, WorkInfo,
} from '../src/types.ts'

/** A RemoteResult stand-in. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** A plain translate over the zh dictionary (the key-set source of truth). */
export const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as StoryTabProps['t']

export const NOW = '2026-10-04T20:00:00.000Z'
export const DREAM = 'work-dream0001'
export const REPAIR = 'work-repair0002'

/** One work's fixture data, in the Remote's shapes. */
export interface WorkFixture {
  readonly meta: WorkIndexEntry
  readonly info: WorkInfo
  readonly memories: MemoryRecord[]
  readonly characters: CharacterRecord[]
  readonly experiences: ExperienceEntry[]
  readonly chapters: ChapterRow[]
  readonly ledger: LedgerResult
  readonly mentions: MentionEntry[]
  readonly pending: PendingItem[]
  readonly bodies: Readonly<Record<number, string>>
}

/** The《梦境监护者》client fixture (the M1 seed's wire shapes). */
export function dreamFixture(): WorkFixture {
  const meta = { id: DREAM, title: '梦境监护者', workspace: '/home/user/workspace', createdAt: NOW }
  const stamp = (day: number): string => `2026-10-0${day}T20:00:00.000Z`
  const memories: MemoryRecord[] = [
    { id: 'm1', owner: 'creator', type: 'semantic', layer: 'canon', kind: '世界', content: '监护者不能在梦里说出自己的真名。', status: 'active', reviewed: true, confidence: 'high', extractedBy: 'user', firstChapter: 1, lastActiveChapter: 1, createdAt: NOW, updatedAt: NOW },
    { id: 'm4', owner: 'creator', type: 'procedural', layer: 'canon', kind: '原则', content: '每章结尾留一个未解的画面。', status: 'active', reviewed: true, confidence: 'high', extractedBy: 'user', createdAt: NOW, updatedAt: NOW },
    { id: 'm6', owner: 'creator', type: 'semantic', layer: 'intent', kind: '世界', content: '梦境有层数，越深越接近梦主的伤口。', status: 'active', reviewed: false, confidence: 'medium', extractedBy: 'llm', intentStatus: 'draft', createdAt: NOW, updatedAt: NOW },
    { id: 'm7', owner: 'creator', type: 'semantic', layer: 'intent', kind: '章节', content: '第6–8章：门后空间三层递进。', status: 'active', reviewed: true, confidence: 'medium', extractedBy: 'llm', intentStatus: 'active', createdAt: NOW, updatedAt: NOW },
    { id: 'm8', owner: 'creator', type: 'semantic', layer: 'intent', kind: '人物', content: '戴娜：监护局内部的怀疑者，同情派。', status: 'active', reviewed: false, confidence: 'medium', extractedBy: 'llm', intentStatus: 'draft', createdAt: NOW, updatedAt: NOW },
    { id: 'm12', owner: 'creator', type: 'prospective', layer: 'canon', content: '门缝里的东西', specifics: { question: '门缝里的东西', status: 'advanced', tension: 4, plantedAt: 1 }, status: 'active', reviewed: true, confidence: 'high', extractedBy: 'llm', firstChapter: 1, lastActiveChapter: 3, createdAt: NOW, updatedAt: NOW },
    { id: 'm15', owner: 'creator', type: 'prospective', layer: 'canon', content: '蓝色叶子为什么发光', specifics: { question: '蓝色叶子为什么发光', status: 'hinted', tension: 3, plantedAt: 2 }, status: 'active', reviewed: true, confidence: 'high', extractedBy: 'llm', firstChapter: 2, lastActiveChapter: 2, createdAt: NOW, updatedAt: NOW },
  ]
  const characters: CharacterRecord[] = [
    {
      id: 'c1', name: '赵启明', identity: '梦境监护者新人',
      profile: { voice: '说话简短，引用守则条文时会先报编号' },
      core: { want: '找到失踪的前任监护者', lack: '他不记得自己的童年梦', wound: '妹妹走失于一场白日梦' },
      knowledge: { knows: ['监护守则的全部条文'], unaware: ['门缝里有什么'], secrets: ['他在梦里见过走失的妹妹'] },
      relationships: [{ target: '艾文', description: '从戒备到勉强信任', changes: [{ chapter: 4, note: '二层梦脱险后升温' }] }],
      currentState: { where: '档案室门外走廊', state: '心跳未平', concern: '妹妹的下落' },
      status: 'active', createdAt: NOW, updatedAt: NOW,
    },
    {
      id: 'c2', name: '艾文', identity: '活了三百年的梦引者',
      profile: {}, core: { want: '引导梦主苏醒' },
      knowledge: { knows: ['蓝色叶子的来历'], unaware: [], secrets: ['他就是失踪的前任监护者'] },
      relationships: [],
      currentState: { where: '档案室', state: '从容', concern: '梦主苏醒的节奏' },
      status: 'active', createdAt: NOW, updatedAt: NOW,
    },
  ]
  const experiences: ExperienceEntry[] = [
    { id: 'e1', characterId: 'c1', chapter: 4, entry: '首次独自进入二层梦，迷失后被艾文救下', createdAt: stamp(3) },
    { id: 'e2', characterId: 'c1', chapter: 5, entry: '决定推开档案室的门缝', autoImported: true, createdAt: stamp(4) },
    { characterId: 'c2', chapter: 2, entry: '递给赵启明一片蓝色叶子', createdAt: stamp(2) },
  ]
  const plan = {
    pov: '赵启明', goal: '跟随艾文穿过门缝',
    foreshadowOps: [{ op: '推进' as const, id: '#12' }, { op: '暗示' as const, id: '#15' }],
    characters: ['c1', 'c2'], hook: '门后传来妹妹的声音',
  }
  const chapters: ChapterRow[] = [
    { chapter: { n: 1, seq: 1, title: '入职', file: '第1章.md', phase: 'extracted', recap: '赵启明入职梦境监护所。', wordCount: 2800, sessionIds: ['s1'], createdAt: NOW, updatedAt: NOW }, phase: 'extracted' },
    { chapter: { n: 5, seq: 5, title: '门缝', file: '第5章.md', phase: 'reviewed', plan, recap: '赵启明按半页守则找到门缝。', wordCount: 3200, sessionIds: ['s1'], createdAt: NOW, updatedAt: NOW }, phase: 'reviewed' },
    { chapter: { n: 6, seq: 6, title: '门后', file: '第6章.md', phase: 'planning', plan, sessionIds: ['s1'], createdAt: NOW, updatedAt: NOW }, phase: 'planning' },
  ]
  const ledger: LedgerResult = {
    ok: true,
    active: [memories[5]!, memories[6]!],
    resolved: [],
    counts: { active: 2, overdue: 2, resolved: 0, abandoned: 0 },
    currentChapter: 6,
  }
  const mentions: MentionEntry[] = [
    { foreshadowId: 'm12', chapter: 1, kind: 'planted', planned: false, reconciled: true, createdAt: stamp(1) },
    { foreshadowId: 'm12', chapter: 3, kind: 'advanced', planned: true, reconciled: true, createdAt: stamp(3) },
    { foreshadowId: 'm15', chapter: 2, kind: 'hinted', planned: true, reconciled: true, createdAt: stamp(2) },
  ]
  const pending: PendingItem[] = [
    { id: 'p1', kind: 'new-character', confidence: 'medium', chapter: 5, reason: '新角色必进待审', payload: { name: '哼歌的女人', identity: '门后空间里的声音' }, status: 'pending', createdAt: NOW, evidenceInText: '门后传来一个女人的声音' },
    { id: 'p2', kind: 'memory', confidence: 'low', chapter: 5, reason: '置信度 low', payload: { content: '门缝附近的蓝叶会亮得刺眼。' }, status: 'pending', createdAt: NOW, evidenceInText: '袖口的蓝叶在靠近门缝时亮得刺眼' },
    { id: 'p3', kind: 'plan-missed', confidence: 'medium', chapter: 5, reason: '计划落空：推进 [#12] —— 忘了还是改主意？', payload: { op: '推进', id: '#12' }, status: 'pending', createdAt: NOW },
  ]
  const bodies = {
    1: '赵启明入职那天，监护所的钟没有影子。',
    5: '门缝里飘出一片蓝色的叶子，落在赵启明掌心。',
  }
  return {
    meta,
    info: {
      meta: { ...meta, updatedAt: NOW },
      counts: { memories: 7, intentDrafts: 2, characters: 2, chapters: 3, pending: 3 },
      stateDir: `/dsh/state/story/${DREAM}`,
    },
    memories, characters, experiences, chapters, ledger, mentions, pending, bodies,
  }
}

/** The《星海修理铺》client fixture (the switcher's second work). */
export function repairFixture(): WorkFixture {
  const meta = { id: REPAIR, title: '星海修理铺', workspace: '/home/user/workspace', createdAt: NOW }
  return {
    meta,
    info: {
      meta: { ...meta, updatedAt: NOW },
      counts: { memories: 0, intentDrafts: 0, characters: 0, chapters: 0, pending: 0 },
      stateDir: `/dsh/state/story/${REPAIR}`,
    },
    memories: [], characters: [], experiences: [], chapters: [],
    ledger: { ok: true, active: [], resolved: [], counts: { active: 0, overdue: 0, resolved: 0, abandoned: 0 }, currentChapter: 0 },
    mentions: [], pending: [], bodies: {},
  }
}

/** The bench: the fake face, the real store, and the fixture behind it. */
export interface StoryBench {
  readonly props: StoryTabProps
  readonly store: StoryUiStore
  readonly mocks: {
    readonly focusWork: ReturnType<typeof vi.fn>
    readonly createWork: ReturnType<typeof vi.fn>
    readonly decideMemory: ReturnType<typeof vi.fn>
    readonly decidePending: ReturnType<typeof vi.fn>
    readonly reviewChapter: ReturnType<typeof vi.fn>
    readonly confirmChapterPlan: ReturnType<typeof vi.fn>
    readonly foreshadowExit: ReturnType<typeof vi.fn>
    readonly retractExperience: ReturnType<typeof vi.fn>
    readonly patchMemory: ReturnType<typeof vi.fn>
    readonly writeCharacter: ReturnType<typeof vi.fn>
  }
  readonly fixtures: Map<string, WorkFixture>
}

/**
 * Mount the surface over the fixture. `focusId` seeds the session's focus
 * (null = the no-focus empty state).
 */
export function makeStoryBench(options: { focusId?: string | null; sessionId?: SessionId | undefined } = {}): StoryBench {
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
  const fail = <T,>(error: StoryError): Result<T> => ({ ok: true, value: { ok: false, error } as T })
  const fixtures = new Map<string, WorkFixture>([[DREAM, dreamFixture()], [REPAIR, repairFixture()]])
  let focus = options.focusId === undefined ? DREAM : options.focusId
  const store = new StoryUiStore()
  const sessionId = 'sessionId' in options ? options.sessionId : ('s1' as SessionId)

  const forWork = (workId: string): WorkFixture => {
    const fixture = fixtures.get(workId)
    if (fixture === undefined) throw new Error(`no fixture for ${workId}`)
    return fixture
  }

  const mocks = {
    focusWork: vi.fn(async (_sid: SessionId, request: { workId: string }): Promise<Result<{ ok: boolean; error?: StoryError }>> => {
      focus = request.workId
      return ok({ ok: true })
    }),
    createWork: vi.fn(async (_sid: SessionId, request: { title: string; workspace: string }) => {
      const id = 'work-new000003'
      fixtures.set(id, {
        meta: { id, title: request.title, workspace: request.workspace, createdAt: NOW },
        info: {
          meta: { id, title: request.title, workspace: request.workspace, createdAt: NOW, updatedAt: NOW },
          counts: { memories: 0, intentDrafts: 0, characters: 0, chapters: 0, pending: 0 },
          stateDir: `/dsh/state/story/${id}`,
        },
        memories: [], characters: [], experiences: [], chapters: [],
        ledger: { ok: true, active: [], resolved: [], counts: { active: 0, overdue: 0, resolved: 0, abandoned: 0 }, currentChapter: 0 },
        mentions: [], pending: [], bodies: {},
      })
      focus = id
      return ok({ ok: true as const, work: { id, title: request.title, workspace: request.workspace, createdAt: NOW, updatedAt: NOW } })
    }),
    decideMemory: vi.fn(async (_sid: SessionId, request: { workId: string; id: string; action: string }) => {
      const memory = forWork(request.workId).memories.find(candidate => candidate.id === request.id)
      if (memory !== undefined) {
        if (request.action === 'accept') (memory as { intentStatus?: string }).intentStatus = 'active'
        else (memory as { status?: string }).status = 'archived'
      }
      return ok({ ok: true as const, memory })
    }),
    decidePending: vi.fn(async (_sid: SessionId, request: { workId: string; id: string; action: string }) => {
      const fixture = forWork(request.workId)
      fixture.pending.splice(fixture.pending.findIndex(item => item.id === request.id), 1)
      return ok({ ok: true })
    }),
    reviewChapter: vi.fn(async (_sid: SessionId, request: { workId: string; n: number }) => {
      const row = forWork(request.workId).chapters.find(candidate => candidate.chapter.n === request.n)
      if (row !== undefined) {
        (row.chapter as { phase: string }).phase = 'reviewed'
        ;(row as { phase: string }).phase = 'reviewed'
      }
      return ok({ ok: true as const, chapter: row?.chapter })
    }),
    confirmChapterPlan: vi.fn(async (_sid: SessionId, request: { workId: string; n: number }) => {
      const row = forWork(request.workId).chapters.find(candidate => candidate.chapter.n === request.n)
      if (row?.chapter.plan === undefined) return fail('invalid-name')
      ;(row.chapter as { planConfirmedAt?: string }).planConfirmedAt = NOW
      return ok({ ok: true as const, chapter: row.chapter })
    }),
    foreshadowExit: vi.fn(async (_sid: SessionId, _request: { workId: string; id: string; action: string }) => ok({ ok: true })),
    retractExperience: vi.fn(async (_sid: SessionId, request: { workId: string; id: string }) => {
      const fixture = forWork(request.workId)
      const at = fixture.experiences.findIndex(entry => entry.id === request.id)
      if (at >= 0) fixture.experiences.splice(at, 1)
      return ok({ ok: true })
    }),
    patchMemory: vi.fn(async (_sid: SessionId, request: { workId: string; id: string; content?: string }) => {
      const fixture = forWork(request.workId)
      const memory = fixture.memories.find(candidate => candidate.id === request.id)
      if (memory !== undefined && request.content !== undefined) (memory as { content: string }).content = request.content
      return ok({ ok: true as const, memory })
    }),
    writeCharacter: vi.fn(async (_sid: SessionId, request: { workId: string; id?: string }) => {
      const fixture = forWork(request.workId)
      const character = fixture.characters.find(candidate => candidate.id === request.id)
      return ok({ ok: true as const, character })
    }),
  }

  const face = {
    t,
    sessionId,
    listWorks: vi.fn(async () => ok([...fixtures.values()].map(fixture => fixture.meta))),
    readWork: vi.fn(async (request: { workId: string }) => ok({ ok: true as const, info: forWork(request.workId).info })),
    getFocus: vi.fn(async () => {
      const fixture = focus === null ? null : fixtures.get(focus)
      return ok(fixture === null || fixture === undefined ? null : { workId: fixture.meta.id, title: fixture.meta.title })
    }),
    listMemories: vi.fn(async (request: { workId: string; layer?: string; kind?: string; intentStatus?: string }) => {
      const rows = forWork(request.workId).memories.filter(memory =>
        (request.layer === undefined || memory.layer === request.layer)
        && (request.kind === undefined || memory.kind === request.kind)
        && (request.intentStatus === undefined || memory.intentStatus === request.intentStatus))
      return ok(rows)
    }),
    listCharacters: vi.fn(async (request: { workId: string }) => ok(forWork(request.workId).characters)),
    listExperiences: vi.fn(async (request: { workId: string; characterId?: string }) =>
      ok(forWork(request.workId).experiences.filter(entry => request.characterId === undefined || entry.characterId === request.characterId))),
    listChapters: vi.fn(async (request: { workId: string }) => ok(forWork(request.workId).chapters)),
    readChapter: vi.fn(async (request: { workId: string; n: number }) => {
      const fixture = forWork(request.workId)
      const row = fixture.chapters.find(candidate => candidate.chapter.n === request.n)
      if (row === undefined) return ok({ ok: false as const, error: 'missing' as const })
      return ok({ ok: true as const, chapter: row.chapter, phase: row.phase, body: fixture.bodies[request.n as keyof typeof fixture.bodies] ?? '' })
    }),
    ledger: vi.fn(async (request: { workId: string }) => ok(forWork(request.workId).ledger)),
    listMentions: vi.fn(async (request: { workId: string }) => ok(forWork(request.workId).mentions)),
    listPending: vi.fn(async (request: { workId: string }) => ok([...forWork(request.workId).pending])),
    ...mocks,
    editorAvailable: vi.fn(() => true),
    openInEditor: vi.fn(),
    openReaderAt: (n: number) => { store.openReaderAt(n) },
    openPending: () => { store.pulsePending() },
    openCharacter: (characterId: string) => { store.setCmCharacter(characterId); store.setFragmentsView('characters') },
    setFragmentsView: (view: Parameters<typeof store.setFragmentsView>[0]) => { store.setFragmentsView(view) },
    setCmCharacter: (id: string | null) => { store.setCmCharacter(id) },
    setCmCursor: (n: number | null) => { store.setCmCursor(n) },
    refresh: () => { store.touch() },
    useSessions: ((selector: (snapshot: { byId: Record<string, { cwd: string }> }) => unknown) =>
      selector({ byId: { s1: { cwd: '/home/user/workspace' } } })) as StoryTabProps['useSessions'],
    useWorkspaces: ((selector: (snapshot: { items: readonly unknown[] }) => unknown) =>
      selector({ items: [{ workspaceId: 'ws1', path: '/home/user/workspace', title: '小说' }] })) as StoryTabProps['useWorkspaces'],
    useStory: function useStory<S>(selector: (snapshot: StoryUiState) => S): S {
      return selector(useSyncExternalStore(store.source.subscribe, store.source.getSnapshot))
    } as StoryTabProps['useStory'],
  }
  return { props: face as unknown as StoryTabProps, store, mocks, fixtures }
}
