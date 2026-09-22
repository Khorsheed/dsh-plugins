/**
 * The named-question registry: the decisions this package knows how to ask,
 * with their thresholds, defined in ONE place so a tool and a code gate ask the
 * same question and a human reviews the wording and the cutoff together.
 *
 * Ids are for code only — the API never sees them, and the model never sees
 * them either: the instructions carry the whole meaning.
 * @module @khorsheed/dsh-typesafe/questions
 */

import type { QuestionSpec } from './types.ts'

/** One registered decision. */
export interface QuestionDefinition {
  /** The question body, minus the id the caller supplies. */
  readonly question: Omit<QuestionSpec, 'id'>
  /**
   * The cutoff a `noul` answer is compared against (`probability >= threshold`).
   * Tune it on your own data; the values here are starting points, not truths.
   */
  readonly threshold?: number
  /** Why this question exists and where it is meant to be consumed. */
  readonly note: string
}

/**
 * The registry. Add a decision here when a second consumer needs it — never
 * inline the same question at two call sites.
 */
export const QUESTION_REGISTRY = {
  NEEDS_REPLY: {
    question: {
      type: 'noul',
      instructions:
        'Does the latest information need an agent to reply? Answer yes only when a reply would add information '
        + 'or move work forward. Acknowledgements, emoji-only reactions, social noise, and remarks aimed at someone '
        + 'else are not enough.',
    },
    threshold: 0.5,
    note: 'Chat/room gate: whether an incoming message should wake a model turn at all.',
  },
  SHOULD_START_WORK: {
    question: {
      type: 'noul',
      instructions:
        'Does the latest information justify starting work now — writing or changing files, running commands, '
        + 'producing a deliverable — rather than only discussing, planning, or asking?',
    },
    threshold: 0.5,
    note: 'Chat/room gate: whether a member should begin executing work rather than keep talking.',
  },
} as const satisfies Record<string, QuestionDefinition>

/** Every registered id. */
export type QuestionId = keyof typeof QUESTION_REGISTRY

/** The registry's ids, in declaration order (mirrored by a test). */
export const QUESTION_IDS: readonly QuestionId[] = ['NEEDS_REPLY', 'SHOULD_START_WORK']

/** Whether a string names a registered question. */
export function isQuestionId(value: string): value is QuestionId {
  return Object.hasOwn(QUESTION_REGISTRY, value)
}

/** The full spec for a registered question, id included. */
export function questionSpec(id: QuestionId): QuestionSpec {
  const definition: QuestionDefinition = QUESTION_REGISTRY[id]
  return {
    id,
    type: definition.question.type,
    instructions: definition.question.instructions,
    ...definition.question.criteria === undefined ? {} : { criteria: definition.question.criteria },
  }
}

/** The registered cutoff, when the definition carries one. */
export function thresholdOf(id: QuestionId): number | undefined {
  return QUESTION_REGISTRY[id].threshold
}
