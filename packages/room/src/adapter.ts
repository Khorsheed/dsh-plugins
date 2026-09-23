/**
 * The room's ONLY coupling point to the local-agent family's delegation
 * facade (`proposals/closed/2026-08-18-local-agent-delegation-api.md`, M1
 * landed as `LocalAgentRegistry.start/resume/cancel`). The TYPES come from a
 * type-only import of the family core (drift-checked at compile time); the
 * RUNTIME stays a probe — `ctx.get('localAgent')` plus method-existence
 * checks — so a composition without the family degrades the CLI-member
 * capability (structured `local-agent-unavailable` at invite, journaled
 * `failed` runs at dispatch) while the main-agent member keeps working.
 * @module @khorsheed/dsh-room/adapter
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { LocalAgentRegistry } from '@khorsheed/dsh-local-agent'

/** The delegation-facade slice room consumes (the family's public M1 API). */
export type LocalAgentFacade = Pick<LocalAgentRegistry, 'start' | 'resume' | 'cancel'> & Partial<Pick<LocalAgentRegistry, 'prepareMember' | 'isPreparedMember' | 'supportsMemberConfiguration'>>

/** The roster slice of the registry (older than the M1 facade). */
export type LocalAgentRosterSlice = Pick<LocalAgentRegistry, 'roster' | 'statusOf'>

/** The methods a service must carry to quack like the facade. */
const FACADE_METHODS = ['start', 'resume', 'cancel'] as const

/**
 * Probe the local-agent facade.
 * @param ctx - host context.
 * @returns the facade when `localAgent` is present and carries the full M1
 * method set, undefined otherwise (absent core, or a pre-facade version).
 */
export function probeLocalAgent(ctx: Context): LocalAgentFacade | undefined {
  const service = ctx.get('localAgent') as Record<string, unknown> | undefined
  if (service === undefined || service === null) return undefined
  return FACADE_METHODS.every(method => typeof service[method] === 'function')
    ? service as unknown as LocalAgentFacade
    : undefined
}

/**
 * Probe the registry's roster slice (independent of the delegation facade:
 * a core without M1 still serves the roster, and the invite dialog greys
 * undispatchable providers instead of hiding them).
 * @param ctx - host context.
 * @returns the roster slice, or undefined.
 */
export function probeLocalAgentRoster(ctx: Context): LocalAgentRosterSlice | undefined {
  const service = ctx.get('localAgent') as Record<string, unknown> | undefined
  if (service === undefined || service === null) return undefined
  return typeof service['roster'] === 'function' && typeof service['statusOf'] === 'function'
    ? service as unknown as LocalAgentRosterSlice
    : undefined
}

/**
 * Extract a member's reply text from a settled run: the text blocks of its
 * final output, joined. Non-text blocks (images etc.) are dropped — the
 * blackboard is a text layer.
 * @param output - the settled run's output content.
 * @returns the reply text (empty string when the run produced no text).
 */
export function runOutputText(output: readonly ContentBlock[]): string {
  return output.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n')
}
