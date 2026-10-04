/**
 * The story-bible's Remote service: the UI data face on the wire, mounted
 * under the `story` namespace. A thin adapter over the same `ctx.storyBible`
 * service core — no logic is copied. M1 mounts it WITHOUT a browser consumer
 * (the right-sidebar tabs land with M3 against exactly these verbs), so the
 * verb set is the minimal one proposal §6's views need.
 *
 * The MUTATING methods take the calling `agent` first (the wire's lookup
 * convention): state writes are fenced by the caller's resolved mode with the
 * boundary re-rooted at the plugin's state dir, which only the session knows.
 * Reads take no agent — a fence is a write fence, so a work stays browsable
 * for a session that is only being read (the canvas remote's rule).
 *
 * @module @khorsheed/dsh-story-bible
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { StoryBibleService } from './store.ts'
import type {
  ChapterRecord, ChapterRow, CharacterRecord, EffectiveChapterPhase, ExperienceEntry, ExtractPayload,
  ImportReport, LedgerResult, MemoryRecord, PendingItem, ReviewAction, StoryError,
  WorkIndexEntry, WorkInfo, WorkMeta, WriteCharacterRequest, WriteMemoryRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The story-bible's Remote face. */
    storyRemote: StoryRemoteService
  }
}

/** Remote construction options (reserved for future config-driven knobs). */
export interface StoryRemoteConfig {}

/**
 * The story-bible's wire namespace: the browser calls `remote.story.*`.
 */
export class StoryRemoteService extends TypertRemoteService<StoryRemoteConfig> {
  static inject = ['storyBible']

  /**
   * @param ctx - host context carrying the story service core.
   * @param _config - reserved.
   */
  constructor(ctx: Context, _config: StoryRemoteConfig = {}) {
    super(ctx, 'storyRemote', { namespace: 'story' })
  }

  private get store(): StoryBibleService {
    return this.ctx.storyBible
  }

  /** List every registered work (the work switcher's source). */
  @Remote('listWorks')
  listWorks(): Promise<WorkIndexEntry[]> {
    return this.store.listWorks()
  }

  /**
   * Create one work (title + the mounted workspace's absolute path).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - the new work's title and workspace.
   * @returns the new work's metadata, or the failure code.
   */
  @Remote('createWork')
  createWork(agent: Agent, request: { title: string; workspace: string }): Promise<{ ok: boolean; error?: StoryError; work?: WorkMeta }> {
    return this.store.createWork(request, agent.session)
  }

  /** The information page: metadata plus live counts and the state dir (proposal §6 信息 view). */
  @Remote('readWork')
  readWork(request: { workId: string }): Promise<{ ok: boolean; error?: StoryError; info?: WorkInfo }> {
    return this.store.readWork(request)
  }

  /** One work's memories (the 灵感墙 / 设定集 views' shared source; filters ANDed). */
  @Remote('listMemories')
  listMemories(request: {
    workId: string
    layer?: MemoryRecord['layer']
    type?: MemoryRecord['type']
    kind?: MemoryRecord['kind']
    intentStatus?: MemoryRecord['intentStatus']
    includeArchived?: boolean
  }): Promise<MemoryRecord[]> {
    return this.store.listMemories(request)
  }

  /** The character cards (角色记忆 view). */
  @Remote('listCharacters')
  listCharacters(request: { workId: string; includeArchived?: boolean }): Promise<CharacterRecord[]> {
    return this.store.listCharacters(request)
  }

  /** One character's experience journal (the 经历流水 block). */
  @Remote('listExperiences')
  listExperiences(request: { workId: string; characterId?: string }): Promise<ExperienceEntry[]> {
    return this.store.listExperiences(request)
  }

  /** The chapter index, seq-ordered, phases derived from the manuscript facts (章节阅读 view). */
  @Remote('listChapters')
  listChapters(request: { workId: string }): Promise<ChapterRow[]> {
    return this.store.listChapters(request)
  }

