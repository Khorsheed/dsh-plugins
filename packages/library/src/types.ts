/**
 * The library's domain vocabulary: projects, resources, roadmaps, nodes,
 * assessments, attempts, photo pages, knowledge cards and session bindings.
 * Everything here is plain serializable data — the store (`store.ts`)
 * persists exactly these shapes under `$DSH_HOME/state/dsh-library/`, and the
 * Remote face (`remote.ts`) and the model tools (`tool-definition.ts`) both
 * speak them.
 *
 * The shapes follow the proposal `2026-10-16-library-v5-model` (v5: the
 * six-layer core — Project → Resource → Roadmap → Node → Assessment →
 * Attempt, with Card / Page / Event as the trace layer):
 *
 * - a RESOURCE is anything on the project's shelf. Its `toc` is the
 *   thick/thin switch: a resource WITH a contents (a book, a course with
 *   episodes) can carry a roadmap, be covered by chapter, be quizzed and be
 *   photographed; one without is a thin link (an article, a video, a tool)
 *   that only enters a path whole. Nothing is ever uploaded — a thick
 *   resource registers title, kind and a contents the coach verified on the
 *   web (or took from a photo);
 * - a ROADMAP belongs to exactly one thick resource — a TEXTBOOK (proposal
 *   `2026-10-19-library-book-paths`: the project carries no path of its
 *   own). Textbooks sit on the shelf in study order (`seq`), and come from
 *   the learner, from the coach's pick, or from the coach's own pen
 *   (`origin`). A node draws on COVERS in one shape — `{ ref, locator? }`,
 *   where ref is a resource id, a bare url, or `topic:…` (plain coached
 *   teaching) and locator counts contents rows ("1-5,7"); the path's own
 *   textbook is the main cover, anything else rides along as a side
 *   reference. A path need not cover the whole contents. The coach writes DRAFTS, the
 *   learner adopts one, and the adopted path's state machine has three edges
 *   only (`locked → current → done`);
 * - a NODE's `gate` says how it completes: `quiz` (an assessed quiz at the
 *   pass ratio), `acceptance` (a hands-on station — the learner submits
 *   evidence, the coach judges one verdict per rubric line), `read` (an
 *   optional side stop that 「读完」 completes and never gates);
 * - an ASSESSMENT is the graded thing: `quiz` carries questions, `practice`
 *   carries a station's materialized rubric (stable line ids; a line may
 *   reference another assessment that machine-checks it). Hung on a node, on
 *   a resource (a book-level paper), or on nothing (free practice). A
 *   station's paper history chains by `supersededBy`;
 * - an ATTEMPT is one graded sitting and names only its `assessmentId` (a
 *   verdict's `task` is a question id or a rubric line id, so rewording never
 *   orphans history);
 * - a PAGE is one photographed page of a thick resource: its recognized text
 *   plus the learner's marks;
 * - a CARD (知识卡片) is the learner's own memory: a word or a concept met in a
 *   photo, asked about in a chat, or missed in an assessment — one card per
 *   thing, sources stacked, with a weakness score (0–3) beside its Leitner
 *   mastery;
 * - an EVENT is the append-only audit trail.
 *
 * @module @khorsheed/dsh-library/types
 */

/** The state-root directory name under `$DSH_HOME/state`. */
export const STATE_ROOT_SEGMENT = 'dsh-library'

/**
 * The on-disk schema version of `state.json`. v1 (uploaded books, project
 * roadmaps, the vocab book) was never deployed; a v1 root reads as empty. v2
 * roots (per-book roadmaps with `chapterRanges`) and v3/v4 roots (the
 * book/resource split, cover unions, quiz entities) all read tolerantly —
 * every normalize* function reads the old shapes — and rewrite to v5 on their
 * next write. There is no offline migration pass.
 */
export const LIBRARY_STATE_VERSION = 5

/** The Leitner intervals in days, indexed by box (box 5 reuses the last rung). */
export const LEITNER_INTERVAL_DAYS: readonly number[] = [1, 2, 4, 7, 15]

/** The highest Leitner box. */
export const MAX_BOX = 5

