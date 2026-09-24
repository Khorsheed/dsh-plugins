/**
 * Resolving WHICH scope the catalog reads — and the one place where a listing
 * and a fingerprint part company.
 *
 * The catalog reads the skill and tool registries at an agent preset's
 * standing scope, because that is the view the model actually has. Resolving
 * it can fail: the composition may mount no roster, the named preset may not
 * exist, or its composition may refuse to mount.
 *
 * The roster face depends on the host line: 0.1.5 exposes a lease-free
 * `standingKeyFor(id)`, while rc.1 replaced it with a LEASED
 * `acquireScope(id)` — the resolved lease carries the key and a release on
 * `Symbol.asyncDispose`, and a lease never released leaks a generation user,
 * so the preset's scope is never collected. Both faces resolve through
 * {@link acquireStandingScope}; callers that hold the key across reads own
 * the release (see {@link ResolvedPresetScope.dispose}).
 *
 * A LISTING degrades on all three. The settings card must not go blank
 * because a preset has a bad row, and the global layer is a useful, honestly
 * unlabelled answer there.
 *
 * A FINGERPRINT must not. Falling back to the global layer and stamping the
 * requested preset's name on the result hands back a hash that is not that
 * preset's face — which is precisely the "claim with nothing behind it" the
 * hash exists to eliminate. It was not hypothetical: on a real sub-dsh whose
 * preset carried one invalid row, two scopes rostering two different presets
 * produced one identical hash, silently, and the only way to notice was to
 * already know the answer.
 * @module @khorsheed/dsh-capability-catalog/preset-scope
 */

/** The slice of the agent-preset roster the catalog reads. */
export interface PresetRosterSlice {
  readonly defaultId?: string
  /** The 0.1.5 face: a lease-free read of one preset's standing scope key. */
  readonly standingKeyFor?: (id?: string) => Promise<unknown>
  /**
   * The rc.1 face: a LEASED read resolving to `{ key } & AsyncDisposable`.
   * An unknown preset rejects `agent-preset/not-found`, a broken one
   * `agent-preset/invalid`. Typed as unknown: the key is opaque to the
   * catalog, and `Symbol.asyncDispose` is untyped under the es2024 target —
   * {@link acquireStandingScope} narrows both structurally.
   */
  readonly acquireScope?: (id?: string) => Promise<unknown>
  /** Every preset the deployment supplies, for a scope picker. */
  readonly list?: () => Promise<readonly PresetRosterRow[]>
}

/** One roster row, structurally narrowed to what a picker needs. */
export interface PresetRosterRow {
  readonly id: string
  readonly name?: string
  readonly description?: string
  /** Why this preset cannot compose a session, when it cannot. */
  readonly broken?: string
}

/**
 * A standing-scope read, normalized across roster faces: the key, and the
 * release when the face leases. The key outlives the release — the roster
 * reaps a generation only once its preset is unregistered AND unleased — so
 * a reader that finished its reads may release without unmounting the scope.
 */
export interface StandingScopeRead {
  /** The standing scope key, or undefined when the roster resolved none. */
  readonly key: unknown | undefined
  /** Releases the rc.1 lease; undefined on the lease-free 0.1.5 face. */
  readonly dispose?: () => Promise<void>
}

/** A resolved reading position: the scope key, and the preset it is honestly labelled with. */
export interface ResolvedPresetScope {
  /** The standing scope key, or undefined for the global layer. */
  readonly scope: unknown | undefined
  /** The preset id — set ONLY when a standing scope actually resolved. */
  readonly preset: string | undefined
  /**
   * Releases the scope lease, when the roster leases (rc.1). Undefined on the
   * 0.1.5 face, which carries no lease. A caller holding `scope` across reads
   * must dispose in a `finally` after the LAST read — never releasing leaks a
   * generation user, so the preset's scope is never collected.
   */
  readonly dispose?: () => Promise<void>
}

