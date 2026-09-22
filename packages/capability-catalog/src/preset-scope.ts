/**
 * Resolving WHICH scope the catalog reads — and the one place where a listing
 * and a fingerprint part company.
 *
 * The catalog reads the skill and tool registries at an agent preset's
 * standing scope, because that is the view the model actually has. Resolving
 * it can fail: the composition may mount no roster, the named preset may not
 * exist, or its composition may refuse to mount.
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
  readonly standingKeyFor?: (id?: string) => Promise<unknown>
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

/** A resolved reading position: the scope key, and the preset it is honestly labelled with. */
export interface ResolvedPresetScope {
  /** The standing scope key, or undefined for the global layer. */
  readonly scope: unknown | undefined
  /** The preset id — set ONLY when a standing scope actually resolved. */
  readonly preset: string | undefined
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
  if (roster?.standingKeyFor === undefined) {
    // No roster at all. Naming a preset here is a caller error; asking for
    // the default face is honest — there is no preset to misreport.
    if (strict && presetId !== undefined) {
      throw new Error(`capability-catalog: cannot fingerprint preset ${JSON.stringify(presetId)} — this composition mounts no agent-preset roster`)
    }
    return { scope: undefined, preset: undefined }
  }
  const wanted = presetId ?? roster.defaultId
  let scope: unknown
  try {
    scope = await roster.standingKeyFor(wanted)
  } catch (error) {
    if (strict) {
      throw new Error(`capability-catalog: cannot fingerprint preset ${JSON.stringify(wanted)}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { scope: undefined, preset: undefined }
  }
  if (scope === undefined) {
    if (strict) {
      throw new Error(`capability-catalog: the roster resolved no standing scope for preset ${JSON.stringify(wanted)}`)
    }
    return { scope: undefined, preset: undefined }
  }
  return { scope, preset: typeof wanted === 'string' && wanted !== '' ? wanted : undefined }
}
