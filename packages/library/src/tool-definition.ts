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
  LibraryTemplate,
  LibraryQuizQuestion,
  LibraryVerdict,
  RoadmapNode,
} from './types.ts'
import type { LibraryService } from './service.ts'
import { ImageRefCache } from './image-refs.ts'

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

const READ_WHATS = ['projects', 'books', 'toc', 'roadmap', 'pages', 'cards', 'quiz', 'stats'] as const
const WRITE_WHATS = ['project', 'book', 'roadmap', 'page', 'cards', 'quiz', 'binding'] as const

type Exec = { agent?: Agent }

/** The calling session's id, when the call came from a session. */
function sessionIdOf(exec: Exec | undefined): string | undefined {
  const id = exec?.agent?.session?.id
  return id === undefined ? undefined : String(id)
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

  /** The project: the argument, else the binding, else a lesson. */
  const projectOf = (value: unknown, exec: Exec | undefined): string => {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    const bound = bindingOf(exec)?.projectId
    if (bound !== undefined) return bound
    throw new Error('no project: this session is not bound to one — library_read · projects lists them; ask the learner which one (ask_user_question), then library_write · binding { project, book? }')
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

  const definitions: ToolDefinition[] = []

  definitions.push(defineTool({
    name: 'library_read',
    description:
      'Read the learner\'s library (read-only). what: '
      + '"projects" — every project with its books\' progress and card tallies, plus this session\'s binding; '
      + '"books" — a project\'s books with their tables of contents; '
      + '"toc" — one book (title, edition, kind, contents rows numbered n); '
      + '"roadmap" — one book\'s adopted path and any pending draft; '
      + '"pages" — one book\'s photographed pages (printed text + the learner\'s marks), node narrows; '
      + '"cards" — the knowledge cards: query searches term, aliases, gloss and sentences; filters book, node, kind (word|concept), '
      + 'source (photo|chat|quiz|manual), weakMin (0-3), due; sorted weakest first — check here before teaching a point, '
      + 'to know where the learner got stuck before; '
      + '"quiz" — one quiz whole (quiz id), or the list; '
      + '"stats" — the whole library\'s tally. project and book default to this session\'s binding.',
    parameters: {
      what: { type: 'string', required: true, description: `What to read: ${READ_WHATS.join(' | ')}.` },
      project: { type: 'string', description: 'Project id (defaults to the binding).' },
      book: { type: 'string', description: 'Book id (defaults to the binding\'s book).' },
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
        case 'toc':
          return unwrap(await service.getBook({ projectId: projectOf(args.project, exec), bookId: bookOf(args.book, exec) })).book as unknown as JsonValue
        case 'roadmap':
          return (await service.getRoadmap({ projectId: projectOf(args.project, exec), bookId: bookOf(args.book, exec) })) as unknown as JsonValue
        case 'pages':
          return (await service.listPages({
            projectId: projectOf(args.project, exec),
            bookId: bookOf(args.book, exec),
            ...(args.node === undefined ? {} : { nodeId: args.node }),
          })) as unknown as JsonValue
        case 'cards': {
          const book = typeof args.book === 'string' && args.book.trim() !== '' ? args.book.trim() : undefined
          const result = await service.listCards({
            projectId: projectOf(args.project, exec),
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
          const project = projectOf(args.project, exec)
          if (args.quiz === undefined || args.quiz.trim() === '') {
            const book = optBook(args.book, exec)
            return (await service.listQuizzes({ projectId: project, ...(book === undefined ? {} : { bookId: book }) })) as unknown as JsonValue
          }
          return unwrap(await service.getQuiz({ projectId: project, quizId: args.quiz.trim() })).quiz as unknown as JsonValue
        }
        case 'stats':
          return (await service.stats()) as unknown as JsonValue
        default:
          throw new Error(`what must be one of ${READ_WHATS.join(' | ')} — got ${JSON.stringify(args.what)}`)
      }
    },
  }))

  definitions.push(defineTool({
    name: 'library_write',
    description:
      'Validate and persist what you authored. Pass what plus the matching payload; project / book default to this session\'s binding. '
      + 'what="project": project { name, template: "language"|"subject"|"custom", templateNote?, goal? } — language: marks are words; subject: marks are concepts. '
      + 'With project { id, name?, goal?, template? } it edits that project instead (the learner renamed or refocused it; goal "" clears it). '
      + 'what="book": book { title, short (a 2-4 character cover abbreviation, e.g. 剑5 / PNS), author?, edition?, isbn?, bookKind: "knowledge"|"material", toc: [{ title, part? }], tocSource: { by: "web"|"model"|"photo", url? }, '
      + 'extras?: [{ title, note?, where?, when: "before"|"reference" }] (how to use the book, the answer key, transcripts, appendices — they are NOT roadmap nodes), bookId? } — '
      + 'register a book (no upload): search the web for the exact edition\'s contents and cite the url — a publisher, library-catalog or retailer page, never a full-text copy; '
      + 'toc has one row per chapter (or passage), never a row for a part heading — the part goes in part; "material" = exam papers, novels, anthologies '
      + '(specific text you cannot recall); bookId corrects an existing one. '
      + 'what="roadmap": roadmap { nodes: [{ id, title, kind: "quiz"|"read", goals: [..], chapterRanges: [{ from, to }], dependsOn }], passRatio?, note? } — '
      + 'writes a DRAFT the learner adopts in the sidebar (采用); ranges count contents rows. Quiz nodes are the levels (a chapter quiz completes them) and depend only on quiz nodes; '
      + 'read nodes are optional side stops for an overview chapter worth reading but not testing (读完 completes them, they never gate). How-to-use pages, answer keys, transcripts '
      + 'and appendices are book extras, not nodes. note is the one-line pacing shown on the draft card. '
      + 'what="page": page { attachment? (the image id; omit it for the latest photo in this conversation), label?, node?, text (the page\'s printed text), '
      + 'marks: [{ text, sentence?, handNote?, gloss?, uncertain? }] } — records a photographed page and cards every mark at once; gloss is the in-context meaning; '
      + 'uncertain marks are kept but not carded. '
      + 'what="cards": cards [{ kind: "word"|"concept", term, aliases?, gloss, userGloss?, context?: { sentence, node? }, source: { type: "chat"|"photo"|"quiz"|"manual", note? }, weaken?, mergeInto?, asNew? }] — '
      + 'record a weak point when the learner is stuck (says they mix it up, asks the same point again, keeps probing): source chat, weaken true, and tell them in your reply what you noted. '
      + 'A near-duplicate comes back in pending with candidates: resend it with mergeInto: <id> or asNew: true. '
      + 'what="quiz": quiz { node?, focus?: "mine"|"book"|"mixed" (the learner\'s choice of source — mine: only their own cards, book: only the chapter\'s content), questions: [{ id, kind: "choice"|"fill"|"free", prompt, options?, answer, explanation?, target: { kind: "marked"|"asked"|"missed"|"topic", cardIds? }, '
      + 'evidence: { kind: "photo"|"web"|"knowledge", pageId?, url?, quote? } }] } — target the learner\'s own cards first; photo evidence quotes a recorded page, web evidence cites url + quote; '
      + 'a material book never takes a knowledge-backed question about its content. '
      + 'what="binding": binding { project, book? } — bind this session; binding: null unbinds.',
    parameters: {
      what: { type: 'string', required: true, description: `What to write: ${WRITE_WHATS.join(' | ')}.` },
      project: { type: 'json', description: 'what=project: the new project payload; otherwise the project id (defaults to the binding).' },
      book: { type: 'json', description: 'what=book: the book payload; otherwise the book id (defaults to the binding\'s book).' },
      roadmap: { type: 'object', description: 'what=roadmap: { nodes, passRatio?, note? }.', additionalProperties: true },
      page: { type: 'object', description: 'what=page: { attachment, label?, node?, text, marks }.', additionalProperties: true },
      cards: { type: 'array', description: 'what=cards: the cards to record.', items: { type: 'object', additionalProperties: true } },
      quiz: { type: 'object', description: 'what=quiz: { node?, questions }.', additionalProperties: true },
      binding: { type: 'json', description: 'what=binding: { project, book? } or null.' },
    },
    output: jsonOutput(),
    // Writes serialize on the store's locks; one at a time keeps their order legible.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const payload = (value: unknown): Record<string, unknown> | undefined =>
        typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
      switch (args.what) {
        case 'project': {
          const body = payload(args.project)
          if (body !== undefined && typeof body.id === 'string') {
            const { id, name, goal, template } = body
            const patch = {
              ...(typeof name === 'string' ? { name } : {}),
              ...(typeof goal === 'string' ? { goal } : {}),
              ...(typeof template === 'string' ? { template: template as LibraryTemplate } : {}),
            }
            if (Object.keys(patch).length === 0) throw new Error('editing a project takes project: { id, name?, goal?, template? }')
            return unwrap(await service.updateProject({ id, patch })) as unknown as JsonValue
          }
          if (body === undefined || typeof body.name !== 'string') {
            throw new Error('what=project takes project: { name, template: "language"|"subject"|"custom", goal? }')
          }
          return unwrap(await service.createProject(body as { name: string })) as unknown as JsonValue
        }
        case 'book': {
          const body = payload(args.book)
          if (body === undefined || typeof body.title !== 'string' || !Array.isArray(body.toc)) {
            throw new Error('what=book takes book: { title, edition?, bookKind: "knowledge"|"material", toc: [{ title, part? }], tocSource: { by, url? } }')
          }
          const toc = (body.toc as unknown[]).map(row => typeof row === 'string' ? { title: row } : row as { title: string; part?: string })
          return unwrap(await service.putBook({
            projectId: projectOf(args.project, exec),
            ...(typeof body.bookId === 'string' ? { bookId: body.bookId } : {}),
            title: body.title,
            ...(typeof body.author === 'string' ? { author: body.author } : {}),
            ...(typeof body.edition === 'string' ? { edition: body.edition } : {}),
            ...(typeof body.isbn === 'string' ? { isbn: body.isbn } : {}),
            bookKind: body.bookKind as 'knowledge' | 'material',
            ...(typeof body.short === 'string' ? { short: body.short } : {}),
            ...(Array.isArray(body.extras) ? { extras: body.extras as { title: string; note?: string; where?: string; when?: 'before' | 'reference' }[] } : {}),
            toc,
            tocSource: (payload(body.tocSource) ?? { by: 'model' }) as { by: 'web' | 'model' | 'photo'; url?: string },
          })) as unknown as JsonValue
        }
        case 'roadmap': {
          const body = payload(args.roadmap)
          if (body === undefined || !Array.isArray(body.nodes)) {
            throw new Error('what=roadmap takes roadmap: { nodes: [{ id, title, kind: "quiz"|"read", goals, chapterRanges: [{ from, to }], dependsOn }], note? } — read the toc first')
          }
          return unwrap(await service.draftRoadmap({
            projectId: projectOf(args.project, exec),
            bookId: bookOf(typeof args.book === 'string' ? args.book : body.book, exec),
            nodes: body.nodes as RoadmapNode[],
            ...(typeof body.passRatio === 'number' ? { passRatio: body.passRatio } : {}),
            ...(typeof body.note === 'string' ? { note: body.note } : {}),
          })) as unknown as JsonValue
        }
        case 'page': {
          const body = payload(args.page)
          if (body === undefined || typeof body.text !== 'string' || !Array.isArray(body.marks)) {
            throw new Error('what=page takes page: { attachment?: <the image id>, text, marks: [{ text, sentence?, handNote?, gloss?, uncertain? }], label?, node? }')
          }
          const attachment = images.resolve(sessionIdOf(exec), body.attachment)
          if (attachment === undefined) {
            throw new Error('no photo to record: this conversation has no image the library saw arrive (or the id names none) — ask the learner to send the page photo here, then record it')
          }
          return unwrap(await service.recordPage({
            projectId: projectOf(args.project, exec),
            bookId: bookOf(typeof args.book === 'string' ? args.book : body.book, exec),
            ...(typeof body.node === 'string' ? { nodeId: body.node } : {}),
            ...(typeof body.label === 'string' ? { label: body.label } : {}),
            attachment,
            text: body.text,
            marks: body.marks as LibraryMark[],
          })) as unknown as JsonValue
        }
        case 'cards': {
          if (!Array.isArray(args.cards)) {
            throw new Error('what=cards takes cards: [{ kind: "word"|"concept", term, gloss, context?, source: { type: "chat", note? }, weaken? }]')
          }
          const sessionId = sessionIdOf(exec)
          const cards = (args.cards as Record<string, unknown>[]).map(card => {
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
            projectId: projectOf(args.project, exec),
            ...(book === undefined ? {} : { bookId: book }),
            cards,
          })) as unknown as JsonValue
        }
        case 'quiz': {
          const body = payload(args.quiz)
          if (body === undefined || !Array.isArray(body.questions)) {
            throw new Error('what=quiz takes quiz: { node?, questions: [{ id, kind, prompt, options?, answer, explanation?, target: { kind, cardIds? }, evidence: { kind, pageId?, url?, quote? } }] }')
          }
          const node = typeof body.node === 'string' ? body.node : undefined
          return unwrap(await service.putQuiz({
            projectId: projectOf(args.project, exec),
            quiz: {
              ...(body.focus === 'mine' || body.focus === 'book' || body.focus === 'mixed' ? { focus: body.focus } : {}),
              scope: { bookId: bookOf(typeof args.book === 'string' ? args.book : body.book, exec), ...(node === undefined ? {} : { nodeId: node }) },
              questions: body.questions as LibraryQuizQuestion[],
            },
          })) as unknown as JsonValue
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
          throw new Error(`what must be one of ${WRITE_WHATS.join(' | ')} — got ${JSON.stringify(args.what)}`)
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
      + 'card-less miss, updates the gated node, and completes it at the pass ratio (default 0.8), unlocking what follows — report what moved and what unlocked.',
    parameters: {
      project: { type: 'string', description: 'Project id (defaults to the binding).' },
      quiz: { type: 'string', required: true, description: 'The quiz id library_write · quiz returned.' },
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
      if (args.quiz.trim() === '') throw new Error('quiz is the id library_write · quiz returned')
      return unwrap(await service.putAttempt({
        projectId: projectOf(args.project, exec),
        quizId: args.quiz.trim(),
        verdicts: [...args.verdicts] as LibraryVerdict[],
      })) as unknown as JsonValue
    },
  }))

  return definitions
}
