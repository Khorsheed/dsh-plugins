/**
 * The `library_binding` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/binding
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  jsonOutput,
  payload,
  pickString,
  sessionIdOf,
  unwrap,
  type ToolKit,
} from './kit.ts'

/** Build the `library_binding` tool over the shared kit. */
export function libraryBindingTool(kit: ToolKit): ToolDefinition {
  const { service, textbookList } = kit
  return defineTool({
    name: 'library_binding',
    description:
      'Bind this session to a project (and optionally a textbook) — every tool\'s default. Writes bind an unbound session by themselves; use this to switch, or unbind: true.',
    parameters: {
      project: { type: 'string' },
      resource: { type: 'string', description: 'A textbook in it.' },
      unbind: { type: 'boolean' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec)
      if (sessionId === undefined) throw new Error('binding needs a session — this call came from none')
      // unbind: true (or the older binding: null) unbinds; the older nested
      // binding { project, resource } still parses.
      const argsAny = args as Record<string, unknown>
      if (args.unbind === true || argsAny.binding === null) return unwrap(await service.setBinding(sessionId, null)) as unknown as JsonValue
      const body = payload(argsAny.binding) ?? {}
      const projectId = pickString(body.project, body.projectId, args.project)
      const resourceId = pickString(body.resource, body.resourceId, body.book, body.bookId, args.resource, (args as Record<string, unknown>).book)
      if (projectId === undefined) {
        throw new Error('binding needs the project: { project, resource? } (library_read · projects lists them); unbind: true to unbind')
      }
      // An id the shelf does not hold (a guessed slug before the textbook is
      // registered) binds the project and says so — not a failed call.
      if (resourceId !== undefined && !(await service.getResource({ projectId, resourceId })).ok) {
        const bound = unwrap(await service.setBinding(sessionId, { projectId }))
        return { ...bound, note: `no resource ${JSON.stringify(resourceId)} in this project — bound the project only. Resource ids are minted (r_…); registering the textbook (library_textbook) binds this session to it by itself${textbookList(exec)}` } as unknown as JsonValue
      }
      return unwrap(await service.setBinding(sessionId, { projectId, ...(resourceId === undefined ? {} : { resourceId }) })) as unknown as JsonValue
    },
  })
}
