/**
 * Local-agent-codex plugin, browser half: one `settings.plugin.item` card
 * (keyed to the `local-agent-codex` settings namespace the host half
 * registers) in the official Plugins → 可配置插件 tab. The card carries the
 * family core's shared ProviderAuthBlock (login/logout/device-code, backed by
 * the core's localAgentGateway Remote and the commands channel) plus the
 * resident-mode block (live switch) and the default-model block (free-text
 * input, the broker's effective-model line and suggestion vocabulary), whose
 * writes ride the bound settingsScope — the host watcher hot-applies them, no
 * reload. Every read degrades: an absent gateway renders the auth block's
 * 'unavailable' state and drops the model surface to the bare input, an
 * unregistered namespace disables the live controls.
 * @module @khorsheed/dsh-local-agent-codex/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the typed `ctx.remote` (commands namespace) merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.settingsScope service merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the ctx.slots service merge (renderer-owned slot registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the 'settings.plugin.item' keyed-slot SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: the family core's LocaleNamespaceMap merge ('local-agent', the
// auth block's copy) and the gateway Remote type.
import type {} from '@khorsheed/dsh-local-agent/client'
// Type-only: the localAgentGateway merge into TypertRemoteNamespaceMap — the
// core's emitted client d.ts elides its own empty `import type {}`, so a
// downstream consumer must pull the generated merge itself or the gateway
// type degrades to any under skipLibCheck.
import type {} from '@khorsheed/dsh-local-agent/remote'
import type { LocalAgentGatewayRemote } from '@khorsheed/dsh-local-agent/client'
import { en, NS, zh, type LocalAgentCodexKey } from './locales.ts'
import {
  CodexSettingsCard, type CodexLiveSettings, type CodexSettingsCardInjected,
} from './SettingsCard.tsx'

export { CodexSettingsCard } from './SettingsCard.tsx'
export type {
  CodexLiveSettings, CodexSettingsCardInjected, CodexSettingsCardProps,
} from './SettingsCard.tsx'
export { en, NS, zh }
export type { LocalAgentCodexKey }

/** Required services: slot registry, settings scope, command Remote, and locale registry. */
export const inject = ['slots', 'settingsScope', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the dictionaries and the codex settings card
 * bound to the local-agent-codex namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-agent-codex: dictionaries')
  const scope = ctx.settingsScope.bind<CodexLiveSettings>({ namespace: 'local-agent-codex' })
  // The auth block's copy lives in the family core's dictionary; binding is
  // stable per namespace and late dictionary registration still resolves.
  const authT = ctx.locale.bind('local-agent')
  // The gateway namespace is mounted by the family core's client half; read it
  // lazily from the global store so boot order between the two client plugins
  // never matters, and degrade to the auth block's 'unavailable' state when
  // the core client is absent.
  const gateway = (): LocalAgentGatewayRemote | undefined =>
    ctx.get('remote.localAgentGateway') as LocalAgentGatewayRemote | undefined
  ctx.slots.inject(
    'settings.plugin.item',
    () => ctx.slots.register({
      name: 'settings.plugin.item',
      key: 'local-agent-codex',
      locale: NS,
      inject: (): CodexSettingsCardInjected => ({
        scope,
        hooks: { settings: scope },
        authT,
        // The harness's memberless model surface; absent gateway/broker
        // degrades to the bare input with its recent-models suggestions.
        harnessModel: () =>
          gateway()?.harnessModel('codex').then(result => (result.ok ? result.value : undefined))
            ?? Promise.resolve(undefined),
        auth: {
          status: name =>
            // The Remote declares (name, scope?) and the client enforces exact arity:
            // pass the default scope explicitly (undefined reads as omitted host-side).
            gateway()?.status(name, undefined).then(result => (result.ok ? result.value : undefined))
              ?? Promise.resolve(undefined),
          runCommand: (sessionId: SessionId, line: string) =>
            ctx.remote.commands.execute(sessionId, line, [])
              .then(result => (result.ok ? result.value?.result.text : undefined)),
        },
      }),
    }, CodexSettingsCard),
  )
}
