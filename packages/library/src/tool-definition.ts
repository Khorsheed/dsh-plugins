/**
 * The model-tool face of the library — three verbs, and the `what` enums that
 * keep them three.
 *
 * The design (proposal 2026-10-06-library-learning-mode) collapsed a dozen
 * per-resource verbs into three: `library_read` answers everything read-only,
 * `library_write` validates and persists model-authored content (the evidence
 * gate lives here), and `library_assess` is the one cascading write. The tools
 * stay dumb: content is always generated on the model side — splitting a book
 * is read-the-TOC then propose-a-roadmap, quizzing is read-then-compose, and
 * grading is the model's judgment handed to `library_assess` to ledger. The
 * per-`what` payload contracts live in the `library` skill, not in these
 * descriptions; every validation failure teaches the correct shape back.
 *
 * Every tool is a thin adapter over {@link LibraryService} — the service is
 * the body, the adapters only translate (the eval precedent). This module
 * BUILDS the definitions and registers nothing; creating them is the
 * package's `./tool` row (`src/tool.ts`), which applies the origin tag.
 *
 * @module @khorsheed/dsh-library/tool-definition
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { LibraryOutcome, LibraryVerdict } from './types.ts'
import type { LibraryService } from './service.ts'

/** The names this module registers, in registration order. */
export const LIBRARY_TOOL_NAMES: readonly string[] = ['library_read', 'library_write', 'library_assess']

/**
 * JSON pass-through output — what the render emits IS what the model reads
 * (the eval precedent): every field these tools return is one the caller
 * asked for.
 */
function jsonOutput() {
  return {
    schema: { type: 'json' } as const,
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  }
}

/**
 * Unwrap a service outcome: the domain value, or a thrown Error whose message
 * IS the service's teaching text (tool errors surface to the model verbatim,
 * so the refusal is the lesson).
 */
function unwrap<T>(outcome: LibraryOutcome<T>): T {
  if (outcome.ok) return outcome
  throw new Error(outcome.message)
}

/** The `what` values `library_read` accepts. */
const READ_WHATS = ['projects', 'books', 'toc', 'chapter', 'roadmap', 'vocab', 'due', 'quiz', 'stats'] as const
/** The `what` values `library_write` accepts. */
const WRITE_WHATS = ['project', 'book', 'roadmap', 'notes', 'quiz'] as const