/**
 * Acquire one preset's standing scope key from whichever face the roster
 * offers — 0.1.5's lease-free `standingKeyFor` first, rc.1's leased
 * `acquireScope` when that is absent. Errors propagate unchanged, so the
 * caller owns the strict/degrade policy; the caller also owns the release.
 * @param roster - the agent-preset roster (already probed present).
 * @param id - the preset to read, or undefined for the deployment default.
 * @returns the key and the lease release, if the face leases.
 */
export async function acquireStandingScope(roster: PresetRosterSlice, id: string | undefined): Promise<StandingScopeRead> {
  if (roster.standingKeyFor !== undefined) return { key: await roster.standingKeyFor(id) }
  if (roster.acquireScope === undefined) return { key: undefined }
  const lease: unknown = await roster.acquireScope(id)
  const dispose = leaseRelease(lease)
  return { key: leaseKey(lease), ...dispose === undefined ? {} : { dispose } }
}

/**
 * Resolve the catalog's reading scope.
 *
 * Resolving a preset MOUNTS it (the roster's single-flight standing mount),
 * so this is not a free read: asking for the capability face of a preset
 * nothing has composed yet composes it.
 * @param roster - the optional agent-preset roster (`ctx.get('agentPresets')`).
 * @param presetId - the preset to read, or undefined for the deployment default.
 * @param strict - fingerprint mode: throw rather than degrade to the global layer.
 * @returns the scope to read at and the label it may carry.
 * @throws in strict mode when the roster is absent for a named preset, or
 *   cannot resolve a standing scope.
 */
export async function resolvePresetScope(
  roster: PresetRosterSlice | undefined,
  presetId: string | undefined,
  strict: boolean,
): Promise<ResolvedPresetScope> {
  if (roster?.standingKeyFor === undefined && roster?.acquireScope === undefined) {
    // No roster at all. Naming a preset here is a caller error; asking for
    // the default face is honest — there is no preset to misreport.
    if (strict && presetId !== undefined) {
      throw new Error(`capability-catalog: cannot fingerprint preset ${JSON.stringify(presetId)} — this composition mounts no agent-preset roster`)
    }
    return { scope: undefined, preset: undefined }
  }
  const wanted = presetId ?? roster?.defaultId
  let read: StandingScopeRead
  try {
    read = await acquireStandingScope(roster, wanted)
  } catch (error) {
    if (strict) {
      throw new Error(`capability-catalog: cannot fingerprint preset ${JSON.stringify(wanted)}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { scope: undefined, preset: undefined }
  }
  if (read.key === undefined) {
    // No scope to hand out, so no caller will release the lease — do it here.
    await read.dispose?.()
    if (strict) {
      throw new Error(`capability-catalog: the roster resolved no standing scope for preset ${JSON.stringify(wanted)}`)
    }
    return { scope: undefined, preset: undefined }
  }
  return {
    scope: read.key,
    preset: typeof wanted === 'string' && wanted !== '' ? wanted : undefined,
    ...read.dispose === undefined ? {} : { dispose: read.dispose },
  }
}

/** The lease's key, read structurally (`key` is opaque to the catalog). */
function leaseKey(lease: unknown): unknown {
  if (lease === null || (typeof lease !== 'object' && typeof lease !== 'function')) return undefined
  return (lease as { readonly key?: unknown }).key
}

/**
 * The lease's release, hung on `Symbol.asyncDispose` by the roster. The
 * es2024 target does not type that symbol, so it is read through a cast —
 * any runtime hosting an rc.1 roster defines it, because the roster's own
 * lease literal is keyed by it. A lease without a callable release degrades
 * to the 0.1.5 shape (nothing to dispose) rather than failing the read.
 */
function leaseRelease(lease: unknown): (() => Promise<void>) | undefined {
  if (lease === null || (typeof lease !== 'object' && typeof lease !== 'function')) return undefined
  const asyncDispose = (Symbol as { readonly asyncDispose?: symbol }).asyncDispose
  const release = asyncDispose === undefined ? undefined : (lease as Record<PropertyKey, unknown>)[asyncDispose]
  if (typeof release !== 'function') return undefined
  return async () => { await (release as (this: unknown) => Promise<void>).call(lease) }
}
