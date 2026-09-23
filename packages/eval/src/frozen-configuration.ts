import type { DelegationConfiguration, EvalDelegationOptions, LocalAgentFace } from './faces.ts'

/** Keep the historical condition bytes/hash untouched; default is a legacy declaration. */
export function declaredEffort(document: Record<string, unknown>): string | null {
  const reasoning = document['reasoning']
  const effort = typeof reasoning === 'object' && reasoning !== null ? (reasoning as Record<string, unknown>)['effort'] : undefined
  return typeof effort === 'string' && effort.trim() !== '' ? effort.trim() : null
}
export function requestedEffort(declared: string | null | undefined): string | undefined {
  return declared == null || declared === 'default' ? undefined : declared
}
export function frozenConfigurationOptions(sha: string, effort: string | null | undefined): Pick<EvalDelegationOptions, 'effort' | 'configurationLock'> {
  const value = requestedEffort(effort)
  return { configurationLock: `Frozen evaluation condition ${sha}`, ...value === undefined ? {} : { effort: value } }
}
export function requireEffortAdmission(face: LocalAgentFace, provider: string, effort: string | null | undefined): void {
  if (requestedEffort(effort) !== undefined && (face.supportsMemberConfiguration?.(provider) !== true || face.runConfiguration === undefined)) {
    throw new Error('This frozen effort condition requires native configuration admission; no generation was started')
  }
}

export interface EffortEvidence {
  declared: string | null
  requested: string | null
  resolved: string | null
  observed: string | null
  revision: number | null
  status: 'verified' | 'unverified' | 'mismatch'
}
export function effortEvidence(declared: string | null | undefined, admitted: DelegationConfiguration | undefined, observed: string | null | undefined): EffortEvidence {
  const requested = requestedEffort(declared) ?? null
  const resolved = admitted?.resolved.effort ?? null
  const actual = observed ?? null
  const expected = requested ?? resolved
  const mismatch = requested !== null && resolved !== requested || actual !== null && expected !== null && actual !== expected
  return { declared: declared ?? null, requested, resolved, observed: actual, revision: admitted?.revision ?? null,
    status: mismatch ? 'mismatch' : actual !== null && expected !== null ? 'verified' : 'unverified' }
}

/** Recompute the verdict from recorded facts; an imported status string is not evidence. */
export function parseEffortEvidence(value: unknown): EffortEvidence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const declared = typeof row['declared'] === 'string' ? row['declared'] : null
  const observed = typeof row['observed'] === 'string' ? row['observed'] : null
  const revision = row['revision']
  const admitted = typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? {
    revision,
    selection: { model: { mode: 'default' as const }, effort: { mode: 'default' as const } },
    resolved: typeof row['resolved'] === 'string' ? { effort: row['resolved'] } : {},
  } : undefined
  return effortEvidence(declared, admitted, observed)
}
