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
 * v5: the shelf unified — a BOOK is `library_resource` with kind "book" and a
 * toc; every scope parameter is named `resource` (the old `book` spelling
 * still parses). A node's `gate` says how it completes (quiz | acceptance |
 * read; the old `kind: "practice"` reads as acceptance). A cover is one
 * string shorthand — "r_…#1-5" | "https://…" | "topic: …" — or the object
 * `{ ref, locator? }` it expands to.
 *
 * `project` / `resource` default to the session's binding (the header chip),
 * so a bound session rarely names them; a resource id alone resolves its
 * owner project.
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
  formatLocator,
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

const READ_WHATS = ['projects', 'resources', 'toc', 'roadmap', 'pages', 'cards', 'quiz', 'stats'] as const

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
  if (Array.isArray(value)) return value
  // A model as often wraps the list: { items: [...] } — unwrap it (the schema
  // carries a matching object branch so this shape reaches execute at all).
  const items = payload(value)?.items
  return Array.isArray(items) ? items : undefined
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

/** The first non-blank string of the candidates (the resource/book alias pairs). */
function pickString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim() !== '')?.trim()
}

/**
 * One cover argument → the stored `{ ref, locator?, … }`. Accepts the string
 * shorthand ("r_…#1-5" | "https://…" | "topic: …"), the v5 object, and every
 * legacy union member ({ kind: "book", bookId|book, ranges } |
 * { kind: "resource", resourceId|resource } | { kind: "url", url, title? } |
 * { kind: "topic", text }). Undefined when nothing usable arrived.
 */
function normalizeCoverArg(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    const shorthand = value.trim()
    if (shorthand === '') return undefined
    if (shorthand.startsWith('topic:') || /^https?:\/\//.test(shorthand)) return { ref: shorthand }
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:#\s*(.+))?$/.exec(shorthand)
    return { ref: match?.[1] ?? shorthand, ...(match?.[2] === undefined ? {} : { locator: match[2].trim() }) }
  }
  const record = payload(value)
  if (record === undefined) return undefined
  const provenance = {
    ...(typeof record.by === 'string' ? { by: record.by } : {}),
    ...(typeof record.verifiedAt === 'string' ? { verifiedAt: record.verifiedAt } : {}),
  }
  if (typeof record.ref === 'string' && record.ref.trim() !== '') {
    return {
      ref: record.ref.trim(),
      ...(typeof record.locator === 'string' && record.locator.trim() !== '' ? { locator: record.locator.trim() } : {}),
      ...(typeof record.title === 'string' && record.title.trim() !== '' ? { title: record.title.trim() } : {}),
      ...provenance,
    }
  }
  const bookId = pickString(record.bookId, record.book)
  if ((record.kind === 'book' || record.kind === undefined) && bookId !== undefined) {
    const ranges = Array.isArray(record.ranges)
      ? (record.ranges as unknown[]).flatMap(range => {
        const row = payload(range)
        const from = typeof row?.from === 'number' ? row.from : undefined
        const to = typeof row?.to === 'number' ? row.to : undefined
        return from === undefined || to === undefined ? [] : [{ from, to }]
      })
      : []
    return { ref: bookId, ...(ranges.length === 0 ? {} : { locator: formatLocator(ranges) }), ...provenance }
  }
  const resourceId = pickString(record.resourceId, record.resource)
  if (record.kind === 'resource' && resourceId !== undefined) return { ref: resourceId, ...provenance }
  if (record.kind === 'url' && typeof record.url === 'string') {
    return { ref: record.url, ...(typeof record.title === 'string' ? { title: record.title } : {}), ...provenance }
  }
  if (record.kind === 'topic' && typeof record.text === 'string') return { ref: `topic:${record.text}`, ...provenance }
  return undefined
}

/**
 * A roadmap's scope read off its content: the one resource every station's
 * covers name, when they all name exactly that one — anything else (mixed
 * resources, a url / topic among the covers, a coverless node) is the
 * project's own path. Runs on the post-normalize nodes, whose covers all
 * carry `ref`.
 */
