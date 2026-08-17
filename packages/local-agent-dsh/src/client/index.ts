/**
 * Local-agent-dsh records plugin, browser half: the DeepSeek delegation
 * toggle row inside the 本地 Agent settings section. The switch binds the
 * `local-agent-dsh` settings namespace the host controller registered; flipping
 * it persists the value and the host watcher registers or disposes the dsh
 * harness, the dsh-cli provider, and the subagent_dsh tool — so the model
 * never sees the dsh delegation tool unless the user turns it on.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Pulls the family core's `local-agent.settings.row` slot declaration.
import type {} from '@khorsheed/dsh-local-agent/client'
import { DeepSeekSettingsRow, type DeepSeekSettingsInjected } from './DeepSeekSettingsRow.tsx'
import { en, NS, zh, type LocalAgentDshKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The DeepSeek delegation toggle row copy. */
    'local-agent-dsh': LocalAgentDshKey
  }
}

/** Required services: slot registry, the settings scope binder, and locale registry. */
export const inject = ['slots', 'settingsScope', 'locale']

/**
 * Client plugin body: register the dictionaries and the DeepSeek toggle row
 * bound to the local-agent-dsh namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-agent-dsh: dictionaries')
  const scope = ctx.settingsScope.bind<{ enabled: boolean }>({ namespace: 'local-agent-dsh' })
  const injected: DeepSeekSettingsInjected = {
    scope,
    subscribe: listener => scope.subscribe(listener),
  }
  ctx.slots.inject(
    'local-agent.settings.row',
    () => ctx.slots.register({
      name: 'local-agent.settings.row',
      id: 'dsh',
      // Below the harness rows.
      order: 0,
      locale: NS,
      inject: () => injected,
    }, DeepSeekSettingsRow),
  )
}
