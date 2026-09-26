/**
 * Context-guard plugin, browser half: contributes one
 * `conversation.input.right` entry — a compact button inside the composer's
 * tool row that appears automatically when the next request's budget
 * (`contextPressure.projectedTokens` + the output budget) crosses
 * `thresholdRatio` of the routed model's context window — plus one settings
 * surface editing the same number live: a standalone install renders the
 * bundle's own configuration on its Plugins-page detail view
 * (`plugins.bundle.config`, keyed by package name), a family-bundle install
 * renders the same card through the row-level configure entry on the
 * BUNDLE's detail view (`plugins.row.config`, keyed
 * `@khorsheed/dsh-bundle-conversation-toolbox#context-guard`), and 0.1.5
 * renders the `settings.plugin.item` card in the plugin configuration tab
 * (keyed by the settings namespace). The action
 * rides the official `/compact` command
 * channel (`remote.commands.execute` → host `ctx.commands` →
 * `ctx.compaction.compactNow`); the config rides the official settings
 * surface (the host half serves the section — its own Config on rc.1, a
 * `settings.register` namespace on 0.1.5 — and this half binds it through
 * ./scope.ts, probing rc.1's `configForms` first and 0.1.5's `settingsScope`
 * second), so neither needs a new RPC or any edit to core packages;
 * composing this plugin out of cordis.yml removes every surface it adds.
 *
 * Why this exists: the official auto-compaction fires at `agent/pre-step`
 * when the meter's context estimate crosses 80% of the window — a check that
 * excludes the request's own output budget and rides a heuristic that
 * deliberately underprices CJK/JSON. A long request can therefore push
 * context + maxTokens past the window while the estimate still sits below
 * 80%, so the provider rejects the request (CONTEXT_WINDOW_EXCEEDED). The
 * guard surfaces the danger while a manual compaction still fits — the
 * summarization call reserves only its own small output cap, so it keeps
 * running after the main request is rejected.
 * @module @khorsheed/dsh-context-guard/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the typed `ctx.remote` (commands namespace) merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.input.right').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-plugin-manager's SlotMap merge
// ('plugins.bundle.config').
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: pulls the `contextPressure` SessionProjectionMap merge for
// useProjection.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { CONTEXT_GUARD_NS } from '../namespace.ts'
import { resolveConfig, type ContextGuardConfig } from './config.ts'
import { en, NS, zh } from './locales.ts'
import { bindGuardScope, GuardScopeChannel } from './scope.ts'
import type { ContextGuardInjected, ContextGuardSettingsCardInjected } from './slots.ts'
import { CompactGuardButton } from './CompactGuardButton.tsx'
import { ContextGuardBundleConfig, ContextGuardSettingsCard } from './SettingsCard.tsx'

export type { ContextGuardConfig } from './config.ts'
export { resolveConfig } from './config.ts'
export type { ContextGuardKey } from './locales.ts'
export { guardReading } from './guard.ts'
export type { GuardInput, GuardLevel, GuardReading } from './guard.ts'
export type { GuardScope, GuardScopeSnapshot } from './scope.ts'
export type {
  CompactGuardButtonProps, ContextGuardBundleConfigProps, ContextGuardInjected, ContextGuardSettingsCardInjected, ContextGuardSettingsCardProps,
} from './slots.ts'

/** Dictionary namespace owned by this plugin. */
export { NS }

/**
 * This bundle's package name — the key the Plugins page dispatches
 * `plugins.bundle.config` entries on (identity triangle: cordis.patch.yml,
 * tsdown.config.ts, invariant.ts).
 */
const PACKAGE_NAME = '@khorsheed/dsh-context-guard'

/**
 * Required services: the slot ledger, the command Remote, and the copy. The
 * settings scope is deliberately NOT injected — rc.1 and 0.1.5 name different
 * services (`configForms` vs `settingsScope`), and a composition without
 * either must not pend the bundle (see ./scope.ts).
 */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the composer-tool-row compact button and the
 * settings card over the shared `context-guard` section.
 * @param ctx - client root context.
 * @param config - entry config (the section's composition base layer); defaults apply when the runner passes none.
 */
export function apply(ctx: Context, config?: Partial<ContextGuardConfig>): void {
  const fallback = resolveConfig(config)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-guard: dictionaries')

  // One shared live section: the settings card writes it, the button reads
  // it. The channel binds whichever settings face the host line serves and
  // publishes `unavailable` until then — the button falls back to the
  // composition-time values above, the card renders nothing.
  const scope = new GuardScopeChannel()
  bindGuardScope(ctx, scope)

  // The slot is declared by ui-conversation, whose apply order relative to
  // this plugin is unconstrained: register through slots.inject so the entry
  // waits for the declaration instead of crashing the loader at boot.
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'context-guard',
    // Sit before the primary send button; the seat currently has no other
    // occupants, and a leading position keeps the danger visible.
    order: -10,
    locale: NS,
    inject: (sessionId: SessionId): ContextGuardInjected => ({
      thresholdRatio: fallback.thresholdRatio,
      // Failure strings stay English (error-surface policy: not localized).
      compactNow: async () => {
        const result = await ctx.remote.commands.execute(sessionId, '/compact', [])
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return 'unknown command: /compact'
        return null
      },
      hooks: { config: scope },
    }),
  }, CompactGuardButton))

  // The settings surface follows the host line AND the install shape — three
  // tracks, all riding slots.inject so each fires only where its declaration
  // exists. Standalone install: the package's own Plugins-page detail view
  // (`plugins.bundle.config`, keyed by package name). Installed as a
  // conversation-toolbox member: the member is no longer the profile's
  // direct dependency, so only the bundle gets a detail view — the card rides
  // the row-level slot (`plugins.row.config`, keyed `<bundle package>#<row
  // id>` with the row id the bundle's patch declares) and the bundle's page
  // gains a configure entry opening it. 0.1.5: the legacy
  // configurable-plugins tab card (`settings.plugin.item`, keyed by the
  // settings namespace) through a string-keyed duck narrow of the same
  // service (the slot name is gone from the alpha.2 SlotMap).
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: PACKAGE_NAME,
    locale: NS,
    inject: (): ContextGuardSettingsCardInjected => ({
      scope,
      hooks: { config: scope },
    }),
  }, ContextGuardBundleConfig))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: '@khorsheed/dsh-bundle-conversation-toolbox#context-guard',
    locale: NS,
    inject: (): ContextGuardSettingsCardInjected => ({
      scope,
      hooks: { config: scope },
    }),
  }, ContextGuardBundleConfig))
  const legacy = ctx.slots as unknown as {
    inject(key: string, callback: () => unknown): unknown
    register(entry: {
      name: string
      key: string
      locale: string
      inject: () => ContextGuardSettingsCardInjected
    }, component: typeof ContextGuardSettingsCard): unknown
  }
  legacy.inject('settings.plugin.item', () => legacy.register({
    name: 'settings.plugin.item',
    key: CONTEXT_GUARD_NS,
    locale: NS,
    inject: (): ContextGuardSettingsCardInjected => ({
      scope,
      hooks: { config: scope },
    }),
  }, ContextGuardSettingsCard))
}
