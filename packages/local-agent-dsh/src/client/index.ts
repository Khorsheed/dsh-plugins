/**
 * Local-agent-dsh records plugin, browser half: the DeepSeek delegation
 * toggle section. The switch binds the `local-agent-dsh` settings namespace
 * the host controller registered; flipping it persists the value and the host
 * watcher registers or disposes the dsh harness, the dsh-cli provider, and
 * the subagent_dsh tool — so the model never sees both the dsh delegation
 * tool and the official in-process subagent tool at once.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { DeepSeekSettingsSection, type DeepSeekSettingsInjected } from './DeepSeekSettingsSection.tsx'
import { en, NS, zh, type LocalAgentDshKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The DeepSeek delegation toggle section copy. */
    'local-agent-dsh': LocalAgentDshKey
  }
}

/** Required services: slot registry, the settings scope binder, and locale registry. */
export const inject = ['slots', 'settingsScope', 'locale']

/**
 * Client plugin body: register the dictionaries and the DeepSeek toggle
 * section bound to the local-agent-dsh namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-agent-dsh: dictionaries')
  const t = ctx.locale.bind(NS)
  const scope = ctx.settingsScope.bind<{ enabled: boolean }>({ namespace: 'local-agent-dsh' })
  const injected: DeepSeekSettingsInjected = {
    scope,
    subscribe: listener => scope.subscribe(listener),
  }
  ctx.slots.inject(
    'settings.section',
    () => ctx.slots.register({
      name: 'settings.section',
      id: 'local-agent-dsh',
      // After the family's 本地 Agent section (order 20).
      order: 21,
      label: () => t('settings.nav'),
      locale: NS,
      inject: () => injected,
    }, DeepSeekSettingsSection),
  )
}
