/**
 * The library's domain vocabulary: projects, books, roadmaps, the vocab book,
 * quizzes and attempts. Everything here is plain serializable data — the store
 * (`store.ts`) persists exactly these shapes under
 * `$DSH_HOME/state/dsh-library/`, and the Remote face (`remote.ts`) and the
 * model tools (`tool-definition.ts`) both speak them.
 *
 * The shapes follow the proposal `2026-10-06-library-learning-mode`:
 *
 * - a ROADMAP is a Duolingo-style path of nodes whose state machine has three
 *   edges only (`locked → current → done`);
 * - a VOCAB entry is a flashcard (or a key point) whose `mastery` is a Leitner
 *   box (0–5) plus a `dueAt`, and whose `source` is a photo reference into the
 *   host's attachment store, a manual entry, or the model's own read;
 * - a QUIZ gates on evidence: every question carries the chapter it came from
 *   and the original-text fragment it is graded against;
 * - an ATTEMPT's verdicts reuse the eval family's `dataseek.verdict/1` shape
 *   (`{task, criterion, pass, ratio?, evidence, by}`), so a future datasets
 *   migration is a shape-preserving move.
 *
 * @module @khorsheed/dsh-library/types
 */

/** The state-root directory name under `$DSH_HOME/state`. */
export const STATE_ROOT_SEGMENT = 'dsh-library'

/** The on-disk schema version of `state.json` and `project.json` documents. */
export const LIBRARY_STATE_VERSION = 1

/** The Leitner intervals in days, indexed by box (box 5 reuses the last rung). */
export const LEITNER_INTERVAL_DAYS: readonly number[] = [1, 2, 4, 7, 15]

/** The highest Leitner box. */
export const MAX_BOX = 5

/** The default node pass threshold (a quiz ratio at or above it completes the node). */
export const DEFAULT_PASS_RATIO = 0.8

/**
 * The chapter-body paging budget, in characters: one `getChapterBody` page
 * never carries more than this. The page slices at a closing-tag boundary when
 * one exists inside the window, so a page never opens mid-tag.
 */
export const CHAPTER_PAGE_BUDGET = 100 * 1024

/** A refusal's code vocabulary — the values the client and the tools switch on. */
export type LibraryErrorCode =
  | 'not-found'
  | 'exists'
  | 'invalid'
  | 'corrupt'
  | 'io'
  | 'storage-unavailable'
  | 'evidence-gate'
  | 'state-machine'
  | 'unavailable'
  | 'ref-incomplete'

/** A domain refusal (never a throw across the Remote wire). */
export interface LibraryRefusal {
  readonly ok: false
  readonly error: LibraryErrorCode
  /** The human/model-readable reason, written to teach the correct call. */
  readonly message: string
}

/** The outcome every mutating verb answers. */
export type LibraryOutcome<T> = ({ readonly ok: true } & T) | LibraryRefusal

/* ------------------------------------------------------------- projects */

/** One learning project (e.g. 「神经科学」). */
export interface LibraryProject {
  readonly id: string
  readonly name: string
  readonly domain?: string
  readonly createdAt: string
}

/** The project wall's row: the project plus its cheap aggregates. */
export interface LibraryProjectSummary extends LibraryProject {
  /** Book ids, in shelving order. */
  readonly books: readonly string[]
  /** Vocab entries the project holds. */
  readonly vocabCount: number
  /** Vocab entries due for review right now. */
  readonly dueCount: number
  /** Roadmap progress, when a roadmap exists. */
  readonly roadmap?: { readonly done: number; readonly total: number }
  /** The current node's title and its book's, when one is in progress. */
  readonly current?: { readonly bookTitle: string; readonly nodeTitle: string }
}

/* ---------------------------------------------------------------- books */

/** Where a book came from. The upload's ref is the original file name. */
export interface LibraryBookSource {
  readonly kind: 'upload' | 'url'
  readonly ref: string
}

/** One chapter's table-of-contents row (the body stays in `chapters/<n>.html`). */
export interface LibraryTocEntry {
  /** The 1-based chapter number — also its file name (`chapters/<n>.html`). */
  readonly n: number
  readonly title: string
  /** The stored body's length in characters (the reader's paging math). */
  readonly chars: number
}

