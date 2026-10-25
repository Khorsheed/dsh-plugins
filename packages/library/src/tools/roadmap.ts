/**
 * The `library_roadmap` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/roadmap
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { formatLocator } from '../types.ts'
import type { LibraryService } from '../service.ts'
import {
  arrival,
  chaptersLocator,
  jsonOutput,
  normalizeCoverArg,
  NODES_SCHEMA,
  payload,
  payloadList,
  pickString,
  unwrap,
  type ToolKit,
} from './kit.ts'

/** Build the `library_roadmap` tool over the shared kit. */
export function libraryRoadmapTool(kit: ToolKit): ToolDefinition {
  const { service, projectOf, autoBind, textbookList } = kit
  return defineTool({
    name: 'library_roadmap',
    description:
      'Write one textbook\'s DRAFT path; it replaces that textbook\'s previous draft. The learner adopts it on the textbook\'s page (采用) — you only write drafts, and never ask before writing one. '
      + 'A station covers the textbook\'s rows (chapters: "3-4"); also adds side references (a link, another entry\'s rows, topic: your own teaching) without moving the path anywhere. '
      + 'One station is one lesson the learner finishes in one sitting: 3–5 knowledge points, ordered simple → hard across the path. A real book\'s long chapter splits into several stations on the same rows; a textbook you authored teaches one chapter per station (its chapters ARE lessons). '
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
  })
}
