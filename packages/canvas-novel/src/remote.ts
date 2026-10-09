/**
 * The canvas-novel Remote: the browser face of the engine, read by the genre's
 * surfaces inside the canvas (the board strip, the story log, the chapter
 * page). Every verb delegates to {@link NovelService}; the reads add only what
 * a surface needs to name things (a pending item's subject, a chapter's
 * pending count), never a second rule.
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
import { planFromText, planToText } from './text-forms.ts'
import {
  coreSuspenseNudge, revealText, revealVolume, targetWordsOf,
  type CharacterView, type LedgerResult, type NovelCardRequest, type NovelCardResult, type NovelChapterRequest, type NovelChapterResult, type NovelChaptersResult,
  type NovelDecideRequest, type NovelGestureResult, type NovelOutlineDecideRequest, type NovelOutlineResult, type NovelPendingResult, type NovelPlanEditRequest, type NovelPlanEditResult, type NovelStarRequest, type NovelStateRequest,
  type NovelWorkRequest, type OutlineCore, type OutlineHero, type PendingItem, type PendingView, type StoryLogResult,
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
  return item.payload.foreshadowId ?? item.payload.characterId ?? item.payload.cardId ?? item.payload.id
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

  /** The foreshadow ledger's counts and rows (the board strip reads its health). */
  @Remote('ledger')
  ledger(request: NovelWorkRequest): Promise<LedgerResult> {
    return this.core.ledger({ workId: request.canvasId })
  }

  /** The 故事日志: the four bands over the chapters. */
  @Remote('storyLog')
  storyLog(request: NovelWorkRequest): Promise<StoryLogResult> {
    return this.core.storyLog({ workId: request.canvasId })
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
    const [entries, items, meta, outline] = await Promise.all([
      this.core.readEntries(request.canvasId),
      this.core.listPending({ workId: request.canvasId }),
      this.core.readWorkMeta(request.canvasId),
      this.core.readOutline(request.canvasId),
    ])
    const targetWords = targetWordsOf(read.chapter, outline)
    const known = namesOf(entries)
    const names: Record<string, string> = {}
    const plan = read.chapter.plan
    for (const id of [plan?.pov, ...(plan?.cast ?? []).map(member => member.who), ...(plan?.foreshadowOps ?? []).map(op => op.id)]) {
      const name = id === undefined ? undefined : known.get(id)
      if (id !== undefined && name !== undefined) names[id] = name
    }
    // The edit box writes cards the way a person does: a foreshadow by its
    // ref (its label opens with it), a character by name.
    const handleOf = (id: string): string => entries?.foreshadows.find(view => view.cardId === id)?.ref ?? known.get(id) ?? id
    return {
      ok: true,
      chapter: read.chapter,
      ...(plan === undefined ? {} : { planText: planToText(plan, handleOf) }),
      ...(read.phase === undefined ? {} : { phase: read.phase }),
      body: read.body ?? '',
      pending: items.filter(item => item.chapter === request.n).length,
      names,
      ...(meta === undefined ? {} : { file: `${meta.title}/${read.chapter.file}` }),
      ...(targetWords === undefined ? {} : { targetWords }),
    }
  }

  /** The person's ✓ 审过: closes an extracted chapter. */
  @Remote('reviewChapter')
  async reviewChapter(agent: Agent, request: NovelChapterRequest): Promise<NovelGestureResult> {
    const result = await this.core.reviewChapter({ workId: request.canvasId, n: request.n }, agent.session)
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'io' }
  }

  /**
   * The 规划 page: the outline, the protagonist read off their card, the
   * chapter index (for the volumes' chapter rows), and the core suspenses
   * (foreshadows set to reveal in a volume) with what the text did to each.
   */
  @Remote('outline')
  async outline(request: NovelWorkRequest): Promise<NovelOutlineResult> {
    const [outline, entries, rows] = await Promise.all([
      this.core.readOutline(request.canvasId),
      this.core.readEntries(request.canvasId),
      this.core.listChapters({ workId: request.canvasId }),
    ])
    if (entries === undefined) return { ok: false, error: 'missing', outline, chapters: [], cores: [] }
    const chapters = rows.map(row => row.chapter)
    const heroOf = (id: string | undefined): OutlineHero | undefined => {
      const view: CharacterView | undefined = id === undefined ? undefined : entries.characters.find(row => row.cardId === id)
      if (view === undefined) return undefined
      const { cardId, ref, name, identity, want, ambition, values, lack, wound } = view
      return {
        cardId, ref, name,
        ...(identity === undefined ? {} : { identity }), ...(want === undefined ? {} : { want }),
        ...(ambition === undefined ? {} : { ambition }), ...(values === undefined ? {} : { values }),
        ...(lack === undefined ? {} : { lack }), ...(wound === undefined ? {} : { wound }),
      }
    }
    const mentions = await this.core.listMentions({ workId: request.canvasId })
    const cores: OutlineCore[] = []
    for (const view of entries.foreshadows) {
      if (view.cardStatus !== 'kept' || view.reveal === undefined || view.reveal.kind === 'chapter') continue
      const pace = coreSuspenseNudge(view, outline.volumes, chapters)
      const due = revealVolume(view.reveal, outline.volumes.length)
      cores.push({
        cardId: view.cardId, ref: view.ref, question: view.question, state: view.state, starred: view.starred,
        reveal: revealText(view.reveal),
        ...(due === undefined ? {} : { revealVolume: due }),
        touches: mentions.filter(entry => entry.foreshadowId === view.cardId)
          .sort((a, b) => a.chapter - b.chapter)
          .map(entry => ({ chapter: entry.chapter, kind: entry.kind, ...(entry.note === undefined ? {} : { note: entry.note }) })),
        line: pace?.text ?? (view.state === '已揭晓' ? '已揭晓' : ''),
        nudge: pace?.nudge ?? false,
      })
    }
    const hero = heroOf(outline.sheet.protagonist)
    const proposed = outline.proposal?.sheet?.protagonist
    const proposedHero = proposed === undefined || proposed === outline.sheet.protagonist ? undefined : heroOf(proposed)
    return {
      ok: true, outline, chapters: rows, cores,
      ...(hero === undefined ? {} : { hero }),
      ...(proposedHero === undefined ? {} : { proposedHero }),
    }
  }

  /** The person's 采用 / 不采用 on the outline proposal. */
  @Remote('decideOutline')
  async decideOutline(agent: Agent, request: NovelOutlineDecideRequest): Promise<NovelGestureResult> {
    const result = await this.core.decideOutline({ workId: request.canvasId, action: request.action }, agent.session)
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'io' }
  }

  /** The person's ✓ 确认计划 on a planned chapter. */
  @Remote('confirmPlan')
  async confirmPlan(agent: Agent, request: NovelChapterRequest): Promise<NovelGestureResult> {
    const result = await this.core.confirmChapterPlan({ workId: request.canvasId, n: request.n }, agent.session)
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'io' }
  }

  /** The person's own edit of a plan (the page's edit box), saved and confirmed at once. */
  @Remote('editPlan')
  async editPlan(agent: Agent, request: NovelPlanEditRequest): Promise<NovelPlanEditResult> {
    const result = await this.core.editPlan({ workId: request.canvasId, n: request.n, plan: planFromText(request.text) }, agent.session)
    if (!result.ok) return { ok: false, error: result.error ?? 'io', ...(result.unknown === undefined ? {} : { unknown: result.unknown }) }
    return { ok: true, changed: result.changed ?? [] }
  }

  /** One card's engine side: its role, the star (foreshadows), 此刻, 出场 and 关系 (characters), the bar (relations). */
  @Remote('card')
  async card(request: NovelCardRequest): Promise<NovelCardResult> {
    const entries = await this.core.readEntries(request.canvasId)
    if (entries === undefined) return { ok: false, error: 'missing' }
    const role = entries.roleOf.get(request.cardId)
    if (role === undefined) return { ok: false, error: 'missing' }
    const foreshadow = entries.foreshadows.find(view => view.cardId === request.cardId)
    const character = entries.characters.find(view => view.cardId === request.cardId)
    const relation = entries.relations.find(view => view.cardId === request.cardId)
    // 出场 is the story log's read (plan cast, experience journal, source chapter); reuse it rather than fork it.
    const appearances = character === undefined ? undefined
      : (await this.core.storyLog({ workId: request.canvasId })).characters.find(row => row.cardId === request.cardId)?.appearances
    return {
      ok: true,
      role,
      ...(foreshadow === undefined ? {} : {
        starred: foreshadow.starred,
        starredCount: entries.foreshadows.filter(view => view.starred).length,
      }),
      ...(character?.currentState === undefined ? {} : { currentState: character.currentState }),
      ...(character === undefined || character.relations.length === 0 ? {} : { relations: character.relations }),
      ...(appearances === undefined || appearances.length === 0 ? {} : { appearances }),
      ...(relation === undefined ? {} : { relation }),
    }
  }

  /** The person's ★ on a foreshadow. */
  @Remote('starForeshadow')
  async starForeshadow(agent: Agent, request: NovelStarRequest): Promise<NovelGestureResult> {
    const result = await this.core.starForeshadow({ workId: request.canvasId, cardId: request.cardId, starred: request.starred }, agent.session)
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'io' }
  }

  /** The person's edit of a character's 此刻. */
  @Remote('setCurrentState')
  async setCurrentState(agent: Agent, request: NovelStateRequest): Promise<NovelGestureResult> {
    const result = await this.core.setCurrentState({ workId: request.canvasId, cardId: request.cardId, state: request.state }, agent.session)
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'io' }
  }
}

export default NovelRemoteService
