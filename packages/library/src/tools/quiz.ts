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
      'Store a composed quiz; then reply with ONE line — the learner answers in the sidebar\'s 章节考 tab, never in the conversation. '
      + 'Scope: node = the quiz-gated station it gates; no node = a textbook-level quiz (本书测验); resource null = a free quiz (自由测验). '
      + 'focus is the learner\'s choice and binds you — mine: only their cards (too few: fewer questions, say so); book: the chapter\'s content only; mixed: their cards first (weakest first), then the chapter. '
      + 'Points: every question names the station point it probes (point); a full chapter quiz touches every point, a retake only the missed ones; a genuine gap in the split goes in addPoints. '
      + 'Evidence: a photographed page\'s text, else a web quote + url, else domain knowledge (say so) — the book beats your memory; a material textbook never takes a content question from memory. '
      + 'Authoring: choice — compose the correct option first and copy it into answer verbatim; fill — only a short answer (term, name, number, formula, date), judged on the spot by text or by value (1/2 = 0.5 = \\frac{1}{2}); several blanks go comma-separated in the order the prompt asks; alternatives are joined with " / " (spaced) — never a bare slash, which is a fraction; free — the prompt locates the passage (quote it). '
      + 'Math only inside $…$ / $$…$$ ($\\sqrt{x+1}$, never √(x+1) or x^2). The prompt stays clean: no kind label, no chapter reference, no recipe (that is explanation). '
      + 'Questions the learner flagged 「这题有问题」 are void — offer replacements on the same points.',
    parameters: {
      ...scopeParams,
      resource: { type: 'json', description: 'The textbook (defaults to the binding\'s); null = a free quiz on no textbook.' },
      node: { type: 'string', description: 'The quiz-gated station it gates.' },
      focus: { type: 'string', enum: ['mine', 'book', 'mixed'], description: 'The learner\'s choice of source.' },
      addPoints: { type: 'array', description: 'New points for the gated station (a genuine gap only).', items: { type: 'object', additionalProperties: true, properties: {
        id: { type: 'string', required: true },
        title: { type: 'string', required: true },
      } } },
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
        throw new Error(`library_quiz takes the questions field: questions: [{ id, kind: "choice"|"fill"|"free", prompt, options?, answer, explanation?, target?, evidence? }] (+ node?, focus?) — ${arrival('questions', args.questions)}`)
      }
      const node = typeof args.node === 'string' && args.node !== '' ? args.node : undefined
      // An explicit null is a free quiz on no textbook; absent falls back to the binding's.
      const argsAny = args as Record<string, unknown>
      const resourceId = args.resource === null || argsAny.book === null ? undefined : pickString(args.resource, argsAny.book) ?? bindingOf(exec)?.resourceId
      // Options may arrive as { label } objects or a letter-keyed map —
      // the stored form is plain strings (the same tolerance reads them
      // back); the two axes default (topic + knowledge) and take the flat
      // cardIds / quote / url / pageId shorthands.
      const cleaned = (questions as Record<string, unknown>[]).map(raw => {
        // The schema no longer rejects a question missing its id / kind / prompt /
        // answer (that refusal named no question); blanks reach the service's
        // per-question check, which names each one.
        const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
        let next: Record<string, unknown> = { ...raw, id: text(raw.id), kind: text(raw.kind), prompt: text(raw.prompt), answer: text(raw.answer) }
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
          ...(Array.isArray(args.addPoints) ? { addPoints: args.addPoints as { id: string; title: string }[] } : {}),
        },
      }))
      await autoBind(exec, { projectId, ...(resourceId === undefined ? {} : { resourceId }) })
      return written as unknown as JsonValue
    },
  })
}
