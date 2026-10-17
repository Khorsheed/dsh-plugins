/**
 * Quiz drafts: the learner's in-progress answers survive leaving the paper
 * (back to the station, a closed sidebar, a reload). Stored in localStorage
 * per quiz id — a draft is local by definition (never ledgered until 交卷),
 * so no host write is involved; the entry clears when the sitting lands.
 *
 * @module @khorsheed/dsh-library/client/quiz-drafts
 */

/** One question's saved state in the draft. */
export interface QuizDraftAnswer {
  readonly given: string
  /** Judged on the spot (choice / fill); open questions stay undefined. */
  readonly pass?: boolean
  readonly void?: boolean
}

/** One paper's in-progress sitting. */
export interface QuizDraft {
  readonly answers: Readonly<Record<string, QuizDraftAnswer>>
  /** Open-answer text not yet submitted. */
  readonly drafts: Readonly<Record<string, string>>
  readonly at: string
}

function keyOf(quizId: string): string {
  return `dsh-library:quiz-draft:${quizId}`
}

/** The saved sitting of one paper, when one parses. */
export function loadQuizDraft(quizId: string): QuizDraft | undefined {
  let raw: string | null
  try {
    raw = localStorage.getItem(keyOf(quizId))
  } catch {
    return undefined // storage blocked (private mode) — a draft is a nicety, never a failure
  }
  if (raw === null) return undefined
  try {
    const parsed = JSON.parse(raw) as QuizDraft
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.answers !== 'object' || parsed.answers === null) return undefined
    return parsed
  } catch {
    return undefined
  }
}

/** Save the sitting (every answer / keystroke; the write is a full replace). */
export function saveQuizDraft(quizId: string, draft: QuizDraft): void {
  try {
    localStorage.setItem(keyOf(quizId), JSON.stringify(draft))
  } catch {
    // Quota or privacy mode — the sitting stays in memory for this mount.
  }
}

/** Drop the draft (the sitting landed, or the paper was superseded under it). */
export function clearQuizDraft(quizId: string): void {
  try {
    localStorage.removeItem(keyOf(quizId))
  } catch {
    // As above.
  }
}