/** The highest weakness score (three bars in the UI). */
export const MAX_WEAKNESS = 3

/** The default node pass threshold (an assessment ratio at or above it completes the node). */
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

/** One resource's row on the project page. */
export interface LibraryResourceProgress {
  readonly id: string
  readonly title: string
  readonly kind: LibraryResourceKind
  /** A textbook's place in the study order (1-based); absent on a thin link. */
  readonly seq?: number
  /** Where the entry came from. */
  readonly origin?: LibraryResourceOrigin
  /** Adopted-roadmap progress; only a thick resource (toc) can carry one. */
  readonly roadmap?: { readonly done: number; readonly total: number }
  /** The first current node, when one is in progress. */
  readonly current?: { readonly id: string; readonly title: string }
  /** A draft is waiting for the learner's 采用. */
  readonly hasDraft: boolean
  /** The waiting draft's station count. */
  readonly draftTotal?: number
}

/** The project list's row: the project plus its cheap aggregates. */
export interface LibraryProjectSummary extends LibraryProject {
  /** Every shelf entry (thick and thin) with its progress. */
  readonly resources: readonly LibraryResourceProgress[]
  /** Live cards (not deleted). */
  readonly cardCount: number
  /** Live, unmastered cards due for review right now. */
  readonly dueCount: number
  /** When anything last happened in the project (its newest event, else its creation) — the list sorts by it. */
  readonly lastActiveAt: string
  /** Open misses (待订正) across every station of the project's textbooks. */
  readonly openMisses?: number
}

/* ------------------------------------------------------------ resources */

/**
 * What a THICK resource's content IS. `knowledge` (textbooks, popular
 * science): the content is domain knowledge, so the coach may quiz from what
 * it knows. `material` (exam papers, novels, anthologies): the content is
 * specific text the model cannot recall — quizzing the resource's content
 * needs a photo or a web quote.
 */
export type LibraryBookKind = 'knowledge' | 'material'

/** One table-of-contents row. */
export interface LibraryTocEntry {
  /** 1-based position — what cover locators count. */
  readonly n: number
  readonly title: string
  /** The part / test / unit it sits under, when the resource groups chapters. */
  readonly part?: string
}

/** Where the table of contents came from — shown on the roadmap draft card. */
export interface LibraryTocSource {
  readonly by: 'web' | 'model' | 'photo'
  readonly url?: string
  readonly verifiedAt?: string
}

/**
 * Something in a thick resource worth knowing but not worth a stop on the
 * path — how to use the book, the answer key, transcripts, appendices. Shown
 * in the resource page's 「开始前 / 附录」 strip.
 */
export interface LibraryResourceExtra {
  readonly title: string
  /** One line from the coach: what it is for. */
  readonly note?: string
  /** Where it is in the resource (「p.152」). */
  readonly where?: string
  readonly when: 'before' | 'reference'
}

/** A thick resource's book-ish metadata, kept off the link fields. */
export interface LibraryResourceMeta {
  readonly bookKind?: LibraryBookKind
  /** The cover's abbreviation (「剑5」「PNS」); derived from the title when absent. */
  readonly short?: string
  readonly extras?: readonly LibraryResourceExtra[]
  readonly author?: string
  readonly edition?: string
  readonly isbn?: string
}

/**
 * Where a shelf entry came from: `learner` — the learner's own (a book they
 * hold, a link they handed over); `picked` — an existing book / course / link
 * the coach chose; `authored` — a textbook the coach wrote itself (its
 * contents are the coach's own outline, its 讲义 are the text). Legacy
 * `addedBy` reads as learner / picked.
 */
export const LIBRARY_RESOURCE_ORIGINS = ['learner', 'picked', 'authored'] as const
export type LibraryResourceOrigin = typeof LIBRARY_RESOURCE_ORIGINS[number]

/** What a shelf entry IS: the shape of the thing it is or points at. */
export const LIBRARY_RESOURCE_KINDS = ['book', 'article', 'video', 'repo', 'tool', 'course', 'hardware'] as const
export type LibraryResourceKind = typeof LIBRARY_RESOURCE_KINDS[number]

