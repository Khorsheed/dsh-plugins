/**
 * The canvas-novel Remote: the browser face of the engine, read by the genre's
 * surfaces inside the canvas (the board strip, the ledger page, the chapter
 * page). Every verb delegates to {@link NovelService}; the reads add only what
 * a surface needs to name things (a pending item's subject, a foreshadow's
 * chapter track, a chapter's pending count), never a second rule.
 *
 * The writes are the person's own gestures (accept/discard a pending item,
 * ✓ 审过 a chapter) and run under the calling session's fence, exactly like
 * the tools.
 *
 * @module @khorsheed/dsh-canvas-novel/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { NovelService, WorkEntries } from './store.ts'
import type {
  LedgerMark, NovelChapterRequest, NovelChapterResult, NovelChaptersResult, NovelDecideRequest,
  NovelGestureResult, NovelLedgerResult, NovelPendingResult, NovelWorkRequest, PendingItem, PendingView,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    novelRemote: NovelRemoteService
  }
}

/** No knobs: the engine owns the config. */
export interface NovelRemoteConfig {}

/** A card id → the label a reader knows it by (`#5 时间兑换率？`, `艾文`). */
function namesOf(entries: WorkEntries | undefined): Map<string, string> {
  const names = new Map<string, string>()
  if (entries === undefined) return names
  for (const view of entries.foreshadows) names.set(view.cardId, `${view.ref} ${view.question}`)
  for (const view of entries.characters) names.set(view.cardId, view.name)
  return names
}

/** The card a pending item is about, when it names one. */
function subjectOf(item: PendingItem): string | undefined {
  return item.payload.foreshadowId ?? item.payload.characterId ?? item.payload.id
}

/** The wire namespace is `novel`: the browser calls `remote.novel.pending`. */
export class NovelRemoteService extends TypertRemoteService<NovelRemoteConfig> {
  static inject = ['canvasNovel']

  constructor(ctx: Context, _config: NovelRemoteConfig = {}) {
    super(ctx, 'novelRemote', { namespace: 'novel' })
  }

  private get core(): NovelService {
    return this.ctx.canvasNovel
  }

  /** The unresolved pending queue, each item named by the card it concerns. */
  @Remote('pending')
  async pending(request: NovelWorkRequest): Promise<NovelPendingResult> {
    const entries = await this.core.readEntries(request.canvasId)
    if (entries === undefined) return { ok: false, error: 'missing', items: [] }
    const names = namesOf(entries)
    const items = (await this.core.listPending({ workId: request.canvasId })).map((item): PendingView => {
      const cardId = subjectOf(item)
      const subject = cardId === undefined ? undefined : names.get(cardId)
      return subject === undefined ? item : { ...item, subject, subjectCardId: cardId! }
    })
    return { ok: true, items }
  }

  /** Accept or discard one pending item. */
  @Remote('decidePending')
  decidePending(agent: Agent, request: NovelDecideRequest): Promise<NovelGestureResult> {
    return this.core.decidePending({ workId: request.canvasId, id: request.id, action: request.action }, agent.session)
  }

  /** The foreshadow ledger plus every foreshadow's chapter track. */
  @Remote('ledger')
  async ledger(request: NovelWorkRequest): Promise<NovelLedgerResult> {
    const ledger = await this.core.ledger({ workId: request.canvasId })
    const marks: Record<string, LedgerMark[]> = {}
    if (ledger.ok) {
      for (const entry of await this.core.listMentions({ workId: request.canvasId })) {
        (marks[entry.foreshadowId] ??= []).push({
          chapter: entry.chapter, kind: entry.kind, planned: entry.planned, reconciled: entry.reconciled,
        })
      }
    }
    return { ...ledger, marks }
  }

  /** The chapter index with each chapter's unresolved pending count. */
  @Remote('chapters')
  async chapters(request: NovelWorkRequest): Promise<NovelChaptersResult> {
    const meta = await this.core.readWorkMeta(request.canvasId)
    if (meta === undefined) return { ok: false, error: 'missing', chapters: [], pending: {} }
    const pending: Record<number, number> = {}
    for (const item of await this.core.listPending({ workId: request.canvasId })) {
      if (item.chapter !== undefined) pending[item.chapter] = (pending[item.chapter] ?? 0) + 1
    }
    return { ok: true, chapters: await this.core.listChapters({ workId: request.canvasId }), pending }
  }

  /** One chapter: body, phase, its pending count and the names its plan uses. */
  @Remote('chapter')
  async chapter(request: NovelChapterRequest): Promise<NovelChapterResult> {
    const read = await this.core.readChapter({ workId: request.canvasId, n: request.n })
    if (!read.ok || read.chapter === undefined) return { ok: false, error: read.error ?? 'missing', pending: 0, names: {} }
    const [entries, items, meta] = await Promise.all([
      this.core.readEntries(request.canvasId),
      this.core.listPending({ workId: request.canvasId }),
      this.core.readWorkMeta(request.canvasId),
    ])
    const known = namesOf(entries)
    const names: Record<string, string> = {}
    const plan = read.chapter.plan
    for (const id of [plan?.pov, ...(plan?.characters ?? []), ...(plan?.foreshadowOps ?? []).map(op => op.id)]) {
      const name = id === undefined ? undefined : known.get(id)
      if (id !== undefined && name !== undefined) names[id] = name
    }
    return {
      ok: true,
      chapter: read.chapter,
      ...(read.phase === undefined ? {} : { phase: read.phase }),
      body: read.body ?? '',
      pending: items.filter(item => item.chapter === request.n).length,
      names,
      ...(meta === undefined ? {} : { file: `${meta.title}/${read.chapter.file}` }),
    }
  }

  /** The person's ✓ 审过: closes an extracted chapter. */
  @Remote('reviewChapter')
  async reviewChapter(agent: Agent, request: NovelChapterRequest): Promise<NovelGestureResult> {
    const result = await this.core.reviewChapter({ workId: request.canvasId, n: request.n }, agent.session)
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'io' }
  }

  /** The person's ✓ 确认计划 on a planned chapter. */
  @Remote('confirmPlan')
  async confirmPlan(agent: Agent, request: NovelChapterRequest): Promise<NovelGestureResult> {
    const result = await this.core.confirmChapterPlan({ workId: request.canvasId, n: request.n }, agent.session)
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'io' }
  }
}

export default NovelRemoteService
