/**
 * The capability probe `conditions provision` runs inside a live instance.
 *
 * T32 left the measurement a hook and nothing filled it, so every condition
 * declaring a `preset` locked without a capability record, warned
 * `CAPABILITIES_UNMEASURED`, and was refused by the readiness gate. This
 * module fills it: read back which preset the scope's sub-profile actually
 * rosters, ask the instance's own capability catalog for that preset's face,
 * and hand provision the digest.
 *
 * ## What this measures, and what it does not
 *
 * The catalog answers for the composition IT runs in — the evaluation
 * instance — not for the sub-dsh's own composition (dsh-base plus the
 * headless patch plus the roster). So the recorded hash is *the preset's
 * capability face as this instance composes it*. Two consequences worth
 * stating rather than discovering:
 *
 * - **It is a real factor.** Two conditions naming two presets get two
 *   different hashes, and editing a preset's skill body moves the hash. That
 *   is what pilot D needs and what the readiness gate checks.
 * - **It is not the sub-dsh's whole face.** Rows the sub-dsh's base
 *   composition contributes are not in it, and a preset whose id means
 *   different directories in the two rosters would hash the wrong one. The
 *   guard against the second is the read-back plus
 *   {@link scopeDefersToInstancePresets} below: the measurement is refused
 *   unless the scope defers to the instance's preset root.
 *
 * Measuring the sub-dsh's real composition means booting its sub-profile and
 * asking a catalog mounted inside it — the launch path the T32 note defers.
 * When that lands, this module is where it replaces the instance read; every
 * lock written by the instance read then reads stale against it, which the
 * readiness gate's re-measure turns into "re-provision" rather than into a
 * silently wrong comparison.
 * @module @khorsheed/dsh-eval
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CapabilityCatalogFace } from './faces.ts'
import type { CapabilityProbe, CapabilityProbeInput, ProvisionedCapabilities } from './provision.ts'
import { readScopePreset } from './sub-profile.ts'

/** The preset root an agent-preset roster derives from a harness home. */
const USER_PRESET_DIR = '.agent-presets'

/**
 * Whether the scope and the instance would read the SAME preset directory.
 *
 * The catalog resolves a preset id through the orchestrating instance's own
 * roster roots; the sub-dsh resolves it through the scoped home's. When both
 * derive their user root from a harness home, "same id" means the same
 * directory only if that directory is one and the same. A scope carrying its
 * own `<scope>/.agent-presets/<id>` while the instance carries a different
 * `<dshHome>/.agent-presets/<id>` is the silent-wrong-hash case, and this is
 * the check that turns it into a refusal.
 *
 * The comparison is deliberately crude — does the SCOPE hold a preset
 * directory of its own for this id? — because that is the only half this
 * module can see. The instance's roots belong to the catalog, which has no
 * verb for reporting them.
 * @param homeDir - the scoped home.
 * @param preset - the preset id.
 * @returns true when the scope keeps no competing copy of that preset.
 */
export function scopeDefersToInstancePresets(homeDir: string, preset: string): boolean {
  return !existsSync(join(homeDir, USER_PRESET_DIR, preset))
}

/** What {@link instanceCapabilityProbe} needs. */
export interface CapabilityProbeDeps {
  catalog: CapabilityCatalogFace
  /** Read back which preset a scoped home rosters. Injected for the tests. */
  readPreset?: (homeDir: string) => string | undefined
  /** Whether the scope keeps its own copy of a preset directory. Injected for the tests. */
  defersToInstance?: (homeDir: string, preset: string) => boolean
  log?: (message: string) => void
}

/**
 * Build the probe `conditions provision` calls for a condition that declares
 * a preset.
 *
 * Returns `undefined` (never throws) for every reason the measurement cannot
 * be trusted, because provision turns that into `CAPABILITIES_UNMEASURED`
 * with the reason logged and the readiness gate refuses the condition later.
 * A probe that guessed would produce a lock that reads as verified, which is
 * strictly worse than no lock at all.
 * @param deps - the catalog face plus the injectable reads.
 * @returns the probe to pass as `ProvisionOptions.capabilities`.
 */
export function instanceCapabilityProbe(deps: CapabilityProbeDeps): CapabilityProbe {
  const readPreset = deps.readPreset ?? readScopePreset
  const defersToInstance = deps.defersToInstance ?? scopeDefersToInstancePresets
  const log = deps.log ?? ((): void => {})

  return async (input: CapabilityProbeInput): Promise<ProvisionedCapabilities | undefined> => {
    // 1. The read-back. `provisioned.preset` is supposed to be what the scope
    //    HAS, so a scope whose roster cannot be read has nothing to record —
    //    copying the declaration here is the one thing that would make the
    //    field meaningless.
    const rostered = readPreset(input.homeDir)
    if (rostered === undefined) {
      log(`capability probe ${input.condition}: the scoped home rosters no readable preset`
        + ` (expected the sub-profile to compose ${JSON.stringify(input.preset)})`
        + ' — provision the scope\'s sub-profile with that preset, then run this again')
      return undefined
    }

    // 2. A disagreement is reported, not resolved: provision records what was
    //    measured and warns, and the readiness gate refuses the pair.
    if (rostered !== input.preset) {
      log(`capability probe ${input.condition}: the scope rosters ${JSON.stringify(rostered)},`
        + ` the condition declares ${JSON.stringify(input.preset)}`)
    }

    // 3. Same id, different directory is the silent-wrong-hash case.
    if (!defersToInstance(input.homeDir, rostered)) {
      log(`capability probe ${input.condition}: the scope keeps its own ${rostered} preset directory,`
        + ' which this instance\'s catalog cannot read — the hash it would return is another preset with the same name.'
        + ` Point the scope's roster at the instance's preset root (the sub-profile's \`roots\`), or wait for the in-scope measurement`)
      return undefined
    }

    // 4. The measurement. A named preset the instance's roster cannot resolve
    //    REJECTS rather than degrading — that refusal is the answer here too.
    let snapshot
    try {
      snapshot = await deps.catalog.snapshotFor(rostered)
    } catch (error) {
      log(`capability probe ${input.condition}: the instance's catalog could not fingerprint preset ${JSON.stringify(rostered)}:`
        + ` ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
    const sha = snapshot.sha ?? deps.catalog.hashOf?.(snapshot)
    if (typeof sha !== 'string' || sha === '') {
      log(`capability probe ${input.condition}: the catalog returned a face with no digest for preset ${JSON.stringify(rostered)}`)
      return undefined
    }
    return {
      sha,
      // The preset the SNAPSHOT was taken under when the catalog says so,
      // else the one read back off the scope. Never the declaration.
      preset: snapshot.preset ?? rostered,
      skills: snapshot.skills.length,
      tools: snapshot.tools.length,
    }
  }
}
