/**
 * The `library_resource` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/resource
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { LIBRARY_RESOURCE_KINDS, type LibraryResourceKind } from '../types.ts'
import {
  arrival,
  jsonOutput,
  payload,
  payloadList,
  pickString,
  splitTocText,
  unwrap,
  LIST_WRAPPER_SCHEMA,
  type ToolKit,
} from './kit.ts'

/** Build the `library_resource` tool over the shared kit. */
export function libraryResourceTool(kit: ToolKit): ToolDefinition {
  const { service, projectOf, autoBind, scopeParams } = kit
  return defineTool({
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
  })
}
