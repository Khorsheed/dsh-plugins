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
      'Write or rewrite a station\'s 讲义 (markdown; math in $…$ / $$…$$) — written FOR the learner, never a glossary or your own notes. '
      + 'On a textbook you authored the 讲义 ARE the lesson, written when the station opens: one line on what this lesson teaches; then one ## section per knowledge point, headed by its title, simple → hard — what it is → why it matters → an example or the steps → a common mistake → one self-check question; end with a recap and 「觉得掌握了 → 去章节考」. '
      + 'On a real book they are a reading guide and marginalia (which pages, what to watch for, where THIS learner got stuck), never a substitute. Rewrite whenever the learner asks to 补讲 / 沉淀讲义. '
      + 'No change logs or internal words (第 N 次更新, 修正说明, acceptance) — the sidebar counts revisions itself.',
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
