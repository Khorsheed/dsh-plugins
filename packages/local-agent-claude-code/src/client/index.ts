import { bindSettingsScope } from '@khorsheed/dsh-local-agent/src/client/settings-scope.ts'
/**
 * Local-agent-claude-code plugin, browser half: the claude-code settings card
 * on the Plugins page — one `plugins.item` entry gated by
 * `configForms.whileServed` on the `local-agent-claude-code` namespace (the
 * official companion convention). Every install shape serves the row's
 * volatile Config under the row id — standalone install, family bundle, or
 * mode pack — so the card follows the served namespace rather than any
 * carrier bundle, and a composition without the row shows no trace of it. The
 * card carries the family core's shared ProviderAuthBlock
 * (login/logout/manual-handoff, backed by the core's localAgentGateway Remote
 * and the commands channel), the default-model block (free-text write plus
 * the gateway's model surface: the effective-model line and the suggestion
 * vocabulary), and the resident-mode switch, whose writes ride the bound
 * settingsScope — the host watcher hot-applies them, no reload. Every read
 * degrades: an absent gateway renders the auth block's 'unavailable' state
 * and drops the model surface, an unregistered namespace disables the live
 * controls.
 * @module @khorsheed/dsh-local-agent-claude-code/client
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
import { en, NS, zh, type LocalAgentClaudeCodeKey } from './locales.ts'
import {
  ClaudeCodeBundleConfig, type ClaudeLiveSettings, type ClaudeCodeSettingsCardInjected,
} from './SettingsCard.tsx'

export { ClaudeCodeBundleConfig, ClaudeCodeSettingsCard } from './SettingsCard.tsx'
export type {
  ClaudeLiveSettings, ClaudeCodeBundleConfigProps, ClaudeCodeSettingsCardInjected, ClaudeCodeSettingsCardProps,
} from './SettingsCard.tsx'
export { en, NS, zh }
export type { LocalAgentClaudeCodeKey }

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
 * Client plugin body: register the dictionaries and the claude-code settings
 * card bound to the local-agent-claude-code namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-agent-claude-code: dictionaries')
  const t = ctx.locale.bind(NS)
  const scope = bindSettingsScope<ClaudeLiveSettings>(ctx, 'local-agent-claude-code')
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
  const cardInject = (): ClaudeCodeSettingsCardInjected => ({
    scope,
    hooks: { settings: scope },
    authT,
    // The curated model list's read/write faces, over the same Remotes.
    modelList: {
      read: () => {
        const gw = gateway()
        if (gw === undefined || typeof gw.modelList !== 'function') return Promise.resolve(undefined)
        return gw.modelList('claude-code').then(result => (result.ok ? result.value : undefined))
      },
      write: (models) => {
        const gw = gateway()
        if (gw === undefined || typeof gw.configureModelList !== 'function') return Promise.resolve(undefined)
        return gw.configureModelList('claude-code', models).then(result => (result.ok ? result.value : undefined))
      },
    },
    // The endpoint's served catalog for the add dialog. A core predating
    // modelDirectory leaves the dialog with its reason.
    modelDirectory: (refresh) => {
      const gw = gateway()
      if (gw === undefined || typeof gw.modelDirectory !== 'function') return Promise.resolve(undefined)
      return gw.modelDirectory('claude-code', undefined, refresh ?? false).then(result => (result.ok ? result.value : undefined))
    },
    // The verify button's probe, over the session-less gateway Remote. A core
    // predating `checkEndpoint` hides the button (declare-and-degrade).
    checkEndpoint: () => {
      const gw = gateway()
      if (gw === undefined || typeof gw.checkEndpoint !== 'function') return Promise.resolve(undefined)
      return gw.checkEndpoint('claude-code').then(result => (result.ok ? result.value : undefined))
    },
    // The credential form's read/write face, over the same session-less
    // Remotes. Absent on a core that predates them — the card hides the form.
    endpointAuth: {
      read: () => {
        const gw = gateway()
        if (gw === undefined || typeof gw.endpointAuth !== 'function') return Promise.resolve(undefined)
        return gw.endpointAuth('claude-code').then(result => (result.ok ? result.value : undefined))
      },
      write: (fields) => {
        const gw = gateway()
        if (gw === undefined || typeof gw.configureEndpoint !== 'function') return Promise.resolve(undefined)
        return gw.configureEndpoint('claude-code', fields).then(result => (result.ok ? result.value : undefined))
      },
    },
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
  // shape: whichever composition carries the `local-agent-claude-code` row —
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
    return forms.whileServed(['local-agent-claude-code'], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item',
      id: 'local-agent-claude-code',
      // Community cards sort after the official settings pages (orders 10-40).
      order: 130,
      label: () => t('card.title'),
      locale: NS,
      inject: cardInject,
    }, ClaudeCodeBundleConfig)))
  })
}
