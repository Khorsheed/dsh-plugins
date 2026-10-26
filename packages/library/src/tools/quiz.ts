/**
 * The `library_quiz` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/quiz
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { type LibraryQuizQuestion } from '../types.ts'
import { normalizeQuizOptions } from '../store.ts'
import {
  arrival,
  jsonOutput,
  normalizeQuestionAxes,
  payloadList,
  pickString,
  QUESTIONS_SCHEMA,
  unwrap,
  type ToolKit,
} from './kit.ts'

/** Build the `library_quiz` tool over the shared kit. */
export function libraryQuizTool(kit: ToolKit): ToolDefinition {
  const { service, bindingOf, projectOf, autoBind, scopeParams } = kit
  return defineTool({
    name: 'library_quiz',
    description:
      'Store a quiz, then reply with one line — the learner answers in the sidebar. node = the station it tests (omit: a whole-textbook quiz; resource null: a free quiz). '
      + 'focus is the learner\'s choice: mine = only their cards; book = the chapter only; mixed = their cards, then the chapter. '
      + 'Every question names its point; quiz weak and untested points first, then practicing ones. '
      + 'Solve each question again before storing; fix any disagreement. choice: answer = the right option verbatim. fill: a short value (1/2), several blanks comma-separated, alternatives " / ". free: say what a good answer covers. '
      + 'Math only in $…$. The prompt carries no kind label or chapter reference. A material textbook needs quote (the page text). Replace voided (「这题有问题」) questions on the same points.',
    parameters: {
      ...scopeParams,
      resource: { type: 'json', description: 'The textbook (defaults to the binding\'s); null = a free quiz.' },
      node: { type: 'string', description: 'The quiz-gated station it gates.' },
      focus: { type: 'string', enum: ['mine', 'book', 'mixed'] },
      questions: {
        ...QUESTIONS_SCHEMA,
        required: true,
        description: 'The questions.',
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const questions = payloadList(args.questions)
      if (questions === undefined) {
        throw new Error(`library_quiz takes questions: [{ point, kind: "choice"|"fill"|"free", prompt, options?, answer, explanation?, quote? }] (+ node?, focus?) — ${arrival('questions', args.questions)}`)
      }
      const node = typeof args.node === 'string' && args.node !== '' ? args.node : undefined
      // An explicit null is a free quiz on no textbook; absent falls back to the binding's.
      const argsAny = args as Record<string, unknown>
      const resourceId = args.resource === null || argsAny.book === null ? undefined : pickString(args.resource, argsAny.book) ?? bindingOf(exec)?.resourceId
      // Options may arrive as { label } objects or a letter-keyed map —
      // the stored form is plain strings (the same tolerance reads them
      // back); the two axes default (topic + knowledge) and take the flat
      // cardIds / quote / url / pageId shorthands.
      const cleaned = (questions as Record<string, unknown>[]).map((raw, index) => {
        // The schema no longer rejects a question missing its id / kind / prompt /
        // answer (that refusal named no question); blanks reach the service's
        // per-question check, which names each one.
        const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
        // ids are numbered when the coach leaves them out (q1, q2…).
        let next: Record<string, unknown> = { ...raw, id: text(raw.id) === '' ? `q${index + 1}` : text(raw.id), kind: text(raw.kind), prompt: text(raw.prompt), answer: text(raw.answer) }
        if (next.options !== undefined) {
          const options = normalizeQuizOptions(next.options)
          if (options !== undefined) next = { ...next, options }
        }
        return normalizeQuestionAxes(next)
      })
      const projectId = projectOf(args.project, exec, resourceId)
      const written = unwrap(await service.putQuiz({
        projectId,
        quiz: {
          ...(args.focus === 'mine' || args.focus === 'book' || args.focus === 'mixed' ? { focus: args.focus } : {}),
          scope: { ...(resourceId === undefined ? {} : { resourceId }), ...(node === undefined ? {} : { nodeId: node }) },
          questions: cleaned as unknown as LibraryQuizQuestion[],
          ...(Array.isArray(argsAny.addPoints) ? { addPoints: argsAny.addPoints as { id: string; title: string }[] } : {}),
        },
      }))
      await autoBind(exec, { projectId, ...(resourceId === undefined ? {} : { resourceId }) })
      return written as unknown as JsonValue
    },
  })
}
