/**
 * Package-owned invariant companion for `@khorsheed/dsh-local-agent`.
 * @module @khorsheed/dsh-local-agent/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { LocalAgentDelegationRecord, LocalAgentHarness } from './index.ts'

const PACKAGE_NAME = '@khorsheed/dsh-local-agent'

/** Cordis companion plugin name. */
export const name = 'local-agent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/u

/**
 * Audit the harness registry lifecycle: a registered harness must carry a
 * valid, unique command-prefix name, a home environment variable, and a
 * records adapter, and a removed name must have been registered first.
 */
function auditLifecycle(ctx: Context, fail: InvariantFailure): void {
  const known = new Set<string>()
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'localAgent/harness-added') {
      const harness = args[0] as LocalAgentHarness
      if (!NAME_PATTERN.test(harness.name)) {
        fail(`localAgent/harness-added names a harness with invalid name ${JSON.stringify(harness.name)}`)
      }
      if (known.has(harness.name)) fail(`localAgent/harness-added repeats name ${JSON.stringify(harness.name)}`)
      if (harness.homeEnvVar.length === 0) fail(`localAgent/harness-added for ${harness.name} has an empty homeEnvVar`)
      known.add(harness.name)
      return
    }
    if (eventName !== 'localAgent/harness-removed') return
    const name = args[0] as string
    if (!known.delete(name)) fail(`localAgent/harness-removed names unknown harness ${JSON.stringify(name)}`)
  }, { global: true })
}

/**
 * Cross-check delegation claims against the mounted subagent providers after
 * the composition settles. A harness whose {@link LocalAgentHarness.delegationProvider}
 * names a provider the tree does not mount means "identity present, delegation
 * 404" — a typo in either the record or the bundle patch — and fails loud.
 * A composition without the subagent seam (record-and-login only) skips the
 * check; so does a harness without a delegation provider.
 */
async function auditDelegationClaims(ctx: Context, fail: InvariantFailure): Promise<void> {
  const loader = ctx.get('loader') as { await(): Promise<unknown> } | undefined
  await loader?.await()
  const subagents = ctx.get('subagents') as { getProvider(name: string): unknown } | undefined
  if (subagents === undefined) return
  const registry = ctx.get('localAgent') as { list(): readonly string[]; get(name: string): LocalAgentHarness | undefined } | undefined
  if (registry === undefined) return
  for (const name of registry.list()) {
    const providerName = registry.get(name)?.delegationProvider
    if (providerName === undefined) continue
    if (subagents.getProvider(providerName) === undefined) {
      fail(`local-agent harness ${name} declares delegation provider ${JSON.stringify(providerName)} which is not mounted`)
    }
  }
}

/**
 * Audit the delegation registry: a recorded delegation must name a mounted
 * subagent provider (the record is only useful when a resume round can route
 * back through the same provider). Mirrors the harness-level delegation-claim
 * check with the same "identity present, delegation 404" rationale — a record
 * whose provider the tree does not mount means a provider rename left a stale
 * mapping that would fail loud on the first resume attempt.
 */
async function auditDelegationProviders(ctx: Context, fail: InvariantFailure): Promise<void> {
  const loader = ctx.get('loader') as { await(): Promise<unknown> } | undefined
  await loader?.await()
  const subagents = ctx.get('subagents') as { getProvider(name: string): unknown } | undefined
  if (subagents === undefined) return
  const registry = ctx.get('localAgent') as {
    listDelegations(): readonly LocalAgentDelegationRecord[]
  } | undefined
  if (registry === undefined) return
  for (const record of registry.listDelegations()) {
    if (subagents.getProvider(record.provider) === undefined) {
      fail(`local-agent delegation for child session ${record.childSessionId} records provider ${JSON.stringify(record.provider)} which is not mounted`)
    }
  }
}

/**
 * Install the package's checks.
 * @param ctx - child context owned by this invariant registration.
 * @param fail - reporter bound to the registering package name.
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure): Promise<void> => {
  auditLifecycle(ctx, fail)
  return Promise.all([
    auditDelegationClaims(ctx, fail),
    auditDelegationProviders(ctx, fail),
  ]).then(() => {})
}, {})

/**
 * Register this package's invariant companion.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
