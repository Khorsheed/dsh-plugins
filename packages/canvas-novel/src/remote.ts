/**
 * The canvas-novel Remote: the browser face of the engine, read by the genre's
 * surfaces inside the canvas (the board strip, the story log, the chapter
 * page). Every verb delegates to {@link NovelService}; the reads add only what
 * a surface needs to name things (a pending item's subject, a chapter's
 * pending count), never a second rule.
 *
 * The writes are the person's own gestures (accept/discard a pending item,
 * ✓ 审过 a chapter) and run under the calling session's fence, exactly like
 * the tools. Every gesture verb is a thin wrapper over the shared cores in
 * `./gestures.ts` — the agent-free adapter factory runs the SAME cores, so
 * the two faces answer identically by construction.
 *
 * @module @khorsheed/dsh-canvas-novel/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { panelSession } from './panel-session.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  confirmPlanGesture, decideOutlineGesture, decidePendingGesture, editPlanGesture,
  reviewChapterGesture, setCurrentStateGesture, starForeshadowGesture,
} from './gestures.ts'
import type { NovelService, WorkEntries } from './store.ts'
import { planToText } from './text-forms.ts'
import { bodyFingerprint } from './types.ts'
import { isFuture, recall, tensionOf, tierReason, type StoryEvent } from './timeline.ts'
import {
  coreSuspenseNudge, revealText, revealVolume, targetWordsOf,
  type CardLinkGroup, type CharacterView, type LedgerResult, type NovelCardRequest, type NovelCardResult, type NovelChapterRequest, type NovelChapterResult, type NovelChaptersResult,
  type NovelDecideRequest, type NovelGestureResult, type NovelOutlineDecideRequest, type NovelOutlineResult, type NovelPendingResult, type NovelPlanEditRequest, type NovelRecentResult, type NovelPlanEditResult, type NovelStarRequest, type NovelStateRequest,
  type NovelWorkRequest, type NovelWorldMapResult, type NovelCodexResult, type CodexSetting, type NovelTimelineResult, type TimelineEventView, type TimelineFutureView,
  type NovelPinsRequest, type NovelIdeasResult, type NovelIdeaRequest, type NovelBodyEditRequest, type NovelBodyEditResult, type NovelOwnChapterRequest, type OutlineCore, type WorldNode, type OutlineHero, type PendingItem, type PendingView, type StoryLogResult,
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
  for (const view of entries.characters) {
    names.set(view.cardId, view.name)
    // A plan written before 信息差 handles were resolved keeps the ref (c2) the model typed.
    if (!names.has(view.ref)) names.set(view.ref, view.name)
  }
  for (const view of entries.rules) names.set(view.cardId, view.name ?? view.ref)
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
  async decidePending(sessionId: SessionId, request: NovelDecideRequest): Promise<NovelGestureResult> {
    return decidePendingGesture(this.core, await panelSession(this.ctx, sessionId), request)
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
    for (const id of [plan?.pov, ...(plan?.cast ?? []).map(member => member.who), ...(plan?.infoGaps ?? []).map(gap => gap.who), ...(plan?.uses ?? []), ...(plan?.foreshadowOps ?? []).map(op => op.id)]) {
      const name = id === undefined ? undefined : known.get(id)
      if (id !== undefined && name !== undefined) names[id] = name
    }
    // 本章推进 names events: their titles.
    if ((plan?.advances ?? []).length > 0) {
      const { events } = await this.core.allEvents(request.canvasId)
      for (const id of plan!.advances!) {
        const hit = events.find(event => event.id === id)
        if (hit !== undefined) names[id] = hit.title
      }
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
      ...(bodyFingerprint(read.body ?? '') === undefined ? {} : { bodyHash: bodyFingerprint(read.body ?? '')! }),
      pending: items.filter(item => item.chapter === request.n).length,
      names,
      ...(meta === undefined ? {} : { file: `${meta.title}/${read.chapter.file}` }),
      ...(targetWords === undefined ? {} : { targetWords }),
    }
  }

  /** The person's ✓ 审过: closes an extracted chapter. */
  @Remote('reviewChapter')
  async reviewChapter(sessionId: SessionId, request: NovelChapterRequest): Promise<NovelGestureResult> {
    return reviewChapterGesture(this.core, await panelSession(this.ctx, sessionId), request)
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
  async decideOutline(sessionId: SessionId, request: NovelOutlineDecideRequest): Promise<NovelGestureResult> {
    return decideOutlineGesture(this.core, await panelSession(this.ctx, sessionId), request)
  }

  /** The person's ✓ 确认计划 on a planned chapter. */
  @Remote('confirmPlan')
  async confirmPlan(sessionId: SessionId, request: NovelChapterRequest): Promise<NovelGestureResult> {
    return confirmPlanGesture(this.core, await panelSession(this.ctx, sessionId), request)
  }

  /** What the newest 对账 did, card by card (the 设定 face's 最近更新). */
  @Remote('recentUpdates')
  async recentUpdates(request: NovelWorkRequest): Promise<NovelRecentResult> {
    return this.core.recentUpdates({ workId: request.canvasId })
  }

  /** The person's own edit of a plan (the page's edit box), saved and confirmed at once. */
  @Remote('editPlan')
  async editPlan(sessionId: SessionId, request: NovelPlanEditRequest): Promise<NovelPlanEditResult> {
    return editPlanGesture(this.core, await panelSession(this.ctx, sessionId), request)
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
    const links = role === 'world' || role === 'character' ? await this.linksOf(entries, request.canvasId, request.cardId, role) : []
    const minds = character === undefined ? [] : await this.core.listMinds({ workId: request.canvasId, characterId: request.cardId })
    const intent = minds.filter(row => row.kind === 'intent').at(-1)?.text
    const beliefs = minds.filter(row => row.kind === 'belief').slice(-8).map(row => ({
      text: row.text, chapter: row.chapter, ...(row.source === undefined ? {} : { source: row.source }),
      ...(row.from === undefined ? {} : { from: entries.characters.find(view => view.cardId === row.from)?.name ?? row.from }),
    }))
    return {
      ok: true,
      role,
      ...(links.length === 0 ? {} : { links }),
      ...(intent === undefined && beliefs.length === 0 ? {} : { mind: { ...(intent === undefined ? {} : { intent }), beliefs } }),
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

  /** A setting's or a character's links, both ways, plus the chapters that used a setting. */
  private async linksOf(entries: WorkEntries, workId: string, cardId: string, role: 'world' | 'character'): Promise<CardLinkGroup[]> {
    const live = entries.board.cards.filter(card => card.status !== 'archived')
    const nameOf = (id: string): string => entries.rules.find(view => view.cardId === id)?.name
      ?? entries.characters.find(view => view.cardId === id)?.name ?? id
    const ids = (card: (typeof live)[number] | undefined, key: string): string[] => {
      const value = card?.fields?.[key]
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && live.some(row => row.id === id)) : []
    }
    const self = live.find(card => card.id === cardId)
    const group = (kind: CardLinkGroup['kind'], list: readonly string[]): CardLinkGroup[] =>
      list.length === 0 ? [] : [{ kind, items: list.map(id => ({ cardId: id, name: nameOf(id) })) }]
    if (role === 'character') return [...group('faction', ids(self, 'faction')), ...group('home', ids(self, 'home'))]
    const naming = (key: string): string[] => live.filter(card => ids(card, key).includes(cardId)).map(card => card.id)
    const characters = new Set(entries.characters.map(view => view.cardId))
    const people = [...naming('faction'), ...naming('home')].filter((id, index, all) => characters.has(id) && all.indexOf(id) === index)
    const chapters = (await this.core.listChapters({ workId })).filter(row => row.chapter.settings?.includes(cardId) === true).map(row => row.chapter.n)
    return [
      ...group('parent', ids(self, 'parent')),
      ...group('base', ids(self, 'base')),
      ...group('children', naming('parent')),
      ...group('based', naming('base')),
      ...group('people', people),
      ...(chapters.length === 0 ? [] : [{ kind: 'chapters' as const, items: chapters.map(n => ({ chapter: n, name: `第${n}章` })) }]),
    ]
  }

  /**
   * The 总览 world map: each shelf as a tree (a setting under its 属于 when
   * that parent is on the same shelf), the writing principles, and how many
   * old 世界 cards still wait for 整理设定.
   */
  @Remote('worldMap')
  async worldMap(request: NovelWorkRequest): Promise<NovelWorldMapResult> {
    const entries = await this.core.readEntries(request.canvasId)
    if (entries === undefined) return { ok: false, error: 'missing' }
    const live = entries.rules.filter(view => view.status !== 'archived')
    const legacyCategories = new Set(entries.board.categories.filter(category => category.role === 'world').map(category => category.id))
    const unorganized = entries.board.cards.filter(card => card.status !== 'archived' && legacyCategories.has(card.kind)).length
    const unsettledText = /工作稿|待定|未决|暂定|待调整/
    const shelves = (['system', 'place', 'faction', 'item'] as const).map(sort => {
      const onShelf = live.filter(view => view.role === 'world' && view.sort === sort)
      const ids = new Set(onShelf.map(view => view.cardId))
      const nodeOf = (view: (typeof onShelf)[number], seen: ReadonlySet<string>): WorldNode => ({
        cardId: view.cardId,
        name: view.name ?? view.text.slice(0, 16),
        unsettled: unsettledText.test(view.text),
        children: onShelf
          .filter(child => !seen.has(child.cardId) && (child.parents ?? []).includes(view.cardId))
          .map(child => nodeOf(child, new Set([...seen, child.cardId]))),
      })
      const roots = onShelf.filter(view => !(view.parents ?? []).some(id => ids.has(id) && id !== view.cardId))
      return { sort, count: onShelf.length, nodes: roots.map(view => nodeOf(view, new Set([view.cardId]))) }
    })
    const principles = live.filter(view => view.role === 'principle').map(view => ({ cardId: view.cardId, text: view.text }))
    return { ok: true, shelves, principles, unorganized }
  }

  /** The 设定 face: every setting on its shelf with its links, the people with their memory, the pairs, the foreshadows with their steps. */
  @Remote('codex')
  async codex(request: NovelWorkRequest): Promise<NovelCodexResult> {
    const entries = await this.core.readEntries(request.canvasId)
    if (entries === undefined) return { ok: false, error: 'missing' }
    const workId = request.canvasId
    const live = (status: string): boolean => status !== 'archived'
    const chapters = (await this.core.listChapters({ workId })).map(row => row.chapter)
    const unsettled = /工作稿|待定|未决|暂定|待调整/
    const settings: CodexSetting[] = entries.rules.filter(view => view.role === 'world' && live(view.status)).map(view => {
      const card = entries.board.cards.find(row => row.id === view.cardId)
      const body = typeof card?.fields?.['rule'] === 'string' ? card.fields['rule'] : view.text
      return {
        cardId: view.cardId, ref: view.ref, name: view.name ?? view.text.slice(0, 16), sort: view.sort ?? 'system',
        // A card body the model wrote with escaped line breaks (`\\n`) reads with real ones.
        text: body.replace(/\\n/g, '\n'), unsettled: unsettled.test(view.text), parents: view.parents ?? [], base: view.base ?? [],
        chapters: chapters.filter(row => row.settings?.includes(view.cardId) === true).map(row => row.n),
      }
    })
    const minds = await this.core.listMinds({ workId })
    const story = await this.core.storyLog({ workId })
    const linksOf = (cardId: string, key: string): string[] => {
      const value = entries.board.cards.find(row => row.id === cardId)?.fields?.[key]
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    }
    const characters = entries.characters.filter(view => live(view.cardStatus)).map(view => {
      const own = minds.filter(row => row.characterId === view.cardId)
      const intent = own.filter(row => row.kind === 'intent').at(-1)?.text
      const appear = story.characters.find(row => row.cardId === view.cardId)?.appearances ?? []
      return {
        cardId: view.cardId, name: view.name, ...(view.identity === undefined ? {} : { identity: view.identity }),
        factions: linksOf(view.cardId, 'faction'), homes: linksOf(view.cardId, 'home'),
        ...(view.currentState?.where === undefined ? {} : { where: view.currentState.where }),
        ...(view.currentState?.state === undefined ? {} : { state: view.currentState.state }),
        ...(intent === undefined ? {} : { intent }),
        beliefs: own.filter(row => row.kind === 'belief').slice(-4).map(row => ({ text: row.text, chapter: row.chapter, ...(row.source === undefined ? {} : { source: row.source }) })),
        secrets: view.secrets,
        chapters: appear.filter(row => !row.planned).map(row => row.chapter),
      }
    })
    const journal = await this.core.listRelationJournal({ workId })
    const relations = entries.relations.filter(view => live(view.cardStatus)).map(view => {
      const own = journal.filter(row => row.relationId === view.cardId)
      const since = own.length === 0 ? undefined : Math.min(...own.map(row => row.chapter))
      return {
        cardId: view.cardId, pair: view.pair, type: view.type, stage: view.stage, ...(view.now === undefined ? {} : { now: view.now }),
        ...(since === undefined ? {} : { since }),
        steps: own.map(row => ({ chapter: row.chapter, label: row.kind === 'points' ? `${row.delta > 0 ? '+' : ''}${row.delta}` : row.stage, ...(row.evidence === undefined ? {} : { evidence: row.evidence }) })),
      }
    })
    const mentions = await this.core.listMentions({ workId })
    const foreshadows = entries.foreshadows.filter(view => live(view.cardStatus)).map(view => ({
      cardId: view.cardId, ref: view.ref, question: view.question, state: view.state, starred: view.starred,
      ...(view.reveal === undefined ? {} : { reveal: revealText(view.reveal), revealKind: view.reveal.kind }),
      ...(view.answer === undefined ? {} : { answer: view.answer }),
      steps: mentions.filter(row => row.foreshadowId === view.cardId).sort((a, b) => a.chapter - b.chapter).map(row => ({
        chapter: row.chapter, kind: row.kind, ...(row.note === undefined ? {} : { note: row.note }), ...(row.evidence === undefined ? {} : { evidence: row.evidence }), ...(row.planned === true ? { planned: true } : {}),
      })),
    }))
    const legacy = new Set(entries.board.categories.filter(category => category.role === 'world').map(category => category.id))
    return {
      ok: true, current: entries.currentChapter, settings, characters, relations, foreshadows,
      principles: entries.rules.filter(view => view.role === 'principle' && live(view.status)).map(view => ({ cardId: view.cardId, text: view.text })),
      unorganized: entries.board.cards.filter(card => live(card.status) && legacy.has(card.kind)).length,
    }
  }

  /**
   * The 时间轴 face: what has happened in story time, everything to come with
   * its tension and tier, the next chapter's recall and the person's pins.
   */
  @Remote('timeline')
  async timeline(request: NovelWorkRequest): Promise<NovelTimelineResult> {
    const entries = await this.core.readEntries(request.canvasId)
    if (entries === undefined) return { ok: false, error: 'missing' }
    const { events, current, doc } = await this.core.allEvents(request.canvasId)
    const ideas = await this.core.readIdeas(request.canvasId)
    const names: Record<string, string> = {}
    for (const view of entries.characters) names[view.cardId] = view.name
    for (const view of entries.rules) names[view.cardId] = view.name ?? view.ref
    // 世界层: the top of a place's 属于 chain. An event's lane is the layer of
    // the place it happens at (a faction's 据点 stands in for the faction).
    const rules = new Map(entries.rules.map(view => [view.cardId, view]))
    const rootOf = (id: string): string | undefined => {
      let at = rules.get(id)
      if (at?.sort === 'faction' && at.base?.[0] !== undefined) at = rules.get(at.base[0])
      if (at?.sort !== 'place') return undefined
      const seen = new Set<string>()
      while (at.parents?.[0] !== undefined && !seen.has(at.cardId)) {
        seen.add(at.cardId)
        const up = rules.get(at.parents[0])
        if (up?.sort !== 'place') break
        at = up
      }
      return at.cardId
    }
    const laneOf = (places: readonly string[] | undefined): string | undefined => {
      for (const id of [...places ?? []].reverse()) { const root = rootOf(id); if (root !== undefined) return root }
      return undefined
    }
    const viewOf = (event: StoryEvent): TimelineEventView => ({
      id: event.id, title: event.title, status: event.status,
      ...(laneOf(event.places) === undefined ? {} : { lane: laneOf(event.places)! }),
      ...(event.when === undefined ? {} : { when: event.when }),
      ...(event.source === undefined ? {} : { source: event.source }),
      ...(event.who === undefined ? {} : { who: event.who }),
      ...(event.places === undefined ? {} : { places: event.places }),
      ...(event.chapters === undefined ? {} : { chapters: event.chapters }),
      ...(event.window === undefined ? {} : { window: event.window }),
      ...(event.causes === undefined ? {} : { causes: event.causes }),
      ...(event.pre === undefined ? {} : { pre: event.pre }),
      ...(event.valueWhy === undefined ? {} : { valueWhy: event.valueWhy }),
      ...(event.foreshadowId === undefined ? {} : { foreshadowId: event.foreshadowId }),
      ideas: ideas.ideas.filter(idea => idea.eventId === event.id && idea.writtenIn === undefined).length,
    })
    const chapter = current + 1
    const stored = events.filter(event => (event.status === 'happened' || event.status === 'failed') && event.foreshadowId === undefined).sort((a, b) => a.order - b.order)
    // A reconciled chapter with no events of its own (reconciled before the
    // timeline existed) stands in as one event: its recap.
    const covered = new Set(stored.flatMap(event => event.chapters ?? []))
    const recapped = (await this.core.listChapters({ workId: request.canvasId }))
      .filter(row => row.chapter.recap !== undefined && !covered.has(row.chapter.n) && (row.phase === 'extracted' || row.phase === 'reviewed' || row.phase === 'stale'))
      .map((row): TimelineEventView => {
        // Who and where by the names the recap uses (rules, not a model): a
        // place matches by its name or its name less 世界 / 梦域 (山海梦域 ↔ 山海).
        const text = `${row.chapter.title} ${row.chapter.recap!}`
        const at = (name: string | undefined): number => {
          if (name === undefined || name.length < 2) return -1
          const short = name.replace(/(世界|梦域)$/u, '')
          return Math.max(text.lastIndexOf(name), short.length >= 2 ? text.lastIndexOf(short) : -1)
        }
        const who = entries.characters.filter(view => at(view.name) >= 0 || (row.chapter.plan?.cast ?? []).some(member => member.who === view.cardId || member.who === view.name)).map(view => view.cardId)
        const places = entries.rules.filter(view => view.sort === 'place' && at(view.name) >= 0).sort((a, b) => at(a.name) - at(b.name)).map(view => view.cardId)
        const lane = laneOf(places)
        return {
          id: `ch:${row.chapter.n}`, title: row.chapter.recap!, status: 'happened', chapters: [row.chapter.n], ideas: 0, recap: true,
          ...(who.length === 0 ? {} : { who }), ...(places.length === 0 ? {} : { places }), ...(lane === undefined ? {} : { lane }),
        }
      })
    // Story time: stored events keep their order; a recap goes after the
    // events of the chapters before it.
    const storedViews = stored.map(viewOf)
    const past: TimelineEventView[] = [...storedViews]
    for (const recap of recapped) {
      const n = recap.chapters![0]!
      const after = past.findIndex(event => (event.chapters?.[0] ?? 0) > n)
      past.splice(after < 0 ? past.length : after, 0, recap)
    }
    const future = events.filter(isFuture).map((event): TimelineFutureView => {
      const parts = tensionOf(event, current)
      return { ...viewOf(event), tier: parts.tier, reason: tierReason(event, parts), tension: parts.tension, V: parts.V, E: parts.E, ...(parts.D === undefined ? {} : { D: parts.D }), Z: parts.Z, S: parts.S }
    })
    const pins = doc.pins?.chapter === chapter ? doc.pins : undefined
    const hero = (await this.core.readOutline(request.canvasId)).sheet.protagonist
    const candidates = recall(events, current, { ...(pins === undefined ? {} : { prefer: pins.prefer, block: pins.block }), ...(hero === undefined ? {} : { pov: hero }) }).map(row => row.event.id)
    const lanes = [...new Set([...past, ...future].map(event => event.lane).filter((id): id is string => id !== undefined))]
    for (const id of lanes) names[id] ??= rules.get(id)?.name ?? id
    const backfill = recapped.map(event => event.chapters![0]!)
    return { ok: true, chapter, past, future, names, candidates, lanes, ...(backfill.length === 0 ? {} : { backfill }), ...(pins === undefined ? {} : { pins: { prefer: pins.prefer, block: pins.block } }) }
  }

  /** The person's 优先推进 / 本章屏蔽 on the next chapter's candidates. */
  @Remote('setRecallPins')
  async setRecallPins(sessionId: SessionId, request: NovelPinsRequest): Promise<NovelGestureResult> {
    return this.core.setRecallPins({ workId: request.canvasId, chapter: request.chapter, prefer: request.prefer, block: request.block }, await panelSession(this.ctx, sessionId))
  }

  /** The 灵感 face: every idea, and the events one may be bound to. */
  @Remote('ideas')
  async ideas(request: NovelWorkRequest): Promise<NovelIdeasResult> {
    const entries = await this.core.readEntries(request.canvasId)
    if (entries === undefined) return { ok: false, error: 'missing' }
    const doc = await this.core.readIdeas(request.canvasId)
    const { events, current } = await this.core.allEvents(request.canvasId)
    const nameOf = (id: string): string => entries.characters.find(view => view.cardId === id)?.name ?? entries.rules.find(view => view.cardId === id)?.name ?? id
    return {
      ok: true,
      ideas: doc.ideas,
      events: events.filter(event => isFuture(event) || doc.ideas.some(idea => idea.eventId === event.id)).map(event => ({
        id: event.id, title: event.title,
        ...(isFuture(event) ? { tier: tensionOf(event, current).tier } : {}),
        mentions: [...(event.who ?? []), ...(event.places ?? [])].map(nameOf),
      })),
    }
  }

  /** One change to the ideas: add, delete, bind or unbind. */
  @Remote('changeIdea')
  async changeIdea(sessionId: SessionId, request: NovelIdeaRequest): Promise<NovelGestureResult> {
    const outcome = await this.core.changeIdea({
      workId: request.canvasId,
      ...(request.add === undefined ? {} : { add: request.add }),
      ...(request.id === undefined ? {} : { id: request.id }),
      ...(request.delete === true ? { delete: true } : {}),
      ...(request.eventId === undefined ? {} : { eventId: request.eventId }),
    }, await panelSession(this.ctx, sessionId))
    return outcome.ok ? { ok: true } : { ok: false, ...(outcome.error === undefined ? {} : { error: outcome.error }) }
  }

  /** The person's own edit of a chapter's text. */
  @Remote('editChapterBody')
  async editChapterBody(sessionId: SessionId, request: NovelBodyEditRequest): Promise<NovelBodyEditResult> {
    return this.core.editChapterBody({ workId: request.canvasId, n: request.n, text: request.text, ...(request.baseHash === undefined ? {} : { baseHash: request.baseHash }) }, await panelSession(this.ctx, sessionId))
  }

  /** A new chapter the person writes themselves (用户原稿: no plan, no confirmation). */
  @Remote('newOwnChapter')
  async newOwnChapter(sessionId: SessionId, request: NovelOwnChapterRequest): Promise<NovelGestureResult & { readonly n?: number }> {
    const outcome = await this.core.writeChapter({ workId: request.canvasId, title: request.title, byUser: true, content: '' }, await panelSession(this.ctx, sessionId))
    return outcome.ok ? { ok: true, ...(outcome.chapter === undefined ? {} : { n: outcome.chapter.n }) } : { ok: false, ...(outcome.error === undefined ? {} : { error: outcome.error }) }
  }

  /** The person's ★ on a foreshadow. */
  @Remote('starForeshadow')
  async starForeshadow(sessionId: SessionId, request: NovelStarRequest): Promise<NovelGestureResult> {
    return starForeshadowGesture(this.core, await panelSession(this.ctx, sessionId), request)
  }

  /** The person's edit of a character's 此刻. */
  @Remote('setCurrentState')
  async setCurrentState(sessionId: SessionId, request: NovelStateRequest): Promise<NovelGestureResult> {
    return setCurrentStateGesture(this.core, await panelSession(this.ctx, sessionId), request)
  }
}

export default NovelRemoteService
