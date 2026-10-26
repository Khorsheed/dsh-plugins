import type { LocalAgentUi } from '@khorsheed/dsh-local-agent/client'
import { bindCardSettingsScope, type SettingsScopeSnapshot } from '@khorsheed/dsh-local-agent/src/client/settings-scope.ts'
/**
 * Local-agent-dsh plugin, browser half: the dsh settings card — a section of
 * the family core's「本机 Agent 委派」family card on the Plugins page
 * (registered through the core's `localAgentUi.registerHarnessCard` while the
 * Host serves the `local-agent-dsh` namespace), or this package's own
 * `plugins.item` entry when the core predates the family card (the
 * declare-and-degrade fallback). Every
 * install shape serves the row's volatile Config under the row id —
 * standalone install, family bundle, or mode pack — so the card follows the
 * served namespace rather than any carrier bundle, and a composition without
 * the row shows no trace of it. The card carries the family core's shared
 * ProviderAuthBlock (dsh authenticates through the host credentials, so the
 * block renders status only), the DeepSeek delegation switch — migrated from
 * the core section's `local-agent.settings.row-action` seat, which this
 * plugin no longer contributes to — and the resident-mode block (live switch)
 * plus the default-model block (free-text input, the broker's effective-model
 * line and suggestion vocabulary), whose writes ride the bound settingsScope:
 * the host watcher hot-applies them, no reload. Every read degrades: an
 * absent gateway renders the auth block's 'unavailable' state and drops the
 * model surface to the bare input, an unregistered namespace disables the
 * controls.
 * @module @khorsheed/dsh-local-agent-dsh/client
 */
import { createElement, useSyncExternalStore } from 'react'
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
import { en, NS, zh, type LocalAgentDshKey } from './locales.ts'
import {
  DshBundleConfig, DshCardSection, type DshCardSettings, type DshSettingsCardInjected,
} from './SettingsCard.tsx'

export { DshBundleConfig, DshCardSection, DshSettingsCard } from './SettingsCard.tsx'
export type {
  DshCardSettings, DshBundleConfigProps, DshCardSectionProps, DshSettingsCardInjected, DshSettingsCardProps,
} from './SettingsCard.tsx'
export { en, NS, zh }
export type { LocalAgentDshKey }

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
 * Client plugin body: register the dictionaries and the dsh settings card
 * bound to the local-agent-dsh namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-agent-dsh: dictionaries')
  const t = ctx.locale.bind(NS)
  const scope = bindCardSettingsScope<DshCardSettings>(ctx, 'dsh', 'local-agent-dsh')
  // The auth block's copy lives in the family core's dictionary; binding is
  // stable per namespace and late dictionary registration still resolves.
  const authT = ctx.locale.bind('local-agent')
  // The gateway namespace is mounted by the family core's client half; read it
  // lazily from the global store so boot order between the two client plugins
  // never matters, and degrade to the auth block's 'unavailable' state when
  // the core client is absent.
  const gateway = (): LocalAgentGatewayRemote | undefined =>
    ctx.get('remote.localAgentGateway') as LocalAgentGatewayRemote | undefined
  // The card's inject face minus the hooks compartment — the family-card
  // section consumes this verbatim; the standalone card's slot registration
  // adds the hooks compartment back below.
  const cardFace = (): Omit<DshSettingsCardInjected, 'hooks'> => ({
    scope,
    authT,
    renderModelPicker: props => (ctx.get('localAgentUi') as LocalAgentUi | undefined)?.renderHarnessModelPicker('dsh', props),
    // The harness's memberless model surface; absent gateway/broker
    // degrades to the bare input with its recent-models suggestions.
    harnessModel: () =>
      gateway()?.harnessModel('dsh').then(result => (result.ok ? result.value : undefined))
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
  // The settings card injects this face.
  const cardInject = (): DshSettingsCardInjected => ({ ...cardFace(), hooks: { settings: scope } })
  // The family-card section render bypasses the slot renderer's inject.hooks
  // materialization, so bind the scope's selector hook here with the same
  // semantics (a uSES subscription over the scope's own subscribe/getSnapshot).
  const subscribeScope = (listener: () => void): (() => void) => scope.subscribe(listener)
  const readScope = (): SettingsScopeSnapshot<DshCardSettings> => scope.getSnapshot()
  const useSettings = <S,>(select: (snapshot: SettingsScopeSnapshot<DshCardSettings>) => S): S =>
    select(useSyncExternalStore(subscribeScope, readScope))
  // One Plugins-page seat gated on the SERVED NAMESPACE, never on the install
  // shape: whichever composition carries the `local-agent-dsh` row —
  // standalone install, family bundle, or mode pack — serves the row's
  // volatile Config under the row id, and `whileServed` keeps the
  // registration alive for exactly that span (the official companion
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
    return forms.whileServed(['local-agent-dsh'], () => {
      // The family card owns the Plugins-page seat when the core's client
      // provides it: a core new enough answers registerHarnessCard, and this
      // package renders as a section of the「本机 Agent 委派」card instead of
      // its own entry. The probe runs at serve time — a host round-trip past
      // client plugin boot — so a composed core has already provided the
      // service; an old or absent core keeps the standalone card below.
      const ui = ctx.get('localAgentUi') as LocalAgentUi | undefined
      if (typeof ui?.registerHarnessCard === 'function') {
        return ui.registerHarnessCard({
          name: 'dsh',
          // The retired standalone card's order, kept as the section order.
          order: 140,
          locale: NS,
          label: () => t('card.title'),
          render: ({ active, useSessions }) =>
            createElement(DshCardSection, { active, useSessions, ...cardFace(), useSettings, t }),
        })
      }
      return ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item',
        id: 'local-agent-dsh',
        // Community cards sort after the official settings pages (orders 10-40).
        order: 140,
        label: () => t('card.title'),
        locale: NS,
        inject: cardInject,
      }, DshBundleConfig))
    })
  })
}