/**
 * One entry on a project's shelf — the v5 unified resource. A BOOK is the
 * thick case: `kind: "book"` plus a table of contents (and its book-ish
 * detail in `meta`). Any other kind with a `toc` is thick too (a course with
 * episodes routes by chapter); without a `toc` it is a thin link — no
 * roadmap, never covered by chapter, never quizzed by content, no pages.
 */
export interface LibraryResource {
  readonly id: string
  readonly title: string
  readonly kind: LibraryResourceKind
  /** A thin link's address; a thick resource may carry one (the web copy). */
  readonly url?: string
  /** The coach's one line: why it is on the shelf (「热身站的读物，只看两节」). */
  readonly note?: string
  /** Where it came from. */
  readonly origin?: LibraryResourceOrigin
  /** A textbook's place in the project's study order, 1-based and gapless; thin links carry none. */
  readonly seq?: number
  /** The thick/thin switch: present (and non-empty) = thick. */
  readonly toc?: readonly LibraryTocEntry[]
  readonly tocSource?: LibraryTocSource
  readonly meta?: LibraryResourceMeta
  readonly createdAt: string
}

/** Whether a resource is thick (routable, coverable by chapter, quizzable, photographable). */
export function isThickResource(resource: { toc?: readonly LibraryTocEntry[] }): boolean {
  return resource.toc !== undefined && resource.toc.length > 0
}

/* ------------------------------------------------------------- roadmaps */

/** The three node states; the only legal edges are locked→current→done. */
export type RoadmapNodeState = 'locked' | 'current' | 'done'

/**
 * How a node completes. `quiz` nodes are the path's levels: they gate on an
 * assessed quiz at the pass ratio. `acceptance` nodes are hands-on stations:
 * they gate on acceptance — the learner submits evidence, the coach judges
 * one verdict per rubric line. `read` nodes are side stops (an overview worth
 * reading, not testing): always open, complete by 「读完」, and never a
 * dependency of a level. How-to-use pages, answer keys and appendices are not
 * nodes at all — they are resource extras.
 */
export type RoadmapNodeGate = 'quiz' | 'acceptance' | 'read'

/** A table-of-contents span, 1-based and inclusive. */
export interface LibraryChapterRange {
  readonly from: number
  readonly to: number
}

/**
 * The locator's text form: comma-joined spans ("1-5,7,9-12" — a one-row span
 * is the bare number). Contents-row spans are what cover locators count.
 */
export function formatLocator(ranges: readonly LibraryChapterRange[]): string {
  return ranges.map(range => range.from === range.to ? String(range.from) : `${range.from}-${range.to}`).join(',')
}

/** Parse a locator ("1-5,7") into spans; bad segments drop out. */
export function parseLocator(locator: string): LibraryChapterRange[] {
  return locator.split(',').flatMap(segment => {
    const match = /^\s*(\d+)\s*(?:[-–—]\s*(\d+)\s*)?$/.exec(segment)
    if (match === null) return []
    const from = Number.parseInt(match[1]!, 10)
    const to = match[2] === undefined ? from : Number.parseInt(match[2], 10)
    return from >= 1 && to >= from ? [{ from, to }] : []
  })
}

/**
 * What one node draws on, in one shape. `ref` is self-describing:
 *
 * - a resource id (`r_…`, and legacy `b_…` books) — a shelf entry, thick ones
 *   with a `locator` of contents rows;
 * - a bare url (`https://…`) — a web text not on the shelf;
 * - `topic:…` — plain coached teaching (the station IS the coach's lecture).
 *
 * `by`/`verifiedAt` record who vouched for the cover and when (a resource's
 * own tocSource records its contents' provenance; a topic needs none).
 */
export interface LibraryNodeCover {
  readonly ref: string
  /** The contents rows drawn on ("1-5,7") — thick resources only. */
  readonly locator?: string
  /** A url cover's display title. */
  readonly title?: string
  /** web: fetched and checked; model: from the coach's memory, unverified; user: the learner gave it. */
  readonly by?: 'web' | 'model' | 'user'
  readonly verifiedAt?: string
}

