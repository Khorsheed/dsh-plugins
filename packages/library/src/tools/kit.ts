/**
 * What every library tool shares: payload transport helpers, the parameter
 * schemas, and the per-call context kit (binding defaults, project / resource
 * resolution, auto-binding). Each tool lives in its own file under `tools/`
 * and receives the kit; `tool-definition.ts` assembles them in workflow order.
 *
 * @module @khorsheed/dsh-library/tools/kit
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { formatLocator, type LibraryBinding, type LibraryOutcome } from '../types.ts'
import type { LibraryService } from '../service.ts'
import { ImageRefCache } from '../image-refs.ts'

/** JSON pass-through output — what the render emits IS what the model reads, so it goes compact (indentation doubled every result). */
export function jsonOutput() {
  return {
    schema: { type: 'json' } as const,
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
}

/** Unwrap a service outcome: the domain value, or a thrown Error whose message IS the lesson. */
export function unwrap<T>(outcome: LibraryOutcome<T>): T {
  if (outcome.ok) return outcome
  throw new Error(outcome.message)
}

export const READ_WHATS = ['projects', 'resources', 'toc', 'roadmap', 'pages', 'cards', 'quiz'] as const

export type Exec = { agent?: Agent }

/** The calling session's id, when the call came from a session. */
export function sessionIdOf(exec: Exec | undefined): string | undefined {
  const id = exec?.agent?.session?.id
  return id === undefined ? undefined : String(id)
}

/**
 * Payloads arrive as objects — or, from models that stringify deep parameters
 * (common with big nested ones), as their JSON text; both parse. A refusal
 * names what actually arrived, so the model fixes the transport instead of
 * guessing at the shape.
 */
export function payload(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function payloadList(value: unknown): unknown[] | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  if (Array.isArray(value)) return value
  // A model as often wraps the list: { items: [...] } — unwrap it (the schema
  // carries a matching object branch so this shape reaches execute at all).
  const items = payload(value)?.items
  return Array.isArray(items) ? items : undefined
}

export function arrival(field: string, value: unknown): string {
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
export function pickString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim() !== '')?.trim()
}

/**
 * One cover argument → the stored `{ ref, locator?, … }`. Accepts the string
 * shorthand ("r_…#1-5" | "https://…" | "topic: …"), the v5 object, and every
 * legacy union member ({ kind: "book", bookId|book, ranges } |
 * { kind: "resource", resourceId|resource } | { kind: "url", url, title? } |
 * { kind: "topic", text }). Undefined when nothing usable arrived.
 */
export function normalizeCoverArg(value: unknown): Record<string, unknown> | undefined {
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
export function normalizeQuestionAxes(question: Record<string, unknown>): Record<string, unknown> {
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
export const LIST_WRAPPER_SCHEMA = { type: 'object', additionalProperties: true, description: 'The same list wrapped: { items: [...] }.' } as const

/**
 * The roadmap nodes schema. Only the canonical shape is advertised; execute
 * still takes the older spellings (also, dependsOn, read stations, acceptance
 * refs, chapterRanges, covers) — the schema items allow extra keys, and the
 * JSON-text branch lets a stringified list through to execute's parser.
 */
export const NODES_SCHEMA = {
  oneOf: [
    { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
      id: { type: 'string', description: 'Unique: s1, s2…' },
      title: { type: 'string' },
      chapters: { oneOf: [{ type: 'string' }, { type: 'integer' }], description: 'Contents rows it covers: "4" | "3-4".' },
      points: { type: 'array', description: 'Required: its 3–5 knowledge points — the chapter quiz asks them.', items: { type: 'object', additionalProperties: true, properties: {
        id: { type: 'string', description: 'A stable slug.' },
        title: { type: 'string' },
      } } },
      goals: { type: 'json', description: 'What the learner can do after it: ["…"].' },
    } } },
    { type: 'string', description: 'The same list as JSON text.' },
  ],
} as const

/**
 * The quiz questions schema. ids are numbered when missing; target and
 * evidence follow from cardIds / quote / pageId / url and the textbook (the
 * full two-axis objects still parse).
 */
export const QUESTIONS_SCHEMA = {
  oneOf: [
    { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
      point: { type: 'string', description: 'The station point it probes.' },
      kind: { type: 'string', enum: ['choice', 'fill', 'free'] },
      prompt: { type: 'string' },
      options: { type: 'json', description: 'choice only: ["…", "…"].' },
      answer: { type: 'string', description: 'choice: the right option, verbatim.' },
      explanation: { type: 'string' },
      quote: { type: 'string', description: 'The page text it rests on (required for a material textbook).' },
    } } },
    { type: 'string', description: 'The same list as JSON text.' },
  ],
} as const


/** The per-call helpers every tool closes over, built once per tool set. */
export function createToolKit(service: LibraryService, images: ImageRefCache) {
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
    service.noteSessionWrite(sessionId)
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
    project: { type: 'string', description: 'Defaults to the binding.' },
  } as const
  const textbookParams = {
    ...scopeParams,
    resource: { type: 'string', description: 'Defaults to the binding.' },
  } as const

  return { service, images, bindingOf, projectOf, autoBind, textbookList, resourceOf, scopeParams, textbookParams }
}

/** The kit a tool factory receives. */
export type ToolKit = ReturnType<typeof createToolKit>