/** A book's metadata (`books/<id>/book.json`); bodies are externalized. */
export interface LibraryBook {
  readonly id: string
  readonly title: string
  readonly author?: string
  readonly source: LibraryBookSource
  readonly format: 'epub' | 'md'
  readonly toc: readonly LibraryTocEntry[]
  readonly createdAt: string
}

/* ------------------------------------------------------------- roadmaps */

/** The three node states; the only legal edges are locked→current→done. */
export type RoadmapNodeState = 'locked' | 'current' | 'done'

/**
 * What kind of learning a node carries. `quiz` nodes gate on an assessed quiz
 * at the pass ratio; `read` nodes (front matter, the whole-book map,
 * appendices — the coach classifies at split time) carry no quiz gate: they
 * complete by being read (the reader's 「读完」 gesture or the model's call),
 * and never hold quizStats.
 */
export type RoadmapNodeKind = 'quiz' | 'read'

/** A chapter span one node covers, 1-based and inclusive (`chapters/<from..to>.html`). */
export interface LibraryChapterRange {
  readonly from: number
  readonly to: number
}

/** A node's quiz ledger, updated by every assessed attempt that names it. */
export interface LibraryQuizStats {
  readonly attempts: number
  /** The newest attempt's pass ratio, when one exists. */
  readonly lastRatio?: number
  /** The best ratio ever reached. */
  readonly bestRatio?: number
}

/** One roadmap node. */
export interface RoadmapNode {
  readonly id: string
  readonly title: string
  /** What the learner should be able to do after this node. */
  readonly goals: readonly string[]
  /** Node ids that must be `done` before this one may leave `locked`. */
  readonly dependsOn: readonly string[]
  readonly chapterRanges: readonly LibraryChapterRange[]
  readonly state: RoadmapNodeState
  /** `quiz` gates on an assessed quiz; `read` completes by being read. */
  readonly kind: RoadmapNodeKind
  /** Quiz nodes only — a read node must never carry one. */
  readonly quizStats?: LibraryQuizStats
}

/** A book's roadmap (`roadmap.json`). */
export interface LibraryRoadmap {
  readonly bookId: string
  readonly nodes: readonly RoadmapNode[]
  /** The pass threshold for this roadmap (default {@link DEFAULT_PASS_RATIO}). */
  readonly passRatio?: number
  readonly generatedAt: string
}

/* ---------------------------------------------------------------- vocab */

/** A photo source carries the host attachment's durable reference fields — the
 * photo is never copied (the attachment store is content-addressed), and the
 * full reference is what `attachments.readImage` verifies against. */
export interface LibraryVocabSource {
  readonly kind: 'photo' | 'manual' | 'model'
  readonly attachmentId?: string
  readonly mediaType?: string
  readonly bytes?: number
  readonly width?: number
  readonly height?: number
}

/** One flashcard's mastery: the Leitner box, the next review moment, the streak. */
export interface LibraryMastery {
  /** 0–5; a wrong verdict resets to 0, a right one climbs by one (capped). */
  readonly box: number
  /** ISO timestamp; `dueVocab` answers entries whose dueAt is not in the future. */
  readonly dueAt: string
  /** Consecutive right verdicts. */
  readonly streak: number
}

/** One vocab-book entry (a `vocab.jsonl` line). */
export interface LibraryVocabEntry {
  readonly id: string
  readonly kind: 'vocab' | 'keypoint'
  readonly term: string
  /** The gloss / the point itself. */
  readonly note: string
  /** The sentence it was met in, when the source gave one. */
  readonly context?: string
  /** The chapter it belongs to (the skill's `ch:<n>` convention). */
  readonly chapterRef: string
  readonly source: LibraryVocabSource
  readonly mastery: LibraryMastery
  readonly createdAt: string
}

/* --------------------------------------------------------------- quizzes */

