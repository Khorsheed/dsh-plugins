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
 *   guard against the second is the read-back plus {@link scopeKeepsOwnPreset}
 *   below: a scope that keeps its own copy of the preset is measured only
 *   when the provisioning that made that copy reports it byte-identical to
 *   the deployment's — which is exactly when the face, carrying no
 *   filesystem path, describes both.
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
import type { CapabilityCatalogFace } from './faces.ts'
import { hashPresetTree, scopePresetDir, scopePresetProblem } from './preset-snapshot.ts'
import type { CapabilityProbe, CapabilityProbeInput, ProvisionedCapabilities } from './provision.ts'
import { readScopePreset } from './sub-profile.ts'

/**
 * Whether the scope keeps a preset directory of its own for this id.
 *
 * Two arrangements reach this module, and the answer decides which:
 *
 * - **No copy.** The scope defers to the deployment's preset root, which is
 *   what T32b required of every scope. The catalog and the sub-dsh then read
 *   one directory on the host — and inside an evaluation unit the sub-dsh
 *   reads nothing at all, because the unit mounts the scope and the roster's
 *   roots name a host path. Still measured, still correct on the host path,
 *   and warned about for the other.
 * - **A copy.** The scope IS the preset, on both paths. The catalog still
 *   reads the deployment's copy — it resolves ids through the instance's own
 *   roster and has no verb for a directory — so the measurement describes the
 *   scope's copy exactly when the two hold the same bytes. That equality is
 *   reported by the provisioning that made the copy and required below.
 * @param homeDir - the scoped home.
 * @param preset - the preset id.
 * @returns true when the scope keeps its own copy of that preset.
 */
export function scopeKeepsOwnPreset(homeDir: string, preset: string): boolean {
  return existsSync(scopePresetDir(homeDir, preset))
}

/** What {@link instanceCapabilityProbe} needs. */
export interface CapabilityProbeDeps {
  catalog: CapabilityCatalogFace
  /** Read back which preset a scoped home rosters. Injected for the tests. */
  readPreset?: (homeDir: string) => string | undefined
  /** Whether the scope keeps its own copy of a preset directory. Injected for the tests. */
  keepsOwnPreset?: (homeDir: string, preset: string) => boolean
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
  const keepsOwnPreset = deps.keepsOwnPreset ?? scopeKeepsOwnPreset
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

    // 3. Which arrangement this scope is, and whether it is measurable.
    //    A copy the provisioning did not vouch for is the silent-wrong-hash
    //    case T32b refused outright: same id, different content, a plausible
    //    number that describes neither subject.
    const scopeCopy = keepsOwnPreset(input.homeDir, rostered)
    let snapshot: { sha: string } | undefined
    if (scopeCopy) {
      if (input.snapshot?.matchesSource !== true) {
        log(`capability probe ${input.condition}: the scope keeps its own ${rostered} preset directory and nothing vouched for it`
          + ' — this instance\'s catalog reads the deployment\'s copy, so the hash it would return describes another directory with the same name.'
          + ' Provision this condition through a facade that composes the scope\'s preset (localAgent.provisionScope), or remove the scope\'s copy')
        return undefined
      }
      const problem = await scopePresetProblem(scopePresetDir(input.homeDir, rostered))
      if (problem !== undefined) {
        log(`capability probe ${input.condition}: the scope's ${rostered} copy cannot be a subject — ${problem}`)
        return undefined
      }
      const tree = await hashPresetTree(scopePresetDir(input.homeDir, rostered))
      if (tree === undefined) {
        log(`capability probe ${input.condition}: the scope's ${rostered} copy is not a plain tree of files, so it cannot be hashed`
          + ' — a symlink does not survive the bind mount into an evaluation unit')
        return undefined
      }
      snapshot = { sha: tree.sha }
    } else {
      log(`capability probe ${input.condition}: the scope defers to this deployment's preset root for ${rostered}`
        + ' — measurable here, but a unit mounts only the scoped home, so the sub-dsh will not resolve the preset on the container path')
    }

    // 4. The measurement. A named preset the instance's roster cannot resolve
    //    REJECTS rather than degrading — that refusal is the answer here too.
    let face
    try {
      face = await deps.catalog.snapshotFor(rostered)
    } catch (error) {
      log(`capability probe ${input.condition}: the instance's catalog could not fingerprint preset ${JSON.stringify(rostered)}:`
        + ` ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
    const sha = face.sha ?? deps.catalog.hashOf?.(face)
    if (typeof sha !== 'string' || sha === '') {
      log(`capability probe ${input.condition}: the catalog returned a face with no digest for preset ${JSON.stringify(rostered)}`)
      return undefined
    }
    return {
      sha,
      // The preset the FACE was taken under when the catalog says so, else
      // the one read back off the scope. Never the declaration.
      preset: face.preset ?? rostered,
      skills: face.skills.length,
      tools: face.tools.length,
      source: scopeCopy ? 'scope-snapshot' : 'instance-root',
      ...(snapshot === undefined ? {} : { snapshot }),
    }
  }
}
