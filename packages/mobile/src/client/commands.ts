import type { Context } from '@deepseek-ai/cordis'
import type { TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
/** Narrow structural face of the host's public inputTriggers.sessionOf API.
 * Candidate discovery, filtering and picks remain owned by the host. */
export interface MobileCommandController {
  toggleSource(source: string, hit: { trigger: '/'; query: string; quoted: boolean; position: 'leading' | 'inline'; span: TokenSpan }): void
}
export interface MobileCommandService { sessionOf(ctx: Context): MobileCommandController }
export function openMobileCommands(controller: MobileCommandController | undefined, draft: string, span: TokenSpan): boolean {
  if (!controller || typeof controller.toggleSource !== 'function') return false
  controller.toggleSource('command', { trigger: '/', query: '', quoted: false, position: draft.slice(0, span.start).trim() === '' ? 'leading' : 'inline', span })
  return true
}
