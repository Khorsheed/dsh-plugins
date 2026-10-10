/**
 * The PRODUCER half of the scoped-home evidence seam.
 *
 * {@link ScopedHomeEvidenceFace} (faces.ts) is the consumption contract:
 * provision, the readiness gate and the freshness checks read their fairness
 * evidence through it when the service is mounted with one. This module is
 * how the EXECUTION TARGET produces that evidence — the same algorithms the
 * local path runs (`hashHome`, `readScopePreset`, the scope-preset trio),
 * over the scoped home the caller names and nothing else, so the digest the
 * target reports is byte-identical to the one a local read would produce.
 *
 * Two deliberate absences:
 *
 * - **No credential grading, no effective settings.** `credentialGrade` and
 *   `effectiveSettings` are the caller's own auth implementation — the
 *   factory reads the home's CONFIG bytes, and the auth answers are the
 *   family's verbs, not files this module may infer.
 * - **No defaults.** The home is a required argument, absolute and already
 *   authorization-checked by the caller; nothing here derives, discovers or
 *   falls back to a default home. A relative path is refused rather than
 *   resolved, because what it would resolve to depends on the caller's cwd —
 *   a path nobody verified.
 *
 * Fail-closed parity with the local reads: a missing home propagates
 * `hashHome`'s own throw; a scope with no readable roster answers
 * `rosteredPreset: undefined`; a scope that keeps no copy answers
 * `{ keepsCopy: false }`; a copy that cannot be a subject carries
 * `scopePresetProblem`'s text as `problem` and NO digest — the digest is
 * computed only for a copy that passed the subject checks, which is the order
 * the consumer applies them.
 * @module @khorsheed/dsh-eval
 */
import { isAbsolute } from 'node:path'
import { hashHome } from './contract/hash.ts'
import { scopeKeepsOwnPreset } from './capability-probe.ts'
import { hashPresetTree, scopePresetDir, scopePresetProblem } from './preset-snapshot.ts'
import { readScopePreset } from './sub-profile.ts'
import type { PresetSnapshotEvidence, ScopedHomeHashEvidence } from './faces.ts'

/** What {@link produceScopedHomeEvidence} answers. Plain data; safe across a JSON boundary. */
export interface ProducedScopedHomeEvidence {
  /** The `homeHash` verb's answer: the home's content fingerprint plus its producer-side identity. */
  home: ScopedHomeHashEvidence
  /** The `rosteredPreset` verb's answer; undefined when the scope rosters no readable preset. */
  rosteredPreset: string | undefined
  /**
   * The `presetSnapshot` verb's answer — present only when a preset was
   * named. `{ keepsCopy: false }` is the instance-root arrangement (the scope
   * defers to the deployment's preset root, so there is nothing to
   * fingerprint).
   */
  presetSnapshot?: PresetSnapshotEvidence
}

/**
 * Produce one scoped home's evidence, computed where the home lives.
 *
 * Reuses the local path's own functions, so the answers are the local
 * read's — parity is by construction, not by re-implementation. The function
 * reads ONLY under `homeDir`: it has no default home and no notion of one.
 * @param homeDir - the scoped home (absolute, already authorization-checked
 *   by the caller — this module's job is measurement, not admission).
 * @param options - `preset` asks for the scope's own copy of that preset to
 *   be fingerprinted too.
 * @returns the evidence bundle.
 * @throws when `homeDir` is not absolute, and whatever `hashHome` throws for
 *   a home that is not there — the local read's own failure, deliberately
 *   unmapped.
 */
export async function produceScopedHomeEvidence(
  homeDir: string,
  options: { preset?: string } = {},
): Promise<ProducedScopedHomeEvidence> {
  if (!isAbsolute(homeDir)) {
    throw new Error(`produceScopedHomeEvidence needs an absolute scoped-home path (caller-verified); got ${JSON.stringify(homeDir)}`)
  }
  const home = await hashHome(homeDir)
  const rosteredPreset = readScopePreset(homeDir)
  const evidence: ProducedScopedHomeEvidence = {
    home: { homeDir, ...home },
    rosteredPreset,
  }
  const preset = options.preset
  if (preset !== undefined) {
    if (!scopeKeepsOwnPreset(homeDir, preset)) {
      evidence.presetSnapshot = { keepsCopy: false }
    } else {
      const problem = await scopePresetProblem(scopePresetDir(homeDir, preset))
      if (problem !== undefined) {
        evidence.presetSnapshot = { keepsCopy: true, problem }
      } else {
        // The digest only for a copy that passed the subject checks — the
        // consumer's order (problem first, digest only when usable) preserved.
        const snapshot = await hashPresetTree(scopePresetDir(homeDir, preset))
        evidence.presetSnapshot = snapshot === undefined ? { keepsCopy: true } : { keepsCopy: true, snapshot }
      }
    }
  }
  return evidence
}
