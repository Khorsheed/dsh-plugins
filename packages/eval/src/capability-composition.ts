/**
 * The bound member's capability composition: the shared half of the seam.
 *
 * The face verb ({@link ScopedHomeEvidenceFace.capabilityComposition}) is the
 * door; this module is what every consumer behind it shares — the SHAPE an
 * answer must carry to be evidence at all, and the coded freshness comparison
 * between the lock's recorded measurement and the one taken now. One shape,
 * one comparator: provision's admission, validate's freshness warnings and
 * the readiness gate cannot drift into three readings of one record.
 *
 * The codes are the refusal vocabulary the review named: INVALID (missing or
 * misshapen answer), INCOMPLETE (a section is `partial`/`unavailable` — "not
 * verified", never admitted), STALE (the digest moved), MEASUREMENT_MISMATCH
 * (the descriptor — kind, presetId, workdir, revision — moved),
 * HOME_MISMATCH and BINDING_MISMATCH (the identity pair moved).
 * @module @khorsheed/dsh-eval
 */
import { CAPABILITY_COMPOSITION_FORMAT, type CapabilityCompositionEvidence } from './faces.ts'
import { SHA256_HEX_RE } from './contract/schema.ts'

/** The completeness sections, in record order. */
const COMPLETENESS_SECTIONS = ['skills', 'tools', 'mcpServers', 'channels'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

/**
 * Hold a face answer to the evidence contract: producer format, digest,
 * measurement descriptor, four-section completeness, and the identity pair
 * (binding required, homeIdentity when present a string).
 * @param value - the answer, as it crossed the seam.
 * @returns the typed evidence, or undefined when the answer is not evidence.
 */
export function readCapabilityCompositionShape(value: unknown): CapabilityCompositionEvidence | undefined {
  if (!isPlainObject(value)) return undefined
  if (value['providerFormat'] !== CAPABILITY_COMPOSITION_FORMAT) return undefined
  const sha = value['sha']
  if (typeof sha !== 'string' || !SHA256_HEX_RE.test(sha)) return undefined
  const measurement = value['measurement']
  if (!isPlainObject(measurement) || measurement['kind'] !== 'preset-composition') return undefined
  if (!optionalString(measurement['presetId']) || !optionalString(measurement['workdir']) || !optionalString(measurement['revision'])) return undefined
  const completeness = value['completeness']
  if (!isPlainObject(completeness)) return undefined
  for (const section of COMPLETENESS_SECTIONS) {
    const row = completeness[section]
    if (!isPlainObject(row)) return undefined
    const state = row['state']
    if (state !== 'complete' && state !== 'partial' && state !== 'unavailable') return undefined
    if (!optionalString(row['reason'])) return undefined
  }
  const coverage = value['coverage']
  if (coverage !== undefined) {
    if (!isPlainObject(coverage)) return undefined
    for (const key of ['directories', 'services'] as const) {
      const list = coverage[key]
      if (list !== undefined && (!Array.isArray(list) || !list.every(item => typeof item === 'string'))) return undefined
    }
  }
  if (!optionalString(value['homeIdentity'])) return undefined
  const binding = value['binding']
  if (typeof binding !== 'string' || binding === '') return undefined
  return value as unknown as CapabilityCompositionEvidence
}

/**
 * The sections that are not `complete`, in record order. An empty list is a
 * fully verified measurement — and `complete` includes the measured-zero
 * case, so zero-found never appears here.
 */
export function incompleteSections(evidence: CapabilityCompositionEvidence): string[] {
  return COMPLETENESS_SECTIONS.filter(section => evidence.completeness[section].state !== 'complete')
}

/**
 * The coded freshness comparison: the lock's recorded measurement against
 * the one taken now. Deterministic order — completeness first (an
 * unmeasurable-now answer says "not verified" before any drift is read),
 * then the digest, the descriptor, and the identity pair.
 * @param recorded - what the lock records.
 * @param fresh - what the face answers now.
 * @returns the coded refusal reason, or undefined when nothing moved.
 */
export function compositionFreshnessRefusal(
  recorded: CapabilityCompositionEvidence,
  fresh: CapabilityCompositionEvidence,
): string | undefined {
  const incomplete = incompleteSections(fresh)
  if (incomplete.length > 0) {
    return `CAPABILITY_COMPOSITION_INCOMPLETE: the member's capability composition now measures ${incomplete.join(', ')}`
      + ' as not complete — "not verified", never an admission (re-measure where the member runs, then `conditions provision` again)'
  }
  if (fresh.sha !== recorded.sha) {
    return `CAPABILITY_COMPOSITION_STALE: the lock records capability composition caps:${recorded.sha.slice(0, 12)}…`
      + ` but it now measures caps:${fresh.sha.slice(0, 12)}… — the composition changed after provision (run \`conditions provision\` again)`
  }
  const descriptorChanged = fresh.measurement.kind !== recorded.measurement.kind
    || fresh.measurement.presetId !== recorded.measurement.presetId
    || fresh.measurement.workdir !== recorded.measurement.workdir
    || fresh.measurement.revision !== recorded.measurement.revision
  if (descriptorChanged) {
    return `CAPABILITY_COMPOSITION_MEASUREMENT_MISMATCH: the lock records measurement ${JSON.stringify(recorded.measurement)}`
      + ` but the face now answers ${JSON.stringify(fresh.measurement)} — the measured claim itself moved`
  }
  if (fresh.homeIdentity !== recorded.homeIdentity) {
    return `CAPABILITY_COMPOSITION_HOME_MISMATCH: the lock records homeIdentity ${JSON.stringify(recorded.homeIdentity)}`
      + ` but the face now answers ${JSON.stringify(fresh.homeIdentity)} — the evidence moved to another home`
  }
  if (fresh.binding !== recorded.binding) {
    return `CAPABILITY_COMPOSITION_BINDING_MISMATCH: the lock records binding ${JSON.stringify(recorded.binding)}`
      + ` but the face now answers ${JSON.stringify(fresh.binding)} — the evidence is about another member`
  }
  return undefined
}
