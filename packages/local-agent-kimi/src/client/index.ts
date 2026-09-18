/**
 * Local-agent-kimi plugin, browser half: the kimi settings surface, one face
 * per host line — on alpha.2 the bundle's own configuration on its
 * Plugins-page detail view (`plugins.bundle.config`, keyed by package name),
 * on 0.1.5 the `settings.plugin.item` card (keyed to the `local-agent-kimi`
 * settings namespace the host half registers) in the official
 * Plugins → 可配置插件 tab. The card carries the family core's shared
 * ProviderAuthBlock (login/logout/device-code, backed by the core's
 * localAgentGateway Remote and the commands channel), the default-model block
 * (free-text field, the broker-fed effective-model line and choices), and the
 * resident-mode switch, whose writes ride the bound settingsScope — the host
 * watcher hot-applies them, no reload. Every read degrades: an absent gateway
 * renders the auth block's 'unavailable' state and drops the effective-model
 * line, an unregistered namespace disables the live controls.
 * @module @khorsheed/dsh-local-agent-kimi/client
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
// Type-only: the 'plugins.bundle.config' keyed-slot SlotMap merge (alpha.2).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: the family core's LocaleNamespaceMap merge ('local-agent', the
// auth block's copy) and the gateway Remote type.
import type {} from '@khorsheed/dsh-local-agent/client'
// Type-only: the localAgentGateway merge into TypertRemoteNamespaceMap — the
// core's emitted client d.ts elides its own empty `import type {}`, so a
// downstream consumer must pull the generated merge itself or the gateway
// type degrades to any under skipLibCheck.
import type {} from '@khorsheed/dsh-local-agent/remote'
import type { LocalAgentGatewayRemote } from '@khorsheed/dsh-local-agent/client'
import { en, NS, zh, type LocalAgentKimiKey } from './locales.ts'
import {
  KimiBundleConfig, KimiSettingsCard, type KimiLiveSettings, type KimiSettingsCardInjected,
} from './SettingsCard.tsx'

export { KimiBundleConfig, KimiSettingsCard } from './SettingsCard.tsx'
export type {
  KimiLiveSettings, KimiBundleConfigProps, KimiSettingsCardInjected, KimiSettingsCardProps,
} from './SettingsCard.tsx'
export { en, NS, zh }
export type { LocalAgentKimiKey }

/**
 * This bundle's package name — the key the Plugins page dispatches
 * `plugins.bundle.config` entries on (identity triangle: cordis.patch.yml,
 * tsdown.config.ts, invariant.ts).
 */
const PACKAGE_NAME = '@khorsheed/dsh-local-agent-kimi'

/** Required services: slot registry, settings scope, command Remote, and locale registry. */
export const inject = ['slots', 'settingsScope', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the dictionaries and the kimi settings
 * surfaces bound to the local-agent-kimi namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-agent-kimi: dictionaries')
  const scope = ctx.settingsScope.bind<KimiLiveSettings>({ namespace: 'local-agent-kimi' })
  // The auth block's copy lives in the family core's dictionary; binding is
  // stable per namespace and late dictionary registration still resolves.
  const authT = ctx.locale.bind('local-agent')
  // The gateway namespace is mounted by the family core's client half; read it
  // lazily from the global store so boot order between the two client plugins
  // never matters, and degrade to the auth block's 'unavailable' state when
  // the core client is absent.
  const gateway = (): LocalAgentGatewayRemote | undefined =>
    ctx.get('remote.localAgentGateway') as LocalAgentGatewayRemote | undefined
  // Both settings surfaces inject the same face.
  const cardInject = (): KimiSettingsCardInjected => ({
    scope,
    hooks: { settings: scope },
    authT,
    // The broker's memberless surface (effective model + pickable
    // vocabulary). Null — a core without a model broker — degrades to the
    // pre-broker card: the free-text field alone, no effective-model line.
    harnessModel: () =>
      gateway()?.harnessModel('kimi').then(result => (result.ok ? result.value ?? undefined : undefined))
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
  })
  // The settings surface follows the host line. alpha.2 renders a bundle's own
  // configuration on its Plugins-page detail view (`plugins.bundle.config`,
  // keyed by package name); 0.1.5 renders the configurable-plugins tab card
  // (`settings.plugin.item`, keyed by the settings namespace). Each name is
  // absent from the other line's registry, so both registrations ride
  // slots.inject — each wait fires only where the declaration exists — and the
  // legacy calls go through a string-keyed duck narrow of the same service
  // (the slot name is gone from the alpha.2 SlotMap).
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: PACKAGE_NAME,
    locale: NS,
    inject: cardInject,
  }, KimiBundleConfig))
  const legacy = ctx.slots as unknown as {
    inject(key: string, callback: () => unknown): unknown
    register(entry: {
      name: string
      key: string
      locale: string
      inject: () => KimiSettingsCardInjected
    }, component: typeof KimiSettingsCard): unknown
  }
  legacy.inject('settings.plugin.item', () => legacy.register({
    name: 'settings.plugin.item',
    key: 'local-agent-kimi',
    locale: NS,
    inject: cardInject,
  }, KimiSettingsCard))
}
