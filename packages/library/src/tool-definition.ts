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
      what: { type: 'string', description: `Required. What to read: ${READ_WHATS.join(' | ')}.` },
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
        case 'toc':
          return unwrap(await service.getBook({ projectId: projectOf(args.project, exec), bookId: bookOf(args.book, exec) })).book as unknown as JsonValue
        case 'roadmap': {
          const book = scopeBookOf(args.book, exec)
          return (await service.getRoadmap({ projectId: projectOf(args.project, exec), ...(book === undefined ? {} : { bookId: book }) })) as unknown as JsonValue
        }
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
          throw new Error(`what is required — one of ${READ_WHATS.join(' | ')} — got ${JSON.stringify(args.what) ?? 'nothing'}; e.g. { what: "books" } reads the bound project's books`)
      }
    },
  }))

  definitions.push(defineTool({
    name: 'library_write',
    description:
      'Validate and persist what you authored: what plus its payload (each payload\'s shape sits in its parameter\'s description below; project / book default to this session\'s binding). '
      + 'project — create; with id, edit (goal "" clears). '
      + 'book — register (never ask for an upload): web-verify the exact edition\'s contents first and cite the url in tocSource (a publisher / catalog / retailer page, never a full-text copy). '
      + 'roadmap — write a DRAFT the learner adopts in the sidebar (采用); book defaults to the binding\'s book, book: null = the project\'s OWN path. A route whose every station covers the same single book belongs to that book — the service refuses it on the project. '
      + 'notes — a station\'s 讲义 (markdown) on the adopted path: the textbook on a 讲授 (topic) station, marginalia on a book station; rewrite as 补讲 deepens (each write bumps 第 N 次更新). '
      + 'page — record a photographed page, carding every mark at once. '
      + 'cards — record a weak point when the learner is stuck, and say what you noted. '
      + 'quiz — store a composed quiz; focus is the learner\'s choice. '
      + 'resource — op add | remove: a light shelf link (no contents, no roadmap, never quizzed; something referenced BY CHAPTER is a book instead). '
      + 'binding — bind this session (null unbinds). '
      + 'A refusal names exactly what to fix — change only that and resend the same payload.',
    parameters: {
      what: { type: 'string', description: `Required. What to write: ${WRITE_WHATS.join(' | ')}.` },
      project: { type: 'json', description: 'what=project: { name, template: "language"|"subject"|"custom" (language: marks are words; subject: concepts), templateNote?, goal? } — with id it edits instead. Otherwise: the project id (defaults to the binding).' },
      book: { type: 'json', description: 'what=book: { title, short (2-4 char cover abbreviation, e.g. 剑5 / PNS), author?, edition?, isbn?, bookKind: "knowledge"|"material" ("material" = exam papers / novels / anthologies — specific text you cannot recall), toc: [{ title, part? }] (one row per chapter or passage, never a part heading — the part goes in part; a bare string per row, or one newline-joined string, works), extras?: [{ title, note?, where?, when: "before"|"reference" }] (how-to-use pages, answer keys, transcripts, appendices — NOT roadmap nodes), tocSource: { by: "web"|"model"|"photo", url? }, bookId? (corrects an existing one) } — an object, or its JSON text. Otherwise: the book id (defaults to the binding\'s book; null on roadmap / notes / quiz = the project\'s own path).' },
      roadmap: { type: 'json', description: 'what=roadmap: { nodes: [{ id, title, kind: "quiz"|"read"|"practice", goals: [...] (a bare string works), covers: [{ kind: "book", bookId, ranges: [{ from, to }] } | { kind: "resource", resourceId } | { kind: "url", url, title? } | { kind: "topic", text }], dependsOn, acceptance?: [...] (practice only) }], passRatio?, note? } — or its JSON text. quiz nodes are the levels (a chapter quiz completes them) and depend only on quiz / practice nodes; a practice node is a hands-on station gated by acceptance lines; read nodes are optional side stops (读完 completes them, they never gate). Covers mix freely on the project\'s path; on a book\'s own path every node covers that one book (chapterRanges: [{ from, to }] works as sugar for its single book cover). Every url / resource cover carries provenance: by: "web" + verifiedAt once actually opened, "model" straight from memory (verify and replace before the learner adopts), "user" when the learner gave it.' },
      notes: { type: 'json', description: 'what=notes: { node: <station id>, text: <the station\'s 讲义, markdown> } — an object, or its JSON text. book defaults to the binding\'s book; book: null for a project-path station.' },
      page: { type: 'json', description: 'what=page: { attachment? (the image id; omit for the latest photo in this conversation), label?, node?, text (the page\'s printed text), marks: [{ text, sentence?, handNote?, gloss? (the in-context meaning), uncertain? (kept, not carded) }] } — an object, or its JSON text.' },
      cards: { type: 'json', description: 'what=cards: [{ kind: "word"|"concept", term, aliases?, gloss, userGloss?, context?: { sentence, node? }, source: { type: "chat"|"photo"|"quiz"|"manual", note? }, weaken?, mergeInto?, asNew? }] — or the JSON text. When the learner is stuck: source chat, weaken true. A near-duplicate comes back in pending with candidates: resend it with mergeInto: <id> or asNew: true.' },
      quiz: { type: 'json', description: 'what=quiz: { node?, focus?: "mine"|"book"|"mixed" (the learner\'s choice of source — mine: only their own cards, book: only the chapter\'s content), questions: [{ id, kind: "choice"|"fill"|"free", prompt, options?, answer, explanation?, target: { kind: "marked"|"asked"|"missed"|"topic", cardIds? }, evidence: { kind: "photo"|"web"|"knowledge", pageId?, url?, quote? } }] } — or its JSON text. Target the learner\'s own cards first; photo evidence quotes a recorded page, web evidence cites url + quote; a material book, a resource or a url among the gated station\'s covers demands a verbatim quote for a content question.' },
      op: { type: 'string', description: 'what=resource: add | remove.' },
      resource: { type: 'json', description: 'what=resource: add — { title, url, kind: "article"|"video"|"repo"|"tool"|"course"|"hardware", note? (one line: why it earns its place), addedBy? }; remove — { id }. An object, or its JSON text. Open the link on the web first: the title is what its own page calls it.' },
      binding: { type: 'json', description: 'what=binding: { project, book? } or null.' },
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
            throw new Error(`what=project takes project: { name, template: "language"|"subject"|"custom", goal? } — ${arrival('project', args.project)}`)
          }
          return unwrap(await service.createProject(body as { name: string })) as unknown as JsonValue
        }
        case 'book': {
          const body = payload(args.book)
          if (body === undefined || typeof body.title !== 'string' || (!Array.isArray(body.toc) && typeof body.toc !== 'string')) {
            throw new Error(`what=book takes book: { title, edition?, bookKind: "knowledge"|"material", toc: [{ title, part? }] (a bare string per row, or one newline-joined string), tocSource: { by, url? } } — ${arrival('book', args.book)}`)
          }
          // A whole contents may arrive as one newline-joined string — the
          // biggest single payload, and the one models mangle most as JSON.
          const tocRows = typeof body.toc === 'string'
            ? body.toc.split('\n').map(line => line.trim()).filter(line => line !== '')
            : body.toc as unknown[]
          const toc = tocRows.map(row => typeof row === 'string' ? { title: row } : row as { title: string; part?: string })
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
            throw new Error(`what=roadmap takes roadmap: { nodes: [{ id, title, kind: "quiz"|"read"|"practice", goals, covers: [{ kind: "book", bookId, ranges: [{ from, to }] } | { kind: "resource", resourceId } | { kind: "url", url } | { kind: "topic", text }], dependsOn, acceptance? (practice only) }], note? } — ${arrival('roadmap', args.roadmap)}`)
          }
          const rawBook = args.book === null || typeof args.book === 'string' ? args.book : body.book === null || typeof body.book === 'string' ? body.book : undefined
          const bookId = rawBook === null ? undefined : rawBook ?? bindingOf(exec)?.bookId
          const nodes = (body.nodes as Record<string, unknown>[]).map(node => {
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
              if (bookId === undefined) {
                throw new Error('chapterRanges count a book\'s contents rows — the project\'s OWN path (book: null) needs covers instead: { kind: "book", bookId, ranges: [{ from, to }] } names the book explicitly')
              }
              return { ...rest, covers: [{ kind: 'book', bookId, ranges: chapterRanges }] }
            }
            return rest
          })
          return unwrap(await service.draftRoadmap({
            projectId: projectOf(args.project, exec),
            ...(bookId === undefined ? {} : { bookId }),
            nodes: nodes as unknown as Parameters<LibraryService['draftRoadmap']>[0]['nodes'],
            ...(typeof body.passRatio === 'number' ? { passRatio: body.passRatio } : {}),
            ...(typeof body.note === 'string' ? { note: body.note } : {}),
          })) as unknown as JsonValue
        }
        case 'notes': {
          const body = payload(args.notes)
          if (body === undefined || typeof body.node !== 'string' || typeof body.text !== 'string') {
            throw new Error(`what=notes takes notes: { node: <station id>, text: <the station's 讲义, markdown> } — ${arrival('notes', args.notes)}`)
          }
          const rawBook = args.book === null || typeof args.book === 'string' ? args.book : body.book === null || typeof body.book === 'string' ? body.book : undefined
          const bookId = rawBook === null ? undefined : rawBook ?? bindingOf(exec)?.bookId
          return unwrap(await service.putNotes({
            projectId: projectOf(args.project, exec),
            ...(bookId === undefined ? {} : { bookId }),
            nodeId: body.node,
            text: body.text,
          })) as unknown as JsonValue
        }
        case 'page': {
          const body = payload(args.page)
          if (body === undefined || typeof body.text !== 'string' || !Array.isArray(body.marks)) {
            throw new Error(`what=page takes page: { attachment?: <the image id>, text, marks: [{ text, sentence?, handNote?, gloss?, uncertain? }], label?, node? } — ${arrival('page', args.page)}`)
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
            projectId: projectOf(args.project, exec),
            ...(book === undefined ? {} : { bookId: book }),
            cards,
          })) as unknown as JsonValue
        }
        case 'quiz': {
          const body = payload(args.quiz)
          if (body === undefined || !Array.isArray(body.questions)) {
            throw new Error(`what=quiz takes quiz: { node?, questions: [{ id, kind, prompt, options?, answer, explanation?, target: { kind, cardIds? }, evidence: { kind, pageId?, url?, quote? } }] } — ${arrival('quiz', args.quiz)}`)
          }
          const node = typeof body.node === 'string' ? body.node : undefined
          const rawBook = args.book === null || typeof args.book === 'string' ? args.book : body.book === null || typeof body.book === 'string' ? body.book : undefined
          const bookId = rawBook === null ? undefined : rawBook ?? bindingOf(exec)?.bookId
          return unwrap(await service.putQuiz({
            projectId: projectOf(args.project, exec),
            quiz: {
              ...(body.focus === 'mine' || body.focus === 'book' || body.focus === 'mixed' ? { focus: body.focus } : {}),
              scope: { ...(bookId === undefined ? {} : { bookId }), ...(node === undefined ? {} : { nodeId: node }) },
              questions: body.questions as LibraryQuizQuestion[],
            },
          })) as unknown as JsonValue
        }
        case 'resource': {
          const body = payload(args.resource)
          if (args.op === 'add') {
            if (body === undefined || typeof body.title !== 'string' || typeof body.url !== 'string') {
              throw new Error(`what=resource · op=add takes resource: { title, url, kind: "article"|"video"|"repo"|"tool"|"course"|"hardware", note? } — a light link on the project's shelf; open it on the web first, and let note say why it earns its place — ${arrival('resource', args.resource)}`)
            }
            return unwrap(await service.addResource({
              projectId: projectOf(args.project, exec),
              resource: {
                title: body.title,
                url: body.url,
                kind: body.kind as LibraryResourceKind,
                ...(typeof body.note === 'string' ? { note: body.note } : {}),
                addedBy: body.addedBy === 'learner' ? 'learner' : 'coach',
              },
            })) as unknown as JsonValue
          }
          if (args.op === 'remove') {
            const resourceId = typeof body?.id === 'string' ? body.id : undefined
            if (resourceId === undefined) throw new Error('what=resource · op=remove takes resource: { id } — library_read · resources lists the ids')
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