  /** One chapter's metadata and manuscript body (the reader; a missing body reads as empty). */
  @Remote('readChapter')
  readChapter(request: { workId: string; n: number }): Promise<{
    ok: boolean
    error?: StoryError
    chapter?: ChapterRecord
    phase?: EffectiveChapterPhase
    body?: string
  }> {
    return this.store.readChapter(request)
  }

  /** The 伏笔沉睡榜 + 健康度 (世界记忆 view). */
  @Remote('ledger')
  ledger(request: { workId: string }): Promise<LedgerResult> {
    return this.store.ledger(request)
  }

  /** The pending queue (钉在灵感碎片底部, 红点计数). */
  @Remote('listPending')
  listPending(request: { workId: string; includeResolved?: boolean }): Promise<PendingItem[]> {
    return this.store.listPending(request)
  }

  /**
   * Mark the work this session focuses (the tools' and pointer's target).
   * @param agent - the calling session's agent; its session records the focus.
   * @param request - the work id.
   * @returns the receipt, or the failure code.
   */
  @Remote('focusWork')
  focusWork(agent: Agent, request: { workId: string }): Promise<{ ok: boolean; error?: StoryError }> {
    return this.store.focusWork(request, agent.session)
  }

  /** The work this session focuses, or null (the tab's initial state). */
  @Remote('getFocus')
  getFocus(agent: Agent): { workId: string; title: string } | null {
    return this.store.focusedWorkOf(agent.session) ?? null
  }

  /**
   * The user's ✓审过 gate — 对账前置 (invariant 2).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - work id and chapter number.
   * @returns the fresh record, or the failure code.
   */
  @Remote('reviewChapter')
  reviewChapter(agent: Agent, request: { workId: string; n: number }): Promise<{ ok: boolean; error?: StoryError; chapter?: ChapterRecord }> {
    return this.store.reviewChapter(request, agent.session)
  }

  /**
   * The user's own memory entrance (设定页手写一条; reviewed on arrival).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - the memory content and axes.
   * @returns the new record, or the failure code.
   */
  @Remote('writeMemory')
  writeMemory(agent: Agent, request: WriteMemoryRequest): Promise<{ ok: boolean; error?: StoryError; memory?: MemoryRecord }> {
    return this.store.writeMemory(request, agent.session, 'user')
  }

  /**
   * The review verb on one memory (采纳/丢弃/归档/撤销 — UI 与 agent 同一动词).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - work id, memory id, the action.
   * @returns the fresh record, or the failure code.
   */
  @Remote('decideMemory')
  decideMemory(agent: Agent, request: { workId: string; id: string; action: ReviewAction }): Promise<{ ok: boolean; error?: StoryError; memory?: MemoryRecord }> {
    return this.store.decideMemory(request, agent.session)
  }

  /**
   * The person's answer to one pending item (✓ materializes, ✗ settles).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - work id, item id, the action.
   * @returns the receipt, or the failure code.
   */
  @Remote('decidePending')
  decidePending(agent: Agent, request: { workId: string; id: string; action: 'accept' | 'discard' }): Promise<{ ok: boolean; error?: StoryError }> {
    return this.store.decidePending(request, agent.session)
  }

  /**
   * The field-level character edit (角色记忆 view's 字段级可编辑).
   * @param agent - the calling session's agent; its session fences the write.
   * @param request - the character data (id present = patch).
   * @returns the fresh record, or the failure code.
   */
  @Remote('writeCharacter')
  writeCharacter(agent: Agent, request: WriteCharacterRequest): Promise<{ ok: boolean; error?: StoryError; character?: CharacterRecord }> {
    return this.store.writeCharacter(request, agent.session)
  }

  /**
   * The extract import's report for the review UI (called only after the
   * agent's story_extract import; exposed so a UI-side reconcile can land
   * without a tool round-trip in later milestones).
   * @param agent - the calling session's agent; its session fences the writes.
   * @param request - work id, chapter number, the strict JSON.
   * @returns the reconciliation report, or the failure code.
   */
  @Remote('extractImport')
  extractImport(agent: Agent, request: { workId: string; n: number; payload: ExtractPayload }): Promise<ImportReport> {
    return this.store.extractImport(request, agent.session)
  }
}

export default StoryRemoteService
