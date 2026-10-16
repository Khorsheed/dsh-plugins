/**
 * The model-tool face of the library: one small tool per noun, each with a
 * schema sized to its own job (schema-level required fields per operation —
 * the mega-tool's per-`what` missing-field teaching class moved to the schema
 * line). `library_read` answers everything read-only; the `library_<noun>`
 * writes validate and persist what the coach authored (the card dedupe and
 * the two-axis quiz checks live behind them); `library_assess` is the one
 * cascading write. Content is always generated on the model side; the tools
 * are mechanical. There is no skill to load: each tool's parameter
 * descriptions carry its payload shape, and every refusal teaches the correct
 * call back.
 *
 * `project` / `book` default to the session's binding (the header chip), so a
 * bound session rarely names them; a book id alone resolves its owner project.
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
import {
  LIBRARY_RESOURCE_KINDS,
  type LibraryBinding,
  type LibraryCardInput,
  type LibraryCardKind,
  type LibraryCardSourceType,
  type LibraryMark,
  type LibraryOutcome,
  type LibraryResourceKind,
  type LibraryTemplate,
  type LibraryQuizQuestion,
  type LibraryVerdict,
} from './types.ts'
import type { LibraryService } from './service.ts'
import { ImageRefCache } from './image-refs.ts'
import { normalizeQuizOptions } from './store.ts'

/** The names this module registers, in registration (workflow) order. */
export const LIBRARY_TOOL_NAMES: readonly string[] = [
  'library_read',
  'library_project',
  'library_book',
  'library_resource',
  'library_roadmap',
  'library_notes',
  'library_page',
  'library_cards',
  'library_quiz',
  'library_binding',
  'library_assess',
]

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

type Exec = { agent?: Agent }

/** The calling session's id, when the call came from a session. */
function sessionIdOf(exec: Exec | undefined): string | undefined {
  const id = exec?.agent?.session?.id
  return id === undefined ? undefined : String(id)
}

/**
 * Payloads arrive as objects — or, from models that stringify deep parameters
 * (common with big nested ones), as their JSON text; both parse. A refusal
 * names what actually arrived, so the model fixes the transport instead of
 * guessing at the shape.
 */
function payload(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function payloadList(value: unknown): unknown[] | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  return Array.isArray(value) ? value : undefined
}

