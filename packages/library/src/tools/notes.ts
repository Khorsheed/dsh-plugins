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
  })
}
