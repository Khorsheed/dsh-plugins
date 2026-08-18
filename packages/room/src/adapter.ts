/**
 * The room's ONLY coupling point to the local-agent family's delegation
 * facade (`proposals/active/2026-08-18-local-agent-delegation-api.md`, M1).
 * No static dependency on @khorsheed/dsh-local-agent: the facade is probed
 * through `ctx.get('localAgent')` at dispatch time, and a missing or
 * incomplete facade degrades the CLI-member capability (structured
 * `local-agent-unavailable` at invite, journaled `failed` runs at dispatch)
 * while the main-agent member keeps working.
 * @module @khorsheed/dsh-room/adapter
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'

/**
 * The facade shape room consumes. Field types intentionally mirror the family
 * proposal's M1 signature (parentSessionId-keyed, prompt as content blocks,
 * the resume handle never inside prompt text).
 */
export interface LocalAgentFacade {
  /** Fresh delegation; the returned run's id IS the new child session id. */
  start(parentSessionId: string, provider: string, prompt: ContentBlock[]): Promise<SubagentRun>
  /** Continue a member's CLI conversation in its recorded child session. */
  resume(parentSessionId: string, provider: string, childSessionId: string, prompt: ContentBlock[]): Promise<SubagentRun>
  /** Cancel an in-flight run by child session id; false when nothing was in flight. */
  cancel(childSessionId: string): boolean
}

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

/** One roster row as the registry's roster() returns it. */
export interface LocalAgentRosterRowProbe {
  readonly name: string
  readonly displayName: string
}

/** One harness status as the registry's statusOf() returns it. */
export interface LocalAgentStatusProbe {
  readonly authenticated: boolean
  /** The subagent provider name the harness delegates through, when it has one. */
  readonly delegationProvider?: string
}

/** The roster slice of the localAgent registry (older than the M1 facade). */
export interface LocalAgentRosterSlice {
  roster(): readonly LocalAgentRosterRowProbe[]
  statusOf(name: string): Promise<LocalAgentStatusProbe>
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
