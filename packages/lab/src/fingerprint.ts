/**
 * The composite environment fingerprint: what "the same environment" means
 * mechanically.
 *
 * A bare image digest is not that claim. Two units off one image with
 * different CPU/memory ceilings, one extra mounted volume, or a different set
 * of injected environment variables are different environments, and a
 * fingerprint that cannot tell them apart lets an evaluation report license a
 * comparison it has no right to. So the fingerprint is sha256 over a
 * canonical JSON of four components — image digest, resource ceilings, mount
 * layout, injected env key names — carried as `lab-env:<hex>`.
 *
 * Two rules keep the components honest in the other direction, so environments
 * that really are identical never look different:
 *
 * - **Only container-side facts.** A mount contributes its in-container path,
 *   its type, and its read-only bit — never the host path, which differs per
 *   machine and per run for the same materialized input.
 * - **Key names, never values.** An env value is a credential or a per-cell
 *   coordinate; the environment's shape is the set of names.
 *
 * Values are normalized before hashing (`4g` and `4096m` are one ceiling;
 * mount declaration order is not a fact), so equal environments hash equally.
 */
import { createHash } from 'node:crypto'
import type { AcquireSpec, FingerprintComponents, MountSpec, ResourceLimits } from './types.ts'

/** Scheme prefix of a composite fingerprint; anything else is a legacy bare digest. */
export const FINGERPRINT_SCHEME = 'lab-env:'

/**
 * Component-set schema version. It is hashed, so teaching the fingerprint a
 * new component necessarily changes every fingerprint — which is correct:
 * units previously judged identical may not be under the wider definition.
 */
export const COMPONENTS_VERSION = 1

/** Binary multipliers docker's own memory parser accepts. */
const MEMORY_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
}

/**
 * Normalize a docker `--cpus` value to its shortest exact decimal, so `2`,
 * `2.0` and `2.00` are one ceiling.
 * @param raw - the declared value.
 * @returns the canonical literal.
 */
export function normalizeCpus(raw: string | number): string {
  const text = String(raw).trim()
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    throw new Error(`lab: bad resources.cpus ${JSON.stringify(String(raw))} — want a positive decimal count of CPUs (e.g. "2" or "0.5")`)
  }
  const value = Number(text)
  if (!(value > 0)) throw new Error(`lab: resources.cpus must be greater than zero, got ${JSON.stringify(String(raw))}`)
  return String(value)
}

/**
 * Normalize a docker `--memory` value to a byte count, so `4g`, `4096m` and
 * `4294967296` are one ceiling.
 * @param raw - the declared value (optional b/k/m/g suffix, case-insensitive).
 * @returns the canonical byte count as a decimal string.
 */
export function normalizeMemory(raw: string | number): string {
  const text = String(raw).trim().toLowerCase()
  const match = /^(\d+(?:\.\d+)?)([a-z]*)$/.exec(text)
  const unit = match === null ? undefined : (match[2] === '' ? 1 : MEMORY_UNITS[match[2] as string])
  if (match === null || unit === undefined) {
    throw new Error(`lab: bad resources.memory ${JSON.stringify(String(raw))} — want a byte count with an optional b/k/m/g suffix (e.g. "4g")`)
  }
  const bytes = Number(match[1]) * unit
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(`lab: resources.memory ${JSON.stringify(String(raw))} does not resolve to a positive whole number of bytes`)
  }
  return String(bytes)
}

/** Normalized ceilings; an undeclared one is null, so the shape never varies. */
function normalizeResources(resources: ResourceLimits | undefined): FingerprintComponents['resources'] {
  return {
    cpus: resources?.cpus === undefined ? null : normalizeCpus(resources.cpus),
    memory: resources?.memory === undefined ? null : normalizeMemory(resources.memory),
  }
}

/**
 * Mount layout as the container sees it, sorted so declaration order — which
 * is not an environment fact — cannot split two identical units. The host
 * `source` is deliberately absent: the same input materializes at different
 * host paths on different machines.
 */
function normalizeMounts(mounts: MountSpec[] | undefined): FingerprintComponents['mounts'] {
  return (mounts ?? [])
    .map((mount) => ({ target: mount.target, type: 'bind', readonly: mount.readonly === true }))
    .sort((a, b) => a.target.localeCompare(b.target) || a.type.localeCompare(b.type) || Number(a.readonly) - Number(b.readonly))
}

/**
 * Build the component set for a spec.
 * @param spec - the acquire specification.
 * @param image - the resolved image digest (null when unresolvable).
 * @returns the components, in a shape that never varies.
 */
export function componentsFor(spec: AcquireSpec, image: string | null): FingerprintComponents {
  return {
    version: COMPONENTS_VERSION,
    image,
    resources: normalizeResources(spec.resources),
    mounts: normalizeMounts(spec.mounts),
    // Names only: a value is a credential or a per-cell coordinate, never the
    // shape of the environment.
    envKeys: Object.keys(spec.env ?? {}).sort(),
  }
}

/**
 * Canonical JSON: keys sorted at every depth, no insertion-order dependence.
 * Arrays keep their order — the normalizers above already sorted the ones
 * whose order is not a fact.
 * @param value - any JSON-representable value.
 * @returns the canonical serialization.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

/**
 * Hash a component set into the fingerprint string recorded in mission refs.
 * @param components - the component set.
 * @returns `lab-env:<sha256 hex>`.
 */
export function hashComponents(components: FingerprintComponents): string {
  return `${FINGERPRINT_SCHEME}${createHash('sha256').update(canonicalJson(components)).digest('hex')}`
}

/**
 * Is this a composite fingerprint? `false` means a legacy bare image digest
 * recorded before this line — accepted as a fingerprint with no components,
 * never reinterpreted.
 * @param fingerprint - the recorded string.
 * @returns true for the composite scheme.
 */
export function isComposite(fingerprint: string): boolean {
  return fingerprint.startsWith(FINGERPRINT_SCHEME)
}

/**
 * The display form for a status column: the tail after the last `:`, capped —
 * `lab-env:9f2c1a2b…` and `registry/app@sha256:aaa…` both read usefully.
 * @param fingerprint - the recorded string.
 * @returns a short, comparable-at-a-glance prefix.
 */
export function shortFingerprint(fingerprint: string): string {
  const tail = fingerprint.slice(fingerprint.lastIndexOf(':') + 1)
  return (tail === '' ? fingerprint : tail).slice(0, 8)
}

/**
 * Parse a components label or state value back, tolerating anything
 * unreadable: a hand-edited label must degrade to "no components", never
 * crash a reconcile that is rebuilding the whole registry.
 * @param raw - the serialized components, or undefined.
 * @returns the components, or undefined when absent or unreadable.
 */
export function parseComponents(raw: string | undefined): FingerprintComponents | undefined {
  if (raw === undefined || raw === '') return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<FingerprintComponents>
    if (typeof parsed.version !== 'number' || !Array.isArray(parsed.envKeys) || !Array.isArray(parsed.mounts)) return undefined
    return parsed as FingerprintComponents
  } catch {
    return undefined
  }
}