/** What a cover's ref points at. */
export type LibraryCoverKind = 'resource' | 'url' | 'topic'

/** Discriminate a cover by its ref's form (a resource id resolves against the shelf). */
export function coverKind(cover: Pick<LibraryNodeCover, 'ref'>): LibraryCoverKind {
  if (cover.ref.startsWith('topic:')) return 'topic'
  if (/^https?:\/\//.test(cover.ref)) return 'url'
  return 'resource'
}

/** A topic cover's teaching text (the ref minus its `topic:` prefix). */
export function coverTopic(cover: Pick<LibraryNodeCover, 'ref'>): string | undefined {
  return cover.ref.startsWith('topic:') ? cover.ref.slice('topic:'.length) : undefined
}

/** A node's quiz ledger, updated by every assessed attempt that names it. */
export interface LibraryQuizStats {
  readonly attempts: number
  readonly lastRatio?: number
  readonly bestRatio?: number
}

/**
 * One knowledge point a quiz station tests (考点). Points are authored on the
 * roadmap draft and reviewed at adoption — the learner's consent checkpoint
 * covers the split. Questions reference a point by id, so a reworded title
 * never orphans mastery; per-point state aggregates off the newest verdict of
 * any question probing it.
 */
export interface LibraryPoint {
  /** Stable slug (letters, digits, . _ -) — the mastery key. */
  readonly id: string
  /** The point as the learner reads it (「极限的定义」). */
  readonly title: string
  /** What the coach noticed the learner stuck on here (a subject project's weak point lands on its point, not on a card). */
  readonly notes?: readonly LibraryPointNote[]
}

/** One coach note on a knowledge point: the learner stuck on it. */
export interface LibraryPointNote {
  readonly text: string
  /** The short name of the confusion, when the coach gave one (「反函数 vs 倒数」). */
  readonly term?: string
  readonly at: string
  /** The session it came from. */
  readonly session?: string
}

/** A knowledge point's state (mastery.ts decides it from the ledger and the notes). */
export type LibraryPointState = 'untested' | 'weak' | 'practicing' | 'mastered'

/** A point whose state moved because of a write. */
export interface LibraryPointChange {
  readonly nodeId: string
  readonly pointId: string
  readonly title: string
  readonly from: LibraryPointState
  readonly to: LibraryPointState
}

/**
 * The station's 讲义 — the coach's distilled teaching, persisted on the node so
 * the learner re-reads it in the sidebar instead of scrolling the chat. On a
 * 讲授 (topic) station it IS the textbook; on a book station it is marginalia
 * (the explanation, the learner's own stuck points, the pitfalls) and never a
 * substitute for the book. Coach-written only (library_notes).
 */
export interface LibraryNodeNotes {
  /** Markdown body. */
  readonly text: string
  readonly updatedAt: string
  /** 1-based — the Nth version (「第 N 次更新」). */
  readonly revisions: number
}

/** One roadmap node. */
export interface RoadmapNode {
  readonly id: string
  readonly title: string
  /** What the learner should be able to do after this node. */
  readonly goals: readonly string[]
  /** Node ids that must be `done` before this one may leave `locked`. */
  readonly dependsOn: readonly string[]
  /** What the station draws on — at least one cover. */
  readonly covers: readonly LibraryNodeCover[]
  readonly state: RoadmapNodeState
  /** How the node completes: quiz | acceptance | read. */
  readonly gate: RoadmapNodeGate
  /** Quiz-gated nodes only — a read / acceptance node never carries one. */
  readonly quizStats?: LibraryQuizStats
  /** Quiz-gated nodes only: the station's knowledge points (3-6), drafted with the roadmap and reviewed at adoption. Quiz questions reference them by id. */
  readonly points?: readonly LibraryPoint[]
  /** Acceptance nodes only: the rubric lines as authored (the draft's and the display's source of truth; adoption materializes them into the node's practice assessment). */
  readonly acceptance?: readonly LibraryAcceptanceInput[]
  /** The station's 讲义, once the coach has taught it. */
  readonly notes?: LibraryNodeNotes
}

/**
 * One acceptance line as authored: a bare line the coach judges, or
 * `{ line, ref }` — a machine-checked line that auto-passes when the
 * referenced assessment's latest sitting passes the roadmap's pass ratio.
 */
export type LibraryAcceptanceInput = string | { readonly line: string; readonly ref?: string }

/** One rubric line of an acceptance station, with its stable positional id. */
export interface LibraryAcceptanceLine {
  /** Stable id: L + 1-based position — verdicts name it, so a replan rewording the line never orphans history. */
  readonly id: string
  readonly line: string
  /** The assessment that machine-checks this line. */
  readonly ref?: string
}

/** An acceptance station's rubric: its acceptance lines with stable positional ids (L1, L2, …). */
export function acceptanceLines(node: { acceptance?: readonly LibraryAcceptanceInput[] }): LibraryAcceptanceLine[] {
  return (node.acceptance ?? []).map((entry, index) => typeof entry === 'string'
    ? { id: `L${index + 1}`, line: entry }
    : { id: `L${index + 1}`, line: entry.line, ...(entry.ref === undefined ? {} : { ref: entry.ref }) })
}

/** A roadmap — the adopted path (`roadmaps/<key>.json`) or a draft (`roadmaps/<key>.draft.json`). */
export interface LibraryRoadmap {
  /**
   * The textbook whose path this is. Always present on anything written
   * since the book-paths cut; a legacy project-level path (absent) is never
   * read back.
   */
  readonly primaryResourceId?: string
  readonly status: 'draft' | 'adopted'
  readonly nodes: readonly RoadmapNode[]
  /** The pass threshold (default {@link DEFAULT_PASS_RATIO}). */
  readonly passRatio?: number
  /** The coach's one-line pacing note on the draft card (「每周 3 章，约 4 周」). */
  readonly note?: string
  readonly generatedAt: string
  readonly adoptedAt?: string
}

/* ---------------------------------------------------------- assessments */

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
  /** The gated station's point this question probes (a point id) — required once the station carries points; mastery aggregates by it. */
  readonly point?: string
  /** retake papers: the question this one re-asks. */
  readonly origin?: { readonly assessmentId: string; readonly questionId: string }
  readonly target: LibraryQuestionTarget
  readonly evidence: LibraryQuestionEvidence
}