/** One argument's non-empty string, or a thrown lesson. */
function needString(value: string | undefined, name: string, hint: string): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required here — ${hint}`)
  }
  return value.trim()
}

/**
 * Build the three tools. Creating them is the package's `./tool` row, which
 * applies the origin tag; this module never registers.
 * @param service - the library service the adapters translate to.
 * @returns the three definitions, untagged and unregistered.
 */
export function libraryToolDefinitions(service: LibraryService): ToolDefinition[] {
  const definitions: ToolDefinition[] = []

  definitions.push(defineTool({
    name: 'library_read',
    description:
      'Read the library: every project (what: "projects" — the wall, with book/vocab/due tallies and roadmap '
      + 'progress); one project\'s books ("books", needs project); a book\'s table of contents ("toc", needs '
      + 'project + book); one chapter\'s body, paged under a 100KB budget ("chapter", needs project + book + '
      + 'chapter, then page with offset — the answer\'s nextOffset is the next page\'s offset); the project\'s '
      + 'roadmap ("roadmap", needs project); the vocab book ("vocab", needs project; kind: "vocab"|"keypoint" '
      + 'narrows it); the flashcards due for review, lowest mastery first ("due" — project optional, without it '
      + 'every project\'s); quizzes ("quiz", needs project; with quiz: one quiz whole, without: the project\'s '
      + 'list); or the whole library\'s tally ("stats"). Read-only: nothing here writes, unlocks, or moves a '
      + 'card. The per-what payload contracts and the ch:<n> chapter convention are in the library skill — load '
      + 'it before your first write.',
    parameters: {
      what: {
        type: 'string',
        required: true,
        description: `What to read: ${READ_WHATS.join(' | ')}.`,
      },
      project: { type: 'string', description: 'The project id (library_read · projects lists them).' },
      book: { type: 'string', description: 'The book id (books / toc / chapter).' },
      chapter: { type: 'integer', description: 'The 1-based chapter number (chapter).' },
      quiz: { type: 'string', description: 'The quiz id (quiz; omit for the project\'s list).' },
      kind: { type: 'string', description: 'vocab | keypoint (vocab; omit for both).' },
      offset: { type: 'integer', description: 'The chapter page\'s start offset (chapter; 0 first).' },
      limit: { type: 'integer', description: 'How many due cards to return (due; default 100).' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      switch (args.what) {
        case 'projects':
          return (await service.listProjects()) as unknown as JsonValue
        case 'books': {
          const project = needString(args.project, 'project', 'library_read · projects lists the ids')
          const detail = unwrap(await service.getProject({ id: project }))
          return { books: detail.books } as unknown as JsonValue
        }
        case 'toc': {
          const project = needString(args.project, 'project', 'library_read · projects lists the ids')
          const book = needString(args.book, 'book', 'library_read · books lists the project\'s book ids')
          const result = unwrap(await service.getToc({ projectId: project, bookId: book }))
          return result.book as unknown as JsonValue
        }
        case 'chapter': {
          const project = needString(args.project, 'project', 'library_read · projects lists the ids')
          const book = needString(args.book, 'book', 'library_read · books lists the project\'s book ids')
          if (args.chapter === undefined) throw new Error('chapter is required here — the 1-based chapter number; library_read · toc lists them with titles')
          return (unwrap(await service.getChapterBody({
            projectId: project,
            bookId: book,
            chapter: args.chapter,
            ...(args.offset === undefined ? {} : { offset: args.offset }),
          }))) as unknown as JsonValue
        }
        case 'roadmap': {
          const project = needString(args.project, 'project', 'library_read · projects lists the ids')
          return (await service.getRoadmap({ projectId: project })) as unknown as JsonValue
        }
        case 'vocab': {
          const project = needString(args.project, 'project', 'library_read · projects lists the ids')
          return (await service.listVocab({
            projectId: project,
            ...(args.kind === 'vocab' || args.kind === 'keypoint' ? { kind: args.kind } : {}),
          })) as unknown as JsonValue
        }
        case 'due':
          return (await service.dueVocab({
            ...(args.project === undefined || args.project.trim() === '' ? {} : { projectId: args.project.trim() }),
            ...(args.limit === undefined ? {} : { limit: args.limit }),
          })) as unknown as JsonValue
        case 'quiz': {
          const project = needString(args.project, 'project', 'library_read · projects lists the ids')
          if (args.quiz === undefined || args.quiz.trim() === '') {
            return (await service.listQuizzes({ projectId: project })) as unknown as JsonValue
          }
          return (unwrap(await service.getQuiz({ projectId: project, quizId: args.quiz.trim() }))).quiz as unknown as JsonValue
        }
        case 'stats':
          return (await service.stats()) as unknown as JsonValue
        default:
          throw new Error(
            `what must be one of ${READ_WHATS.join(' | ')} — got ${JSON.stringify(args.what)}. `
            + 'projects/books/toc/chapter/roadmap/vocab/due/quiz/stats; the library skill has one example per what.',
          )
      }
    },
  }))

  definitions.push(defineTool({
    name: 'library_write',
    description:
      'Validate and persist what you authored for the library. what: "project" creates a learning project '
      + '({ project: { name, domain? } }); "book" stores an already-parsed book ({ book: { project, title, '
      + 'author?, format: "epub"|"md", chapters: [{ title, html }…] } }) — files are ingested on the 图书馆 tab '
      + '(EPUB parsing lives in the browser), this verb is for content YOU already hold; "roadmap" writes a '
      + 'book\'s learning path ({ roadmap: { project, book, nodes: [{ id, title, goals, chapterRanges: '
      + '[{ from, to }], dependsOn, state }], passRatio?, regenerate? } }) — the state machine has only the '
      + 'edges locked → current → done, and re-splitting an existing roadmap needs regenerate: true; "notes" '
      + 'logs vocab-book entries ({ notes: { project, entries: [{ kind: "vocab"|"keypoint", term, note, '
      + 'context?, chapterRef: "ch:<n>", source? }] } }) — for a photo source copy the image block\'s durable '
      + 'reference (attachmentId, mediaType, bytes, width, height) verbatim; "quiz" stores a quiz '
      + '({ quiz: { project, scope: { book, node? }, questions: [{ id, kind, prompt, options?, chapterRef, '
      + 'evidence, answer, vocabIds? }] } }) behind the EVIDENCE GATE: every question names a real chapter as '
      + 'ch:<n> and quotes the original passage it grades against — a question without chapterRef + evidence '
      + 'is refused, and the refusal says how to fix it. Content is yours, checking is mechanical: read the '
      + 'book/vocab first (library_read), then write. The library skill carries one full example per what.',
    parameters: {
      what: {
        type: 'string',
        required: true,
        description: `What to write: ${WRITE_WHATS.join(' | ')}.`,
      },
      project: {
        type: 'object',
        description: 'what=project: { name, domain? }.',
        additionalProperties: true,
      },
      book: {
        type: 'object',
        description: 'what=book: { project, title, author?, format, chapters: [{ title, html }…], replaceId? }.',
        additionalProperties: true,
      },
      roadmap: {
        type: 'object',
        description: 'what=roadmap: { project, book, nodes, passRatio?, regenerate? }.',
        additionalProperties: true,
      },
      notes: {
        type: 'object',
        description: 'what=notes: { project, entries: […] }.',
        additionalProperties: true,
      },
      quiz: {
        type: 'object',
        description: 'what=quiz: { project, scope: { book, node? }, questions: […] }.',
        additionalProperties: true,
      },
    },
    output: jsonOutput(),
    // Writes serialize on the store's locks; declaring the tool unsafe keeps a
    // batch of model writes from interleaving into a confusing order.
    isConcurrencySafe: () => false,
    async execute(args) {
      switch (args.what) {
        case 'project': {
          const payload = args.project as { name?: string; domain?: string } | undefined
          if (payload === undefined || typeof payload.name !== 'string') {
            throw new Error('what=project takes { project: { name, domain? } } — name is what the learner calls the subject (「神经科学」)')
          }
          return (unwrap(await service.createProject({
            name: payload.name,
            ...(payload.domain === undefined ? {} : { domain: payload.domain }),
          }))) as unknown as JsonValue
        }
        case 'book': {
          const payload = args.book as {
            project?: string
            title?: string
            author?: string
            format?: 'epub' | 'md'
            chapters?: { title: string; html: string }[]
            replaceId?: string
          } | undefined
          if (payload === undefined || typeof payload.project !== 'string' || typeof payload.title !== 'string' || !Array.isArray(payload.chapters)) {
            throw new Error('what=book takes { book: { project, title, format: "epub"|"md", chapters: [{ title, html }…] } } — chapters are the split you made; an empty chapters array stores nothing')
          }
          return (unwrap(await service.storeBook({
            projectId: payload.project,
            title: payload.title,
            ...(payload.author === undefined ? {} : { author: payload.author }),
            source: { kind: 'upload', ref: payload.title },
            format: payload.format ?? 'md',
            chapters: payload.chapters,
            ...(payload.replaceId === undefined ? {} : { replaceId: payload.replaceId }),
          }))) as unknown as JsonValue
        }
        case 'roadmap': {
          const payload = args.roadmap as {
            project?: string
            book?: string
            nodes?: never[]
            passRatio?: number
            regenerate?: boolean
          } | undefined
          if (payload === undefined || typeof payload.project !== 'string' || typeof payload.book !== 'string' || !Array.isArray(payload.nodes)) {
            throw new Error('what=roadmap takes { roadmap: { project, book, nodes: [{ id, title, goals, chapterRanges: [{ from, to }], dependsOn, state }] } } — read the TOC first, then split the book')
          }
          return (unwrap(await service.putRoadmap({
            projectId: payload.project,
            bookId: payload.book,
            nodes: payload.nodes,
            ...(payload.passRatio === undefined ? {} : { passRatio: payload.passRatio }),
            ...(payload.regenerate === undefined ? {} : { regenerate: payload.regenerate }),
          }))) as unknown as JsonValue
        }
        case 'notes': {
          const payload = args.notes as { project?: string; entries?: never[] } | undefined
          if (payload === undefined || typeof payload.project !== 'string' || !Array.isArray(payload.entries)) {
            throw new Error('what=notes takes { notes: { project, entries: [{ kind: "vocab"|"keypoint", term, note, context?, chapterRef: "ch:<n>", source? }] } } — one entry per term or key point')
          }
          return (unwrap(await service.addVocabEntries({
            projectId: payload.project,
            entries: payload.entries,
          }))) as unknown as JsonValue
        }
        case 'quiz': {
          const payload = args.quiz as {
            project?: string
            scope?: { bookId?: string; nodeId?: string }
            questions?: never[]
          } | undefined
          if (payload === undefined || typeof payload.project !== 'string' || payload.scope === undefined || !Array.isArray(payload.questions)) {
            throw new Error('what=quiz takes { quiz: { project, scope: { book, node? }, questions: [{ id, kind: "choice"|"fill"|"free", prompt, options?, chapterRef: "ch:<n>", evidence, answer, vocabIds? }] } } — every question quotes its original passage as evidence')
          }
          const scope = payload.scope as { book?: string; bookId?: string; node?: string; nodeId?: string }
          const bookId = scope.bookId ?? scope.book
          const nodeId = scope.nodeId ?? scope.node
          if (typeof bookId !== 'string') {
            throw new Error('quiz.scope needs book — the book id the quiz tests (library_read · books lists them)')
          }
          return (unwrap(await service.putQuiz({
            projectId: payload.project,
            quiz: {
              scope: { bookId, ...(nodeId === undefined ? {} : { nodeId }) },
              questions: payload.questions,
            },
          }))) as unknown as JsonValue
        }
        default:
          throw new Error(
            `what must be one of ${WRITE_WHATS.join(' | ')} — got ${JSON.stringify(args.what)}. `
            + 'project/book/roadmap/notes/quiz; the library skill has one full example per what.',
          )
      }
    },
  }))

  definitions.push(defineTool({
    name: 'library_assess',
    description:
      'Ledger a graded sitting — the ONLY cascading write. You judge the answers in the conversation first '
      + '(against each question\'s answer and evidence); this call records your verdicts and the engine does the '
      + 'rest: the attempt lands in the append-only ledger, every probed vocab entry\'s Leitner box moves (a pass '
      + 'climbs one box, a fail resets to box 0 due tomorrow), the gated roadmap node\'s quiz stats update, and '
      + 'a node whose attempt reaches its pass ratio (default 0.8) completes and unlocks its dependents — the '
      + 'answer names them. verdicts: one per question, the dataseek.verdict/1 shape: { task: <the question id>, '
      + 'criterion: <what you judged, one line>, pass: true|false, ratio?: <partial credit 0..1>, evidence: '
      + '<the passage you graded against>, by: "llm"|"self"|"user" }. Never assess a quiz you have not read '
      + '(library_read · quiz), and never invent a question id — the refusal lists the real ones.',
    parameters: {
      project: { type: 'string', required: true, description: 'The project id.' },
      quiz: { type: 'string', required: true, description: 'The quiz id (library_write · quiz returned it).' },
      verdicts: {
        type: 'array',
        required: true,
        description: 'One dataseek.verdict/1 verdict per question: { task, criterion, pass, ratio?, evidence, by }.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            task: { type: 'string', description: 'The question id this verdict judges.' },
            criterion: { type: 'string', description: 'What was judged, in one line.' },
            pass: { type: 'boolean', description: 'Whether the answer passes.' },
            ratio: { type: 'number', description: 'Partial credit 0..1 (defaults to pass ? 1 : 0).' },
            evidence: { type: 'string', description: 'The passage the judgment leaned on.' },
            by: { type: 'string', enum: ['llm', 'self', 'user'], description: 'Who graded: the model, a self-check, or the person.' },
          },
        },
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args) {
      const project = needString(args.project, 'project', 'library_read · projects lists the ids')
      const quiz = needString(args.quiz, 'quiz', 'the id library_write · quiz returned')
      return (unwrap(await service.putAttempt({
        projectId: project,
        quizId: quiz,
        verdicts: [...args.verdicts] as LibraryVerdict[],
      }))) as unknown as JsonValue
    },
  }))

  return definitions
}
