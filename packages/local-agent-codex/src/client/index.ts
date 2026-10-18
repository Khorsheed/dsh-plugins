import type { LocalAgentUi } from '@khorsheed/dsh-local-agent/client'
import { bindSettingsScope } from '@khorsheed/dsh-local-agent/src/client/settings-scope.ts'
/**
 * Local-agent-codex plugin, browser half: the codex settings card on the
 * Plugins page — one `plugins.item` entry gated by `configForms.whileServed`
 * on the `local-agent-codex` namespace (the official companion convention).
 * Every install shape serves the row's volatile Config under the row id —
 * standalone install, family bundle, or mode pack — so the card follows the
 * served namespace rather than any carrier bundle, and a composition without
 * the row shows no trace of it. The card carries the family core's shared
 * ProviderAuthBlock (login/logout/device-code, backed by the core's
 * localAgentGateway Remote and the commands channel) plus the resident-mode
 * block (live switch) and the default-model block (free-text input, the
 * broker's effective-model line and suggestion vocabulary), whose writes ride
 * the bound settingsScope — the host watcher hot-applies them, no reload.
 * Every read degrades: an absent gateway renders the auth block's
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
// Type-only: the ctx.configForms service merge (the scope probe and the
// whileServed gate both ride it).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the ctx.slots service merge (renderer-owned slot registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the 'plugins.item' list-slot SlotMap merge.
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
import { en, NS, zh, type LocalAgentCodexKey } from './locales.ts'
import {
  CodexBundleConfig, type CodexLiveSettings, type CodexSettingsCardInjected,
} from './SettingsCard.tsx'

export { CodexBundleConfig, CodexSettingsCard } from './SettingsCard.tsx'
export type {
  CodexLiveSettings, CodexBundleConfigProps, CodexSettingsCardInjected, CodexSettingsCardProps,
} from './SettingsCard.tsx'
export { en, NS, zh }
export type { LocalAgentCodexKey }

/**
 * Required services: slot registry, command Remote, and locale registry. The
 * settings scope is NOT a static inject — its service name differs per host
 * line (`settingsScope` on 0.1.5, `configForms` on rc.1), so a static entry
 * would pend the whole client plugin on the other line; bindSettingsScope
 * probes the serving one instead (the settings client package is a declared
 * client inject, so one of them is always already up). The card track probes
 * `configForms` through the same kind of deferred inject (see apply).
 */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the dictionaries and the codex settings card
 * bound to the local-agent-codex namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-agent-codex: dictionaries')
  const t = ctx.locale.bind(NS)
  const scope = bindSettingsScope<CodexLiveSettings>(ctx, 'local-agent-codex')
  // The auth block's copy lives in the family core's dictionary; binding is
  // stable per namespace and late dictionary registration still resolves.
  const authT = ctx.locale.bind('local-agent')
  // The gateway namespace is mounted by the family core's client half; read it
  // lazily from the global store so boot order between the two client plugins
  // never matters, and degrade to the auth block's 'unavailable' state when
  // the core client is absent.
  const gateway = (): LocalAgentGatewayRemote | undefined =>
    ctx.get('remote.localAgentGateway') as LocalAgentGatewayRemote | undefined
  // The settings card injects this face.
  const cardInject = (): CodexSettingsCardInjected => ({
    scope,
    hooks: { settings: scope },
    authT,
    renderModelPicker: props => (ctx.get('localAgentUi') as LocalAgentUi | undefined)?.renderHarnessModelPicker('codex', props),
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
  })
  // One Plugins-page card gated on the SERVED NAMESPACE, never on the install
  // shape: whichever composition carries the `local-agent-codex` row —
  // standalone install, family bundle, or mode pack — serves the row's
  // volatile Config under the row id, and `whileServed` keeps the
  // `plugins.item` entry alive for exactly that span (the official companion
  // convention), so a composition without the row shows no trace of the card.
  // This replaces the retired per-shape seats: `plugins.row.config` hardcoded
  // one carrier bundle into its key, and the host deleted
  // `settings.plugin.item`. The probe rides a deferred inject because
  // configForms exists only on the alpha.2+ host line; a 0.1.5 host never
  // fires it, and a configForms predating whileServed (0.1.6-alpha.2) skips
  // the card.
  ctx.inject(['configForms'], (formsCtx) => {
    const forms = formsCtx.configForms
    if (typeof forms.whileServed !== 'function') return
    return forms.whileServed(['local-agent-codex'], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item',
      id: 'local-agent-codex',
      // Community cards sort after the official settings pages (orders 10-40).
      order: 120,
      label: () => t('card.title'),
      locale: NS,
      inject: cardInject,
    }, CodexBundleConfig)))
  })
}
