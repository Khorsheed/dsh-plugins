/**
 * The model-tool face of the library — three verbs, and the `what` enums that
 * keep them three.
 *
 * `library_read` answers everything read-only, `library_write` validates and
 * persists what the coach authored (the card dedupe and the two-axis quiz
 * checks live behind it), and `library_assess` is the one cascading write.
 * Content is always generated on the model side; the tools are mechanical.
 * There is no skill to load: each `what`'s payload shape is in the parameter
 * descriptions, and every refusal teaches the correct call back.
 *
 * `project` / `book` default to the session's binding (the header chip), so a
 * bound session rarely names them.
 *
 * Every tool is a thin adapter over {@link LibraryService}. This module BUILDS
 * the definitions and registers nothing; the package's `./tool` row
 * (`src/tool.ts`) tags and registers them.
 *
 * @module @khorsheed/dsh-library/tool-definition
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  LibraryBinding,
  LibraryCardInput,
  LibraryCardKind,
  LibraryCardSourceType,
  LibraryMark,
  LibraryOutcome,
  LibraryResourceKind,
  LibraryTemplate,
  LibraryQuizQuestion,
  LibraryVerdict,
} from './types.ts'
import type { LibraryService } from './service.ts'
import { ImageRefCache } from './image-refs.ts'
import { normalizeQuizOptions } from './store.ts'

/** The names this module registers, in registration order. */
export const LIBRARY_TOOL_NAMES: readonly string[] = ['library_read', 'library_write', 'library_assess']

/** JSON pass-through output — what the render emits IS what the model reads. */
function jsonOutput() {
  return {
    schema: { type: 'json' } as const,
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  }
}

/** Unwrap a service outcome: the domain value, or a thrown Error whose message IS the lesson. */
function unwrap<T>(outcome: LibraryOutcome<T>): T {
  if (outcome.ok) return outcome
  throw new Error(outcome.message)
}

const READ_WHATS = ['projects', 'books', 'resources', 'toc', 'roadmap', 'pages', 'cards', 'quiz', 'stats'] as const
const WRITE_WHATS = ['project', 'book', 'roadmap', 'notes', 'page', 'cards', 'quiz', 'resource', 'binding'] as const

type Exec = { agent?: Agent }

/** The calling session's id, when the call came from a session. */
function sessionIdOf(exec: Exec | undefined): string | undefined {
  const id = exec?.agent?.session?.id
  return id === undefined ? undefined : String(id)
}

/**
 * A roadmap's scope read off its content: the one book every station's covers
 * name, when they all name exactly that one — anything else (mixed books, a
 * resource / url / topic among the covers, a coverless node) is the project's
 * own path. Runs on the post-sugar nodes, so chapterRanges have already become
 * the book cover they wrap.
 */
function deriveRoadmapBook(nodes: readonly Record<string, unknown>[]): string | undefined {
  const ids = new Set<string>()
  for (const node of nodes) {
    const covers = node.covers
    if (!Array.isArray(covers) || covers.length === 0) return undefined
    for (const cover of covers) {
      if (cover === null || typeof cover !== 'object' || Array.isArray(cover)) return undefined
      const row = cover as Record<string, unknown>
      if (row.kind !== 'book' || typeof row.bookId !== 'string' || row.bookId === '') return undefined
      ids.add(row.bookId)
    }
  }
  return ids.size === 1 ? [...ids][0] : undefined
}

/**
 * A question's two axes are optional on the wire: target defaults to the
 * station's topic, evidence to domain knowledge. Flat shorthands fill them in —
 * cardIds imply a marked target; pageId / url imply photo / web evidence; a
 * bare string sets just the kind. The service's two-axis gate is untouched: it
 * judges the normalized shape.
 */
function normalizeQuestionAxes(question: Record<string, unknown>): Record<string, unknown> {
  const { cardIds, quote, url, pageId, ...rest } = question
  const flatIds = Array.isArray(cardIds) ? cardIds.filter((id): id is string => typeof id === 'string' && id !== '') : undefined
  const rawTarget = typeof rest.target === 'string' ? { kind: rest.target } : rest.target
  const targetIn = rawTarget !== null && typeof rawTarget === 'object' && !Array.isArray(rawTarget) ? rawTarget as Record<string, unknown> : undefined
  let target: Record<string, unknown> = targetIn ?? (flatIds !== undefined && flatIds.length > 0 ? { kind: 'marked' } : { kind: 'topic' })
  if (flatIds !== undefined && flatIds.length > 0 && target.cardIds === undefined) target = { ...target, cardIds: flatIds }
  const rawEvidence = typeof rest.evidence === 'string' ? { kind: rest.evidence } : rest.evidence
  const evidenceIn = rawEvidence !== null && typeof rawEvidence === 'object' && !Array.isArray(rawEvidence) ? rawEvidence as Record<string, unknown> : undefined
  let evidence: Record<string, unknown> = evidenceIn ?? { kind: typeof pageId === 'string' && pageId !== '' ? 'photo' : typeof url === 'string' && url !== '' ? 'web' : 'knowledge' }
  for (const [key, value] of [['quote', quote], ['url', url], ['pageId', pageId]] as const) {
    if (typeof value === 'string' && value !== '' && evidence[key] === undefined) evidence = { ...evidence, [key]: value }
  }
  return { ...rest, target, evidence }
}

/**
 * Build the three tools. Creating them is the package's `./tool` row, which
 * applies the origin tag; this module never registers.
 * @param service - the library service the adapters translate to.
 * @param images - the session image references the tool row remembers (a
 *   page's photo is resolved from them, never trusted to the model's copy).
 * @returns the three definitions, untagged and unregistered.
 */
