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
 * A path belongs to one TEXTBOOK (a resource with a contents; proposal
 * 2026-10-19-library-book-paths): `library_roadmap` takes the textbook as a
 * required `resource`, and a station names that textbook's rows as
 * `chapters: "3-4"` plus side references in `also` — both expand to the
 * stored covers (`{ ref, locator? }`). The older spellings still parse
 * (`covers`, `chapterRanges`, `book`, node `kind`), they are just no longer
 * advertised. A node's `gate` says how it completes (quiz | acceptance |
 * read).
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

/**
 * A contents sent as one text: one row per line. Models also join the rows
 * with ；/; on a single line, or send literal "\\n" escapes — a single line
 * holding several separators splits on them (a 30-chapter book once landed
 * as ONE row, and every station's chapters then fell out of range).
 */
export function splitTocText(text: string): string[] {
  const lines = text.replace(/\\n/g, '\n').split('\n').map(line => line.trim()).filter(line => line !== '')
  if (lines.length !== 1) return lines
  const parts = lines[0]!.split(/\s*[；;]\s*/).map(part => part.trim()).filter(part => part !== '')
  return parts.length >= 3 ? parts : lines
}

/**
 * A station's chapters as a locator: row numbers and ranges, whatever the
 * dash or separator ("15–16", "3-4、7", "第3-4章"); words around them (an
 * appendix, a part name) come back as `rest` for a topic side reference.
 */
