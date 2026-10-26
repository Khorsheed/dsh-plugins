/**
 * The `library_read` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/read
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { type LibraryCardKind, type LibraryCardSourceType, type LibraryRoadmap } from '../types.ts'
import {
  jsonOutput,
  pickString,
  READ_WHATS,
  unwrap,
  type ToolKit,
} from './kit.ts'

/**
 * A path as the coach needs it: each station's id, title, state, rows and
 * points, and whether its 讲义 exist — never the 讲义 text itself (a read of
 * an 11-station path once returned 7,300 characters).
 */
function compactRoadmap(read: { roadmap?: LibraryRoadmap; draft?: LibraryRoadmap }): Record<string, unknown> {
  const stations = (roadmap: LibraryRoadmap) => roadmap.nodes.map(node => ({
    id: node.id,
    title: node.title,
    state: node.state,
    ...(node.gate === 'quiz' ? {} : { gate: node.gate }),
    rows: node.covers.flatMap(cover => cover.locator === undefined ? [] : [cover.locator]).join(',') || undefined,
    points: (node.points ?? []).map(point => `${point.id}: ${point.title}`),
    ...(node.goals.length === 0 ? {} : { goals: node.goals }),
    ...(node.acceptance === undefined || node.acceptance.length === 0 ? {} : { acceptance: node.acceptance }),
    ...(node.notes === undefined ? {} : { notes: `${node.notes.text.length} chars, revision ${node.notes.revisions}` }),
    ...(node.quizStats === undefined ? {} : { best: node.quizStats.bestRatio }),
  }))
  return {
    ...(read.roadmap === undefined ? { adopted: null } : { adopted: { stations: stations(read.roadmap) } }),
    ...(read.draft === undefined ? {} : { draft: { stations: stations(read.draft), note: read.draft.note } }),
  }
}

/** Build the `library_read` tool over the shared kit. */
export function libraryReadTool(kit: ToolKit): ToolDefinition {
  const { service, bindingOf, projectOf, resourceOf } = kit
  return defineTool({
    name: 'library_read',
    description:
      'Read the library: projects (all, with this session\'s binding) | resources (one project\'s textbooks in study order) | toc (a textbook\'s contents rows) | roadmap (a textbook\'s path and pending draft) | pages (photographed pages) | cards (the learner\'s cards, weakest first) | quiz (one quiz, or the list). project and resource default to the binding.',
    parameters: {
      what: { type: 'string', description: 'One of the reads above.' },
      project: { type: 'string' },
      resource: { type: 'string' },
      node: { type: 'string', description: 'A station (pages / cards).' },
      quiz: { type: 'string', description: 'A quiz id.' },
      query: { type: 'string', description: 'cards: search term, gloss, sentences.' },
      due: { type: 'boolean', description: 'cards: only those due for review.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const argsAny = args as Record<string, unknown>
      // A read that forgot what: the arguments it did pass say which one it meant.
      const what = typeof args.what === 'string' && args.what !== '' ? args.what
        : args.quiz !== undefined ? 'quiz' : args.resource !== undefined || args.node !== undefined ? 'roadmap' : 'projects'
      switch (what) {
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
          return compactRoadmap(await service.getRoadmap({ projectId: projectOf(args.project, exec, resource), resourceId: resource })) as unknown as JsonValue
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
            ...(argsAny.kind === 'word' || argsAny.kind === 'concept' ? { kind: argsAny.kind as LibraryCardKind } : {}),
            ...(['photo', 'chat', 'quiz', 'manual'].includes(String(argsAny.source ?? '')) ? { source: argsAny.source as LibraryCardSourceType } : {}),
            ...(typeof argsAny.weakMin === 'number' ? { weakMin: argsAny.weakMin } : {}),
            ...(args.due === true ? { due: true } : {}),
            limit: typeof argsAny.limit === 'number' ? argsAny.limit : 30,
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
          throw new Error(`what is one of ${READ_WHATS.join(' | ')} — got ${JSON.stringify(args.what)}`)
      }
    },
  })
}