/**
 * Where a quiz's questions may come from, as the learner chose it: `mine` —
 * only the learner's own cards (marked, asked, missed); `book` — only the
 * chapter's content; `mixed` — both.
 */
export type LibraryQuizFocus = 'mine' | 'book' | 'mixed'

/**
 * The graded thing (`assessments/<id>.json`). `quiz` carries questions;
 * `practice` carries an acceptance station's materialized rubric (the node's
 * `acceptance` stays the authoring source; this snapshot is what verdicts
 * name, so a replan rewording the lines never orphans the station's history).
 * Scope: a node (its gate's paper), a resource (a book-level paper), or
 * nothing (free practice). A station's paper history chains by
 * `supersededBy` (the newest is the current one).
 */
export interface LibraryAssessment {
  readonly id: string
  /** quiz: a paper; practice: an acceptance rubric; retake: a station's open misses, re-asked (never counts toward passing). */
  readonly type: 'quiz' | 'practice' | 'retake'
  readonly scope: {
    /** The roadmap node this assessment gates, when it is a node assessment. */
    readonly nodeId?: string
    /** The resource whose content is quizzed; absent + nodeId present = a project-path station, both absent = free practice. */
    readonly resourceId?: string
  }
  /** quiz: the learner's chosen source (absent on assessments stored before the choice existed = mixed). */
  readonly focus?: LibraryQuizFocus
  /** quiz: the questions. */
  readonly questions?: readonly LibraryQuizQuestion[]
  /** practice: the materialized rubric (stable line ids). */
  readonly rubric?: readonly LibraryAcceptanceLine[]
  /** The assessment that replaced this one (a station's newer paper). */
  readonly supersededBy?: string
  readonly createdAt: string
}

