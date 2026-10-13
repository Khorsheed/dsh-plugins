/**
 * The library's domain vocabulary: projects, books, per-book roadmaps, photo
 * pages, knowledge cards, quizzes, attempts and session bindings. Everything
 * here is plain serializable data — the store (`store.ts`) persists exactly
 * these shapes under `$DSH_HOME/state/dsh-library/`, and the Remote face
 * (`remote.ts`) and the model tools (`tool-definition.ts`) both speak them.
 *
 * The shapes follow the proposal `2026-10-06-library-learning-mode` (v2):
 *
 * - a BOOK is registered, never uploaded: title, edition, kind and a table of
 *   contents the coach verified on the web (or took from a photo);
 * - a RESOURCE is a light link entry on the project's shelf, beside the books:
 *   title, url, kind and the coach's one-line why — no contents, no roadmap,
 *   never quizzed (what you reference BY CHAPTER is registered as a book);
 * - a ROADMAP belongs to one book; the coach writes DRAFTS, the learner adopts
 *   one, and the adopted path's state machine has three edges only
 *   (`locked → current → done`);
 * - a PAGE is one photographed page: its recognized text plus the marks the
 *   learner made (underlines, margin notes);
 * - a CARD (知识卡片) is the learner's own memory: a word or a concept met in a
 *   photo, asked about in a chat, or missed in a quiz — one card per thing,
 *   sources stacked, with a weakness score (0–3) beside its Leitner mastery;
 * - a QUIZ question carries two axes: what it targets (marked / asked /
 *   missed cards, or the chapter's topic) and what it rests on (a photo
 *   quote, a web quote, or domain knowledge);
 * - an ATTEMPT's verdicts reuse the eval family's `dataseek.verdict/1` shape.
 *
 * @module @khorsheed/dsh-library/types
 */

/** The state-root directory name under `$DSH_HOME/state`. */
export const STATE_ROOT_SEGMENT = 'dsh-library'

/**
 * The on-disk schema version of `state.json`. v1 (uploaded books, project
 * roadmaps, the vocab book) was never deployed; a v1 root reads as empty.
 */
export const LIBRARY_STATE_VERSION = 2

/** The Leitner intervals in days, indexed by box (box 5 reuses the last rung). */
export const LEITNER_INTERVAL_DAYS: readonly number[] = [1, 2, 4, 7, 15]

/** The highest Leitner box. */
export const MAX_BOX = 5

/** The highest weakness score (three bars in the UI). */
export const MAX_WEAKNESS = 3

/** The default node pass threshold (a quiz ratio at or above it completes the node). */
export const DEFAULT_PASS_RATIO = 0.8

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
  | 'unbound'

/** A domain refusal (never a throw across the Remote wire). */
export interface LibraryRefusal {
  readonly ok: false
  readonly error: LibraryErrorCode
  /** The human/model-readable reason, written to teach the correct call. */
  readonly message: string
}

/** The outcome every mutating verb answers. */
export type LibraryOutcome<T> = ({ readonly ok: true } & T) | LibraryRefusal

/* --------------------------------------------------------- capabilities */

/**
 * Capability handshake: what a client may rely on in this composition. A
 * read-only DISPLAY contract — enforcement stays at the write gates
 * (`storage-unavailable` / `unavailable` refusals), exactly as before. The
 * shape evolves additively only: new fields are always optional, so a
 * consumer written against protocolVersion 1 keeps working (the reader's
 * ReaderCapabilities rule).
 */
export interface LibraryCapabilities {
  readonly protocolVersion: 1
  /** Whether the state root accepts writes; when false every write refuses `storage-unavailable`. */
  readonly hasStorage: boolean
  /** Why persistence is unavailable, when it is (the store's probe message). */
  readonly storageUnavailableReason?: string
  /** Whether an attachment store is mounted on the Context; when false the image routes refuse `unavailable`. */
  readonly hasAttachments: boolean
}

/* ------------------------------------------------------------- projects */

/**
 * What a project's marks mean. `language`: an underline is a word or phrase,
 * quizzed by meaning-in-context, paraphrase and spelling; `subject`: an
 * underline is a concept, quizzed by explanation, contrast and application;
 * `custom`: the learner said how (in `templateNote`).
 */
export type LibraryTemplate = 'language' | 'subject' | 'custom'

/** What editing a project may change; an empty goal clears it. */
export interface LibraryProjectPatch {
  readonly name?: string
  readonly goal?: string
  readonly template?: LibraryTemplate
  readonly color?: LibraryColor
  readonly icon?: LibraryIcon
}

