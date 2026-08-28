/**
 * Fail-soft poll of the local-agent family's in-flight delegations.
 *
 * TaskPilot integrates with the local-agent family by duck typing only: the
 * family's read-only `localAgentGateway` Remote namespace is polled when it
 * exists, and every failure mode — the family not installed (channel absent),
 * a call error, a non-ok result — resolves to an empty list. The two plugins
 * never depend on each other; without the local-agent channel this helper is
 * a strict no-op, so the dock keeps the exact single-source behavior.
 *
 * @module dsh-taskpilot/client/active-delegations
 */

/** The only shape taskpilot reads off the family gateway (duck typed). */
export interface ActiveDelegationsGatewayLike {
  readonly activeDelegations: () => Promise<{
    readonly ok: boolean
    readonly value?: readonly string[]
  }>
}

/** A minimal reader exposing `ctx.get`, so the helper stays unit-testable. */
export interface ActiveDelegationsReader {
  get(key: string): unknown
}

/** The Remote namespace the local-agent client mounts for its gateway. */
const LOCAL_AGENT_GATEWAY_KEY = 'remote.localAgentGateway'

/**
 * Poll the family's in-flight delegation child session ids.
 * @param reader - context reader resolving the mounted gateway namespace.
 * @returns the active child session ids, or an empty list when the channel
 *   is absent, the call fails, or the result is not ok.
 */
export async function pollActiveDelegations(
  reader: ActiveDelegationsReader,
): Promise<readonly string[]> {
  try {
    const gateway = reader.get(LOCAL_AGENT_GATEWAY_KEY) as ActiveDelegationsGatewayLike | undefined
    if (gateway?.activeDelegations === undefined) return []
    const result = await gateway.activeDelegations()
    return result.ok === true ? (result.value ?? []) : []
  } catch {
    // Channel missing or the call threw: treat as no in-flight delegations,
    // identical to a session without the local-agent family installed.
    return []
  }
}