export function libraryToolDefinitions(service: LibraryService, images: ImageRefCache = new ImageRefCache()): ToolDefinition[] {
  /** The session's binding, when it has one. */
  const bindingOf = (exec: Exec | undefined): LibraryBinding | undefined => {
    const sessionId = sessionIdOf(exec)
    return sessionId === undefined ? undefined : service.getBinding(sessionId)
  }

  /** The project: the argument, else the binding, else the book's owner, else a lesson. */
  const projectOf = (value: unknown, exec: Exec | undefined, book?: string): string => {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    const bound = bindingOf(exec)?.projectId
    if (bound !== undefined) return bound
    if (book !== undefined) {
      const owner = service.findBookOwner(book)
      if (owner !== undefined) return owner
    }
    throw new Error('no project: this session is not bound to one and no book resolves one — library_read · projects lists them; ask the learner which one (ask_user_question), then library_write · binding { project, book? }')
  }

  /** A successful write knows its work context: an unbound session binds to it, and a project-bound session picks up the book it just registered — create the project, register the book, draft the path, and the chain has strung itself. Never steals another project's session, never yanks a book off one. */
  const autoBind = async (exec: Exec | undefined, binding: LibraryBinding): Promise<void> => {
    const sessionId = sessionIdOf(exec)
    if (sessionId === undefined) return
    const current = bindingOf(exec)
    if (current !== undefined && (current.projectId !== binding.projectId || current.bookId !== undefined)) return
    if (current !== undefined && binding.bookId === undefined) return
    await service.setBinding(sessionId, binding)
  }

  /** The book: the argument, else the binding's book, else a lesson. */
  const bookOf = (value: unknown, exec: Exec | undefined): string => {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    const bound = bindingOf(exec)?.bookId
    if (bound !== undefined) return bound
    throw new Error('no book: name it (library_read · books lists the project\'s), or bind this session to a book with library_write · binding')
  }

  const optBook = (value: unknown, exec: Exec | undefined): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : bindingOf(exec)?.bookId

  /** A path/quiz scope's book: a string wins, an explicit null means "the project's own path", absent falls back to the binding's book. */
  const scopeBookOf = (value: unknown, exec: Exec | undefined): string | undefined => {
    if (value === null) return undefined
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    return bindingOf(exec)?.bookId
  }

  const definitions: ToolDefinition[] = []

  definitions.push(defineTool({
    name: 'library_read',
    description:
      'Read the learner\'s library (read-only). what: '
      + '"projects" — every project with its books\' progress and card tallies, plus this session\'s binding; '
      + '"books" — a project\'s books with their tables of contents; '
      + '"resources" — a project\'s shelf links (article | video | repo | tool | course | hardware), each with its one-line why — light entries: no contents, no roadmap, never quizzed; '
      + '"toc" — one book (title, edition, kind, contents rows numbered n); '
      + '"roadmap" — the adopted path and any pending draft (book defaults to the binding\'s book; pass book: null for the project\'s own path); '
      + '"pages" — one book\'s photographed pages (printed text + the learner\'s marks), node narrows; '
      + '"cards" — the knowledge cards: query searches term, aliases, gloss and sentences; filters book, node, kind (word|concept), '
      + 'source (photo|chat|quiz|manual), weakMin (0-3), due; sorted weakest first — check here before teaching a point, '
      + 'to know where the learner got stuck before; '
      + '"quiz" — one quiz whole (quiz id), or the list; '
      + '"stats" — the whole library\'s tally. project and book default to this session\'s binding.',
    parameters: {
      what: { type: 'string', required: true, description: `What to read: ${READ_WHATS.join(' | ')}.` },
      project: { type: 'string', description: 'Project id (defaults to the binding).' },
      book: { type: 'json', description: 'Book id (defaults to the binding\'s book; null reads the project\'s own roadmap).' },
      node: { type: 'string', description: 'Roadmap node id (pages / cards).' },
      quiz: { type: 'string', description: 'Quiz id (quiz; omit for the list).' },
      query: { type: 'string', description: 'Free-text card search (cards).' },
      kind: { type: 'string', description: 'word | concept (cards).' },
      source: { type: 'string', description: 'photo | chat | quiz | manual (cards).' },
      weakMin: { type: 'integer', description: 'Only cards at least this weak, 0-3 (cards).' },
      due: { type: 'boolean', description: 'Only cards due for review (cards).' },
      limit: { type: 'integer', description: 'How many cards (default 30).' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      switch (args.what) {
        case 'projects': {
          const listed = await service.listProjects()
          return { ...listed, binding: bindingOf(exec) ?? null } as unknown as JsonValue
        }
        case 'books': {
          const detail = unwrap(await service.getProject({ id: projectOf(args.project, exec) }))
          return { project: detail.project, books: detail.books } as unknown as JsonValue
        }
        case 'resources':
          return (await service.listResources({ projectId: projectOf(args.project, exec) })) as unknown as JsonValue
        case 'toc': {
          const book = bookOf(args.book, exec)
          return unwrap(await service.getBook({ projectId: projectOf(args.project, exec, book), bookId: book })).book as unknown as JsonValue
        }
        case 'roadmap': {
          const book = scopeBookOf(args.book, exec)
          return (await service.getRoadmap({ projectId: projectOf(args.project, exec, book), ...(book === undefined ? {} : { bookId: book }) })) as unknown as JsonValue
        }
        case 'pages': {
          const book = bookOf(args.book, exec)
          return (await service.listPages({
            projectId: projectOf(args.project, exec, book),
            bookId: book,
            ...(args.node === undefined ? {} : { nodeId: args.node }),
          })) as unknown as JsonValue
        }
        case 'cards': {
          const book = typeof args.book === 'string' && args.book.trim() !== '' ? args.book.trim() : undefined
          const result = await service.listCards({
            projectId: projectOf(args.project, exec, book),
            ...(book === undefined ? {} : { bookId: book }),
            ...(args.node === undefined ? {} : { nodeId: args.node }),
            ...(args.query === undefined ? {} : { query: args.query }),
            ...(args.kind === 'word' || args.kind === 'concept' ? { kind: args.kind as LibraryCardKind } : {}),
            ...(['photo', 'chat', 'quiz', 'manual'].includes(args.source ?? '') ? { source: args.source as LibraryCardSourceType } : {}),
            ...(args.weakMin === undefined ? {} : { weakMin: args.weakMin }),
            ...(args.due === true ? { due: true } : {}),
            limit: args.limit ?? 30,
          })
          // The model needs the card, not its whole ledger: sources compress to counts.
          return {
            total: result.total,
            cards: result.cards.map(card => ({
              id: card.id,
              kind: card.kind,
              term: card.term,
              ...(card.aliases.length === 0 ? {} : { aliases: card.aliases }),
              gloss: card.gloss,
              ...(card.userGloss === undefined ? {} : { userGloss: card.userGloss }),
              ...(card.bookId === undefined ? {} : { book: card.bookId }),
              contexts: card.contexts.slice(0, 2).map(context => context.sentence),
              weakness: card.weakness,
              box: card.mastery.box,
              dueAt: card.mastery.dueAt,
              sources: card.sources.map(source => source.note === undefined ? source.type : `${source.type}: ${source.note}`).slice(-4),
            })),
          } as unknown as JsonValue
        }
        case 'quiz': {
          const book = optBook(args.book, exec)
          const project = projectOf(args.project, exec, book)
          if (args.quiz === undefined || args.quiz.trim() === '') {
            return (await service.listQuizzes({ projectId: project, ...(book === undefined ? {} : { bookId: book }) })) as unknown as JsonValue
          }
          return unwrap(await service.getQuiz({ projectId: project, quizId: args.quiz.trim() })).quiz as unknown as JsonValue
        }
        case 'stats':
          return (await service.stats()) as unknown as JsonValue
        default:
          throw new Error(`what is required — one of ${READ_WHATS.join(' | ')} — got ${JSON.stringify(args.what) ?? 'nothing'}; e.g. { what: "books" } reads the bound project's books`)
      }
    },
  }))

  definitions.push(defineTool({
    name: 'library_write',
    description:
      'Validate and persist what you authored: what plus its fields as TOP-LEVEL parameters (each field is documented below, where you write it; project / book default to this session\'s binding). '
      + 'project — create (name + template), or edit with project: <id> (goal "" clears). '
      + 'book — register (title + bookKind + toc + tocSource): never ask for an upload; web-verify the exact edition\'s contents first and cite the page (a publisher / catalog / retailer page, never a full-text copy). '
      + 'roadmap — write a DRAFT (nodes) the learner adopts in the sidebar (采用); the scope reads itself off the covers: every station drawing on the same single book lands on THAT book\'s path, anything mixed lands on the project\'s own — omit book (a string is an explicit override). '
      + 'notes — a station\'s 讲义 (node + text, markdown): the textbook on a 讲授 (topic) station, marginalia on a book station; rewrite as 补讲 deepens. '
      + 'page — record a photographed page (text + marks), carding every mark at once. '
      + 'cards — record a weak point when the learner is stuck, and say what you noted. '
      + 'quiz — store a composed quiz (questions; node names the quiz-kind station it gates — omitted, it is book-level (the book page\'s 本书测验), or free with book: null (the project page\'s 自由测验); focus is the learner\'s choice; a question\'s target defaults to topic (flat cardIds imply marked), evidence to knowledge (flat pageId / url imply photo / web)). '
      + 'resource — op add | remove: a light shelf link (no contents, no roadmap, never quizzed; something referenced BY CHAPTER is a book instead). '
      + 'binding — bind this session (binding: null unbinds). '
      + 'A refusal names exactly what to fix — change only that and resend.',
    parameters: {
      what: { type: 'string', required: true, description: `What to write: ${WRITE_WHATS.join(' | ')}. The payload goes in the TOP-LEVEL fields below (title / toc / nodes / text / questions / …), not in a wrapper object.` },
      project: { type: 'json', description: 'The project id (defaults to this session\'s binding; a book id resolves its owner). what=project: omit it to create; pass the id to edit.' },
      book: { type: 'json', description: 'Defaults to the binding\'s book; null = the project\'s own path (notes / quiz). what=roadmap: omit it — the scope reads itself off the covers; a string is an explicit override, validated as before.' },
      name: { type: 'string', description: 'what=project: the project\'s name.' },
      template: { type: 'string', description: 'what=project: "language" (marks are words) | "subject" (marks are concepts) | "custom".' },
      goal: { type: 'string', description: 'what=project: the one-line goal.' },
      title: { type: 'string', description: 'what=book: the exact edition\'s title. what=resource · op=add: what the link\'s own page calls it.' },
      short: { type: 'string', description: 'what=book: a 2-4 character cover abbreviation (剑5 / PNS).' },
      author: { type: 'string', description: 'what=book.' },
      edition: { type: 'string', description: 'what=book (e.g. 2020 年 9 月第一版).' },
      isbn: { type: 'string', description: 'what=book.' },
      bookKind: { type: 'string', description: 'what=book: "knowledge" | "material" ("material" = exam papers / novels / anthologies — specific text you cannot recall).' },
      toc: {
        oneOf: [
          { type: 'array', description: 'One row per chapter or passage.', items: { oneOf: [
            { type: 'string', description: 'A bare row title.' },
            { type: 'object', additionalProperties: true, properties: {
              title: { type: 'string', required: true, description: 'The chapter / passage title.' },
              part: { type: 'string', description: 'The part heading this row belongs to (a part is never a row of its own).' },
            } },
          ] } },
          { type: 'string', description: 'The whole contents as ONE newline-joined string of titles (the form least mangled by models).' },
        ],
        description: 'what=book: the contents (required).',
      },
      extras: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
            title: { type: 'string', required: true },
            note: { type: 'string' },
            where: { type: 'string' },
            when: { type: 'string', required: true, enum: ['before', 'reference'], description: 'before: read before starting; reference: consult when needed.' },
          } } },
          { type: 'string', description: 'The same array as its JSON text.' },
        ],
        description: 'what=book: how-to-use pages, answer keys, transcripts, appendices — NOT roadmap nodes.',
      },
      tocSource: {
        oneOf: [
          { type: 'object', additionalProperties: true, properties: {
            by: { type: 'string', required: true, enum: ['web', 'model', 'photo'], description: 'web: you verified it online (cite url); model: from memory; photo: from the learner\'s photo.' },
            url: { type: 'string', description: 'The page you verified (publisher / catalog / retailer).' },
          } },
          { type: 'string', description: 'The same object as its JSON text.' },
        ],
        description: 'what=book: where the contents came from (required).',
      },
      bookId: { type: 'string', description: 'what=book: correct this existing book instead of adding (library_read · books lists the ids).' },
      nodes: {
        oneOf: [
          { type: 'array', description: 'The stations, in dependency order.', items: { type: 'object', additionalProperties: true, properties: {
            id: { type: 'string', required: true, description: 'Unique station id (letters, digits, . _ -).' },
            title: { type: 'string', required: true, description: 'What the learner masters here.' },
            kind: { type: 'string', required: true, enum: ['quiz', 'read', 'practice'], description: 'quiz: a level gated by its chapter quiz (depends only on quiz / practice nodes); practice: a hands-on station gated by acceptance lines; read: an optional side stop (读完 completes it, never gates).' },
            goals: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: 'What to master / complete here — a quiz / read station\'s completion expectations live HERE, never in acceptance.' },
            covers: { type: 'array', description: 'What the station draws on (at least one). On a book\'s own path: exactly one book cover naming that book.', items: { type: 'object', additionalProperties: true, properties: {
              kind: { type: 'string', required: true, enum: ['book', 'resource', 'url', 'topic'], description: 'book: a shelf book\'s chapters (+ bookId, ranges); resource: a shelf link (+ resourceId); url: a bare link (+ url, title?); topic: plain coached teaching (+ text).' },
              bookId: { type: 'string', description: 'kind=book: the book (library_read · books lists ids).' },
              ranges: { type: 'array', description: 'kind=book: contents rows, 1-based inclusive.', items: { type: 'object', additionalProperties: true, properties: {
                from: { type: 'integer', required: true },
                to: { type: 'integer', required: true },
              } } },
              resourceId: { type: 'string', description: 'kind=resource: the shelf entry (library_read · resources).' },
              url: { type: 'string', description: 'kind=url.' },
              title: { type: 'string', description: 'kind=url: a short label.' },
              text: { type: 'string', description: 'kind=topic: what the coach teaches here.' },
              by: { type: 'string', enum: ['web', 'model', 'user'], description: 'url / resource provenance: "web" once actually opened (+ verifiedAt), "model" straight from memory (verify and replace before the learner adopts), "user" when the learner gave it.' },
              verifiedAt: { type: 'string', description: 'ISO time of the web check.' },
            } } },
            dependsOn: { type: 'array', items: { type: 'string' }, description: 'Earlier station ids this one gates on.' },
            acceptance: { type: 'array', items: { type: 'string' }, description: 'kind=practice only: the criteria — one verbatim verdict.criterion per line at assess time.' },
          } } },
          { type: 'string', description: 'The same array as its JSON text.' },
        ],
        description: 'what=roadmap: the stations of the DRAFT the learner adopts in the sidebar (采用).',
      },
      passRatio: { type: 'number', description: 'what=roadmap: the pass line in (0, 1] — 0.8 means 8 of 10 right (the default).' },
      note: { type: 'string', description: 'what=roadmap: the one-line pacing on the draft card. what=resource · op=add: one line on why the link earns its place.' },
      node: { type: 'string', description: 'what=notes: the station. what=quiz: the quiz-kind station the quiz gates — omit for a book-level quiz (the book page\'s 本书测验), or with book: null a free one (the project page\'s 自由测验).' },
      text: { type: 'string', description: 'what=notes: the station\'s 讲义 in markdown (math in $…$ / $$…$$ LaTeX renders for the learner). what=page: the photographed page\'s printed text.' },
      attachment: { type: 'string', description: 'what=page: the image id (omit for the latest photo in this conversation).' },
      label: { type: 'string', description: 'what=page: what the learner calls the page (「p.16」).' },
      marks: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
            text: { type: 'string', required: true, description: 'The marked word / phrase, as printed.' },
            sentence: { type: 'string', description: 'The sentence it sits in, as printed.' },
            handNote: { type: 'string', description: 'The learner\'s handwritten gloss beside it, transcribed.' },
            gloss: { type: 'string', description: 'The in-context meaning.' },
            uncertain: { type: 'boolean', description: 'You could not tell — kept, never auto-carded.' },
          } } },
          { type: 'string', description: 'The same array as its JSON text.' },
        ],
        description: 'what=page: every mark on the photographed page.',
      },
      cards: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
            kind: { type: 'string', required: true, enum: ['word', 'concept'] },
            term: { type: 'string', required: true },
            gloss: { type: 'string', required: true, description: 'The in-context meaning.' },
            aliases: { type: 'array', items: { type: 'string' } },
            userGloss: { type: 'string', description: 'The learner\'s own wording.' },
            context: { type: 'object', additionalProperties: true, properties: {
              sentence: { type: 'string' },
              node: { type: 'string', description: 'The station id.' },
            } },
            source: { type: 'object', additionalProperties: true, properties: {
              type: { type: 'string', required: true, enum: ['chat', 'photo', 'quiz', 'manual'] },
              note: { type: 'string' },
            }, description: 'When the learner is stuck: chat + weaken true.' },
            weaken: { type: 'boolean', description: 'The learner is stuck on it.' },
            mergeInto: { type: 'string', description: 'Resolve a pending near-duplicate: merge into this card id.' },
            asNew: { type: 'boolean', description: 'Resolve a pending near-duplicate: keep it separate.' },
          } } },
          { type: 'string', description: 'The same array as its JSON text.' },
        ],
        description: 'what=cards: the weak points to record.',
      },
      focus: { type: 'string', description: 'what=quiz: "mine" | "book" | "mixed" — the learner\'s choice of source.' },
      questions: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
            id: { type: 'string', required: true },
            kind: { type: 'string', required: true, enum: ['choice', 'fill', 'free'], description: 'choice: the answer IS one of options, verbatim; fill: a short verbatim answer (a term, a formula, a date); free: an open discussion (the prompt locates the passage).' },
            prompt: { type: 'string', required: true },
            options: { type: 'array', description: 'choice only.', items: { oneOf: [
              { type: 'string', description: 'The option text.' },
              { type: 'object', additionalProperties: true, properties: { label: { type: 'string', required: true, description: 'The option text (the label form is stored as its plain text).' } } },
            ] } },
            answer: { type: 'string', required: true, description: 'choice: the correct option, copied verbatim.' },
            explanation: { type: 'string', description: 'Why the answer is right.' },
            target: {
              oneOf: [
                { type: 'object', additionalProperties: true, properties: {
                  kind: { type: 'string', required: true, enum: ['marked', 'asked', 'missed', 'topic'], description: 'The learner\'s own cards first (marked / asked / missed + cardIds), else the chapter\'s topic.' },
                  cardIds: { type: 'array', items: { type: 'string' } },
                } },
                { type: 'string', enum: ['marked', 'asked', 'missed', 'topic'], description: 'Just the kind.' },
              ],
              description: 'OPTIONAL: what the question probes — omit for the station\'s topic (the default); flat cardIds imply marked.',
            },
            evidence: {
              oneOf: [
                { type: 'object', additionalProperties: true, properties: {
                  kind: { type: 'string', required: true, enum: ['photo', 'web', 'knowledge'], description: 'photo quotes a recorded page (pageId + quote); web cites url + quote; knowledge only where the station\'s covers allow it.' },
                  pageId: { type: 'string' },
                  url: { type: 'string' },
                  quote: { type: 'string', description: 'The passage, verbatim.' },
                } },
                { type: 'string', enum: ['photo', 'web', 'knowledge'], description: 'Just the kind.' },
              ],
              description: 'OPTIONAL: what the answer rests on — omit for domain knowledge (the default); the flat pageId / url / quote set the kind. The verbatim gate still bites: a material book, a shelf resource or a url among the covers demands a quote.',
            },
            cardIds: { type: 'array', items: { type: 'string' }, description: 'Shorthand for target.cardIds (kind defaults to marked): live cards from library_read · cards.' },
            quote: { type: 'string', description: 'Shorthand for evidence.quote (with pageId → photo, with url → web).' },
            url: { type: 'string', description: 'Shorthand: evidence { kind: "web", url, quote? }.' },
            pageId: { type: 'string', description: 'Shorthand: evidence { kind: "photo", pageId, quote? } — page ids from library_read · pages.' },
          } } },
          { type: 'string', description: 'The same array as its JSON text.' },
        ],
        description: 'what=quiz: the questions of the composed quiz — target / evidence are OPTIONAL (defaults: the station\'s topic + domain knowledge). Math typesets: write it as $…$ (inline) or $$…$$ (block) LaTeX and it renders for the learner — \\sqrt{3-x} over \\sqrt{(3-x)/(x+2)} is exactly the vinculum difference.',
      },
      op: { type: 'string', description: 'what=resource: add | remove.' },
      url: { type: 'string', description: 'what=resource · op=add: the link — open it on the web first.' },
      kind: { type: 'string', description: 'what=resource: article | video | repo | tool | course | hardware.' },
      addedBy: { type: 'string', description: 'what=resource: "coach" (the default) | "learner".' },
      resourceId: { type: 'string', description: 'what=resource · op=remove: the shelf entry id (library_read · resources lists them).' },
      binding: {
        oneOf: [
          { type: 'object', additionalProperties: true, properties: {
            project: { type: 'string', required: true, description: 'The project id (library_read · projects lists them).' },
            book: { type: 'string', description: 'Optionally the book within it.' },
          } },
          { type: 'null', description: 'Unbind this session.' },
        ],
        description: 'what=binding: bind this session to a project (and optionally a book).',
      },
    },
    output: jsonOutput(),
    // Writes serialize on the store's locks; one at a time keeps their order legible.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      // Payloads arrive as objects — or, from models that stringify deep
      // parameters (common with big nested ones), as their JSON text; both
      // parse. A refusal names what actually arrived, so the model fixes the
      // transport instead of guessing at the shape.
      const payload = (value: unknown): Record<string, unknown> | undefined => {
        if (typeof value === 'string') {
          try { value = JSON.parse(value) } catch { return undefined }
        }
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
      }
      const payloadList = (value: unknown): unknown[] | undefined => {
        if (typeof value === 'string') {
          try { value = JSON.parse(value) } catch { return undefined }
        }
        return Array.isArray(value) ? value : undefined
      }
      const arrival = (field: string, value: unknown): string => {
        if (value === undefined) return `no ${field} field arrived — set the ${field} field itself; its value may be the object or its JSON text`
        if (typeof value === 'string') {
          try {
            JSON.parse(value)
            return `${field} arrived as JSON text that is not the expected shape`
          } catch {
            return `${field} arrived as text that is not valid JSON — send the object itself (or its JSON text)`
          }
        }
        return `${field} arrived as ${Array.isArray(value) ? 'an array' : typeof value} with an unexpected shape`
      }
      // The canonical form is FLAT top-level fields (title / toc / nodes / …);
      // a nested payload in the what-named slot (book: {…}, roadmap: {…}) is
      // the tolerated legacy form — undeclared keys pass the open parameter
      // root, so read them through this record view. Flat wins when both arrive.
      const legacy = args as unknown as Record<string, unknown>
      const strField = (key: keyof typeof args): Record<string, string> =>
        typeof args[key] === 'string' ? { [key]: args[key] as string } : {}
      switch (args.what) {
        case 'project': {
          const nested = payload(args.project)
          const body: Record<string, unknown> = { ...(nested ?? {}), ...strField('name'), ...strField('goal'), ...strField('template') }
          const editId = typeof args.project === 'string' && args.project.trim() !== '' ? args.project.trim() : (typeof body.id === 'string' ? body.id : undefined)
          if (editId !== undefined) {
            const { id: _id, ...patch } = body
            if (Object.keys(patch).length === 0) throw new Error('editing a project takes project: "<id>" (a minted id — library_read · projects lists them; to CREATE a project omit project and set name + template) plus the top-level fields to change (name? / goal? / template?)')
            const edited = unwrap(await service.updateProject({ id: editId, patch: patch as { name?: string; goal?: string; template?: LibraryTemplate } }))
            await autoBind(exec, { projectId: edited.project.id })
            return edited as unknown as JsonValue
          }
          if (typeof body.name !== 'string') {
            throw new Error(`what=project takes top-level fields: name, template ("language"|"subject"|"custom"), goal? — e.g. { what: "project", name: "数学", template: "subject" } — ${arrival('name', args.name)}`)
          }
          const created = unwrap(await service.createProject(body as { name: string }))
          await autoBind(exec, { projectId: created.project.id })
          return created as unknown as JsonValue
        }
        case 'book': {
          const nested = payload(args.book)
          const body: Record<string, unknown> = {
            ...(nested ?? {}),
            ...strField('title'), ...strField('short'), ...strField('author'), ...strField('edition'), ...strField('isbn'), ...strField('bookKind'), ...strField('bookId'),
            ...(args.toc !== undefined ? { toc: args.toc } : {}),
            ...(args.extras !== undefined ? { extras: args.extras } : {}),
            ...(args.tocSource !== undefined ? { tocSource: args.tocSource } : {}),
          }
          if (typeof body.title !== 'string' || (!Array.isArray(body.toc) && typeof body.toc !== 'string')) {
            const got = [typeof body.title === 'string' ? 'title ✓' : 'title ✗ MISSING', body.toc !== undefined ? 'toc ✓' : 'toc ✗ MISSING'].join(' · ')
            throw new Error(`what=book takes TOP-LEVEL fields: title, bookKind: "knowledge"|"material", toc ([{ title, part? }] | a bare string per row | one newline-joined string), tocSource: { by, url? } (+ short?, author?, edition?, isbn?, extras?) — got ${got}`)
          }
          // A whole contents may arrive as one newline-joined string — the
          // biggest single payload, and the one models mangle most as JSON.
          const tocList = payloadList(body.toc)
          const tocRows = typeof body.toc === 'string' && payloadList(body.toc) === undefined
            ? body.toc.split('\n').map(line => line.trim()).filter(line => line !== '')
            : (tocList ?? [])
          const toc = tocRows.map(row => typeof row === 'string' ? { title: row } : row as { title: string; part?: string })
          const projectId = projectOf(args.project, exec)
          const written = unwrap(await service.putBook({
            projectId,
            ...(typeof body.bookId === 'string' ? { bookId: body.bookId } : {}),
            title: body.title,
            ...(typeof body.author === 'string' ? { author: body.author } : {}),
            ...(typeof body.edition === 'string' ? { edition: body.edition } : {}),
            ...(typeof body.isbn === 'string' ? { isbn: body.isbn } : {}),
            bookKind: body.bookKind as 'knowledge' | 'material',
            ...(typeof body.short === 'string' ? { short: body.short } : {}),
            ...(Array.isArray(payloadList(body.extras)) ? { extras: payloadList(body.extras) as { title: string; note?: string; where?: string; when?: 'before' | 'reference' }[] } : {}),
            toc,
            tocSource: (payload(body.tocSource) ?? { by: 'model' }) as { by: 'web' | 'model' | 'photo'; url?: string },
          }))
          await autoBind(exec, { projectId, bookId: written.book.id })
          return written as unknown as JsonValue
        }
        case 'roadmap': {
          const nested = payload(legacy.roadmap)
          const list = payloadList(args.nodes ?? nested?.nodes)
          if (list === undefined) {
            throw new Error(`what=roadmap takes the TOP-LEVEL nodes field: nodes: [{ id, title, kind: "quiz"|"read"|"practice", goals, covers: [{ kind: "book", bookId, ranges: [{ from, to }] } | { kind: "resource", resourceId } | { kind: "url", url } | { kind: "topic", text }], dependsOn, acceptance? (practice only) }] (+ passRatio?, note?) — ${arrival('nodes', args.nodes ?? nested?.nodes ?? legacy.roadmap)}`)
          }
          const rawBook = args.book === null || typeof args.book === 'string' ? args.book : nested?.book === null || typeof nested?.book === 'string' ? nested.book : undefined
          // The scope reads itself off the covers: every station drawing on
          // the same single book lands on THAT book's path, anything mixed
          // lands on the project's own. `book` survives only as an explicit
          // override (a string is honored and validated as before); the
          // binding's book is consulted solely by the chapterRanges sugar.
          const overrideBook = typeof rawBook === 'string' ? rawBook : undefined
          const sugarBook = overrideBook ?? bindingOf(exec)?.bookId
          const nodes = (list as Record<string, unknown>[]).map(node => {
            const { chapterRanges, covers, ...rest } = node
            if (covers !== undefined) {
              // Tolerate the natural shorthand: a cover's target may arrive as
              // book / resource; the stored fields are bookId / resourceId.
              const aliased = (covers as Record<string, unknown>[]).map(cover => {
                if (cover === null || typeof cover !== 'object' || Array.isArray(cover)) return cover
                const { book, resource, ...restCover } = cover as Record<string, unknown>
                return {
                  ...restCover,
                  ...(restCover.bookId === undefined && typeof book === 'string' ? { bookId: book } : {}),
                  ...(restCover.resourceId === undefined && typeof resource === 'string' ? { resourceId: resource } : {}),
                }
              })
              return { ...rest, covers: aliased }
            }
            // Sugar for the book special case: chapterRanges wrap into the
            // one book cover a book's own path allows.
            if (chapterRanges !== undefined) {
              if (sugarBook === undefined) {
                throw new Error('chapterRanges count a book\'s contents rows — the covers need the book named: { kind: "book", bookId, ranges: [{ from, to }] } (or bind this session to the book first)')
              }
              return { ...rest, covers: [{ kind: 'book', bookId: sugarBook, ranges: chapterRanges }] }
            }
            return rest
          })
          const bookId = overrideBook ?? deriveRoadmapBook(nodes)
          const projectId = projectOf(args.project, exec, bookId)
          const drafted = unwrap(await service.draftRoadmap({
            projectId,
            ...(bookId === undefined ? {} : { bookId }),
            nodes: nodes as unknown as Parameters<LibraryService['draftRoadmap']>[0]['nodes'],
            ...(typeof args.passRatio === 'number' ? { passRatio: args.passRatio } : typeof nested?.passRatio === 'number' ? { passRatio: nested.passRatio as number } : {}),
            ...(typeof args.note === 'string' ? { note: args.note } : typeof nested?.note === 'string' ? { note: nested.note as string } : {}),
          }))
          await autoBind(exec, { projectId, ...(bookId === undefined ? {} : { bookId }) })
          const placedOn = bookId === undefined
            ? "the project's own path (the covers mix sources)"
            : `《${unwrap(await service.getBook({ projectId, bookId })).book.title}》's path`
          return { ...drafted, scopeNote: `draft placed on ${placedOn} — the learner adopts it in the sidebar (采用)` } as unknown as JsonValue
        }
        case 'notes': {
          const nested = payload(legacy.notes)
          const nodeId = typeof args.node === 'string' && args.node !== '' ? args.node : (typeof nested?.node === 'string' ? nested.node as string : undefined)
          const text = typeof args.text === 'string' && args.text !== '' ? args.text : (typeof nested?.text === 'string' ? nested.text as string : undefined)
          if (nodeId === undefined || text === undefined) {
            throw new Error(`what=notes takes TOP-LEVEL fields: node: <station id>, text: <the station's 讲义, markdown> — got node ${nodeId === undefined ? '✗ MISSING' : '✓'} · text ${text === undefined ? '✗ MISSING' : '✓'}`)
          }
          const rawBook = args.book === null || typeof args.book === 'string' ? args.book : nested?.book === null || typeof nested?.book === 'string' ? nested.book : undefined
          const bookId = rawBook === null ? undefined : (rawBook as string | undefined) ?? bindingOf(exec)?.bookId
          return unwrap(await service.putNotes({
            projectId: projectOf(args.project, exec, bookId),
            ...(bookId === undefined ? {} : { bookId }),
            nodeId,
            text,
          })) as unknown as JsonValue
        }
        case 'page': {
          const nested = payload(legacy.page)
          const pageText = typeof args.text === 'string' && args.text !== '' ? args.text : (typeof nested?.text === 'string' ? nested.text as string : undefined)
          const marks = payloadList(args.marks ?? nested?.marks)
          if (pageText === undefined || marks === undefined) {
            throw new Error(`what=page takes TOP-LEVEL fields: text (the page's printed text), marks: [{ text, sentence?, handNote?, gloss?, uncertain? }] (+ attachment?, label?, node?) — got text ${pageText === undefined ? '✗ MISSING' : '✓'} · marks ${marks === undefined ? '✗ MISSING' : '✓'}`)
          }
          const attachmentRef = typeof args.attachment === 'string' ? args.attachment : nested?.attachment
          const attachment = images.resolve(sessionIdOf(exec), attachmentRef)
          if (attachment === undefined) {
            throw new Error('no photo to record: this conversation has no image the library saw arrive (or the id names none) — ask the learner to send the page photo here, then record it')
          }
          const pageNode = typeof args.node === 'string' && args.node !== '' ? args.node : (typeof nested?.node === 'string' ? nested.node as string : undefined)
          const pageBook = bookOf(typeof args.book === 'string' ? args.book : nested?.book, exec)
          return unwrap(await service.recordPage({
            projectId: projectOf(args.project, exec, pageBook),
            bookId: pageBook,
            ...(pageNode === undefined ? {} : { nodeId: pageNode }),
            ...(typeof (args.label ?? nested?.label) === 'string' ? { label: (args.label ?? nested?.label) as string } : {}),
            attachment,
            text: pageText,
            marks: marks as LibraryMark[],
          })) as unknown as JsonValue
        }
        case 'cards': {
          const list = payloadList(args.cards)
          if (list === undefined) {
            throw new Error(`what=cards takes cards: [{ kind: "word"|"concept", term, gloss, context?, source: { type: "chat", note? }, weaken? }] — ${arrival('cards', args.cards)}`)
          }
          const sessionId = sessionIdOf(exec)
          const cards = (list as Record<string, unknown>[]).map(card => {
            const source = payload(card.source) ?? { type: 'chat' }
            const context = payload(card.context)
            return {
              ...card,
              source: { ...source, ...(source.type === 'chat' && source.ref === undefined && sessionId !== undefined ? { ref: sessionId } : {}) },
              ...(context === undefined ? {} : { context: { sentence: String(context.sentence ?? ''), ...(typeof context.node === 'string' ? { nodeId: context.node } : {}) } }),
            } as unknown as LibraryCardInput
          })
          const book = optBook(args.book, exec)
          return unwrap(await service.writeCards({
            projectId: projectOf(args.project, exec, book),
            ...(book === undefined ? {} : { bookId: book }),
            cards,
          })) as unknown as JsonValue
        }
        case 'quiz': {
          const nested = payload(legacy.quiz)
          const questions = payloadList(args.questions ?? nested?.questions)
          if (questions === undefined) {
            throw new Error(`what=quiz takes the TOP-LEVEL questions field: questions: [{ id, kind: "choice"|"fill"|"free", prompt, options?, answer, explanation?, target: { kind, cardIds? }, evidence: { kind, pageId?, url?, quote? } }] (+ node?, focus?) — ${arrival('questions', args.questions ?? nested?.questions ?? legacy.quiz)}`)
          }
          const node = typeof args.node === 'string' && args.node !== '' ? args.node : (typeof nested?.node === 'string' ? nested.node as string : undefined)
          const rawBook = args.book === null || typeof args.book === 'string' ? args.book : nested?.book === null || typeof nested?.book === 'string' ? nested.book : undefined
          const bookId = rawBook === null ? undefined : (rawBook as string | undefined) ?? bindingOf(exec)?.bookId
          const focus = args.focus ?? nested?.focus
          // Options may arrive as { label } objects or a letter-keyed map —
          // the stored form is plain strings (the same tolerance reads them
          // back); the two axes default (topic + knowledge) and take the flat
          // cardIds / quote / url / pageId shorthands.
          const cleaned = (questions as Record<string, unknown>[]).map(question => {
            let next = question
            if (next.options !== undefined) {
              const options = normalizeQuizOptions(next.options)
              if (options !== undefined) next = { ...next, options }
            }
            return normalizeQuestionAxes(next)
          })
          const projectId = projectOf(args.project, exec, bookId)
          const written = unwrap(await service.putQuiz({
            projectId,
            quiz: {
              ...(focus === 'mine' || focus === 'book' || focus === 'mixed' ? { focus } : {}),
              scope: { ...(bookId === undefined ? {} : { bookId }), ...(node === undefined ? {} : { nodeId: node }) },
              questions: cleaned as unknown as LibraryQuizQuestion[],
            },
          }))
          await autoBind(exec, { projectId, ...(bookId === undefined ? {} : { bookId }) })
          return written as unknown as JsonValue
        }
        case 'resource': {
          const nested = payload(legacy.resource)
          if (args.op === 'add') {
            const title = typeof args.title === 'string' && args.title !== '' ? args.title : (typeof nested?.title === 'string' ? nested.title as string : undefined)
            const url = typeof args.url === 'string' && args.url !== '' ? args.url : (typeof nested?.url === 'string' ? nested.url as string : undefined)
            if (title === undefined || url === undefined) {
              throw new Error(`what=resource · op=add takes TOP-LEVEL fields: title, url, kind: "article"|"video"|"repo"|"tool"|"course"|"hardware", note? — a light link on the project's shelf; open it on the web first, and let note say why it earns its place — got title ${title === undefined ? '✗ MISSING' : '✓'} · url ${url === undefined ? '✗ MISSING' : '✓'}`)
            }
            const projectId = projectOf(args.project, exec)
            const added = unwrap(await service.addResource({
              projectId,
              resource: {
                title,
                url,
                kind: (typeof args.kind === 'string' ? args.kind : nested?.kind) as LibraryResourceKind,
                ...(typeof (args.note ?? nested?.note) === 'string' ? { note: (args.note ?? nested?.note) as string } : {}),
                addedBy: (args.addedBy ?? nested?.addedBy) === 'learner' ? 'learner' : 'coach',
              },
            }))
            await autoBind(exec, { projectId })
            return added as unknown as JsonValue
          }
          if (args.op === 'remove') {
            const resourceId = typeof args.resourceId === 'string' && args.resourceId !== '' ? args.resourceId : (typeof nested?.id === 'string' ? nested.id as string : undefined)
            if (resourceId === undefined) throw new Error('what=resource · op=remove takes the top-level resourceId field — library_read · resources lists the ids')
            return unwrap(await service.removeResource({ projectId: projectOf(args.project, exec), resourceId })) as unknown as JsonValue
          }
          throw new Error(`what=resource needs op: add | remove — got ${JSON.stringify(args.op)}`)
        }
        case 'binding': {
          const sessionId = sessionIdOf(exec)
          if (sessionId === undefined) throw new Error('binding needs a session — this call came from none')
          // Only an explicit null unbinds. A model as often names the target at
          // the top level as inside binding (live trial) — both bind.
          if (args.binding === null) return unwrap(await service.setBinding(sessionId, null)) as unknown as JsonValue
          const body = payload(args.binding) ?? {}
          const pick = (...values: unknown[]): string | undefined => values.find((value): value is string => typeof value === 'string' && value.trim() !== '')?.trim()
          const projectId = pick(body.project, body.projectId, args.project)
          const bookId = pick(body.book, body.bookId, args.book)
          if (projectId === undefined) {
            throw new Error('binding needs the project: binding { project, book? } (library_read · projects lists them); pass binding: null to unbind')
          }
          return unwrap(await service.setBinding(sessionId, { projectId, ...(bookId === undefined ? {} : { bookId }) })) as unknown as JsonValue
        }
        default:
          throw new Error(`what is required — one of ${WRITE_WHATS.join(' | ')} — got ${JSON.stringify(args.what) ?? 'nothing'}; e.g. { what: "binding", binding: { project: "p_…" } } binds this session`)
      }
    },
  }))

  definitions.push(defineTool({
    name: 'library_assess',
    description:
      'Ledger a graded sitting — the ONLY cascading write. Judge the answers in the conversation first (against each question\'s answer and evidence), '
      + 'then record one verdict per question: { task: <question id>, criterion: <what you judged>, pass, ratio?: <partial credit 0..1>, evidence: <what it rests on>, '
      + 'by: "llm"|"self"|"user", void?: true when the learner flagged the question as broken, missedCard?: { term, gloss } for a missed question that targets no card }. '
      + 'The engine moves every probed card (a pass climbs a review box and eases weakness; a miss resets it to tomorrow and adds weakness), creates a card for a '
      + 'card-less miss, updates the gated node, and completes it at the pass ratio (default 0.8), unlocking what follows — report what moved and what unlocked. '
      + 'Practice acceptance: pass node instead of quiz (plus book when the station sits on a book\'s path) — the station must be a practice node, and every '
      + 'verdict\'s criterion is one of its acceptance lines, VERBATIM; the learner submits the evidence (terminal output, a screenshot, a repo link), you judge each line. Same cascade.',
    parameters: {
      project: { type: 'string', description: 'Project id (defaults to the binding).' },
      quiz: { type: 'string', description: 'The quiz id library_write · quiz returned (a quiz sitting).' },
      node: { type: 'string', description: 'Practice station id (an acceptance sitting — instead of quiz).' },
      book: { type: 'string', description: 'Book id when the practice station sits on a book\'s path (omit for the project\'s).' },
      verdicts: {
        type: 'array',
        required: true,
        description: 'One verdict per question.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            task: { type: 'string', description: 'The question id.' },
            criterion: { type: 'string', description: 'What was judged, in one line.' },
            pass: { type: 'boolean', description: 'Whether the answer passes.' },
            ratio: { type: 'number', description: 'Partial credit 0..1.' },
            evidence: { type: 'string', description: 'What the judgment rests on.' },
            by: { type: 'string', enum: ['llm', 'self', 'user'], description: 'Who graded.' },
            void: { type: 'boolean', description: 'The learner flagged the question as broken: it counts for nothing.' },
            missedCard: {
              type: 'object',
              additionalProperties: false,
              description: 'For a missed question with no target card: the card to create.',
              properties: { term: { type: 'string' }, gloss: { type: 'string' } },
            },
          },
        },
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!Array.isArray(args.verdicts) || args.verdicts.length === 0) {
        throw new Error('verdicts is required — one verdict per question: [{ task: <question id>, criterion: <what you judged>, pass, evidence: <what it rests on>, by: "llm"|"self"|"user", ratio?, void?, missedCard? }]')
      }
      const node = typeof args.node === 'string' && args.node.trim() !== '' ? args.node.trim() : undefined
      if (node !== undefined) {
        const book = typeof args.book === 'string' && args.book.trim() !== '' ? args.book.trim() : undefined
        return unwrap(await service.putAttempt({
          projectId: projectOf(args.project, exec),
          nodeId: node,
          ...(book === undefined ? {} : { bookId: book }),
          verdicts: [...args.verdicts] as LibraryVerdict[],
        })) as unknown as JsonValue
      }
      if (args.quiz === undefined || args.quiz.trim() === '') throw new Error('quiz is the id library_write · quiz returned — or pass node (a practice station\'s id) for acceptance')
      return unwrap(await service.putAttempt({
        projectId: projectOf(args.project, exec),
        quizId: args.quiz.trim(),
        verdicts: [...args.verdicts] as LibraryVerdict[],
      })) as unknown as JsonValue
    },
  }))

  return definitions
}