/** The preset project colors (the sidebar maps each to a light and a dark tone). */
export const LIBRARY_COLORS = ['ember', 'amber', 'moss', 'teal', 'sky', 'indigo', 'plum', 'rose'] as const
export type LibraryColor = typeof LIBRARY_COLORS[number]

/** The preset project icons. */
export const LIBRARY_ICONS = ['globe', 'brain', 'book', 'flask', 'atom', 'leaf', 'pen', 'music', 'scale', 'chart', 'code', 'compass'] as const
export type LibraryIcon = typeof LIBRARY_ICONS[number]

/** A template's default look, until the learner picks another. */
export const TEMPLATE_LOOK: Readonly<Record<LibraryTemplate, { color: LibraryColor; icon: LibraryIcon }>> = {
  language: { color: 'ember', icon: 'globe' },
  subject: { color: 'indigo', icon: 'brain' },
  custom: { color: 'teal', icon: 'compass' },
}

/** One learning project (e.g. 「神经科学」). */
export interface LibraryProject {
  readonly id: string
  readonly name: string
  readonly template: LibraryTemplate
  readonly color?: LibraryColor
  readonly icon?: LibraryIcon
  /** The learner's own words for a custom template. */
  readonly templateNote?: string
  /** The learner's goal (「学术类 7 分，12 月 14 日」). */
  readonly goal?: string
  readonly createdAt: string
}

/** One book's row on the project page. */
export interface LibraryBookProgress {
  readonly id: string
  readonly title: string
  /** Adopted-roadmap progress; absent while the book has no adopted path. */
  readonly roadmap?: { readonly done: number; readonly total: number }
  /** The first current node, when one is in progress. */
  readonly current?: { readonly id: string; readonly title: string }
  /** A draft is waiting for the learner's 采用. */
  readonly hasDraft: boolean
}

/** The project list's row: the project plus its cheap aggregates. */
export interface LibraryProjectSummary extends LibraryProject {
  readonly books: readonly LibraryBookProgress[]
  /** Live cards (not deleted). */
  readonly cardCount: number
  /** Live, unmastered cards due for review right now. */
  readonly dueCount: number
  /** When anything last happened in the project (its newest event, else its creation) — the list sorts by it. */
  readonly lastActiveAt: string
}

/* ---------------------------------------------------------------- books */

/**
 * What a book's content IS. `knowledge` (textbooks, popular science): the
 * content is domain knowledge, so the coach may quiz from what it knows.
 * `material` (exam papers, novels, anthologies): the content is specific
 * text the model cannot recall — quizzing the book's content needs a photo
 * or a web quote.
 */
export type LibraryBookKind = 'knowledge' | 'material'

/** One table-of-contents row. */
export interface LibraryTocEntry {
  /** 1-based position — what roadmap chapter ranges count. */
  readonly n: number
  readonly title: string
  /** The part / test / unit it sits under, when the book groups chapters. */
  readonly part?: string
}

/** Where the table of contents came from — shown on the roadmap draft card. */
export interface LibraryTocSource {
  readonly by: 'web' | 'model' | 'photo'
  readonly url?: string
  readonly verifiedAt?: string
}

/**
 * Something in the book worth knowing but not worth a stop on the path —
 * how to use the book, the answer key, transcripts, appendices. Shown in the
 * book page's 「开始前 / 附录」 strip.
 */
export interface LibraryBookExtra {
  readonly title: string
  /** One line from the coach: what it is for. */
  readonly note?: string
  /** Where it is in the book (「p.152」). */
  readonly where?: string
  readonly when: 'before' | 'reference'
}

/** A registered book (`books/<id>/book.json`). No body is ever stored. */
export interface LibraryBook {
  readonly id: string
  readonly title: string
  /** The cover's abbreviation (「剑5」「PNS」); derived from the title when absent. */
  readonly short?: string
  readonly extras?: readonly LibraryBookExtra[]
  readonly author?: string
  readonly edition?: string
  readonly isbn?: string
  readonly bookKind: LibraryBookKind
  readonly toc: readonly LibraryTocEntry[]
  readonly tocSource: LibraryTocSource
  readonly createdAt: string
}

/* ------------------------------------------------------------ resources */

