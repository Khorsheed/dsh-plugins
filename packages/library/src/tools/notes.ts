/**
 * The `library_notes` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/notes
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { jsonOutput, unwrap, type ToolKit } from './kit.ts'

/** Build the `library_notes` tool over the shared kit. */
export function libraryNotesTool(kit: ToolKit): ToolDefinition {
  const { service, projectOf, resourceOf, textbookParams } = kit
  return defineTool({
    name: 'library_notes',
    description:
      'Write or rewrite a station\'s 讲义 (markdown, math in $…$), for THIS learner — written when the learner starts the station. '
      + 'A textbook you authored: the 讲义 are the lesson — one line on what it teaches, then one ## section per knowledge point headed by its title (what it is → why it matters → an example or the steps → a common mistake → a self-check question), then a recap. '
      + 'A real book: a reading guide and marginalia (which pages, what to watch for, where this learner got stuck). No change logs or internal words.',
    parameters: {
      ...textbookParams,
      node: { type: 'string', required: true, description: 'The station id.' },
      text: { type: 'string', required: true, description: 'The 讲义, markdown.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const resourceId = resourceOf(args, exec)
      const written = unwrap(await service.putNotes({
        projectId: projectOf(args.project, exec, resourceId),
        resourceId,
        nodeId: String(args.node),
        text: String(args.text),
      }))
      return {
        ...written,
        next: written.notes.revisions === 1
          ? 'Tell the learner in one line that the 讲义 are ready in the sidebar, then wait — they read first and ask.'
          : 'Tell the learner in one line what changed in the 讲义.',
      } as unknown as JsonValue
    },
  })
}
