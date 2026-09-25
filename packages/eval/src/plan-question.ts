/**
 * The question block of a plan (dataseek.plan/1, v1-rev14): what the
 * experiment is run to answer, what the person expected, and what would
 * count as answered.
 *
 * Three pages read it — the design page's first block, the lab list's second
 * line, the conclusion card's first sentence — and all three read it through
 * this one function, so "a plan with no question" means the same thing on
 * each: none of the three fields says anything. A blank string is not a
 * statement; it reads as absent.
 * @module @khorsheed/dsh-eval/plan-question
 */

import type { EvalPlanQuestion } from './types.ts'

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text === '' ? null : text
}

/**
 * Read the question block off a plan document, structurally.
 * @param plan - the parsed plan (anything; an unreadable plan has no block).
 * @returns the block, or null when the plan says none of the three.
 */
export function planQuestionOf(plan: unknown): EvalPlanQuestion | null {
  if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) return null
  const document = plan as Record<string, unknown>
  const block: EvalPlanQuestion = {
    question: textOrNull(document['question']),
    expectation: textOrNull(document['expectation']),
    answeredWhen: textOrNull(document['answeredWhen']),
  }
  return block.question === null && block.expectation === null && block.answeredWhen === null ? null : block
}