/** What a shelf link IS: the shape of the thing its url points at. */
export const LIBRARY_RESOURCE_KINDS = ['article', 'video', 'repo', 'tool', 'course', 'hardware'] as const
export type LibraryResourceKind = typeof LIBRARY_RESOURCE_KINDS[number]

/**
 * One link entry on a project's shelf (`resources.jsonl` line), beside the
 * books: something the learner opens in the browser — an article, a video, a
 * repo, a tool, a course, a piece of hardware. A resource has no contents, no
 * roadmap and never enters the quiz axis.
 */
export interface LibraryResource {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly kind: LibraryResourceKind
  /** The coach's one line: why it is on the shelf (「热身站的读物，只看两节」). */
  readonly note?: string
  /** Who put it there. */
  readonly addedBy: 'coach' | 'learner'
  readonly createdAt: string
}

/* ------------------------------------------------------------- roadmaps */

/** The three node states; the only legal edges are locked→current→done. */
export type RoadmapNodeState = 'locked' | 'current' | 'done'

/**
 * What kind of learning a node carries. `quiz` nodes are the path's levels:
 * they gate on an assessed quiz at the pass ratio. `read` nodes are side
 * stops (an overview chapter worth reading, not testing): always open,
 * complete by 「读完」, and never a dependency of a level. How-to-use pages,
 * answer keys and appendices are not nodes at all — they are book extras.
 */
export type RoadmapNodeKind = 'quiz' | 'read'

/** A table-of-contents span one node covers, 1-based and inclusive. */
export interface LibraryChapterRange {
  readonly from: number
  readonly to: number
}

/** A node's quiz ledger, updated by every assessed attempt that names it. */
export interface LibraryQuizStats {
  readonly attempts: number
  readonly lastRatio?: number
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
  readonly kind: RoadmapNodeKind
  /** Quiz nodes only — a read node never carries one. */
  readonly quizStats?: LibraryQuizStats
}

/** A book's roadmap — the adopted path (`roadmap.json`) or a draft (`roadmap.draft.json`). */
export interface LibraryRoadmap {
  readonly bookId: string
  readonly status: 'draft' | 'adopted'
  readonly nodes: readonly RoadmapNode[]
  /** The pass threshold (default {@link DEFAULT_PASS_RATIO}). */
  readonly passRatio?: number
  /** The coach's one-line pacing note on the draft card (「每周 3 章，约 4 周」). */
  readonly note?: string
  readonly generatedAt: string
  readonly adoptedAt?: string
}

/* ---------------------------------------------------------------- pages */

/**
 * A host attachment's durable reference — the photo is never copied (the
 * attachment store is content-addressed), and these fields are what
 * `attachments.readImage` verifies against.
 */
export interface LibraryAttachmentRef {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
}

/** One mark the learner made on a page. */
export interface LibraryMark {
  /** The underlined word / phrase / concept, as printed. */
  readonly text: string
  /** The sentence it sits in, as printed. */
  readonly sentence?: string
  /** The learner's handwritten gloss beside it, transcribed. */
  readonly handNote?: string
  /** The recognizer's in-context meaning (a word) or one-line explanation (a concept). */
  readonly gloss?: string
  /** The recognizer could not tell (a strike-through? a stray line?) — never auto-carded. */
  readonly uncertain?: boolean
}

/** One photographed page (a `pages.jsonl` line under its book). */
export interface LibraryPage {
  readonly id: string
  readonly bookId: string
  readonly nodeId?: string
  /** What the learner calls it (「p.16」). */
  readonly label?: string
  readonly attachment: LibraryAttachmentRef
  /** The page's recognized printed text — a photo-evidence quote is checked against it. */
  readonly text: string
  readonly marks: readonly LibraryMark[]
  /** The cards this page's marks became or merged into. */
  readonly cardIds: readonly string[]
  readonly at: string
}

/* ---------------------------------------------------------------- cards */

/** A card is a word (language projects) or a concept (anything else). */
export type LibraryCardKind = 'word' | 'concept'

/** Where a card's evidence of weakness came from. */
export type LibraryCardSourceType = 'photo' | 'chat' | 'quiz' | 'manual'

/** One source stacked on a card. */
export interface LibraryCardSource {
  readonly type: LibraryCardSourceType
  /** photo: the page id; quiz: the quiz id; chat: the session id when known. */
  readonly ref?: string
  /** What happened, in a few words (「说老是记混」「T/F/NG 第 9 题」). */
  readonly note?: string
  /** This source raised the weakness by one (an undo lowers it back). */
  readonly weakened?: boolean
  readonly at: string
}

