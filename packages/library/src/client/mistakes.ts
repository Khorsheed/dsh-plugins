/**
 * The mistake ledger's shared read: every quiz's latest sitting (attempts
 * arrive newest first), and the failed or flagged questions off it. One
 * collection, three filters — the station's 错题 list, its 其他站 shelf and
 * the project page's entry count are the same rows scoped differently, so
 * the two views can never disagree about what counts as missed.
 *
 * @module @khorsheed/dsh-library/client/mistakes
 */
import type { LibraryAssessment, LibraryAttempt, LibraryQuizQuestion, LibraryVerdict } from '../types.ts'

/** One failed (or flagged) question off a paper's latest sitting. */
export interface MissedRow {
  readonly quiz: LibraryAssessment
  readonly question: LibraryQuizQuestion
  readonly at: string
}

/** The rows one predicate collects: each quiz contributes its newest sitting only. */
function latestSittingRows(attempts: readonly LibraryAttempt[], quizzes: readonly LibraryAssessment[], keep: (verdict: LibraryVerdict) => boolean): MissedRow[] {
  const byId = new Map(quizzes.map(quiz => [quiz.id, quiz]))
  const seen = new Set<string>()
  const rows: MissedRow[] = []
  for (const attempt of attempts) {
    const quiz = byId.get(attempt.assessmentId ?? '')
    if (quiz === undefined || seen.has(quiz.id)) continue
    seen.add(quiz.id)
    for (const verdict of attempt.verdicts) {
      if (!keep(verdict)) continue
      const question = quiz.questions?.find(candidate => candidate.id === verdict.task)
      if (question !== undefined) rows.push({ quiz, question, at: attempt.at })
    }
  }
  return rows
}

/** Every failed, non-voided question — pass the project's quizzes for the cross-station shelf, one station's for its own list. */
export function collectMissed(attempts: readonly LibraryAttempt[], quizzes: readonly LibraryAssessment[]): MissedRow[] {
  return latestSittingRows(attempts, quizzes, verdict => !verdict.pass && verdict.void !== true)
}

/** Every question the learner flagged 「这题有问题」 (void — counted for nothing). */
export function collectVoided(attempts: readonly LibraryAttempt[], quizzes: readonly LibraryAssessment[]): MissedRow[] {
  return latestSittingRows(attempts, quizzes, verdict => verdict.void === true)
}