/** One quiz question. `chapterRef` + `evidence` are the evidence gate's demand. */
export interface LibraryQuizQuestion {
  readonly id: string
  /** `choice` carries options; `fill`/`free` are open answers. */
  readonly kind: 'choice' | 'fill' | 'free'
  readonly prompt: string
  readonly options?: readonly string[]
  /** The chapter this question tests (`ch:<n>`). */
  readonly chapterRef: string
  /** The original-text fragment the answer is graded against — never invented. */
  readonly evidence: string
  readonly answer: string
  /** Vocab entries this question probes (the assess cascade's targets). */
  readonly vocabIds?: readonly string[]
}

/** A stored quiz (`quizzes/<id>.json`). */
export interface LibraryQuiz {
  readonly id: string
  readonly scope: {
    readonly bookId: string
    /** The roadmap node this quiz gates, when it is a node quiz. */
    readonly nodeId?: string
  }
  readonly questions: readonly LibraryQuizQuestion[]
  readonly createdAt: string
}

/** One graded answer, the eval family's `dataseek.verdict/1` shape. */
export interface LibraryVerdict {
  /** The question id this verdict judges. */
  readonly task: string
  /** What was judged, in one line. */
  readonly criterion: string
  readonly pass: boolean
  /** A partial-credit ratio, when the grader gives one (defaults to pass ? 1 : 0). */
  readonly ratio?: number
  /** The evidence the judgment leaned on. */
  readonly evidence: string
  readonly by: 'llm' | 'self' | 'user'
}

/** One graded sitting (`attempts.jsonl` line). */
export interface LibraryAttempt {
  readonly id: string
  readonly quizId: string
  readonly verdicts: readonly LibraryVerdict[]
  /** passed verdicts / total (ratios averaged), the node's unlock input. */
  readonly ratio: number
  readonly at: string
}

/** What an assess call changed, reported back to the caller. */
export interface LibraryAssessResult {
  readonly attempt: LibraryAttempt
  /** Vocab entries whose mastery moved (id → new mastery). */
  readonly vocabUpdates: readonly { readonly id: string; readonly mastery: LibraryMastery }[]
  /** Nodes that left `locked` because of this attempt. */
  readonly unlocked: readonly string[]
  /** The node this quiz gated, when it completed. */
  readonly completed?: string
}

/* --------------------------------------------------------------- events */

/** The audit ledger's event types (`events.jsonl`, append-only). */
export type LibraryEventType =
  | 'book.ingested'
  | 'roadmap.generated'
  | 'roadmap.regenerated'
  | 'notes.recorded'
  | 'quiz.created'
  | 'attempt.assessed'
  | 'node.completed'
  | 'node.unlocked'

/** One event: a timestamp, a type, and a small typed summary per type. */
export interface LibraryEvent {
  readonly at: string
  readonly type: LibraryEventType
  /** The object the event is about (a book / quiz / node id), when one applies. */
  readonly id?: string
  /** Its display name (book title / node title), so a reader needs no join. */
  readonly title?: string
  /** Small numeric summaries (chapters / questions / added+merged / percent). */
  readonly count?: number
  readonly count2?: number
  /** attempt.assessed: the sitting's ratio; node.completed: the passing ratio. */
  readonly ratio?: number
}

/** The event vocabulary, for tests and for writers who must not invent types. */
export const LIBRARY_EVENT_TYPES: readonly LibraryEventType[] = [
  'book.ingested',
  'roadmap.generated',
  'roadmap.regenerated',
  'notes.recorded',
  'quiz.created',
  'attempt.assessed',
  'node.completed',
  'node.unlocked',
]

/* ------------------------------------------------------------- id minting */

/** Ids become path segments — keep them inside a safe alphabet (mission rule). */
export const LIBRARY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Whether an id is usable as a path segment. */
export function isLibraryId(id: string): boolean {
  return LIBRARY_ID_PATTERN.test(id)
}

/**
 * The chapterRef convention the skill teaches: `ch:<n>` with the 1-based
 * chapter number (a section suffix is allowed: `ch:3.2`). The chapter number
 * it names, or undefined when the ref is off-convention.
 */
export function chapterOfRef(ref: string): number | undefined {
  const match = /^ch:(\d+)(?:\.\d+)*$/.exec(ref.trim())
  return match === null ? undefined : Number(match[1])
}

/** A native fs failure's message, with its code, for the wire. */
export function libraryErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}
