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
      'Draft one textbook\'s path (replaces its previous draft); the learner adopts it in the sidebar. '
      + 'One station = one lesson: 3–5 knowledge points, simple → hard. A real book\'s long chapter splits into several stations; a textbook you authored teaches one chapter per station.',
    parameters: {
      resource: { type: 'string', required: true, description: 'The textbook.' },
      nodes: { ...NODES_SCHEMA, required: true, description: 'The stations, in study order.' },
      note: { type: 'string', description: 'One line of pacing for the draft card.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const list = payloadList(args.nodes)
      if (list === undefined) {
        throw new Error(`library_roadmap takes resource and nodes: [{ id, title, chapters: "3-4", points: [{ id, title }] (3–5), goals?, acceptance? }] — ${arrival('nodes', args.nodes)}`)
      }
      const argsAny = args as Record<string, unknown>
      const resourceId = pickString(args.resource, argsAny.book)
      if (resourceId === undefined) throw new Error(`a path belongs to one textbook — pass resource${textbookList(exec) || ' (shelve the textbook first with library_textbook)'}`)
      const adjusted: string[] = []
      const missingPoints: string[] = []
      const nodes = (list as Record<string, unknown>[]).map(node => {
        const { chapters, also, chapterRanges, covers, kind, gate, points, ...rest } = node
        // gate is the v5 spelling; the old kind still parses (practice → acceptance).
        // Unsaid, every station is a quiz one: its check is the chapter quiz, never a
        // rubric the learner cannot tell how to meet (10-26) — stray acceptance
        // lines become goals.
        const gateValue = typeof gate === 'string' ? gate : kind === 'practice' ? 'acceptance' : typeof kind === 'string' ? kind : 'quiz'
        if (gateValue === 'quiz' && Array.isArray(rest.acceptance) && rest.acceptance.length > 0) {
          const lines = (rest.acceptance as unknown[]).flatMap(line => typeof line === 'string' ? [line] : typeof payload(line)?.line === 'string' ? [String(payload(line)!.line)] : [])
          const goals = Array.isArray(rest.goals) ? rest.goals as unknown[] : typeof rest.goals === 'string' ? [rest.goals] : []
          rest.goals = [...goals, ...lines]
          delete rest.acceptance
        }
        if (gateValue === 'quiz' && (!Array.isArray(points) || points.length === 0)) {
          missingPoints.push(String(rest.id ?? rest.title ?? '?'))
        }
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
      // Every station is checked by its chapter quiz, and the quiz asks its points.
      if (missingPoints.length > 0) {
        throw new Error(`every station needs its 3–5 knowledge points (points: [{ id, title }]) — the chapter quiz asks them: ${missingPoints.join(', ')}`)
      }
      const projectId = projectOf(argsAny.project, exec, resourceId)
      const before = unwrap(await service.getProject({ id: projectId }))
      const replaced = before.project.resources.find(row => row.id === resourceId)?.hasDraft === true
      const drafted = unwrap(await service.draftRoadmap({
        projectId,
        resourceId,
        nodes: nodes as unknown as Parameters<LibraryService['draftRoadmap']>[0]['nodes'],
        ...(typeof argsAny.passRatio === 'number' ? { passRatio: argsAny.passRatio } : {}),
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
        next: 'Describe the path to the learner in two lines and ask them to review and adopt it in the sidebar (采用). Then stop: before they adopt it, write no 讲义, teach nothing, set no quiz.',
      } as unknown as JsonValue
    },
  })
}