function arrival(field: string, value: unknown): string {
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

/** The roadmap nodes schema — shared by the parameter declaration and its description. */
const NODES_SCHEMA = {
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
} as const

/** The quiz questions schema — the two-axis fields are optional (defaults: topic + knowledge). */
const QUESTIONS_SCHEMA = {
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
} as const

/**
 * Build the tools. Creating them is the package's `./tool` row, which applies
 * the origin tag; this module never registers.
 * @param service - the library service the adapters translate to.
 * @param images - the session image references the tool row remembers (a
 *   page's photo is resolved from them, never trusted to the model's copy).
 * @returns the definitions, untagged and unregistered.
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
    throw new Error('no project: this session is not bound to one and no book resolves one — library_read · projects lists them; ask the learner which one (ask_user_question), then library_binding { project, book? }')
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
    throw new Error('no book: name it (library_read · books lists the project\'s), or bind this session to a book with library_binding')
  }

  const optBook = (value: unknown, exec: Exec | undefined): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : bindingOf(exec)?.bookId

  /** A path/quiz scope's book: a string wins, an explicit null means "the project's own path", absent falls back to the binding's book. */
  const scopeBookOf = (value: unknown, exec: Exec | undefined): string | undefined => {
    if (value === null) return undefined
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    return bindingOf(exec)?.bookId
  }

  /** The shared scope parameter descriptions (write tools). */
  const scopeParams = {
    project: { type: 'string', description: 'The project id (defaults to this session\'s binding; a book id resolves its owner).' },
  } as const
  const scopeParamsBook = {
    ...scopeParams,
    book: { type: 'json', description: 'Defaults to the binding\'s book; null = the project\'s own path.' },
  } as const

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
      + 'to know where they got stuck before; '
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
    name: 'library_project',
    description:
      'Create a learning project, or edit one (id + the fields to change; goal "" clears). '
      + 'template: "language" (marks are words) | "subject" (marks are concepts) | "custom". '
      + 'Creating or editing binds an unbound session to the project — the onboarding chain is just: create, register a book (library_book), draft (library_roadmap).',
    parameters: {
      id: { type: 'string', description: 'Edit this existing project (library_read · projects lists the ids); omit to create.' },
      name: { type: 'string', description: 'The project\'s name (required when creating).' },
      template: { type: 'string', description: '"language" | "subject" | "custom".' },
      goal: { type: 'string', description: 'The one-line goal ("" clears).' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (typeof args.id === 'string' && args.id.trim() !== '') {
        const patch: Record<string, unknown> = {}
        if (typeof args.name === 'string') patch.name = args.name
        if (typeof args.template === 'string') patch.template = args.template
        if (typeof args.goal === 'string') patch.goal = args.goal
        if (Object.keys(patch).length === 0) throw new Error('editing a project takes id plus the fields to change (name? / goal? / template?) — omit id to CREATE one (name + template)')
        const edited = unwrap(await service.updateProject({ id: args.id.trim(), patch: patch as { name?: string; goal?: string; template?: LibraryTemplate } }))
        await autoBind(exec, { projectId: edited.project.id })
        return edited as unknown as JsonValue
      }
      if (typeof args.name !== 'string' || args.name.trim() === '') {
        throw new Error('creating a project takes name (+ template: "language" | "subject" | "custom", goal?) — e.g. { name: "数学", template: "subject" }')
      }
      const created = unwrap(await service.createProject({
        name: args.name,
        ...(typeof args.template === 'string' ? { template: args.template as LibraryTemplate } : {}),
        ...(typeof args.goal === 'string' ? { goal: args.goal } : {}),
      }))
      await autoBind(exec, { projectId: created.project.id })
      return created as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_book',
    description:
      'Register a book on the project\'s shelf (or correct one with bookId). Never ask for an upload: web-verify the exact edition\'s contents first and cite the page (publisher / catalog / retailer — never a full-text copy). The contents may go as ONE newline-joined string of titles — the least mangled form. Registering binds an unbound session to the project and this book.',
    parameters: {
      ...scopeParams,
      bookId: { type: 'string', description: 'Correct this existing book instead of adding (library_read · books lists the ids).' },
      title: { type: 'string', required: true, description: 'The exact edition\'s title.' },
      bookKind: { type: 'string', required: true, enum: ['knowledge', 'material'], description: 'knowledge: a textbook / popular science (its content is domain knowledge); material: exam papers / novels / anthologies (specific text you cannot recall).' },
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
        required: true,
        description: 'The contents.',
      },
      tocSource: {
        oneOf: [
          { type: 'object', additionalProperties: true, properties: {
            by: { type: 'string', required: true, enum: ['web', 'model', 'photo'], description: 'web: you verified it online (cite url); model: from memory; photo: from the learner\'s photo.' },
            url: { type: 'string', description: 'The page you verified (publisher / catalog / retailer).' },
          } },
          { type: 'string', description: 'The same object as its JSON text.' },
        ],
        description: 'Where the contents came from — defaults to { by: "model" }; say web (+ url) once you actually verified.',
      },
      short: { type: 'string', description: 'A 2-4 character cover abbreviation (剑5 / PNS).' },
      author: { type: 'string', description: 'The author.' },
      edition: { type: 'string', description: 'The edition (e.g. 2020 年 9 月第一版).' },
      isbn: { type: 'string', description: 'The ISBN.' },
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
        description: 'How-to-use pages, answer keys, transcripts, appendices — NOT roadmap nodes.',
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      // A whole contents may arrive as one newline-joined string — the
      // biggest single payload, and the one models mangle most as JSON.
      const tocList = payloadList(args.toc)
      const tocRows = typeof args.toc === 'string' && tocList === undefined
        ? args.toc.split('\n').map(line => line.trim()).filter(line => line !== '')
        : (tocList ?? [])
      if (typeof args.title !== 'string' || args.title.trim() === '' || tocRows.length === 0) {
        throw new Error(`library_book takes: title, bookKind ("knowledge"|"material"), toc ([{ title, part? }] | bare titles | one newline-joined string), tocSource { by, url? } (+ short?, author?, edition?, isbn?, extras?, bookId? to correct) — ${arrival('toc', args.toc)}`)
      }
      const toc = tocRows.map(row => typeof row === 'string' ? { title: row } : row as { title: string; part?: string })
      const projectId = projectOf(args.project, exec)
      const written = unwrap(await service.putBook({
        projectId,
        ...(typeof args.bookId === 'string' ? { bookId: args.bookId } : {}),
        title: args.title,
        ...(typeof args.author === 'string' ? { author: args.author } : {}),
        ...(typeof args.edition === 'string' ? { edition: args.edition } : {}),
        ...(typeof args.isbn === 'string' ? { isbn: args.isbn } : {}),
        bookKind: args.bookKind as 'knowledge' | 'material',
        ...(typeof args.short === 'string' ? { short: args.short } : {}),
        ...(Array.isArray(payloadList(args.extras)) ? { extras: payloadList(args.extras) as { title: string; note?: string; where?: string; when?: 'before' | 'reference' }[] } : {}),
        toc,
        tocSource: (payload(args.tocSource) ?? { by: 'model' }) as { by: 'web' | 'model' | 'photo'; url?: string },
      }))
      await autoBind(exec, { projectId, bookId: written.book.id })
      return written as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_resource',
    description:
      'Add or remove a light shelf link — no contents, no roadmap, never quizzed; something referenced BY CHAPTER is a book instead (library_book). Open the link on the web first, and let note say why it earns its place.',
    parameters: {
      ...scopeParams,
      op: { type: 'string', required: true, enum: ['add', 'remove'], description: 'add: shelve the link; remove: take it off (the line is physically dropped).' },
      title: { type: 'string', description: 'op=add: what the link\'s own page calls it.' },
      url: { type: 'string', description: 'op=add: the link.' },
      kind: { type: 'string', enum: [...LIBRARY_RESOURCE_KINDS], description: 'What the link IS: an article to read, a video to watch, a repo or tool to build with, a course to follow, hardware to get.' },
      note: { type: 'string', description: 'op=add: one line on why it earns its place.' },
      addedBy: { type: 'string', enum: ['coach', 'learner'], description: 'Who put it on the shelf (default coach).' },
      resourceId: { type: 'string', description: 'op=remove: the shelf entry id (library_read · resources lists them).' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (args.op === 'add') {
        const title = typeof args.title === 'string' && args.title !== '' ? args.title : undefined
        const url = typeof args.url === 'string' && args.url !== '' ? args.url : undefined
        if (title === undefined || url === undefined) {
          throw new Error(`library_resource · op=add takes: title, url, kind ("article"|"video"|"repo"|"tool"|"course"|"hardware"), note? — got title ${title === undefined ? '✗ MISSING' : '✓'} · url ${url === undefined ? '✗ MISSING' : '✓'}`)
        }
        const projectId = projectOf(args.project, exec)
        const added = unwrap(await service.addResource({
          projectId,
          resource: {
            title,
            url,
            kind: args.kind as LibraryResourceKind,
            ...(typeof args.note === 'string' ? { note: args.note } : {}),
            addedBy: args.addedBy === 'learner' ? 'learner' : 'coach',
          },
        }))
        await autoBind(exec, { projectId })
        return added as unknown as JsonValue
      }
      if (args.op === 'remove') {
        if (typeof args.resourceId !== 'string' || args.resourceId === '') throw new Error('library_resource · op=remove takes the resourceId field — library_read · resources lists the ids')
        return unwrap(await service.removeResource({ projectId: projectOf(args.project, exec), resourceId: args.resourceId })) as unknown as JsonValue
      }
      throw new Error(`library_resource needs op: add | remove — got ${JSON.stringify(args.op)}`)
    },
  }))

  definitions.push(defineTool({
    name: 'library_roadmap',
    description:
      'Write a DRAFT path (nodes) the learner adopts in the sidebar (采用) — you only ever write drafts; adoption is the learner\'s consent. '
      + 'The scope reads itself off the covers: every station drawing on the same single book lands on THAT book\'s path, anything mixed lands on the project\'s own — omit book (a string is an explicit override, validated as such). '
      + 'Returns scopeNote saying where the draft landed.',
    parameters: {
      ...scopeParams,
      book: { type: 'json', description: 'Usually omit — the scope reads itself off the covers. A string is an explicit override (validated: a book\'s own path covers that book only).' },
      nodes: { ...NODES_SCHEMA, required: true, description: 'The stations of the draft.' },
      passRatio: { type: 'number', description: 'The pass line in (0, 1] — 0.8 means 8 of 10 right (the default).' },
      note: { type: 'string', description: 'The one-line pacing on the draft card.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const list = payloadList(args.nodes)
      if (list === undefined) {
        throw new Error(`library_roadmap takes the nodes field: nodes: [{ id, title, kind: "quiz"|"read"|"practice", goals, covers: [{ kind: "book", bookId, ranges: [{ from, to }] } | { kind: "resource", resourceId } | { kind: "url", url } | { kind: "topic", text }], dependsOn, acceptance? (practice only) }] (+ passRatio?, note?) — ${arrival('nodes', args.nodes)}`)
      }
      // The scope reads itself off the covers: every station drawing on
      // the same single book lands on THAT book's path, anything mixed
      // lands on the project's own. `book` survives only as an explicit
      // override (a string is honored and validated as before); the
      // binding's book is consulted solely by the chapterRanges sugar.
      const overrideBook = typeof args.book === 'string' ? args.book : undefined
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
        ...(typeof args.passRatio === 'number' ? { passRatio: args.passRatio } : {}),
        ...(typeof args.note === 'string' ? { note: args.note } : {}),
      }))
      await autoBind(exec, { projectId, ...(bookId === undefined ? {} : { bookId }) })
      const placedOn = bookId === undefined
        ? "the project's own path (the covers mix sources)"
        : `《${unwrap(await service.getBook({ projectId, bookId })).book.title}》's path`
      return { ...drafted, scopeNote: `draft placed on ${placedOn} — the learner adopts it in the sidebar (采用)` } as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_notes',
    description:
      'Write or rewrite a station\'s 讲义 (markdown; math in $…$ / $$…$$ LaTeX renders for the learner): the textbook on a 讲授 (topic) station, marginalia on a book station. Rewrite as 补讲 deepens — each write bumps 第 N 次更新.',
    parameters: {
      ...scopeParamsBook,
      node: { type: 'string', required: true, description: 'The station id (library_read · roadmap lists them).' },
      text: { type: 'string', required: true, description: 'The station\'s 讲义 in markdown.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const bookId = scopeBookOf(args.book, exec)
      return unwrap(await service.putNotes({
        projectId: projectOf(args.project, exec, bookId),
        ...(bookId === undefined ? {} : { bookId }),
        nodeId: args.node,
        text: args.text,
      })) as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_page',
    description:
      'Record a photographed page: transcribe the printed text (a photo-backed question quotes it), list every mark — each certain mark is carded at once; flag the unreadable uncertain (kept, never auto-carded). attachment is the image id — omit for the latest photo in this conversation.',
    parameters: {
      ...scopeParams,
      book: { type: 'json', description: 'The book id (defaults to the binding\'s book).' },
      text: { type: 'string', required: true, description: 'The page\'s printed text, as recognized.' },
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
        required: true,
        description: 'Every mark on the photographed page.',
      },
      attachment: { type: 'string', description: 'The image id (omit for the latest photo in this conversation).' },
      label: { type: 'string', description: 'What the learner calls the page (「p.16」).' },
      node: { type: 'string', description: 'The station id, when the page belongs to one.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const marks = payloadList(args.marks)
      if (marks === undefined) {
        throw new Error(`library_page takes: text (the page's printed text), marks: [{ text, sentence?, handNote?, gloss?, uncertain? }] (+ attachment?, label?, node?) — ${arrival('marks', args.marks)}`)
      }
      const attachment = images.resolve(sessionIdOf(exec), typeof args.attachment === 'string' ? args.attachment : undefined)
      if (attachment === undefined) {
        throw new Error('no photo to record: this conversation has no image the library saw arrive (or the id names none) — ask the learner to send the page photo here, then record it')
      }
      const pageBook = bookOf(args.book, exec)
      return unwrap(await service.recordPage({
        projectId: projectOf(args.project, exec, pageBook),
        bookId: pageBook,
        ...(typeof args.node === 'string' && args.node !== '' ? { nodeId: args.node } : {}),
        ...(typeof args.label === 'string' ? { label: args.label } : {}),
        attachment,
        text: args.text,
        marks: marks as LibraryMark[],
      })) as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_cards',
    description:
      'Record weak points — when the learner is stuck (mixes it up, asks the same point again), each: { kind: word|concept, term, gloss, context?, source: { type: chat, note? }, weaken? }. Say in one short line what you noted; ordinary curiosity is not a weak point. Near-duplicates come back pending with candidates — resend each with mergeInto or asNew.',
    parameters: {
      ...scopeParams,
      book: { type: 'string', description: 'The book id (defaults to the binding\'s book; omit for a project-level card).' },
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
        required: true,
        description: 'The weak points to record.',
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const list = payloadList(args.cards)
      if (list === undefined) {
        throw new Error(`library_cards takes cards: [{ kind: "word"|"concept", term, gloss, context?, source: { type: "chat", note? }, weaken? }] — ${arrival('cards', args.cards)}`)
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
    },
  }))

  definitions.push(defineTool({
    name: 'library_quiz',
    description:
      'Store a composed quiz. node names the quiz-kind station it gates — omit for a book-level quiz (the book page\'s 本书测验) or, with book: null, a free one (the project page\'s 自由测验). focus is the learner\'s choice (mine | book | mixed). A question\'s target defaults to the station\'s topic (flat cardIds imply marked), evidence to domain knowledge (flat pageId / url / quote imply photo / web). After it returns, reply with one line — the learner answers in the sidebar, never in the conversation.',
    parameters: {
      ...scopeParamsBook,
      node: { type: 'string', description: 'The quiz-kind station the quiz gates — omit for a book-level quiz, or with book: null a free one.' },
      focus: { type: 'string', enum: ['mine', 'book', 'mixed'], description: 'The learner\'s choice of source.' },
      questions: {
        ...QUESTIONS_SCHEMA,
        required: true,
        description: 'The questions of the composed quiz. Math typesets: write it as $…$ (inline) or $$…$$ (block) LaTeX and it renders for the learner — \\sqrt{3-x} over \\sqrt{(3-x)/(x+2)} is exactly the vinculum difference.',
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
      const bookId = scopeBookOf(args.book, exec)
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
          ...(args.focus === 'mine' || args.focus === 'book' || args.focus === 'mixed' ? { focus: args.focus } : {}),
          scope: { ...(bookId === undefined ? {} : { bookId }), ...(node === undefined ? {} : { nodeId: node }) },
          questions: cleaned as unknown as LibraryQuizQuestion[],
        },
      }))
      await autoBind(exec, { projectId, ...(bookId === undefined ? {} : { bookId }) })
      return written as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_binding',
    description:
      'Bind this session to a project (and optionally a book) — the header chip, and every tool\'s defaults. binding: null unbinds. Most writes bind an unbound session by themselves; bind by hand to switch, or when there is nothing to infer from.',
    parameters: {
      binding: {
        oneOf: [
          { type: 'object', additionalProperties: true, properties: {
            project: { type: 'string', required: true, description: 'The project id (library_read · projects lists them).' },
            book: { type: 'string', description: 'Optionally the book within it.' },
          } },
          { type: 'null', description: 'Unbind this session.' },
        ],
        description: 'The binding — or null to unbind.',
      },
      project: { type: 'string', description: 'Alias for binding.project (both work).' },
      book: { type: 'string', description: 'Alias for binding.book.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
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
      quiz: { type: 'string', description: 'The quiz id library_quiz returned (a quiz sitting).' },
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
          projectId: projectOf(args.project, exec, book),
          nodeId: node,
          ...(book === undefined ? {} : { bookId: book }),
          verdicts: [...args.verdicts] as LibraryVerdict[],
        })) as unknown as JsonValue
      }
      if (args.quiz === undefined || args.quiz.trim() === '') throw new Error('quiz is the id library_quiz returned — or pass node (a practice station\'s id) for acceptance')
      return unwrap(await service.putAttempt({
        projectId: projectOf(args.project, exec),
        quizId: args.quiz.trim(),
        verdicts: [...args.verdicts] as LibraryVerdict[],
      })) as unknown as JsonValue
    },
  }))

  return definitions
}
