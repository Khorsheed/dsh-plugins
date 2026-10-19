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

/** Build the `library_assess` tool over the shared kit. */
export function libraryAssessTool(kit: ToolKit): ToolDefinition {
  const { service, projectOf } = kit
  return defineTool({
    name: 'library_assess',
    description:
      'Ledger a graded sitting — the ONLY cascading write. Judge the answers in the conversation first (against each question\'s answer and evidence), '
      + 'then record one verdict per question: { task: <question id>, criterion: <what you judged>, pass, ratio?: <partial credit 0..1>, evidence: <what it rests on>, '
      + 'by: "llm"|"self"|"user", void?: true when the learner flagged the question as broken, missedCard?: { term, gloss } for a missed question that targets no card }. '
      + 'The engine moves every probed card, carding a card-less miss, and completes the gated station at its pass ratio, unlocking what follows — report what moved and what unlocked. '
      + 'Acceptance: pass node instead of quiz; each verdict\'s task is a rubric line id (L1, L2…) judged against the evidence the learner submitted. A line carrying ref is machine-checked — never judge it.',
    parameters: {
      project: { type: 'string', description: 'Project id (defaults to the binding).' },
      quiz: { type: 'string', description: 'The quiz id library_quiz returned (a quiz sitting).' },
      node: { type: 'string', description: 'Acceptance station id (an acceptance sitting — instead of quiz).' },
      resource: { type: 'string', description: 'The textbook whose path holds the acceptance station (defaults to wherever the node is).' },
      verdicts: {
        type: 'array',
        required: true,
        description: 'One verdict per question.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            task: { type: 'string', description: 'The question id (a quiz sitting), or the rubric line id — L1, L2… (an acceptance sitting).' },
            criterion: { type: 'string', description: 'What was judged, in one line.' },
            pass: { type: 'boolean', description: 'Whether the answer passes.' },
            ratio: { type: 'number', description: 'Partial credit 0..1.' },
            evidence: { type: 'string', description: 'What the judgment rests on.' },
            by: { type: 'string', enum: ['llm', 'self', 'user'], description: 'Who graded.' },
            void: { type: 'boolean', description: 'The learner flagged the question as broken: it counts for nothing.' },
            missedCard: {
              type: 'object',
              additionalProperties: false,
              description: 'For a missed question with no target card: the card to create.',
              properties: { term: { type: 'string' }, gloss: { type: 'string' } },
            },
          },
        },
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!Array.isArray(args.verdicts) || args.verdicts.length === 0) {
        throw new Error('verdicts is required — one verdict per question: [{ task: <question id>, criterion: <what you judged>, pass, evidence: <what it rests on>, by: "llm"|"self"|"user", ratio?, void?, missedCard? }]')
      }
      const node = pickString(args.node)
      if (node !== undefined) {
        const resource = pickString(args.resource, (args as Record<string, unknown>).book)
        return unwrap(await service.putAttempt({
          projectId: projectOf(args.project, exec, resource),
          nodeId: node,
          ...(resource === undefined ? {} : { resourceId: resource }),
          verdicts: [...args.verdicts] as LibraryVerdict[],
        })) as unknown as JsonValue
      }
      const quiz = pickString(args.quiz)
      if (quiz === undefined) throw new Error('quiz is the id library_quiz returned — or pass node (an acceptance station\'s id) for acceptance')
      return unwrap(await service.putAttempt({
        projectId: projectOf(args.project, exec),
        assessmentId: quiz,
        verdicts: [...args.verdicts] as LibraryVerdict[],
      })) as unknown as JsonValue
    },
  })
}