export function chaptersLocator(chapters: string): { locator: string; rest?: string } {
  const normalized = chapters.replace(/[–—~～至到]/g, '-').replace(/[，、；;/]/g, ',')
  const ranges = [...normalized.matchAll(/(\d+)\s*(?:-\s*(\d+))?/g)].map(match => match[2] === undefined ? match[1]! : `${match[1]}-${match[2]}`)
  const rest = normalized.replace(/(\d+)\s*(?:-\s*(\d+))?/g, '').replace(/[第章节,+\s-]+/g, ' ').trim()
  return { locator: ranges.join(','), ...(rest === '' ? {} : { rest }) }
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
    { type: 'array', description: 'The stations, in study order.', items: { type: 'object', additionalProperties: true, properties: {
      id: { type: 'string', description: 'Required: a unique station id (letters, digits, . _ -).' },
      title: { type: 'string', description: 'Required: what the learner masters here.' },
      gate: { type: 'string', enum: ['quiz', 'acceptance', 'read'], description: 'Required. quiz: a level, passed by its chapter quiz; acceptance: a hands-on station judged line by line; read: an optional side stop (读完), never a dependency.' },
      chapters: { oneOf: [{ type: 'string' }, { type: 'integer' }], description: 'The textbook\'s contents rows this station covers — row numbers as library_read · toc numbers them, 1-based: "3-4" | "5" | "1-2,7". Omit only on a station resting on also alone.' },
      also: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: 'Side references: "https://…" (a web text, a video), "r_…#2" (another shelf entry), "topic: …" (your own teaching beyond the book).' },
      goals: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: 'What the learner can do after it (never acceptance lines).' },
      dependsOn: { type: 'array', items: { type: 'string' }, description: 'Earlier station ids this one waits for.' },
      points: { type: 'array', description: 'gate=quiz only: its 3-6 knowledge points { id, title } — every question names one; ids are stable slugs, never reworded.', items: { type: 'object', additionalProperties: true, properties: {
        id: { type: 'string' },
        title: { type: 'string', description: 'As the learner reads it (「极限的定义」).' },
      } } },
      acceptance: { type: 'array', description: 'gate=acceptance: the lines judged one verdict each (ids L1, L2… by order). { line, ref: <quiz id> } passes itself when that quiz passes — compose the quiz first.', items: { oneOf: [
        { type: 'string' },
        { type: 'object', additionalProperties: true, properties: {
          line: { type: 'string' },
          ref: { type: 'string' },
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
      id: { type: 'string', description: 'Required.' },
      kind: { type: 'string', enum: ['choice', 'fill', 'free'], description: 'Required.' },
      prompt: { type: 'string', description: 'Required.' },
      options: { type: 'array', description: 'choice only.', items: { oneOf: [
        { type: 'string', description: 'The option text.' },
        { type: 'object', additionalProperties: true, properties: { label: { type: 'string' } } },
      ] } },
      answer: { type: 'string', description: 'Required on every question; choice: the correct option, copied verbatim.' },
      explanation: { type: 'string', description: 'Why the answer is right.' },
      point: { type: 'string', description: 'The station point it probes (its id).' },
      target: {
        oneOf: [
          { type: 'object', additionalProperties: true, properties: {
            kind: { type: 'string', enum: ['marked', 'asked', 'missed', 'topic'] },
            cardIds: { type: 'array', items: { type: 'string' } },
          } },
          { type: 'string', enum: ['marked', 'asked', 'missed', 'topic'], description: 'Just the kind.' },
        ],
        description: 'Optional — omit for the station\'s topic; flat cardIds imply marked.',
      },
      evidence: {
        oneOf: [
          { type: 'object', additionalProperties: true, properties: {
            kind: { type: 'string', enum: ['photo', 'web', 'knowledge'] },
            pageId: { type: 'string' },
            url: { type: 'string' },
            quote: { type: 'string', description: 'The passage, verbatim.' },
          } },
          { type: 'string', enum: ['photo', 'web', 'knowledge'], description: 'Just the kind.' },
        ],
        description: 'Optional — omit for domain knowledge; flat pageId / url set photo / web.',
      },
      cardIds: { type: 'array', items: { type: 'string' }, description: 'The learner\'s cards it probes (library_read · cards).' },
      quote: { type: 'string', description: 'The passage the answer rests on, verbatim.' },
      url: { type: 'string', description: 'The web page quoted.' },
      pageId: { type: 'string', description: 'The photographed page quoted (library_read · pages).' },
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

  /** The textbooks of the bound project, as one teaching line for a refusal. */
  const textbookList = (exec: Exec | undefined): string => {
    const summary = sessionIdOf(exec) === undefined ? undefined : service.bindingSummary(sessionIdOf(exec)!, 0)
    const textbooks = summary?.textbooks ?? []
    return textbooks.length === 0 ? '' : ` — this project's textbooks: ${textbooks.map(textbook => `${textbook.seq ?? '-'}. ${textbook.id} 《${textbook.title}》`).join('; ')}`
  }

  /** The resource: the argument (either spelling), else the binding's resource, else a lesson. */
  const resourceOf = (args: Record<string, unknown>, exec: Exec | undefined): string => {
    const named = pickString(args.resource, args.book)
    if (named !== undefined) return named
    const bound = bindingOf(exec)?.resourceId
    if (bound !== undefined) return bound
    throw new Error(`no textbook named: pass resource${textbookList(exec) || ' (library_read · resources lists them)'}, or bind this session to one (library_binding)`)
  }

  /** The shared scope parameters (write tools). */
  const scopeParams = {
    project: { type: 'string', description: 'Project id (defaults to the binding; a resource id implies its project).' },
  } as const
  const textbookParams = {
    ...scopeParams,
    resource: { type: 'string', description: 'The textbook id (defaults to the binding\'s).' },
  } as const

  const definitions: ToolDefinition[] = []

  definitions.push(defineTool({
    name: 'library_read',
    description:
      'Read the library. what: '
      + '"projects" — every project with its textbooks\' progress and card tallies, plus this session\'s binding; '
      + '"resources" — one project\'s shelf: textbooks in study order (seq, origin, path state), then links; '
      + '"toc" — one textbook\'s contents rows (numbered n); '
      + '"roadmap" — one textbook\'s adopted path and pending draft; '
      + '"pages" — a textbook\'s photographed pages (text + the learner\'s marks), node narrows; '
      + '"cards" — knowledge cards, weakest first: query searches term / gloss / sentences; filters resource, node, kind, source, weakMin (0-3), due — check before teaching a point; '
      + '"quiz" — one quiz whole (quiz id), or the list; '
      + '"stats" — the whole library\'s tally. project and resource default to the binding.',
    parameters: {
      what: { type: 'string', required: true, description: `What to read: ${READ_WHATS.join(' | ')}.` },
      project: { type: 'string', description: 'Project id (defaults to the binding).' },
      resource: { type: 'string', description: 'Textbook / resource id (defaults to the binding\'s).' },
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
          const resource = resourceOf(args, exec)
          return (await service.getRoadmap({ projectId: projectOf(args.project, exec, resource), resourceId: resource })) as unknown as JsonValue
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
          const resource = pickString(args.resource, (args as Record<string, unknown>).book) ?? bindingOf(exec)?.resourceId
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
      + 'Creating binds an unbound session to it. A project is a goal and carries no path: next, shelve its textbooks (library_resource), then draft each one\'s path (library_roadmap).',
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
      'Shelve, reorder or remove one entry. A TEXTBOOK is anything with a contents (kind book | course): the learner\'s own (origin learner), an existing book or digital course you pick (picked — only the chapters the goal needs end up in its path), or one you author when nothing fits (authored — your own contents; your 讲义 are its text). Shelve textbooks in study order (seq; omitted = last). Verify a real one\'s exact edition and contents on the web and cite the page (tocSource web + url); never ask for an upload. A LINK (article | video | repo | tool | hardware) is title + url + why — it never carries a path, a station cites it (also).',
    parameters: {
      ...scopeParams,
      op: { type: 'string', required: true, enum: ['create', 'move', 'remove'], description: 'create: shelve (or correct one, with resourceId); move: put a textbook at seq; remove: take one off (its path and pages go too).' },
      resourceId: { type: 'string', description: 'The entry to correct / move / remove.' },
      kind: { type: 'string', enum: [...LIBRARY_RESOURCE_KINDS], description: 'book | course: a textbook (toc required); article | video | repo | tool | hardware: a link (url required).' },
      origin: { type: 'string', enum: ['learner', 'picked', 'authored'], description: 'Whose it is (default picked).' },
      seq: { type: 'integer', description: 'A textbook\'s place in the study order, from 1 (the rest shift).' },
      title: { type: 'string', description: 'The exact edition\'s title, or what the link\'s page calls it.' },
      url: { type: 'string', description: 'A link\'s address; a digital textbook\'s home page.' },
      note: { type: 'string', description: 'One line on why it is here.' },
      toc: {
        oneOf: [
          { type: 'string', description: 'The whole contents as ONE newline-joined string of titles (preferred).' },
          { type: 'array', description: 'One row per chapter.', items: { oneOf: [
            { type: 'string' },
            { type: 'object', additionalProperties: true, properties: {
              title: { type: 'string', required: true },
              part: { type: 'string', description: 'The part heading it belongs to (a part is never a row).' },
            } },
          ] } },
          LIST_WRAPPER_SCHEMA,
        ],
        description: 'A textbook\'s contents — required for one.',
      },
      tocSource: {
        oneOf: [
          { type: 'object', additionalProperties: true, properties: {
            by: { type: 'string', required: true, enum: ['web', 'model', 'photo'], description: 'web: verified online (+ url); model: your own or from memory; photo: the learner\'s photo.' },
            url: { type: 'string' },
          } },
          { type: 'string', description: 'The same object as its JSON text.' },
        ],
        description: 'Where the contents came from (default { by: "model" }).',
      },
      bookKind: { type: 'string', enum: ['knowledge', 'material'], description: 'knowledge: domain knowledge you may quiz from memory (textbooks); material: specific text you cannot recall (exam papers, novels — questions need a photo or web quote).' },
      author: { type: 'string' },
      edition: { type: 'string', description: 'e.g. 2010 年 8 月第一版.' },
      isbn: { type: 'string' },
      short: { type: 'string', description: 'A 2-4 character cover abbreviation (普微 / 剑5).' },
      extras: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
            title: { type: 'string', required: true },
            note: { type: 'string' },
            where: { type: 'string' },
            when: { type: 'string', required: true, enum: ['before', 'reference'] },
          } } },
          { type: 'string', description: 'The same array as its JSON text.' },
          LIST_WRAPPER_SCHEMA,
        ],
        description: 'How-to-use pages, answer keys, appendices worth knowing about — not stations (before: read first; reference: when needed).',
      },
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
      if (args.op === 'move') {
        if (namedId === undefined || typeof args.seq !== 'number') throw new Error('library_resource · op=move takes resourceId and seq (the textbook\'s new place, from 1)')
        const moved = unwrap(await service.moveResource({ projectId: projectOf(args.project, exec, namedId), resourceId: namedId, seq: args.seq }))
        return { order: moved.resources.filter(resource => resource.seq !== undefined).map(resource => `${resource.seq}. ${resource.id} 《${resource.title}》`) } as unknown as JsonValue
      }
      if (args.op !== 'create') {
        throw new Error(`library_resource needs op: create | move | remove — got ${JSON.stringify(args.op)}`)
      }
      // origin is the v6 field; the older addedBy still parses (coach → picked).
      const originArg = argsAny.origin ?? (argsAny.addedBy === 'learner' ? 'learner' : argsAny.addedBy === 'coach' ? 'picked' : undefined)
      const origin = originArg === 'learner' || originArg === 'picked' || originArg === 'authored' ? { origin: originArg } as const : {}
      const projectId = projectOf(args.project, exec, namedId)
      // Cloning from another project is no longer advertised but still parses.
      const from = payload(argsAny.from)
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
        ? splitTocText(args.toc)
        : (tocList ?? [])
      const thick = tocRows.length > 0 || args.kind === 'book' || args.kind === 'course'
      if (thick) {
        if (typeof args.title !== 'string' || args.title.trim() === '' || tocRows.length === 0) {
          throw new Error(`a textbook (kind "book" | "course") takes: title, toc (one newline-joined string of titles, or [{ title, part? }]), tocSource { by, url? }, origin, seq? (+ bookKind, edition?, author?, isbn?, url?, resourceId? to correct) — ${arrival('toc', args.toc)}`)
        }
        const toc = tocRows.map(row => typeof row === 'string' ? { title: row } : row as { title: string; part?: string })
        const written = unwrap(await service.putResource({
          projectId,
          ...(namedId === undefined ? {} : { resourceId: namedId }),
          title: args.title,
          kind: args.kind === 'course' ? 'course' : 'book',
          ...(typeof args.url === 'string' ? { url: args.url } : {}),
          ...(typeof args.note === 'string' ? { note: args.note } : {}),
          ...origin,
          ...(typeof args.seq === 'number' ? { seq: args.seq } : {}),
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
        // A real book with a handful of rows was almost always joined wrong — say so before a path is drafted against it.
        const rows = written.resource.toc?.length ?? 0
        return {
          ...written,
          contentsRows: rows,
          ...(rows < 3 ? { warning: `the contents has only ${rows} row(s) — one row per chapter is expected (station chapters count these rows). If the chapters got joined, resend toc with one chapter per line and resourceId ${written.resource.id}` } : {}),
        } as unknown as JsonValue
      }
      const title = pickString(args.title)
      const url = pickString(args.url)
      if (title === undefined || url === undefined) {
        throw new Error(`a link takes: title, url, kind ("article"|"video"|"repo"|"tool"|"hardware"), note? — got title ${title === undefined ? '✗ MISSING' : '✓'} · url ${url === undefined ? '✗ MISSING' : '✓'} (a textbook takes kind "book" | "course" + toc)`)
      }
      const added = unwrap(await service.putResource({
        projectId,
        ...(namedId === undefined ? {} : { resourceId: namedId }),
        title,
        kind: (LIBRARY_RESOURCE_KINDS as readonly string[]).includes(args.kind ?? '') && args.kind !== 'book' ? args.kind as LibraryResourceKind : 'article',
        url,
        ...(typeof args.note === 'string' ? { note: args.note } : {}),
        ...origin,
      }))
      await autoBind(exec, { projectId })
      return added as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_roadmap',
    description:
      'Write one textbook\'s DRAFT path; it replaces that textbook\'s previous draft. The learner adopts it on the textbook\'s page (采用) — you only write drafts, and never ask before writing one. '
      + 'A station covers the textbook\'s rows (chapters: "3-4"); also adds side references (a link, another entry\'s rows, topic: your own teaching) without moving the path anywhere. '
      + 'A path covers what the goal needs — skipping chapters is fine. Returns where it landed and which textbooks still wait for adoption.',
    parameters: {
      resource: { type: 'string', required: true, description: 'The textbook this path belongs to (library_read · resources lists them).' },
      nodes: { ...NODES_SCHEMA, required: true, description: 'The stations.' },
      passRatio: { type: 'number', description: 'The pass line in (0, 1] (default 0.8).' },
      note: { type: 'string', description: 'One line of pacing for the draft card.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const list = payloadList(args.nodes)
      if (list === undefined) {
        throw new Error(`library_roadmap takes resource and nodes: [{ id, title, gate: "quiz"|"acceptance"|"read", chapters: "3-4", also?, goals, points? (quiz), acceptance? (acceptance), dependsOn }] (+ passRatio?, note?) — ${arrival('nodes', args.nodes)}`)
      }
      const argsAny = args as Record<string, unknown>
      const resourceId = pickString(args.resource, argsAny.book)
      if (resourceId === undefined) throw new Error(`a path belongs to one textbook — pass resource${textbookList(exec) || ' (register the textbook first with library_resource)'}`)
      const adjusted: string[] = []
      const nodes = (list as Record<string, unknown>[]).map(node => {
        const { chapters, also, chapterRanges, covers, kind, gate, points, ...rest } = node
        // gate is the v5 spelling; the old kind still parses (practice → acceptance).
        const gateValue = typeof gate === 'string' ? gate : kind === 'practice' ? 'acceptance' : kind
        // Points belong to quiz stations; on any other gate they are dropped, not refused.
        const keepPoints = gateValue === 'quiz' || points === undefined || (Array.isArray(points) && points.length === 0)
        if (!keepPoints) adjusted.push(`points dropped on ${String(rest.title ?? rest.id)} — a ${String(gateValue)} station has no quiz; what it checks belongs in ${gateValue === 'acceptance' ? 'acceptance lines' : 'goals'}`)
        const main: Record<string, unknown>[] = []
        const spelled = typeof chapters === 'string' && chapters.trim() !== '' ? chaptersLocator(chapters) : undefined
        if (spelled?.rest !== undefined) adjusted.push(`${String(rest.title ?? rest.id)}: "${spelled.rest}" in chapters is not a row number — kept as a side reference (topic: ${spelled.rest})`)
        const locator = typeof chapters === 'number' ? String(chapters)
          : spelled !== undefined ? spelled.locator
            : Array.isArray(chapters) ? (chapters as unknown[]).filter(entry => typeof entry === 'number' || typeof entry === 'string').join(',')
              : Array.isArray(chapterRanges) ? formatLocator((chapterRanges as unknown[]).flatMap(range => {
                const row = payload(range)
                return typeof row?.from === 'number' && typeof row.to === 'number' ? [{ from: row.from, to: row.to }] : []
              })) : undefined
        if (locator !== undefined && locator !== '') main.push({ ref: resourceId, locator })
        const side = [...(Array.isArray(covers) ? covers as unknown[] : []), ...(Array.isArray(also) ? also as unknown[] : typeof also === 'string' ? [also] : []), ...(spelled?.rest === undefined ? [] : [`topic: ${spelled.rest}`])]
          .map(cover => normalizeCoverArg(cover) ?? cover)
        // A station naming neither rows nor references rests on the textbook whole.
        const all = main.length === 0 && side.length === 0 ? [{ ref: resourceId }] : [...main, ...side]
        return { ...rest, ...(gateValue === undefined ? {} : { gate: gateValue }), ...(keepPoints && points !== undefined ? { points } : {}), covers: all }
      })
      const projectId = projectOf(argsAny.project, exec, resourceId)
      const before = unwrap(await service.getProject({ id: projectId }))
      const replaced = before.project.resources.find(row => row.id === resourceId)?.hasDraft === true
      const drafted = unwrap(await service.draftRoadmap({
        projectId,
        resourceId,
        nodes: nodes as unknown as Parameters<LibraryService['draftRoadmap']>[0]['nodes'],
        ...(typeof args.passRatio === 'number' ? { passRatio: args.passRatio } : {}),
        ...(typeof args.note === 'string' ? { note: args.note } : {}),
      }))
      await autoBind(exec, { projectId, resourceId })
      const after = unwrap(await service.getProject({ id: projectId }))
      const textbook = after.project.resources.find(row => row.id === resourceId)
      return {
        ok: true,
        placedOn: `${textbook?.seq ?? '-'}. 《${textbook?.title ?? resourceId}》 (${resourceId})`,
        stations: drafted.draft.nodes.length,
        ...(replaced ? { replacedDraft: true } : {}),
        waitingForAdoption: after.project.resources.filter(row => row.hasDraft).map(row => `${row.seq ?? '-'}. 《${row.title}》 ${row.draftTotal ?? 0} stations`),
        ...(adjusted.length === 0 ? {} : { adjusted }),
        next: 'the learner adopts it on the textbook\'s page (采用) — say so in one line',
      } as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_notes',
    description:
      'Write or rewrite a station\'s 讲义 (markdown; math in $…$ / $$…$$): when a station\'s teaching settles, and whenever the learner asks to 补讲 / 沉淀讲义 — the explanation, the points THIS learner got stuck on, the pitfalls. On an authored textbook the 讲义 ARE the text; on a real book they are marginalia, never a substitute. Each rewrite bumps 第 N 次更新.',
    parameters: {
      ...textbookParams,
      node: { type: 'string', required: true, description: 'The station id (library_read · roadmap lists them).' },
      text: { type: 'string', required: true, description: 'The station\'s 讲义 in markdown.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const resourceId = resourceOf(args, exec)
      return unwrap(await service.putNotes({
        projectId: projectOf(args.project, exec, resourceId),
        resourceId,
        nodeId: String(args.node),
        text: String(args.text),
      })) as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_page',
    description:
      'Record a photographed page in ONE call: transcribe the printed text (a photo-backed question quotes it), list every mark with its sentence and in-context gloss — each certain mark becomes a card at once; flag the unreadable uncertain (kept, never carded). Omit attachment for the latest photo. If you cannot see images on this route, say so instead.',
    parameters: {
      ...textbookParams,
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
      'Record weak points the moment the learner is stuck (mixes it up, asks the same point again, keeps probing one detail): { kind: word|concept, term, gloss, context?, source: { type: "chat" }, weaken: true }, then say in one short line what you noted. Ordinary curiosity is not a weak point. Near-duplicates come back pending with candidates — resend each with mergeInto or asNew.',
    parameters: {
      ...scopeParams,
      resource: { type: 'string', description: 'The textbook it came up in (defaults to the binding\'s).' },
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
      'Store a composed quiz; then reply with ONE line — the learner answers in the sidebar\'s 章节考 tab, never in the conversation. '
      + 'Scope: node = the quiz-gated station it gates; no node = a textbook-level quiz (本书测验); resource null = a free quiz (自由测验). '
      + 'focus is the learner\'s choice and binds you — mine: only their cards (too few: fewer questions, say so); book: the chapter\'s content only; mixed: their cards first (weakest first), then the chapter. '
      + 'Points: every question names the station point it probes (point); a full chapter quiz touches every point, a retake only the missed ones; a genuine gap in the split goes in addPoints. '
      + 'Evidence: a photographed page\'s text, else a web quote + url, else domain knowledge (say so) — the book beats your memory; a material textbook never takes a content question from memory. '
      + 'Authoring: choice — compose the correct option first and copy it into answer verbatim; fill — only a short answer (term, name, number, formula, date), judged on the spot by text or by value (1/2 = 0.5 = \\frac{1}{2}); several blanks go comma-separated in the order the prompt asks; alternatives are joined with " / " (spaced) — never a bare slash, which is a fraction; free — the prompt locates the passage (quote it). '
      + 'Math only inside $…$ / $$…$$ ($\\sqrt{x+1}$, never √(x+1) or x^2). The prompt stays clean: no kind label, no chapter reference, no recipe (that is explanation). '
      + 'Questions the learner flagged 「这题有问题」 are void — offer replacements on the same points.',
    parameters: {
      ...scopeParams,
      resource: { type: 'json', description: 'The textbook (defaults to the binding\'s); null = a free quiz on no textbook.' },
      node: { type: 'string', description: 'The quiz-gated station it gates.' },
      focus: { type: 'string', enum: ['mine', 'book', 'mixed'], description: 'The learner\'s choice of source.' },
      addPoints: { type: 'array', description: 'New points for the gated station (a genuine gap only).', items: { type: 'object', additionalProperties: true, properties: {
        id: { type: 'string', required: true },
        title: { type: 'string', required: true },
      } } },
      questions: {
        ...QUESTIONS_SCHEMA,
        required: true,
        description: 'The questions.',
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
      // An explicit null is a free quiz on no textbook; absent falls back to the binding's.
      const argsAny = args as Record<string, unknown>
      const resourceId = args.resource === null || argsAny.book === null ? undefined : pickString(args.resource, argsAny.book) ?? bindingOf(exec)?.resourceId
      // Options may arrive as { label } objects or a letter-keyed map —
      // the stored form is plain strings (the same tolerance reads them
      // back); the two axes default (topic + knowledge) and take the flat
      // cardIds / quote / url / pageId shorthands.
      const cleaned = (questions as Record<string, unknown>[]).map(raw => {
        // The schema no longer rejects a question missing its id / kind / prompt /
        // answer (that refusal named no question); blanks reach the service's
        // per-question check, which names each one.
        const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
        let next: Record<string, unknown> = { ...raw, id: text(raw.id), kind: text(raw.kind), prompt: text(raw.prompt), answer: text(raw.answer) }
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
          ...(Array.isArray(args.addPoints) ? { addPoints: args.addPoints as { id: string; title: string }[] } : {}),
        },
      }))
      await autoBind(exec, { projectId, ...(resourceId === undefined ? {} : { resourceId }) })
      return written as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'library_binding',
    description:
      'Bind this session to a project (and optionally a textbook) — the header chip, and every tool\'s defaults. Writes bind an unbound session by themselves; bind by hand to switch, or unbind: true.',
    parameters: {
      project: { type: 'string', description: 'The project id (library_read · projects lists them).' },
      resource: { type: 'string', description: 'A textbook within it, to work inside its path.' },
      unbind: { type: 'boolean', description: 'Unbind this session instead.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec)
      if (sessionId === undefined) throw new Error('binding needs a session — this call came from none')
      // unbind: true (or the older binding: null) unbinds; the older nested
      // binding { project, resource } still parses.
      const argsAny = args as Record<string, unknown>
      if (args.unbind === true || argsAny.binding === null) return unwrap(await service.setBinding(sessionId, null)) as unknown as JsonValue
      const body = payload(argsAny.binding) ?? {}
      const projectId = pickString(body.project, body.projectId, args.project)
      const resourceId = pickString(body.resource, body.resourceId, body.book, body.bookId, args.resource, (args as Record<string, unknown>).book)
      if (projectId === undefined) {
        throw new Error('binding needs the project: { project, resource? } (library_read · projects lists them); unbind: true to unbind')
      }
      // An id the shelf does not hold (a guessed slug before the textbook is
      // registered) binds the project and says so — not a failed call.
      if (resourceId !== undefined && !(await service.getResource({ projectId, resourceId })).ok) {
        const bound = unwrap(await service.setBinding(sessionId, { projectId }))
        return { ...bound, note: `no resource ${JSON.stringify(resourceId)} in this project — bound the project only. Resource ids are minted (r_…); registering the textbook (library_resource) binds this session to it by itself${textbookList(exec)}` } as unknown as JsonValue
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
      + 'The engine moves every probed card, carding a card-less miss, and completes the gated station at its pass ratio, unlocking what follows — report what moved and what unlocked. '
      + 'Acceptance: pass node instead of quiz; each verdict\'s task is a rubric line id (L1, L2…) judged against the evidence the learner submitted. A line carrying ref is machine-checked — never judge it.',
    parameters: {
      project: { type: 'string', description: 'Project id (defaults to the binding).' },
      quiz: { type: 'string', description: 'The quiz id library_quiz returned (a quiz sitting).' },
      node: { type: 'string', description: 'Acceptance station id (an acceptance sitting — instead of quiz).' },
      resource: { type: 'string', description: 'The textbook whose path holds the acceptance station (defaults to wherever the node is).' },
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