/** One sentence the card was met in. */
export interface LibraryCardContext {
  readonly sentence: string
  readonly bookId?: string
  readonly pageId?: string
  readonly nodeId?: string
}

/** One card's review mastery: the Leitner box, the next review moment, the streak. */
export interface LibraryMastery {
  readonly box: number
  readonly dueAt: string
  readonly streak: number
}

/** One knowledge card (知识卡片). */
export interface LibraryCard {
  readonly id: string
  readonly kind: LibraryCardKind
  readonly term: string
  /** Other spellings / names the same card answers to (instalments, 不应期). */
  readonly aliases: readonly string[]
  /** The meaning: the in-context sense for a word, a one-line explanation for a concept. */
  readonly gloss: string
  /** The learner's own handwritten gloss, kept apart from the model's. */
  readonly userGloss?: string
  readonly contexts: readonly LibraryCardContext[]
  /** Hung on a book when it came from one; absent = project-level (「不挂书」). */
  readonly bookId?: string
  readonly sources: readonly LibraryCardSource[]
  /** 0–3: how often the learner got stuck here (asked again, answered wrong). */
  readonly weakness: number
  readonly mastery: LibraryMastery
  readonly status: 'active' | 'mastered' | 'deleted'
  readonly createdAt: string
  readonly updatedAt: string
}

/** One card to record — the shared input of `library_write · cards` and `page`. */
export interface LibraryCardInput {
  readonly kind: LibraryCardKind
  readonly term: string
  readonly aliases?: readonly string[]
  readonly gloss: string
  readonly userGloss?: string
  readonly context?: { readonly sentence: string; readonly pageId?: string; readonly nodeId?: string }
  readonly source: { readonly type: LibraryCardSourceType; readonly ref?: string; readonly note?: string }
  /** Hang it on this book (defaults to the call's book, when one applies). */
  readonly bookId?: string
  /** The learner showed they are stuck: raise weakness by one. */
  readonly weaken?: boolean
  /** Decide a near-duplicate: merge into this existing card … */
  readonly mergeInto?: string
  /** … or keep it as a new card on purpose. */
  readonly asNew?: boolean
}

/** A card the store did not write because it looks like an existing one. */
export interface LibraryCardPending {
  readonly index: number
  readonly term: string
  readonly candidates: readonly { readonly id: string; readonly term: string; readonly gloss: string }[]
}

/** What a card write did. */
export interface LibraryCardWriteResult {
  readonly added: readonly LibraryCard[]
  readonly merged: readonly LibraryCard[]
  /** Near-duplicates held back — resend each with mergeInto or asNew. */
  readonly pending: readonly LibraryCardPending[]
}

/** The filters `listCards` (the sidebar and `library_read · cards`) understands. */
export interface LibraryCardQuery {
  readonly projectId: string
  readonly query?: string
  readonly bookId?: string
  /** Cards met in this node (a context or a source page on it). */
  readonly nodeId?: string
  readonly kind?: LibraryCardKind
  readonly source?: LibraryCardSourceType
  readonly weakMin?: number
  readonly due?: boolean
  /** Include mastered cards (default: active only). */
  readonly includeMastered?: boolean
  readonly limit?: number
  /** `weak` (default): weakness, then due date; `recent`: newest first; `due`: due date. */
  readonly sort?: 'weak' | 'recent' | 'due'
}

/** A learner's self-rating on a review flashcard. */
export type LibraryReviewRating = 'forgot' | 'fuzzy' | 'recalled'

/* --------------------------------------------------------------- quizzes */

/** What a question aims at. */
export interface LibraryQuestionTarget {
  readonly kind: 'marked' | 'asked' | 'missed' | 'topic'
  /** The cards it probes (required for marked / asked / missed). */
  readonly cardIds?: readonly string[]
}

/** What a question rests on. */
export interface LibraryQuestionEvidence {
  readonly kind: 'photo' | 'web' | 'knowledge'
  /** photo: the page whose text holds the quote. */
  readonly pageId?: string
  /** web: where the quote is from. */
  readonly url?: string
  /** photo / web: the passage, verbatim. */
  readonly quote?: string
}

/** One quiz question. */
export interface LibraryQuizQuestion {
  readonly id: string
  /** `choice` carries options; `fill` / `free` are open answers. */
  readonly kind: 'choice' | 'fill' | 'free'
  readonly prompt: string
  readonly options?: readonly string[]
  readonly answer: string
  /** Why the answer is right — shown after answering. */
  readonly explanation?: string
  readonly target: LibraryQuestionTarget
  readonly evidence: LibraryQuestionEvidence
}

