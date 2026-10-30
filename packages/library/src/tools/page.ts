/**
 * The `library_page` tool (moved verbatim from tool-definition.ts; the shared
 * helpers and schemas are in `tools/kit.ts`).
 *
 * @module @khorsheed/dsh-library/tools/page
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { type LibraryMark } from '../types.ts'
import {
  arrival,
  jsonOutput,
  payloadList,
  roomSessionIdOf,
  landed,
  sessionIdOf,
  unwrap,
  type ToolKit,
} from './kit.ts'

/** Build the `library_page` tool over the shared kit. */
export function libraryPageTool(kit: ToolKit): ToolDefinition {
  const { service, images, projectOf, resourceOf, textbookParams } = kit
  return defineTool({
    name: 'library_page',
    description:
      'Record a photographed page in one call: its printed text and every mark the learner made (each certain mark becomes a card). Omit attachment for the latest photo. If you cannot see images, say so instead.',
    parameters: {
      ...textbookParams,
      text: { type: 'string', required: true, description: 'The printed text.' },
      marks: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
            text: { type: 'string', description: 'As printed.' },
            sentence: { type: 'string' },
            handNote: { type: 'string', description: 'The learner\'s handwriting beside it.' },
            gloss: { type: 'string', description: 'In-context meaning.' },
            uncertain: { type: 'boolean', description: 'You could not tell (kept, not carded).' },
          } } },
          { type: 'string', description: 'The same list as JSON text.' },
        ],
        required: true,
        description: 'Every mark on the page.',
      },
      attachment: { type: 'string', description: 'The image id (omit for the latest photo in this conversation).' },
      label: { type: 'string', description: 'What the learner calls the page (「p.16」).' },
      node: { type: 'string', description: 'The station id, when the page belongs to one.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const marks = payloadList(args.marks)
      if (marks === undefined) {
        throw new Error(`library_page takes: text (the page's printed text), marks: [{ text, sentence?, handNote?, gloss?, uncertain? }] (+ attachment?, label?, node?) — ${arrival('marks', args.marks)}`)
      }
      // A photo belongs to the session it was sent in: the member's own first,
      // then — in a room — the room's, where the user's input box sends it.
      const written = typeof args.attachment === 'string' ? args.attachment : undefined
      const room = roomSessionIdOf(exec)
      const attachment = images.resolve(sessionIdOf(exec), written)
        ?? (room === undefined ? undefined : images.resolve(room, written))
      if (attachment === undefined) {
        throw new Error('no photo to record: this conversation has no image the library saw arrive (or the id names none) — ask the learner to send the page photo here, then record it')
      }
      const pageResource = resourceOf(args, exec)
      const pageProject = projectOf(args.project, exec, pageResource)
      const nodeId = typeof args.node === 'string' && args.node !== '' ? args.node : undefined
      const recorded = unwrap(await service.recordPage({
        projectId: pageProject,
        resourceId: pageResource,
        ...(nodeId === undefined ? {} : { nodeId }),
        ...(typeof args.label === 'string' ? { label: args.label } : {}),
        attachment,
        text: args.text,
        marks: marks as LibraryMark[],
      }))
      // The page lands on its station's 页 tab, or its book without one.
      const label = typeof args.label === 'string' && args.label !== '' ? `拍下的页 ${args.label}` : '拍下的页'
      return landed(exec, recorded, nodeId === undefined
        ? { view: 'book', projectId: pageProject, resourceId: pageResource }
        : { view: 'station', projectId: pageProject, resourceId: pageResource, nodeId, tab: 'pages' }, label) as unknown as JsonValue
    },
  })
}
