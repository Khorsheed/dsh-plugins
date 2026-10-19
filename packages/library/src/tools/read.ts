/**
 * The `library_read` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/read
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { type LibraryCardKind, type LibraryCardSourceType } from '../types.ts'
import {
  jsonOutput,
  pickString,
  READ_WHATS,
  unwrap,
  type ToolKit,
} from './kit.ts'

/** Build the `library_read` tool over the shared kit. */
export function libraryReadTool(kit: ToolKit): ToolDefinition {
  const { service, bindingOf, projectOf, resourceOf } = kit
  return defineTool({
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
  })
}