/** One graded answer, the eval family's `dataseek.verdict/1` shape (+ the void flag). */
export interface LibraryVerdict {
  /** The question id or rubric line id this verdict judges. */
  readonly task: string
  readonly criterion: string
  readonly pass: boolean
  /** Partial credit (defaults to pass ? 1 : 0). */
  readonly ratio?: number
  readonly evidence: string
  /** auto: the machine's verdict on a ref acceptance line (never accepted from a caller). */
  readonly by: 'llm' | 'self' | 'user' | 'auto'
  /** The learner flagged the question as broken (「这题有问题」): it counts for nothing. */
  readonly void?: boolean
  /** A missed question with no target card: the card to create for it. */
  readonly missedCard?: { readonly term: string; readonly gloss: string }
}

/** One graded sitting (`attempts.jsonl` line). */
export interface LibraryAttempt {
  readonly id: string
  /** The assessment judged. Always set on v5 writes. */
  readonly assessmentId?: string
  /**
   * Legacy v4 key: the acceptance station accepted, before practice rubrics
   * materialized as assessments. Read compatibility only — new attempts never
   * carry it; readers resolve it through the node's current practice
   * assessment.
   */
  readonly nodeId?: string
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
  /** The node this assessment gated, when it completed. */
  readonly completed?: string
  readonly passRatio: number
  /** Knowledge points whose state this sitting moved. */
  readonly pointChanges?: readonly LibraryPointChange[]
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

/** One photographed page (a `pages/<resourceId>.jsonl` line). */
export interface LibraryPage {
  readonly id: string
  /** The thick resource photographed. */
  readonly resourceId: string
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
  /** photo: the page id; quiz: the assessment id; chat: the session id when known. */
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
  readonly resourceId?: string
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
  /** Hung on a resource when it came from one; absent = project-level (「不挂书」). */
  readonly resourceId?: string
  readonly sources: readonly LibraryCardSource[]
  /** 0–3: how often the learner got stuck here (asked again, answered wrong). */
  readonly weakness: number
  readonly mastery: LibraryMastery
  readonly status: 'active' | 'mastered' | 'deleted'
  readonly createdAt: string
  readonly updatedAt: string
}

/** One card to record — the shared input of `library_cards` and `library_page`. */
export interface LibraryCardInput {
  readonly kind: LibraryCardKind
  readonly term: string
  readonly aliases?: readonly string[]
  readonly gloss: string
  readonly userGloss?: string
  readonly context?: { readonly sentence: string; readonly pageId?: string; readonly nodeId?: string }
  readonly source: { readonly type: LibraryCardSourceType; readonly ref?: string; readonly note?: string }
  /** Hang it on this resource (defaults to the call's resource, when one applies). */
  readonly resourceId?: string
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
  readonly resourceId?: string
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

/* ------------------------------------------------------------- bindings */

/** Which project (and optionally which resource) one session works on. */
export interface LibraryBinding {
  readonly projectId: string
  readonly resourceId?: string
  /** The project this session was bound to before a switch — what was said there is not this project's material. */
  readonly previousProjectId?: string
}

/* --------------------------------------------------------------- events */

/** The audit ledger's event types (`events.jsonl`, append-only). */
export type LibraryEventType =
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
  | 'node.noted'
  | 'point.changed'

/** One event: a timestamp, a type, and a small summary per type. */
export interface LibraryEvent {
  readonly at: string
  readonly type: LibraryEventType
  /** The object the event is about (a resource / assessment / node / page id). */
  readonly id?: string
  /** Its display name, so a reader needs no join (cards.recorded: the terms). */
  readonly title?: string
  readonly resourceId?: string
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
  /** point.changed: the station and the states. */
  readonly nodeId?: string
  readonly from?: LibraryPointState
  readonly to?: LibraryPointState
  /** point.changed: why, in one line (「2 题待订正」「教练备注：…」). */
  readonly detail?: string
}

/** The event vocabulary, for tests and for writers who must not invent types. */
export const LIBRARY_EVENT_TYPES: readonly LibraryEventType[] = [
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
  'node.noted',
  'point.changed',
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
