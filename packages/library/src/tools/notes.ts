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
      'Write or rewrite a station\'s 讲义 (markdown, math in $…$), for THIS learner, when they start the station. The 讲义 are the lesson itself — the learner learns from them without leaving the page, whatever the textbook: '
      + 'open with the core question and 「你将学到」 (the points, numbered) and one or two warm-up questions; then one ## section per knowledge point, headed by its title — explain it plainly, give a concrete example or the steps to try, a common mistake, and a 思考题; '
      + 'then 小结. Outside material (a manual page, a video, the learner\'s book pages) goes only in a final ## 参考 section, never as the lesson. No change logs or internal words.',
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
