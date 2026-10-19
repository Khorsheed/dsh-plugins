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
  LIST_WRAPPER_SCHEMA,
  type ToolKit,
} from './kit.ts'

/** Build the `library_cards` tool over the shared kit. */
export function libraryCardsTool(kit: ToolKit): ToolDefinition {
  const { service, bindingOf, projectOf, scopeParams } = kit
  return defineTool({
    name: 'library_cards',
    description:
      'Record a weak point the moment the learner is stuck on the MATERIAL (mixes it up, asks the same point again, keeps probing one detail), then say in one short line what you noted. '
      + 'Subject projects: name the station\'s knowledge point (node + point) — the note lands on that point and turns it weak; it is not a card. '
      + 'Language projects, or a concept with no point: { kind: word|concept, term, gloss, context?, source: { type: "chat" }, weaken: true } becomes a card; near-duplicates come back pending — resend each with mergeInto or asNew. '
      + 'Never a weak point: ordinary curiosity, or feedback on a question or the tools (a broken question is voided by the learner, not noted).',
    parameters: {
      ...scopeParams,
      resource: { type: 'string', description: 'The textbook it came up in (defaults to the binding\'s).' },
      cards: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
            point: { type: 'string', description: 'Subject projects: the station\'s knowledge point id (the per-turn context lists them) — the note lands there.' },
            node: { type: 'string', description: 'The station id (defaults to the bound textbook\'s current station).' },
            kind: { type: 'string', enum: ['word', 'concept'] },
            term: { type: 'string', description: 'The short name of what they stuck on.' },
            gloss: { type: 'string', description: 'The in-context meaning, or what they confused it with.' },
            aliases: { type: 'array', items: { type: 'string' } },
            userGloss: { type: 'string', description: 'The learner\'s own wording.' },
            context: { type: 'object', additionalProperties: true, properties: {
              sentence: { type: 'string' },
              node: { type: 'string', description: 'The station id.' },
            } },
            source: { type: 'object', additionalProperties: true, properties: {
              type: { type: 'string', required: true, enum: ['chat', 'photo', 'quiz', 'manual'] },
              note: { type: 'string' },
            }, description: 'When the learner is stuck: chat + weaken true.' },
            weaken: { type: 'boolean', description: 'The learner is stuck on it.' },
            mergeInto: { type: 'string', description: 'Resolve a pending near-duplicate: merge into this card id.' },
            asNew: { type: 'boolean', description: 'Resolve a pending near-duplicate: keep it separate.' },
          } } },
          { type: 'string', description: 'The same array as its JSON text.' },
          LIST_WRAPPER_SCHEMA,
        ],
        required: true,
        description: 'The weak points to record.',
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const list = payloadList(args.cards)
      if (list === undefined) {
        throw new Error(`library_cards takes cards: [{ kind: "word"|"concept", term, gloss, context?, source: { type: "chat", note? }, weaken? }] — ${arrival('cards', args.cards)}`)
      }
      const sessionId = sessionIdOf(exec)
      const cards = (list as Record<string, unknown>[]).map(card => {
        const source = payload(card.source) ?? { type: 'chat' }
        const context = payload(card.context)
        return {
          ...card,
          source: { ...source, ...(source.type === 'chat' && source.ref === undefined && sessionId !== undefined ? { ref: sessionId } : {}) },
          ...(context === undefined ? {} : { context: { sentence: String(context.sentence ?? ''), ...(typeof context.node === 'string' ? { nodeId: context.node } : {}) } }),
        } as unknown as LibraryCardInput
      })
      const resource = pickString(args.resource, (args as Record<string, unknown>).book) ?? bindingOf(exec)?.resourceId
      const projectId = projectOf(args.project, exec, resource)
      // A subject project's weak point with a knowledge point lands on the point.
      const project = unwrap(await service.getProject({ id: projectId })).project
      const pointed = profileOf(project.template).pointsDriven
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
      const recorded = rest.length === 0 ? undefined : unwrap(await service.writeCards({
        projectId,
        ...(resource === undefined ? {} : { resourceId: resource }),
        cards: rest,
      }))
      return { ...(recorded ?? { ok: true }), ...(noted.length === 0 ? {} : { pointNotes: noted }) } as unknown as JsonValue
    },
  })
}
