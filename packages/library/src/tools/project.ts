/**
 * The `library_project` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/project
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { type LibraryTemplate } from '../types.ts'
import { jsonOutput, pickString, unwrap, type ToolKit } from './kit.ts'

/** Build the `library_project` tool over the shared kit. */
export function libraryProjectTool(kit: ToolKit): ToolDefinition {
  const { service, autoBind } = kit
  return defineTool({
    name: 'library_project',
    description:
      'Create a learning project, or edit one (projectId + the fields to change; goal "" clears). '
      + 'template: "language" (marks are words) | "subject" (marks are concepts) | "custom". '
      + 'Creating binds an unbound session to it. A project is a goal and carries no path: next, shelve its textbooks (library_resource), then draft each one\'s path (library_roadmap).',
    parameters: {
      projectId: { type: 'string', description: 'Edit this existing project (library_read · projects lists the ids). Omit to CREATE — ids are minted (p_…), never chosen by the caller.' },
      name: { type: 'string', description: 'The project\'s name (required when creating).' },
      template: { type: 'string', description: '"language" | "subject" | "custom".' },
      goal: { type: 'string', description: 'The one-line goal ("" clears).' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      // The edit target's id: projectId now, `id` from a model that memorized
      // the old name (read off the typed surface). An id that resolves to
      // nothing plus a name is a CREATE the model dressed up with a slug —
      // create and say so, never fail it.
      const legacyId = (args as Record<string, unknown>).id
      const editId = pickString(args.projectId, legacyId)
      if (editId !== undefined) {
        const patch: Record<string, unknown> = {}
        if (typeof args.name === 'string') patch.name = args.name
        if (typeof args.template === 'string') patch.template = args.template
        if (typeof args.goal === 'string') patch.goal = args.goal
        if (Object.keys(patch).length === 0) throw new Error('editing a project takes projectId plus the fields to change (name? / goal? / template?) — omit projectId to CREATE one (name + template)')
        const edited = await service.updateProject({ id: editId, patch: patch as { name?: string; goal?: string; template?: LibraryTemplate } })
        if (edited.ok) {
          await autoBind(exec, { projectId: edited.project.id })
          return edited as unknown as JsonValue
        }
        if (typeof args.name !== 'string' || args.name.trim() === '') throw new Error(edited.message)
        const created = unwrap(await service.createProject({
          name: args.name,
          ...(typeof args.template === 'string' ? { template: args.template as LibraryTemplate } : {}),
          ...(typeof args.goal === 'string' ? { goal: args.goal } : {}),
        }))
        await autoBind(exec, { projectId: created.project.id })
        return { ...created, note: `no project ${JSON.stringify(editId)} existed — created a new one instead (ids are minted (p_…), never chosen by the caller; omit projectId to create)` } as unknown as JsonValue
      }
      if (typeof args.name !== 'string' || args.name.trim() === '') {
        throw new Error('creating a project takes name (+ template: "language" | "subject" | "custom", goal?) — e.g. { name: "数学", template: "subject" }')
      }
      const created = unwrap(await service.createProject({
        name: args.name,
        ...(typeof args.template === 'string' ? { template: args.template as LibraryTemplate } : {}),
        ...(typeof args.goal === 'string' ? { goal: args.goal } : {}),
      }))
      await autoBind(exec, { projectId: created.project.id })
      return created as unknown as JsonValue
    },
  })
}
