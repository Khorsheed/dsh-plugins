/**
 * Knowledge cards: the dedupe write path, listing, editing, undo, review scheduling.
 *
 * One layer of the library service (see `service/core.ts` for the layering):
 * the methods are the service's own, moved here verbatim by domain.
 *
 * @module @khorsheed/dsh-library/service/cards
 */
import {
  MAX_BOX,
  type LibraryCardQuery,
  type LibraryCard,
  type LibraryCardInput,
  type LibraryCardPending,
  type LibraryCardWriteResult,
  type LibraryOutcome,
  type LibraryReviewRating,
} from '../types.ts'
import {
  cardKey,
  cardKeys,
  cardMatchesQuery,
  exactMatch,
  nearMatches,
} from '../cards.ts'
import { mintLibraryId } from '../store.ts'
import { refuse, leitnerDueAt, clampWeakness, live } from './core.ts'
import { LibraryServiceShelf } from './shelf.ts'

export class LibraryServiceCards extends LibraryServiceShelf {
  /* --------------------------------------------------------------- cards */

  /**
   * Apply card inputs to the project's cards (call inside the project lock).
   * Exact keys merge; near matches are held back unless `mergeNear` (photo
   * words — a plural or a case away is the same word) or the input decides.
   */
  protected applyCardInputs(
    projectId: string,
    inputs: readonly LibraryCardInput[],
    defaultResourceId: string | undefined,
    options: { mergeNear?: boolean } = {},
  ): LibraryCardWriteResult & { at: string } {
    const cards = this.store.readCards(projectId)
    const byId = new Map(cards.map(card => [card.id, card]))
    const order = cards.map(card => card.id)
    const added: LibraryCard[] = []
    const merged: LibraryCard[] = []
    const pending: LibraryCardPending[] = []
    const now = new Date().toISOString()
    for (const [index, input] of inputs.entries()) {
      const keys = [input.term, ...(input.aliases ?? [])].map(cardKey).filter(key => key !== '')
      const pool = [...byId.values()]
      let target: LibraryCard | undefined
      if (input.mergeInto !== undefined) {
        target = byId.get(input.mergeInto)
      } else if (input.asNew !== true) {
        target = exactMatch(pool, keys)
        if (target === undefined) {
          const near = nearMatches(pool, keys)
          if (near.length > 0) {
            if (options.mergeNear === true) {
              target = near[0]
            } else {
              pending.push({ index, term: input.term, candidates: near.map(card => ({ id: card.id, term: card.term, gloss: card.gloss })) })
              continue
            }
          }
        }
      }
      const resourceId = input.resourceId ?? defaultResourceId
      const source = {
        type: input.source.type,
        ...(input.source.ref === undefined ? {} : { ref: input.source.ref }),
        ...(input.source.note === undefined || input.source.note.trim() === '' ? {} : { note: input.source.note.trim() }),
        ...(input.weaken === true ? { weakened: true } : {}),
        at: now,
      }
      const context = input.context === undefined || input.context.sentence.trim() === ''
        ? undefined
        : {
          sentence: input.context.sentence.trim(),
          ...(resourceId === undefined ? {} : { resourceId }),
          ...(input.context.pageId === undefined ? {} : { pageId: input.context.pageId }),
          ...(input.context.nodeId === undefined ? {} : { nodeId: input.context.nodeId }),
        }
      if (target !== undefined) {
        const aliases = new Set(target.aliases)
        const ownKeys = new Set(cardKeys(target))
        if (!ownKeys.has(cardKey(input.term))) aliases.add(input.term.trim())
        for (const alias of input.aliases ?? []) if (!ownKeys.has(cardKey(alias))) aliases.add(alias.trim())
        const placeholder = target.gloss === '（待补释义）'
        const next: LibraryCard = {
          ...target,
          aliases: [...aliases],
          gloss: placeholder ? input.gloss.trim() : target.gloss,
          ...(target.userGloss === undefined && input.userGloss !== undefined ? { userGloss: input.userGloss.trim() } : {}),
          contexts: context === undefined || target.contexts.some(existing => existing.sentence === context.sentence)
            ? target.contexts
            : [...target.contexts, context],
          ...(target.resourceId === undefined && resourceId !== undefined ? { resourceId } : {}),
          sources: [...target.sources, source],
          weakness: clampWeakness(target.weakness + (input.weaken === true ? 1 : 0)),
          // A card met again is active again — a re-sighting never resets mastery.
          status: target.status === 'deleted' ? 'active' : target.status,
          updatedAt: now,
        }
        byId.set(next.id, next)
        merged.push(next)
        continue
      }
      const card: LibraryCard = {
        id: mintLibraryId('c'),
        kind: input.kind,
        term: input.term.trim(),
        aliases: (input.aliases ?? []).map(alias => alias.trim()).filter(alias => alias !== '' && cardKey(alias) !== cardKey(input.term)),
        gloss: input.gloss.trim(),
        ...(input.userGloss === undefined || input.userGloss.trim() === '' ? {} : { userGloss: input.userGloss.trim() }),
        contexts: context === undefined ? [] : [context],
        ...(resourceId === undefined ? {} : { resourceId }),
        sources: [source],
        weakness: input.weaken === true || input.source.type === 'chat' ? 1 : 0,
        mastery: { box: 0, dueAt: now, streak: 0 },
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }
      byId.set(card.id, card)
      order.push(card.id)
      added.push(card)
    }
    if (added.length > 0 || merged.length > 0) {
      this.store.writeCards(projectId, order.map(cardId => byId.get(cardId)!))
      const touched = [...added, ...merged]
      const sourceType = inputs[0]?.source.type
      this.event(projectId, 'cards.recorded', {
        at: now,
        title: touched.map(card => card.term).join('、').slice(0, 300),
        ids: touched.map(card => card.id),
        ...(sourceType === undefined ? {} : { source: sourceType }),
        ...(sourceType === 'chat' && inputs[0]?.source.ref !== undefined ? { session: inputs[0].source.ref } : {}),
        ...(defaultResourceId === undefined ? {} : { resourceId: defaultResourceId }),
        count: added.length,
        count2: merged.length,
      })
    }
    return { added, merged, pending, at: now }
  }

