/**
 * Context-guard plugin, browser half: contributes one
 * `conversation.input.right` entry — a compact button inside the composer's
 * tool row that appears automatically when the next request's budget
 * (`contextPressure.projectedTokens` + the configured output cap) crosses
 * `thresholdRatio` of the routed model's context window. The action rides the
 * official `/compact` command channel (`remote.commands.execute` → host
 * `ctx.commands` → `ctx.compaction.compactNow`), so the plugin needs no host
 * half, no new RPC, and no edits to core packages; composing this plugin out
 * of cordis.yml removes every surface it adds.
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
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the typed `ctx.remote` (commands namespace) merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.input.right').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `contextPressure` SessionProjectionMap merge for
// useProjection.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { resolveConfig, type ContextGuardConfig } from './config.ts'
import { en, NS, zh } from './locales.ts'
import type { ContextGuardInjected } from './slots.ts'
import { CompactGuardButton } from './CompactGuardButton.tsx'

export type { ContextGuardConfig } from './config.ts'
export { resolveConfig } from './config.ts'
export type { ContextGuardKey } from './locales.ts'
export { guardReading } from './guard.ts'
export type { GuardInput, GuardLevel, GuardReading } from './guard.ts'
export type { CompactGuardButtonProps, ContextGuardInjected } from './slots.ts'

/** Dictionary namespace owned by this plugin. */
export { NS }

/** Required services: the slot ledger, the command Remote, and the copy. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the composer-tool-row compact button.
 * @param ctx - client root context.
 * @param config - entry config; defaults apply when the runner passes none.
 */
export function apply(ctx: ClientContext, config?: Partial<ContextGuardConfig>): void {
  const options = resolveConfig(config)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-guard: dictionaries')
  if (!options.enabled) return

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
      thresholdRatio: options.thresholdRatio,
      maxTokens: options.maxTokens,
      // Failure strings stay English (error-surface policy: not localized).
      compactNow: async () => {
        const result = await ctx.remote.commands.execute(sessionId, '/compact')
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return 'unknown command: /compact'
        return null
      },
    }),
  }, CompactGuardButton))
}
