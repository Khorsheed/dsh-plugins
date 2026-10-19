/**
 * The `library_cards` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/cards
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { type LibraryCardInput } from '../types.ts'
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
      'Record weak points the moment the learner is stuck (mixes it up, asks the same point again, keeps probing one detail): { kind: word|concept, term, gloss, context?, source: { type: "chat" }, weaken: true }, then say in one short line what you noted. Ordinary curiosity is not a weak point. Near-duplicates come back pending with candidates — resend each with mergeInto or asNew.',
    parameters: {
      ...scopeParams,
      resource: { type: 'string', description: 'The textbook it came up in (defaults to the binding\'s).' },
      cards: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
            kind: { type: 'string', required: true, enum: ['word', 'concept'] },
            term: { type: 'string', required: true },
            gloss: { type: 'string', required: true, description: 'The in-context meaning.' },
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
      return unwrap(await service.writeCards({
        projectId: projectOf(args.project, exec, resource),
        ...(resource === undefined ? {} : { resourceId: resource }),
        cards,
      })) as unknown as JsonValue
    },
  })
}