function deriveRoadmapResource(nodes: readonly Record<string, unknown>[]): string | undefined {
  const ids = new Set<string>()
  for (const node of nodes) {
    const covers = node.covers
    if (!Array.isArray(covers) || covers.length === 0) return undefined
    for (const cover of covers) {
      if (cover === null || typeof cover !== 'object' || Array.isArray(cover)) return undefined
      const ref = (cover as Record<string, unknown>).ref
      if (typeof ref !== 'string' || ref === '' || ref.startsWith('topic:') || /^https?:\/\//.test(ref)) return undefined
      ids.add(ref)
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
 * Models sometimes wrap a list payload as `{ items: [...] }`. Declaring the
 * wrapper as a oneOf branch lets it past schema validation into execute (which
 * unwraps it in payloadList) — and a genuinely wrong object then earns the
 * tool's own teaching error instead of the harness's opaque "must match
 * exactly one oneOf branch" refusal.
 */
const LIST_WRAPPER_SCHEMA = { type: 'object', additionalProperties: true, description: 'The same list wrapped: { items: [...] }.' } as const

/** The roadmap nodes schema — shared by the parameter declaration and its description. */
const NODES_SCHEMA = {
  oneOf: [
    { type: 'array', description: 'The stations, in dependency order.', items: { type: 'object', additionalProperties: true, properties: {
      id: { type: 'string', required: true, description: 'Unique station id (letters, digits, . _ -).' },
      title: { type: 'string', required: true, description: 'What the learner masters here.' },
      gate: { type: 'string', required: true, enum: ['quiz', 'acceptance', 'read'], description: 'quiz: a level gated by its chapter quiz (depends only on quiz / acceptance nodes); acceptance: a hands-on station gated by acceptance lines; read: an optional side stop (读完 completes it, never gates).' },
      goals: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: 'What to master / complete here — a quiz / read station\'s completion expectations live HERE, never in acceptance.' },
      covers: { type: 'array', description: 'What the station draws on (at least one). On a resource\'s own path: exactly one cover naming that resource.', items: { oneOf: [
        { type: 'string', description: 'The shorthand: "r_…#1-5" (a shelf resource + contents rows) | "https://…" (a bare web text) | "topic: …" (plain coached teaching).' },
        { type: 'object', additionalProperties: true, properties: {
          ref: { type: 'string', required: true, description: 'The resource id (r_…), the url, or "topic:…".' },
          locator: { type: 'string', description: 'A thick resource\'s contents rows, 1-based inclusive: "1-5,7".' },
          title: { type: 'string', description: 'A url cover\'s short label.' },
          by: { type: 'string', enum: ['web', 'model', 'user'], description: 'Provenance: "web" once actually opened (+ verifiedAt), "model" straight from memory (verify and replace before the learner adopts), "user" when the learner gave it.' },
          verifiedAt: { type: 'string', description: 'ISO time of the web check.' },
        } },
      ] } },
      dependsOn: { type: 'array', items: { type: 'string' }, description: 'Earlier station ids this one gates on.' },
      acceptance: { type: 'array', description: 'gate=acceptance only: the criteria — judged one verdict per line at assess time (task = the line id L1, L2…, or the line verbatim). A line may be { line, ref: <quiz id> } — machine-checked: it auto-passes when that quiz\'s latest sitting passes; compose the quiz FIRST (library_quiz), then ref it.', items: { oneOf: [
        { type: 'string', description: 'The criterion line, judged by the coach.' },
        { type: 'object', additionalProperties: true, properties: {
          line: { type: 'string', required: true, description: 'The criterion line.' },
          ref: { type: 'string', description: 'The quiz that machine-checks this line (library_quiz returned its id).' },
        } },
      ] } },
    } } },
    { type: 'string', description: 'The same array as its JSON text.' },
    LIST_WRAPPER_SCHEMA,
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
        description: 'OPTIONAL: what the answer rests on — omit for domain knowledge (the default); the flat pageId / url / quote set the kind. The verbatim gate still bites: a material book, a thin link or a url among the covers demands a quote.',
      },
      cardIds: { type: 'array', items: { type: 'string' }, description: 'Shorthand for target.cardIds (kind defaults to marked): live cards from library_read · cards.' },
      quote: { type: 'string', description: 'Shorthand for evidence.quote (with pageId → photo, with url → web).' },
      url: { type: 'string', description: 'Shorthand: evidence { kind: "web", url, quote? }.' },
      pageId: { type: 'string', description: 'Shorthand: evidence { kind: "photo", pageId, quote? } — page ids from library_read · pages.' },
    } } },
    { type: 'string', description: 'The same array as its JSON text.' },
    LIST_WRAPPER_SCHEMA,
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

  /** The project: the argument, else the binding, else the resource's owner, else a lesson. */
  const projectOf = (value: unknown, exec: Exec | undefined, resource?: string): string => {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    const bound = bindingOf(exec)?.projectId
    if (bound !== undefined) return bound
    if (resource !== undefined) {
      const owner = service.findResourceOwner(resource)
      if (owner !== undefined) return owner
    }
    throw new Error('no project: this session is not bound to one and no resource resolves one — library_read · projects lists them; ask the learner which one (ask_user_question), then library_binding { project, resource? }')
  }

  /** A successful write knows its work context: an unbound session binds to it, and a project-bound session picks up the resource it just registered — create the project, register the book, draft the path, and the chain has strung itself. Never steals another project's session, never yanks a resource off one. */
  const autoBind = async (exec: Exec | undefined, binding: LibraryBinding): Promise<void> => {
    const sessionId = sessionIdOf(exec)
    if (sessionId === undefined) return
    const current = bindingOf(exec)
    if (current !== undefined && (current.projectId !== binding.projectId || current.resourceId !== undefined)) return
    if (current !== undefined && binding.resourceId === undefined) return
    await service.setBinding(sessionId, binding)
  }

  /** The resource: the argument (either spelling), else the binding's resource, else a lesson. */
  const resourceOf = (args: Record<string, unknown>, exec: Exec | undefined): string => {
    const named = pickString(args.resource, args.book)
    if (named !== undefined) return named
    const bound = bindingOf(exec)?.resourceId
    if (bound !== undefined) return bound
    throw new Error('no resource: name it (library_read · resources lists the project\'s), or bind this session to one with library_binding')
  }

  /** A path/quiz scope's resource: a string wins (either spelling), an explicit null means "the project's own path", absent falls back to the binding's resource. */
  const scopeResourceOf = (args: Record<string, unknown>, exec: Exec | undefined): string | undefined => {
    if (args.resource === null || args.book === null) return undefined
    const named = pickString(args.resource, args.book)
    return named ?? bindingOf(exec)?.resourceId
  }

  /** The shared scope parameter descriptions (write tools). */
  const scopeParams = {
    project: { type: 'string', description: 'The project id (defaults to this session\'s binding; a resource id resolves its owner).' },
  } as const
  const scopeParamsResource = {
    ...scopeParams,
    resource: { type: 'json', description: 'Defaults to the binding\'s resource; null = the project\'s own path.' },
  } as const

  const definitions: ToolDefinition[] = []

  definitions.push(defineTool({
    name: 'library_read',
    description:
      'Read the learner\'s library (read-only). what: '
      + '"projects" — every project with its shelf progress and card tallies, plus this session\'s binding; '
      + '"resources" — a project\'s shelf: every entry with kind (book | course | article | video | repo | tool | hardware), toc presence, and its one-line why; '
      + '"toc" — one thick resource (title, edition, kind, contents rows numbered n); '
      + '"roadmap" — the adopted path and any pending draft (resource defaults to the binding\'s resource; pass resource: null for the project\'s own path); '
      + '"pages" — one thick resource\'s photographed pages (printed text + the learner\'s marks), node narrows; '
      + '"cards" — the knowledge cards: query searches term, aliases, gloss and sentences; filters resource, node, kind (word|concept), '
      + 'source (photo|chat|quiz|manual), weakMin (0-3), due; sorted weakest first — check here before teaching a point, '
      + 'to know where they got stuck before; '
      + '"quiz" — one quiz whole (quiz id), or the list; '
      + '"stats" — the whole library\'s tally. project and resource default to this session\'s binding.',
    parameters: {
      what: { type: 'string', required: true, description: `What to read: ${READ_WHATS.join(' | ')}.` },
      project: { type: 'string', description: 'Project id (defaults to the binding).' },
      resource: { type: 'json', description: 'Resource id (defaults to the binding\'s resource; null reads the project\'s own roadmap).' },
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
        case 'resources':
        case 'books': { // the v4 spelling
          const detail = unwrap(await service.getProject({ id: projectOf(args.project, exec) }))
          return { project: detail.project, resources: detail.resources } as unknown as JsonValue
        }
        case 'toc': {
          const resource = resourceOf(args, exec)
          return unwrap(await service.getResource({ projectId: projectOf(args.project, exec, resource), resourceId: resource })).resource as unknown as JsonValue
        }
        case 'roadmap': {
          const resource = scopeResourceOf(args, exec)
          return (await service.getRoadmap({ projectId: projectOf(args.project, exec, resource), ...(resource === undefined ? {} : { resourceId: resource }) })) as unknown as JsonValue
        }
        case 'pages': {
          const resource = resourceOf(args, exec)
          return (await service.listPages({
            projectId: projectOf(args.project, exec, resource),
            resourceId: resource,
            ...(args.node === undefined ? {} : { nodeId: args.node }),
          })) as unknown as JsonValue
        }
        case 'cards': {
          const resource = pickString(args.resource, (args as Record<string, unknown>).book)
          const result = await service.listCards({
            projectId: projectOf(args.project, exec, resource),
            ...(resource === undefined ? {} : { resourceId: resource }),
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
              ...(card.resourceId === undefined ? {} : { resource: card.resourceId }),
              contexts: card.contexts.slice(0, 2).map(context => context.sentence),
              weakness: card.weakness,
              box: card.mastery.box,
              dueAt: card.mastery.dueAt,
              sources: card.sources.map(source => source.note === undefined ? source.type : `${source.type}: ${source.note}`).slice(-4),
            })),
          } as unknown as JsonValue
        }
        case 'quiz': {
          const resource = scopeResourceOf(args, exec)
          const project = projectOf(args.project, exec, resource)
          if (args.quiz === undefined || args.quiz.trim() === '') {
            return (await service.listAssessments({ projectId: project, type: 'quiz', ...(resource === undefined ? {} : { resourceId: resource }) })) as unknown as JsonValue
          }
          return unwrap(await service.getAssessment({ projectId: project, assessmentId: args.quiz.trim() })).assessment as unknown as JsonValue
        }
        case 'stats':
          return (await service.stats()) as unknown as JsonValue
        default:
          throw new Error(`what is required — one of ${READ_WHATS.join(' | ')} — got ${JSON.stringify(args.what) ?? 'nothing'}; e.g. { what: "resources" } reads the bound project's shelf`)
      }
    },
  }))

  definitions.push(defineTool({
    name: 'library_project',
    description:
      'Create a learning project, or edit one (projectId + the fields to change; goal "" clears). '
      + 'template: "language" (marks are words) | "subject" (marks are concepts) | "custom". '
      + 'Creating or editing binds an unbound session to the project — the onboarding chain is just: create, register a book (library_resource, kind "book"), draft (library_roadmap).',
    parameters: {
      projectId: { type: 'string', description: 'Edit this existing project (library_read · projects lists the ids). Omit to CREATE — ids are minted (p_…), never chosen by the caller.' },
      name: { type: 'string', description: 'The project\'s name (required when creating).' },
      template: { type: 'string', description: '"language" | "subject" | "custom".' },
      goal: { type: 'string', description: 'The one-line goal ("" clears).' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      // The edit target's id: projectId now, `id` from a model that memorized
      // the old name (read off the typed surface). An id that resolves to
      // nothing plus a name is a CREATE the model dressed up with a slug —
      // create and say so, never fail it.
      const legacyId = (args as Record<string, unknown>).id
      const editId = pickString(args.projectId, legacyId)
      if (editId !== undefined) {
        const patch: Record<string, unknown> = {}
        if (typeof args.name === 'string') patch.name = args.name
        if (typeof args.template === 'string') patch.template = args.template
        if (typeof args.goal === 'string') patch.goal = args.goal
        if (Object.keys(patch).length === 0) throw new Error('editing a project takes projectId plus the fields to change (name? / goal? / template?) — omit projectId to CREATE one (name + template)')
        const edited = await service.updateProject({ id: editId, patch: patch as { name?: string; goal?: string; template?: LibraryTemplate } })
        if (edited.ok) {
          await autoBind(exec, { projectId: edited.project.id })
          return edited as unknown as JsonValue
        }
        if (typeof args.name !== 'string' || args.name.trim() === '') throw new Error(edited.message)
        const created = unwrap(await service.createProject({
          name: args.name,
          ...(typeof args.template === 'string' ? { template: args.template as LibraryTemplate } : {}),
          ...(typeof args.goal === 'string' ? { goal: args.goal } : {}),
        }))
        await autoBind(exec, { projectId: created.project.id })
        return { ...created, note: `no project ${JSON.stringify(editId)} existed — created a new one instead (ids are minted (p_…), never chosen by the caller; omit projectId to create)` } as unknown as JsonValue
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
    name: 'library_resource',
    description:
      'Put one entry on the project\'s shelf, or remove one. A THICK entry (kind "book"; a "course" with episodes) registers its contents: web-verify the exact contents first and cite the page (publisher / catalog / retailer — never a full-text copy); the toc may go as ONE newline-joined string of titles, the least mangled form. A THIN link (article | video | repo | tool | hardware) is title + url + one line on why it earns its place. Creating binds an unbound session to the project and the entry. Never ask for an upload.',
    parameters: {
      ...scopeParams,
      op: { type: 'string', required: true, enum: ['create', 'remove'], description: 'create: shelve a new entry (or correct one with resourceId); remove: take one off (its roadmap and pages go with it).' },
      resourceId: { type: 'string', description: 'op=remove: the entry id (library_read · resources lists them). op=create: correct this existing entry instead of adding.' },
      kind: { type: 'string', enum: [...LIBRARY_RESOURCE_KINDS], description: 'What it IS — book: a book (toc required); course: a lecture series with episodes (toc required); article | video | repo | tool | hardware: a thin link (url required).' },
      title: { type: 'string', description: 'op=create: the exact edition\'s title, or what the link\'s own page calls it.' },
      url: { type: 'string', description: 'A thin link\'s address (required for one); a book\'s web copy, when one exists.' },
      note: { type: 'string', description: 'A thin link: one line on why it earns its place.' },
      addedBy: { type: 'string', enum: ['coach', 'learner'], description: 'Who put it on the shelf (default coach).' },
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
          LIST_WRAPPER_SCHEMA,
        ],
        description: 'op=create, a thick entry (book / course): the contents — required for one.',
      },
      tocSource: {
        oneOf: [
          { type: 'object', additionalProperties: true, properties: {
            by: { type: 'string', required: true, enum: ['web', 'model', 'photo'], description: 'web: you verified it online (cite url); model: from memory; photo: from the learner\'s photo.' },
            url: { type: 'string', description: 'The page you verified (publisher / catalog / retailer).' },
          } },
          { type: 'string', description: 'The same object as its JSON text.' },
        ],
        description: 'A thick entry: where the contents came from — defaults to { by: "model" }; say web (+ url) once you actually verified.',
      },
      bookKind: { type: 'string', enum: ['knowledge', 'material'], description: 'A thick entry: knowledge — the content is domain knowledge (a textbook, popular science; you may quiz from what you know); material — specific text you cannot recall (exam papers, novels; quizzing needs a photo or a web quote).' },
      short: { type: 'string', description: 'A thick entry: a 2-4 character cover abbreviation (剑5 / PNS).' },
      author: { type: 'string', description: 'A thick entry: the author.' },
      edition: { type: 'string', description: 'A thick entry: the edition (e.g. 2020 年 9 月第一版).' },
      isbn: { type: 'string', description: 'A book: the ISBN.' },
      extras: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
            title: { type: 'string', required: true },
            note: { type: 'string' },
            where: { type: 'string' },
            when: { type: 'string', required: true, enum: ['before', 'reference'], description: 'before: read before starting; reference: consult when needed.' },
          } } },
          { type: 'string', description: 'The same array as its JSON text.' },
          LIST_WRAPPER_SCHEMA,
        ],
        description: 'A thick entry: how-to-use pages, answer keys, transcripts, appendices — NOT roadmap nodes.',
      },
      from: { type: 'object', additionalProperties: true, properties: {
        project: { type: 'string', required: true, description: 'The source project id.' },
        resource: { type: 'string', required: true, description: 'The source entry id.' },
      }, description: 'op=create: clone an entry from ANOTHER project (its toc and verification come along) — how a book serves two projects.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      // The v4 spellings ride along off the untyped surface (bookId → resourceId).
      const argsAny = args as Record<string, unknown>
      const namedId = pickString(args.resourceId, argsAny.bookId)
      if (args.op === 'remove') {
        if (namedId === undefined) throw new Error('library_resource · op=remove takes the resourceId field — library_read · resources lists the ids')
        return unwrap(await service.removeResource({ projectId: projectOf(args.project, exec, namedId), resourceId: namedId })) as unknown as JsonValue
      }
      if (args.op !== 'create') {
        throw new Error(`library_resource needs op: create | remove — got ${JSON.stringify(args.op)}`)
      }
      const projectId = projectOf(args.project, exec, namedId)
      const from = payload(args.from)
      if (from !== undefined) {
        const fromProject = pickString(from.project, from.projectId)
        const fromResource = pickString(from.resource, from.resourceId, from.book, from.bookId)
        if (fromProject === undefined || fromResource === undefined) throw new Error('from is { project, resource } — the OTHER project\'s id and the entry\'s id there')
        const cloned = unwrap(await service.putResource({
          projectId,
          title: '',
          kind: 'article',
          ...(namedId === undefined ? {} : { resourceId: namedId }),
          from: { projectId: fromProject, resourceId: fromResource },
        }))
        await autoBind(exec, { projectId, resourceId: cloned.resource.id })
        return cloned as unknown as JsonValue
      }
      // A whole contents may arrive as one newline-joined string — the
      // biggest single payload, and the one models mangle most as JSON.
      const tocList = payloadList(args.toc)
      const tocRows = typeof args.toc === 'string' && tocList === undefined
        ? args.toc.split('\n').map(line => line.trim()).filter(line => line !== '')
        : (tocList ?? [])
      const thick = tocRows.length > 0 || args.kind === 'book' || args.kind === 'course'
      if (thick) {
        if (typeof args.title !== 'string' || args.title.trim() === '' || tocRows.length === 0) {
          throw new Error(`a thick entry (kind "book" | "course") takes: title, toc ([{ title, part? }] | bare titles | one newline-joined string), tocSource { by, url? } (+ bookKind, short?, author?, edition?, isbn?, extras?, url?, resourceId? to correct) — ${arrival('toc', args.toc)}`)
        }
        const toc = tocRows.map(row => typeof row === 'string' ? { title: row } : row as { title: string; part?: string })
        const written = unwrap(await service.putResource({
          projectId,
          ...(namedId === undefined ? {} : { resourceId: namedId }),
          title: args.title,
          kind: args.kind === 'course' ? 'course' : 'book',
          ...(typeof args.url === 'string' ? { url: args.url } : {}),
          ...(typeof args.note === 'string' ? { note: args.note } : {}),
          ...(args.addedBy === 'learner' ? { addedBy: 'learner' as const } : {}),
          toc,
          tocSource: (payload(args.tocSource) ?? { by: 'model' }) as { by: 'web' | 'model' | 'photo'; url?: string },
          ...(args.bookKind === 'knowledge' || args.bookKind === 'material' ? { bookKind: args.bookKind } : {}),
          ...(typeof args.short === 'string' ? { short: args.short } : {}),
          ...(typeof args.author === 'string' ? { author: args.author } : {}),
          ...(typeof args.edition === 'string' ? { edition: args.edition } : {}),
          ...(typeof args.isbn === 'string' ? { isbn: args.isbn } : {}),
          ...(Array.isArray(payloadList(args.extras)) ? { extras: payloadList(args.extras) as { title: string; note?: string; where?: string; when?: 'before' | 'reference' }[] } : {}),
        }))
        await autoBind(exec, { projectId, resourceId: written.resource.id })
        return written as unknown as JsonValue
      }
      const title = pickString(args.title)
      const url = pickString(args.url)
      if (title === undefined || url === undefined) {
        throw new Error(`a thin link takes: title, url, kind ("article"|"video"|"repo"|"tool"|"hardware"), note? — got title ${title === undefined ? '✗ MISSING' : '✓'} · url ${url === undefined ? '✗ MISSING' : '✓'} (a book / course goes thick: kind "book" + toc)`)
      }
      const added = unwrap(await service.putResource({
        projectId,
        ...(namedId === undefined ? {} : { resourceId: namedId }),
        title,
        kind: (LIBRARY_RESOURCE_KINDS as readonly string[]).includes(args.kind ?? '') && args.kind !== 'book' ? args.kind as LibraryResourceKind : 'article',
        url,
        ...(typeof args.note === 'string' ? { note: args.note } : {}),
        addedBy: args.addedBy === 'learner' ? 'learner' : 'coach',
      }))
      await autoBind(exec, { projectId })
      return added as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_roadmap',
    description:
      'Write a DRAFT path (nodes) the learner adopts in the sidebar (采用) — you only ever write drafts; adoption is the learner\'s consent. '
      + 'The scope reads itself off the covers: every station drawing on the same single resource lands on THAT resource\'s path, anything mixed lands on the project\'s own — omit resource (a string is an explicit override, validated as such). '
      + 'A cover is the shorthand string "r_…#1-5" | "https://…" | "topic: …" (or the object { ref, locator? }). Returns scopeNote saying where the draft landed.',
    parameters: {
      ...scopeParams,
      resource: { type: 'json', description: 'Usually omit — the scope reads itself off the covers. A string is an explicit override (validated: a resource\'s own path covers that resource only); null forces the project\'s own path.' },
      nodes: { ...NODES_SCHEMA, required: true, description: 'The stations of the draft.' },
      passRatio: { type: 'number', description: 'The pass line in (0, 1] — 0.8 means 8 of 10 right (the default).' },
      note: { type: 'string', description: 'The one-line pacing on the draft card.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const list = payloadList(args.nodes)
      if (list === undefined) {
        throw new Error(`library_roadmap takes the nodes field: nodes: [{ id, title, gate: "quiz"|"acceptance"|"read", goals, covers: ["r_…#1-5" | "https://…" | "topic: …"], dependsOn, acceptance? (acceptance only) }] (+ passRatio?, note?) — ${arrival('nodes', args.nodes)}`)
      }
      // The scope reads itself off the covers: every station drawing on
      // the same single resource lands on THAT resource's path, anything
      // mixed lands on the project's own. `resource` survives as an explicit
      // override (a string is honored and validated; null forces the
      // project's own path); the binding's resource is consulted solely by
      // the chapterRanges sugar.
      const overrideResource = args.resource === null ? undefined : pickString(args.resource, (args as Record<string, unknown>).book)
      const sugarResource = overrideResource ?? bindingOf(exec)?.resourceId
      const nodes = (list as Record<string, unknown>[]).map(node => {
        const { chapterRanges, covers, kind, gate, ...rest } = node
        // gate is the v5 spelling; the old kind still parses (practice → acceptance).
        const gateValue = typeof gate === 'string' ? gate : kind === 'practice' ? 'acceptance' : kind
        let outCovers: unknown[] | undefined
        if (Array.isArray(covers)) {
          outCovers = (covers as unknown[]).map(cover => normalizeCoverArg(cover) ?? cover)
        } else if (chapterRanges !== undefined) {
          // Sugar for the single-resource special case: chapterRanges wrap
          // into the one resource cover a resource's own path allows.
          if (sugarResource === undefined) {
            throw new Error('chapterRanges count a resource\'s contents rows — the covers need the resource named: "r_…#1-5" (or bind this session to it first)')
          }
          const ranges = Array.isArray(chapterRanges)
            ? (chapterRanges as unknown[]).flatMap(range => {
              const row = payload(range)
              const from = typeof row?.from === 'number' ? row.from : undefined
              const to = typeof row?.to === 'number' ? row.to : undefined
              return from === undefined || to === undefined ? [] : [{ from, to }]
            })
            : []
          outCovers = [{ ref: sugarResource, locator: formatLocator(ranges) }]
        }
        return { ...rest, ...(gateValue === undefined ? {} : { gate: gateValue }), ...(outCovers === undefined ? {} : { covers: outCovers }) }
      })
      const resourceId = overrideResource ?? deriveRoadmapResource(nodes)
      const projectId = projectOf(args.project, exec, resourceId)
      const drafted = unwrap(await service.draftRoadmap({
        projectId,
        ...(resourceId === undefined ? {} : { resourceId }),
        nodes: nodes as unknown as Parameters<LibraryService['draftRoadmap']>[0]['nodes'],
        ...(typeof args.passRatio === 'number' ? { passRatio: args.passRatio } : {}),
        ...(typeof args.note === 'string' ? { note: args.note } : {}),
      }))
      await autoBind(exec, { projectId, ...(resourceId === undefined ? {} : { resourceId }) })
      const placedOn = resourceId === undefined
        ? "the project's own path (the covers mix sources)"
        : `《${unwrap(await service.getResource({ projectId, resourceId })).resource.title}》's path`
      return { ...drafted, scopeNote: `draft placed on ${placedOn} — the learner adopts it in the sidebar (采用)` } as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_notes',
    description:
      'Write or rewrite a station\'s 讲义 (markdown; math in $…$ / $$…$$ LaTeX renders for the learner): the textbook on a 讲授 (topic) station, marginalia on a book station. Rewrite as 补讲 deepens — each write bumps 第 N 次更新.',
    parameters: {
      ...scopeParamsResource,
      node: { type: 'string', required: true, description: 'The station id (library_read · roadmap lists them).' },
      text: { type: 'string', required: true, description: 'The station\'s 讲义 in markdown.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const resourceId = scopeResourceOf(args, exec)
      return unwrap(await service.putNotes({
        projectId: projectOf(args.project, exec, resourceId),
        ...(resourceId === undefined ? {} : { resourceId }),
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
      resource: { type: 'json', description: 'The resource id (defaults to the binding\'s resource) — pages belong to a thick one (a book).'},
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
          LIST_WRAPPER_SCHEMA,
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
      const pageResource = resourceOf(args, exec)
      return unwrap(await service.recordPage({
        projectId: projectOf(args.project, exec, pageResource),
        resourceId: pageResource,
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
      resource: { type: 'string', description: 'The resource id (defaults to the binding\'s resource; omit for a project-level card).' },
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
          LIST_WRAPPER_SCHEMA,
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
      const resource = pickString(args.resource, (args as Record<string, unknown>).book) ?? bindingOf(exec)?.resourceId
      return unwrap(await service.writeCards({
        projectId: projectOf(args.project, exec, resource),
        ...(resource === undefined ? {} : { resourceId: resource }),
        cards,
      })) as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_quiz',
    description:
      'Store a composed quiz. node names the quiz-gated station it gates — omit for a resource-level quiz (the resource page\'s 本书测验) or, with resource: null, a free one (the project page\'s 自由测验). focus is the learner\'s choice (mine | book | mixed). A question\'s target defaults to the station\'s topic (flat cardIds imply marked), evidence to domain knowledge (flat pageId / url / quote imply photo / web). After it returns, reply with one line — the learner answers in the sidebar, never in the conversation.',
    parameters: {
      ...scopeParamsResource,
      node: { type: 'string', description: 'The quiz-gated station the quiz gates — omit for a resource-level quiz, or with resource: null a free one.' },
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
      const resourceId = scopeResourceOf(args, exec)
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
      const projectId = projectOf(args.project, exec, resourceId)
      const written = unwrap(await service.putQuiz({
        projectId,
        quiz: {
          ...(args.focus === 'mine' || args.focus === 'book' || args.focus === 'mixed' ? { focus: args.focus } : {}),
          scope: { ...(resourceId === undefined ? {} : { resourceId }), ...(node === undefined ? {} : { nodeId: node }) },
          questions: cleaned as unknown as LibraryQuizQuestion[],
        },
      }))
      await autoBind(exec, { projectId, ...(resourceId === undefined ? {} : { resourceId }) })
      return written as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_binding',
    description:
      'Bind this session to a project (and optionally a resource) — the header chip, and every tool\'s defaults. binding: null unbinds. Most writes bind an unbound session by themselves; bind by hand to switch, or when there is nothing to infer from.',
    parameters: {
      binding: {
        oneOf: [
          { type: 'object', additionalProperties: true, properties: {
            project: { type: 'string', required: true, description: 'The project id (library_read · projects lists them).' },
            resource: { type: 'string', description: 'Optionally the resource within it (a book, to work inside its path).' },
          } },
          { type: 'null', description: 'Unbind this session.' },
        ],
        description: 'The binding — or null to unbind.',
      },
      project: { type: 'string', description: 'Alias for binding.project (both work).' },
      resource: { type: 'string', description: 'Alias for binding.resource.' },
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
      const projectId = pickString(body.project, body.projectId, args.project)
      const resourceId = pickString(body.resource, body.resourceId, body.book, body.bookId, args.resource, (args as Record<string, unknown>).book)
      if (projectId === undefined) {
        throw new Error('binding needs the project: binding { project, resource? } (library_read · projects lists them); pass binding: null to unbind')
      }
      return unwrap(await service.setBinding(sessionId, { projectId, ...(resourceId === undefined ? {} : { resourceId }) })) as unknown as JsonValue
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
      + 'Acceptance: pass node instead of quiz — the station must be an acceptance node; each verdict\'s task is the rubric line\'s id (L1, L2, …) or the line VERBATIM. '
      + 'A line carrying ref is machine-checked by that quiz — never judge it. The learner submits the evidence (terminal output, a screenshot, a repo link), you judge each line. Same cascade.',
    parameters: {
      project: { type: 'string', description: 'Project id (defaults to the binding).' },
      quiz: { type: 'string', description: 'The quiz id library_quiz returned (a quiz sitting).' },
      node: { type: 'string', description: 'Acceptance station id (an acceptance sitting — instead of quiz).' },
      resource: { type: 'string', description: 'Resource id when the acceptance station sits on a resource\'s path (omit for the project\'s).' },
      verdicts: {
        type: 'array',
        required: true,
        description: 'One verdict per question.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            task: { type: 'string', description: 'The question id (a quiz sitting), or the rubric line id — L1, L2… (an acceptance sitting).' },
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
      const node = pickString(args.node)
      if (node !== undefined) {
        const resource = pickString(args.resource, (args as Record<string, unknown>).book)
        return unwrap(await service.putAttempt({
          projectId: projectOf(args.project, exec, resource),
          nodeId: node,
          ...(resource === undefined ? {} : { resourceId: resource }),
          verdicts: [...args.verdicts] as LibraryVerdict[],
        })) as unknown as JsonValue
      }
      const quiz = pickString(args.quiz)
      if (quiz === undefined) throw new Error('quiz is the id library_quiz returned — or pass node (an acceptance station\'s id) for acceptance')
      return unwrap(await service.putAttempt({
        projectId: projectOf(args.project, exec),
        assessmentId: quiz,
        verdicts: [...args.verdicts] as LibraryVerdict[],
      })) as unknown as JsonValue
    },
  }))

  return definitions
}
