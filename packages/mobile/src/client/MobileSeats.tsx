import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MobileIcon } from './MobileIcon.tsx'

/** Brand-seat replacement only. The official hero picker and editor retain ownership. */
export function MobileWelcome({ t }: PropsLocale<'mobile'>) {
  return <div data-mobile-welcome><small>DSH</small><h2>{t('welcome')}</h2><p>{t('welcomeHint')}</p></div>
}

/** Read-only context for an existing session. Choosing a different workspace
 * or preset belongs to the official new-session flow, not to this label. */
export function MobileWorkspaceContext({ sessionId, useSessions, useSession }: PropsRuntime<'conversation.input.dock'>) {
  const blank = useSession(s => s.blank)
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  if (blank || !cwd) return null
  return <div data-mobile-context-seat><span title={cwd} data-mobile-workspace-label><MobileIcon name="folder" size={16}/><span>{cwd.split(/[\\/]/).filter(Boolean).at(-1)}</span></span></div>
}