  /**
   * Record cards (the coach's 「记下」, a manual add). Near-duplicates come back
   * in `pending` with their candidates — resend each with `mergeInto` or `asNew`.
   */
  async writeCards(request: {
    projectId: string
    resourceId?: string
    cards: readonly LibraryCardInput[]
  }): Promise<LibraryOutcome<LibraryCardWriteResult>> {
    this.assertAlive('writeCards')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    if (request.cards.length === 0) {
      return refuse('invalid', 'cards needs at least one card — each: { kind: word|concept, term, gloss, context?, source: { type: chat|photo|quiz|manual, note? }, weaken? }')
    }
    // Per-card problems are collected and reported at once: a batch with
    // three bad cards earns one refusal listing all three, not three
    // fail-fast round trips.
    const errors: string[] = []
    for (const [index, input] of request.cards.entries()) {
      if (input.kind !== 'word' && input.kind !== 'concept') errors.push(`cards[${index}].kind is word | concept`)
      if (input.term.trim() === '' || input.gloss.trim() === '') {
        errors.push(`cards[${index}] needs term and gloss — the gloss is the in-context meaning (a word) or a one-line explanation (a concept)`)
      }
      if (!['photo', 'chat', 'quiz', 'manual'].includes(input.source?.type)) {
        errors.push(`cards[${index}].source.type is chat | photo | quiz | manual — chat: the learner asked / got stuck in conversation`)
      }
    }
    const cards = this.store.readCards(project.value.id)
    for (const [index, input] of request.cards.entries()) {
      if (input.mergeInto !== undefined && !cards.some(card => card.id === input.mergeInto && live(card))) {
        errors.push(`cards[${index}].mergeInto names ${JSON.stringify(input.mergeInto)}, which is not a live card — use an id from the pending candidates`)
      }
    }
    if (errors.length === 1) return refuse('invalid', errors[0]!)
    if (errors.length > 1) {
      return refuse('invalid', `${errors.length} problems in cards — fix them all, then resend:\n${errors.map(error => `- ${error}`).join('\n')}`)
    }
    if (request.resourceId !== undefined && this.store.readResource(project.value.id, request.resourceId) === undefined) {
      return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} in this project — omit resource for a project-level card`)
    }
    return await this.mutate(project.value.id, () => {
      const { at: _at, ...result } = this.applyCardInputs(project.value.id, request.cards, request.resourceId)
      return { ok: true as const, ...result }
    })
  }

  /** Cards, filtered and sorted (the sidebar list, the coach's search). */
  async listCards(request: LibraryCardQuery): Promise<{ cards: LibraryCard[]; total: number }> {
    this.assertAlive('listCards')
    const now = new Date().toISOString()
    let cards = this.store.readCards(request.projectId).filter(live)
    if (request.includeMastered !== true) cards = cards.filter(card => card.status === 'active')
    if (request.resourceId !== undefined) cards = cards.filter(card => card.resourceId === request.resourceId)
    if (request.nodeId !== undefined) cards = cards.filter(card => card.contexts.some(context => context.nodeId === request.nodeId))
    if (request.kind !== undefined) cards = cards.filter(card => card.kind === request.kind)
    if (request.source !== undefined) cards = cards.filter(card => card.sources.some(source => source.type === request.source))
    if (request.weakMin !== undefined) cards = cards.filter(card => card.weakness >= request.weakMin!)
    if (request.due === true) cards = cards.filter(card => card.mastery.dueAt <= now)
    if (request.query !== undefined && request.query.trim() !== '') cards = cards.filter(card => cardMatchesQuery(card, request.query!))
    const sort = request.sort ?? 'weak'
    cards.sort((a, b) => sort === 'recent'
      ? b.updatedAt.localeCompare(a.updatedAt)
      : sort === 'due'
        ? a.mastery.dueAt.localeCompare(b.mastery.dueAt)
        : b.weakness - a.weakness || a.mastery.dueAt.localeCompare(b.mastery.dueAt))
    return { cards: cards.slice(0, request.limit ?? 200), total: cards.length }
  }

  /** The cards due for review across projects (or one), weakest first. */
  async dueCards(request: { projectId?: string; limit?: number }): Promise<{ cards: (LibraryCard & { projectId: string })[] }> {
    this.assertAlive('dueCards')
    const now = new Date().toISOString()
    const projectIds = request.projectId !== undefined ? [request.projectId] : this.store.readIndex().projects.map(project => project.id)
    const due: (LibraryCard & { projectId: string })[] = []
    for (const projectId of projectIds) {
      for (const card of this.store.readCards(projectId)) {
        if (card.status === 'active' && card.mastery.dueAt <= now) due.push({ ...card, projectId })
      }
    }
    due.sort((a, b) => a.mastery.box - b.mastery.box || b.weakness - a.weakness || a.mastery.dueAt.localeCompare(b.mastery.dueAt))
    return { cards: due.slice(0, request.limit ?? 200) }
  }

  /** Edit a card by hand: its words, or its status (mastered / deleted / active). */
  async editCard(request: {
    projectId: string
    cardId: string
    patch: { term?: string; gloss?: string; userGloss?: string; aliases?: readonly string[]; status?: LibraryCard['status']; resourceId?: string | null }
  }): Promise<LibraryOutcome<{ card: LibraryCard }>> {
    this.assertAlive('editCard')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const cards = this.store.readCards(project.value.id)
      const card = cards.find(candidate => candidate.id === request.cardId)
      if (card === undefined) return refuse('not-found', `no card ${JSON.stringify(request.cardId)}`)
      const patch = request.patch
      if (patch.term !== undefined && patch.term.trim() === '') return refuse('invalid', 'a card keeps a term')
      if (patch.gloss !== undefined && patch.gloss.trim() === '') return refuse('invalid', 'a card keeps a gloss')
      const { resourceId: _old, ...rest } = card
      const next: LibraryCard = {
        ...(patch.resourceId === null ? rest : card),
        ...(patch.term === undefined ? {} : { term: patch.term.trim() }),
        ...(patch.gloss === undefined ? {} : { gloss: patch.gloss.trim() }),
        ...(patch.userGloss === undefined ? {} : { userGloss: patch.userGloss.trim() }),
        ...(patch.aliases === undefined ? {} : { aliases: patch.aliases.map(alias => alias.trim()).filter(alias => alias !== '') }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(typeof patch.resourceId === 'string' ? { resourceId: patch.resourceId } : {}),
        updatedAt: new Date().toISOString(),
      }
      this.store.writeCards(project.value.id, cards.map(candidate => candidate.id === card.id ? next : candidate))
      this.event(project.value.id, 'card.edited', { id: card.id, title: next.term })
      return { ok: true as const, card: next }
    })
  }

  /**
   * Undo one recording (the toast's 撤销): cards it created are deleted; cards
   * it merged into lose the source it stacked (and the weakness it added).
   */
  async undoCards(request: { projectId: string; ids: readonly string[]; at: string }): Promise<LibraryOutcome<{ removed: number; reverted: number }>> {
    this.assertAlive('undoCards')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const wanted = new Set(request.ids)
      let removed = 0
      let reverted = 0
      const cards = this.store.readCards(project.value.id).map(card => {
        if (!wanted.has(card.id)) return card
        if (card.createdAt === request.at) {
          removed += 1
          return { ...card, status: 'deleted' as const, updatedAt: new Date().toISOString() }
        }
        const dropped = card.sources.filter(source => source.at === request.at)
        if (dropped.length === 0) return card
        reverted += 1
        return {
          ...card,
          sources: card.sources.filter(source => source.at !== request.at),
          weakness: clampWeakness(card.weakness - dropped.filter(source => source.weakened === true).length),
          updatedAt: new Date().toISOString(),
        }
      })
      this.store.writeCards(project.value.id, cards)
      return { ok: true as const, removed, reverted }
    })
  }

  /**
   * One flashcard review (the daily 复习): only the schedule moves — forgot
   * resets to box 0 (tomorrow), fuzzy keeps the box, recalled climbs one.
   * Reviews never unlock nodes and never touch weakness.
   */
  async reviewCard(request: { projectId: string; cardId: string; rating: LibraryReviewRating }): Promise<LibraryOutcome<{ card: LibraryCard }>> {
    this.assertAlive('reviewCard')
    if (!['forgot', 'fuzzy', 'recalled'].includes(request.rating)) return refuse('invalid', 'rating is forgot | fuzzy | recalled')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const cards = this.store.readCards(project.value.id)
      const card = cards.find(candidate => candidate.id === request.cardId && live(candidate))
      if (card === undefined) return refuse('not-found', `no card ${JSON.stringify(request.cardId)}`)
      const now = new Date()
      const box = request.rating === 'forgot' ? 0 : request.rating === 'fuzzy' ? card.mastery.box : Math.min(card.mastery.box + 1, MAX_BOX)
      const next: LibraryCard = {
        ...card,
        mastery: {
          box,
          dueAt: leitnerDueAt(box, now),
          streak: request.rating === 'recalled' ? card.mastery.streak + 1 : 0,
        },
        updatedAt: now.toISOString(),
      }
      this.store.writeCards(project.value.id, cards.map(candidate => candidate.id === card.id ? next : candidate))
      return { ok: true as const, card: next }
    })
  }

}
