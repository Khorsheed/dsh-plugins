/**
 * The `library_cards` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/cards
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { type LibraryCardInput } from '../types.ts'
import { profileOf } from '../profiles.ts'
import {
  arrival,
  jsonOutput,
  payload,
  payloadList,
  pickString,
  sessionIdOf,
  unwrap,
  type ToolKit,
} from './kit.ts'

/** Build the `library_cards` tool over the shared kit. */
export function libraryCardsTool(kit: ToolKit): ToolDefinition {
  const { service, bindingOf, projectOf, scopeParams } = kit
  return defineTool({
    name: 'library_cards',
    description:
      'The learner is stuck on the material (mixes it up, asks the same thing again) → note it now, then say in one line what you noted. '
      + 'Subject projects: { point, gloss } — the note lands on the current station\'s knowledge point. Language projects: { term, gloss, sentence? } becomes a word card; a near-duplicate comes back pending — resend it with mergeInto or asNew. '
      + 'Not a weak point: curiosity, your own slip (fix the quiz), or feedback on a question or the tools.',
    parameters: {
      ...scopeParams,
      resource: { type: 'string', description: 'The textbook (defaults to the binding\'s).' },
      cards: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
            point: { type: 'string', description: 'Subject: the knowledge point id.' },
            term: { type: 'string', description: 'What they stuck on, in a few words.' },
            gloss: { type: 'string', description: 'What they got wrong, or the meaning.' },
            sentence: { type: 'string', description: 'Language: the sentence it came from.' },
            mergeInto: { type: 'string' },
            asNew: { type: 'boolean' },
          } } },
          { type: 'string', description: 'The same list as JSON text.' },
        ],
        required: true,
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const list = payloadList(args.cards)
      if (list === undefined) {
        throw new Error(`library_cards takes cards: [{ point, gloss }] (subject) or [{ term, gloss, sentence? }] (language) — ${arrival('cards', args.cards)}`)
      }
      const sessionId = sessionIdOf(exec)
      const resource = pickString(args.resource, (args as Record<string, unknown>).book) ?? bindingOf(exec)?.resourceId
      const projectId = projectOf(args.project, exec, resource)
      const project = profileOf(unwrap(await service.getProject({ id: projectId })).project.template)
      const cards = (list as Record<string, unknown>[]).map(card => {
        const source = payload(card.source) ?? { type: 'chat' }
        // A flat sentence is the context; a card from the chat weakens unless told otherwise.
        const context = payload(card.context) ?? (pickString(card.sentence) === undefined ? undefined : { sentence: card.sentence })
        return {
          ...card,
          kind: card.kind === 'word' || card.kind === 'concept' ? card.kind : project.markKind,
          ...(card.weaken === undefined && source.type === 'chat' ? { weaken: true } : {}),
          source: { ...source, ...(source.type === 'chat' && source.ref === undefined && sessionId !== undefined ? { ref: sessionId } : {}) },
          ...(context === undefined ? {} : { context: { sentence: String(context.sentence ?? ''), ...(typeof context.node === 'string' ? { nodeId: context.node } : {}) } }),
        } as unknown as LibraryCardInput
      })
      // A subject project's weak point with a knowledge point lands on the point.
      const pointed = project.pointsDriven
        ? (list as Record<string, unknown>[]).filter(card => pickString(card.point) !== undefined)
        : []
      const noted = []
      for (const card of pointed) {
        const station = pickString(card.node, payload(card.context)?.node) ?? (sessionId === undefined ? undefined : service.bindingSummary(sessionId, 0).station?.id)
        if (station === undefined) throw new Error('a point note needs its station: node (the per-turn context names the current station and its points)')
        const term = pickString(card.term)
        const text = [term, pickString(card.gloss, card.userGloss)].filter(Boolean).join(' — ')
        const written = unwrap(await service.notePoint({
          projectId,
          ...(resource === undefined ? {} : { resourceId: resource }),
          nodeId: station,
          pointId: pickString(card.point)!,
          text: text === '' ? String(card.gloss ?? '') : text,
          ...(term === undefined ? {} : { term }),
          ...(sessionId === undefined ? {} : { session: sessionId }),
        }))
        noted.push({ point: written.point.title, state: written.point.state, ...(written.changes.length === 0 ? {} : { changed: written.changes.map(change => `${change.title}: ${change.from} → ${change.to}`) }) })
      }
      const rest = cards.filter((_card, index) => !pointed.includes((list as Record<string, unknown>[])[index]!))
      // In a points-driven project a weak point from the conversation lands on
      // a knowledge point or nowhere: a free-floating chat card is how the
      // coach's own slips and the learner's feedback leaked in as 「弱点」.
      if (project.pointsDriven) {
        const loose = rest.filter(card => (card as { source?: { type?: string } }).source?.type === 'chat')
        if (loose.length > 0) {
          const points = sessionId === undefined ? [] : (service.bindingSummary(sessionId, 0).station?.mastery.points ?? [])
          throw new Error(`in a subject project a weak point from the conversation lands on the station's knowledge point — add point (+ node) to: ${loose.map(card => (card as { term?: string }).term ?? '?').join(', ')}${points.length === 0 ? '' : `; this station's points: ${points.map(point => `${point.id} (${point.title})`).join(', ')}`}. Record only what the LEARNER got wrong about the material — never your own slip (a wrong answer key: fix the quiz) and never feedback on a question or the tools. If none of that applies, record nothing.`)
        }
      }
      const recorded = rest.length === 0 ? undefined : unwrap(await service.writeCards({
        projectId,
        ...(resource === undefined ? {} : { resourceId: resource }),
        cards: rest,
      }))
      return { ...(recorded ?? { ok: true }), ...(noted.length === 0 ? {} : { pointNotes: noted }) } as unknown as JsonValue
    },
  })
}
