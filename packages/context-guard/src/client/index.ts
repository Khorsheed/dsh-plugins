/**
 * Context-guard plugin, browser half: contributes one
 * `conversation.input.right` entry — a compact button inside the composer's
 * tool row that appears automatically when the next request's budget
 * (`contextPressure.projectedTokens` + the output budget) crosses
 * `thresholdRatio` of the routed model's context window — plus one settings
 * card editing the same number live: a `plugins.item` entry on the Plugins
 * page gated by `configForms.whileServed` on the `context-guard` namespace
 * (the official companion convention), so every install shape — standalone,
 * the basic bundle, a mode pack — surfaces the same card, and
 * a composition without the row shows no trace of it. The action
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
// Type-only: pulls the ctx.configForms service merge (the whileServed gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.input.right').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-plugin-manager's SlotMap merge ('plugins.item').
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
import { ContextGuardBundleConfig } from './SettingsCard.tsx'

export type { ContextGuardConfig } from './config.ts'
export { resolveConfig } from './config.ts'
export type { ContextGuardKey } from './locales.ts'
export { guardReading } from './guard.ts'
export type { GuardInput, GuardLevel, GuardReading } from './guard.ts'
export type { GuardScope, GuardScopeSnapshot } from './scope.ts'
export type {
  CompactGuardButtonProps, ContextGuardBundleConfigProps, ContextGuardInjected, ContextGuardSettingsCardInjected,
} from './slots.ts'

/** Dictionary namespace owned by this plugin. */
export { NS }

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

  // One Plugins-page card gated on the SERVED NAMESPACE, never on the install
  // shape: whichever composition carries the `context-guard` row — standalone,
  // the basic bundle, or a mode pack — serves the row's
  // volatile Config under the row id, and `whileServed` keeps the
  // `plugins.item` entry alive for exactly that span (the official companion
  // convention), so a composition without the row shows no trace of the card.
  // This replaces the retired per-shape seats: `plugins.row.config` hardcoded
  // one carrier bundle into its key, and the host deleted
  // `settings.plugin.item`. The probe rides a deferred inject because
  // configForms exists only on the alpha.2+ host line; a 0.1.5 host never
  // fires it, and a configForms predating whileServed (0.1.6-alpha.2) skips
  // the card.
  const t = ctx.locale.bind(NS)
  ctx.inject(['configForms'], (formsCtx) => {
    const forms = formsCtx.configForms
    if (typeof forms.whileServed !== 'function') return
    return forms.whileServed([CONTEXT_GUARD_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item',
      id: CONTEXT_GUARD_NS,
      // Community cards sort after the official settings pages (orders 10-40).
      order: 100,
      label: () => t('settings.title'),
      locale: NS,
      inject: (): ContextGuardSettingsCardInjected => ({
        scope,
        hooks: { config: scope },
      }),
    }, ContextGuardBundleConfig)))
  })
}