/**
 * Where a quiz's questions may come from, as the learner chose it: `mine` —
 * only the learner's own cards (marked, asked, missed); `book` — only the
 * chapter's content; `mixed` — both.
 */
export type LibraryQuizFocus = 'mine' | 'book' | 'mixed'

/** A stored quiz (`quizzes/<id>.json`). */
export interface LibraryQuiz {
  readonly id: string
  readonly scope: {
    readonly bookId: string
    /** The roadmap node this quiz gates, when it is a node quiz. */
    readonly nodeId?: string
  }
  /** The learner's chosen source (absent on quizzes stored before the choice existed = mixed). */
  readonly focus?: LibraryQuizFocus
  readonly questions: readonly LibraryQuizQuestion[]
  readonly createdAt: string
}

/** One graded answer, the eval family's `dataseek.verdict/1` shape (+ the void flag). */
export interface LibraryVerdict {
  /** The question id this verdict judges. */
  readonly task: string
  readonly criterion: string
  readonly pass: boolean
  /** Partial credit (defaults to pass ? 1 : 0). */
  readonly ratio?: number
  readonly evidence: string
  readonly by: 'llm' | 'self' | 'user'
  /** The learner flagged the question as broken (「这题有问题」): it counts for nothing. */
  readonly void?: boolean
  /** A missed question with no target card: the card to create for it. */
  readonly missedCard?: { readonly term: string; readonly gloss: string }
}

/** One graded sitting (`attempts.jsonl` line). */
export interface LibraryAttempt {
  readonly id: string
  readonly quizId: string
  readonly verdicts: readonly LibraryVerdict[]
  /** Credit over the non-void verdicts — the node's unlock input. */
  readonly ratio: number
  readonly at: string
}

/** One card a sitting changed. */
export interface LibraryCardUpdate {
  readonly id: string
  readonly term: string
  readonly weakness: number
  readonly mastery: LibraryMastery
  readonly created?: boolean
}

/** What an assess call changed, reported back to the caller. */
export interface LibraryAssessResult {
  readonly attempt: LibraryAttempt
  readonly cardUpdates: readonly LibraryCardUpdate[]
  /** Nodes that left `locked` because of this attempt. */
  readonly unlocked: readonly string[]
  /** The node this quiz gated, when it completed. */
  readonly completed?: string
  readonly passRatio: number
}

/* ------------------------------------------------------------- bindings */

/** Which project (and optionally which book) one session works on. */
export interface LibraryBinding {
  readonly projectId: string
  readonly bookId?: string
}

/* --------------------------------------------------------------- events */

/** The audit ledger's event types (`events.jsonl`, append-only). */
export type LibraryEventType =
  | 'book.added'
  | 'resource.added'
  | 'roadmap.drafted'
  | 'roadmap.adopted'
  | 'page.recorded'
  | 'cards.recorded'
  | 'card.edited'
  | 'quiz.created'
  | 'attempt.assessed'
  | 'node.completed'
  | 'node.unlocked'

/** One event: a timestamp, a type, and a small summary per type. */
export interface LibraryEvent {
  readonly at: string
  readonly type: LibraryEventType
  /** The object the event is about (a book / quiz / node / page id). */
  readonly id?: string
  /** Its display name, so a reader needs no join (cards.recorded: the terms). */
  readonly title?: string
  readonly bookId?: string
  /** cards.recorded: where they came from (the 「教练最近记下」 filter). */
  readonly source?: LibraryCardSourceType
  /** cards.recorded from a chat: the session that noted them (its sidebar toasts them). */
  readonly session?: string
  /** cards.recorded: the card ids, so a toast can undo them. */
  readonly ids?: readonly string[]
  /** Small numeric summaries (nodes / questions / added / merged). */
  readonly count?: number
  readonly count2?: number
  readonly ratio?: number
}

/** The event vocabulary, for tests and for writers who must not invent types. */
export const LIBRARY_EVENT_TYPES: readonly LibraryEventType[] = [
  'book.added',
  'resource.added',
  'roadmap.drafted',
  'roadmap.adopted',
  'page.recorded',
  'cards.recorded',
  'card.edited',
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

/** A native fs failure's message, with its code, for the wire. */
export function libraryErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}
