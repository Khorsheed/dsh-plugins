/**
 * The `library_textbook` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/resource
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { isThickResource, LIBRARY_RESOURCE_KINDS, type LibraryResourceKind } from '../types.ts'
import {
  arrival,
  jsonOutput,
  payload,
  payloadList,
  pickString,
  splitTocText,
  unwrap,
  type ToolKit,
} from './kit.ts'

/** Build the `library_textbook` tool over the shared kit (the file keeps its v5 name). */
export function libraryResourceTool(kit: ToolKit): ToolDefinition {
  const { service, projectOf, autoBind, scopeParams } = kit
  return defineTool({
    name: 'library_textbook',
    description:
      'Shelve, correct, reorder or remove a textbook (anything with a contents) — in study order. origin: learner (their own) | picked (a book or course you chose; its path takes only the chapters the goal needs) | authored (you write it: one chapter per lesson, your 讲义 are its text). '
      + 'A real book: verify the edition and contents online and cite the page (tocSource { by: "web", url }); never ask for an upload. A correction (resourceId) sends only what changes. A web page a station cites is no textbook — the path names its url.',
    parameters: {
      ...scopeParams,
      op: { type: 'string', required: true, description: 'add | update | move | remove.' },
      resourceId: { type: 'string', description: 'The textbook to update / move / remove.' },
      title: { type: 'string', description: 'The exact edition\'s title.' },
      origin: { type: 'string', enum: ['learner', 'picked', 'authored'] },
      toc: { type: 'json', description: 'The contents: one chapter per line in one string, or ["…", "…"].' },
      tocSource: { type: 'json', description: '{ by: "web" | "model" | "photo", url? } — web needs the url.' },
      seq: { type: 'integer', description: 'Its place in the study order, from 1.' },
      bookKind: { type: 'string', enum: ['knowledge', 'material'], description: 'material only when the exact text is what is tested (exam papers, literature).' },
      edition: { type: 'string' },
      author: { type: 'string' },
      url: { type: 'string', description: 'A digital textbook\'s home page.' },
      note: { type: 'string', description: 'One line on why it is here.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      // The v4 spellings ride along off the untyped surface (bookId → resourceId).
      const argsAny = args as Record<string, unknown>
      const namedId = pickString(args.resourceId, argsAny.bookId)
      // add / update are the advertised spellings; create (either one) still parses.
      const op = args.op === 'add' || args.op === 'update' ? 'create' : args.op as string
      if (op === 'remove') {
        if (namedId === undefined) throw new Error('library_textbook · op=remove takes the resourceId field — library_read · resources lists the ids')
        return unwrap(await service.removeResource({ projectId: projectOf(args.project, exec, namedId), resourceId: namedId })) as unknown as JsonValue
      }
      if (op === 'move') {
        if (namedId === undefined || typeof args.seq !== 'number') throw new Error('library_textbook · op=move takes resourceId and seq (the textbook\'s new place, from 1)')
        const moved = unwrap(await service.moveResource({ projectId: projectOf(args.project, exec, namedId), resourceId: namedId, seq: args.seq }))
        return { order: moved.resources.filter(resource => resource.seq !== undefined).map(resource => `${resource.seq}. ${resource.id} 《${resource.title}》`) } as unknown as JsonValue
      }
      if (op !== 'create') {
        throw new Error(`library_textbook needs op: add | update | move | remove — got ${JSON.stringify(args.op)}`)
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
      const sentRows = typeof args.toc === 'string' && tocList === undefined
        ? splitTocText(args.toc)
        : (tocList ?? [])
      // Correcting a shelved textbook (its note, kind, edition…) sends only
      // what changes: the title and the contents come from the shelf.
      const shelved = namedId !== undefined && sentRows.length === 0 && pickString(args.url) === undefined
        ? await service.getResource({ projectId, resourceId: namedId })
        : undefined
      const kept = shelved?.ok === true && isThickResource(shelved.resource) ? shelved.resource : undefined
      const tocRows = sentRows.length > 0 ? sentRows : (kept?.toc ?? []).map(entry => ({ ...entry }))
      if (kept !== undefined) {
        if (typeof args.title !== 'string' || args.title.trim() === '') argsAny.title = kept.title
        if (argsAny.kind === undefined) argsAny.kind = kept.kind
      }
      // A thin link is the hidden v5 case: only an explicit link kind (article, video…) takes that branch.
      const linkKind = typeof argsAny.kind === 'string' && argsAny.kind !== 'book' && argsAny.kind !== 'course' && (LIBRARY_RESOURCE_KINDS as readonly string[]).includes(argsAny.kind)
      const thick = tocRows.length > 0 || !linkKind
      if (thick) {
        if (typeof args.title !== 'string' || args.title.trim() === '' || tocRows.length === 0) {
          throw new Error(`a textbook takes: title, toc (one chapter per line), tocSource { by, url? }, origin (+ seq?, bookKind?, edition?, author?; resourceId to update one) — ${arrival('toc', args.toc)}`)
        }
        const toc = tocRows.map(row => typeof row === 'string' ? { title: row } : row as { title: string; part?: string })
        const written = unwrap(await service.putResource({
          projectId,
          ...(namedId === undefined ? {} : { resourceId: namedId }),
          title: args.title,
          kind: argsAny.kind === 'course' ? 'course' : 'book',
          ...(typeof args.url === 'string' ? { url: args.url } : {}),
          ...(typeof args.note === 'string' ? { note: args.note } : {}),
          ...origin,
          ...(typeof args.seq === 'number' ? { seq: args.seq } : {}),
          toc,
          tocSource: (payload(args.tocSource) ?? kept?.tocSource ?? { by: 'model' }) as { by: 'web' | 'model' | 'photo'; url?: string },
          ...(args.bookKind === 'knowledge' || args.bookKind === 'material' ? { bookKind: args.bookKind } : {}),
          ...(typeof argsAny.short === 'string' ? { short: argsAny.short } : {}),
          ...(typeof args.author === 'string' ? { author: args.author } : {}),
          ...(typeof args.edition === 'string' ? { edition: args.edition } : {}),
          ...(typeof argsAny.isbn === 'string' ? { isbn: argsAny.isbn } : {}),
          ...(Array.isArray(payloadList(argsAny.extras)) ? { extras: payloadList(argsAny.extras) as { title: string; note?: string; where?: string; when?: 'before' | 'reference' }[] } : {}),
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
        kind: linkKind ? argsAny.kind as LibraryResourceKind : 'article',
        url,
        ...(typeof args.note === 'string' ? { note: args.note } : {}),
        ...origin,
      }))
      await autoBind(exec, { projectId })
      return added as unknown as JsonValue
    },
  })
}
