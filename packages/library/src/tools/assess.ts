/**
 * The `library_assess` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/assess
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { type LibraryVerdict } from '../types.ts'
import { jsonOutput, pickString, unwrap, type ToolKit } from './kit.ts'

/** A passed station's result carries the next step: name what follows and ask (the learner starts it). */
function withNext<T extends { completed?: string; unlocked?: readonly string[] }>(result: T): T & { next?: string } {
  if (result.completed === undefined) return result
  return { ...result, next: `Congratulate the learner, name the next station${result.unlocked !== undefined && result.unlocked.length > 0 ? ` (${result.unlocked.join(', ')})` : ''} and ask whether to start it — start only when they say so.` }
}

/** Build the `library_assess` tool over the shared kit. */
export function libraryAssessTool(kit: ToolKit): ToolDefinition {
  const { service, projectOf } = kit
  return defineTool({
    name: 'library_assess',
    description:
      'Record a graded sitting after judging it in the chat: one verdict per question. The stored answer can be wrong — judge by the question, and say so when it was. '
      + 'A hands-on station: pass node instead of quiz; each task is a line id (L1, L2…). Then tell the learner what moved and what unlocked.',
    parameters: {
      project: { type: 'string', description: 'Project id (defaults to the binding).' },
      quiz: { type: 'string', description: 'The quiz id.' },
      node: { type: 'string', description: 'A hands-on station, instead of quiz.' },
      resource: { type: 'string', description: 'Its textbook (defaults to wherever the node is).' },
      verdicts: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            task: { type: 'string', description: 'The question id, or the line id (L1…).' },
            pass: { type: 'boolean' },
            ratio: { type: 'number', description: 'Partial credit 0..1.' },
            why: { type: 'string', description: 'One line on the judgment.' },
            void: { type: 'boolean', description: 'The learner flagged it broken.' },
            missedCard: { type: 'object', additionalProperties: false, description: 'Language projects: the word they missed.', properties: { term: { type: 'string' }, gloss: { type: 'string' } } },
          },
        },
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!Array.isArray(args.verdicts) || args.verdicts.length === 0) {
        throw new Error('verdicts is required — one per question: [{ task: <question id>, pass, why, ratio?, void? }]')
      }
      // why is the one line the coach writes; criterion / evidence / by keep
      // their ledger slots (older calls still send them).
      const verdicts = (args.verdicts as Record<string, unknown>[]).map(verdict => {
        const why = pickString(verdict.why, verdict.criterion, verdict.evidence) ?? ''
        return {
          ...verdict,
          criterion: pickString(verdict.criterion) ?? why,
          evidence: pickString(verdict.evidence) ?? why,
          by: verdict.by === 'self' || verdict.by === 'user' ? verdict.by : 'llm',
        }
      }) as unknown as LibraryVerdict[]
      const node = pickString(args.node)
      if (node !== undefined) {
        const resource = pickString(args.resource, (args as Record<string, unknown>).book)
        return withNext(unwrap(await service.putAttempt({
          projectId: projectOf(args.project, exec, resource),
          nodeId: node,
          ...(resource === undefined ? {} : { resourceId: resource }),
          verdicts,
        }))) as unknown as JsonValue
      }
      const quiz = pickString(args.quiz)
      if (quiz === undefined) throw new Error('quiz is the id library_quiz returned — or pass node (an acceptance station\'s id) for acceptance')
      const result = unwrap(await service.putAttempt({
        projectId: projectOf(args.project, exec),
        assessmentId: quiz,
        verdicts,
      }))
      return withNext(result) as unknown as JsonValue
    },
  })
}
