/**
 * message-tools node half: provides the durable edit/withdraw service
 * (`ctx.messageTools`). The browser half shadows the user-message renderer.
 * @module @khorsheed/dsh-client-message-tools
 */
import { apply, name } from './host.ts'

export { apply, name }
export type { MessageToolsHost } from './host.ts'
export { editEvent, withdrawEvent } from './events.ts'
export { foldEffectiveMessages, joinText } from './projection.ts'
export { foldTurnFiles, summarizeFiles } from './files.ts'
