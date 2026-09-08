/**
 * The composite environment fingerprint: what "the same environment" means
 * mechanically.
 *
 * A bare image digest is not that claim. Two units off one image with
 * different CPU/memory ceilings, one extra mounted volume, or a different set
 * of injected environment variables are different environments, and a
 * fingerprint that cannot tell them apart lets an evaluation report license a
 * comparison it has no right to. So the fingerprint is sha256 over a
 * canonical JSON of the components — image digest, resource ceilings, mount
 * layout, injected env key names, docker network, in-container user — carried
 * as `lab-env:<hex>`.
 *
 * Two rules keep the components honest in the other direction, so environments
 * that really are identical never look different:
 *
 * - **Only container-side facts.** A mount contributes its in-container path,
 *   its type, and its read-only bit — never the host path or volume name,
 *   which differ per machine and per run for the same materialized input. A
 *   network NAME is the exception that proves the rule: it is a daemon-local
 *   label naming a topology, not a location on someone's disk.
 * - **Key names, never values.** An env value is a credential or a per-cell
 *   coordinate; the environment's shape is the set of names.
 *
 * Values are normalized before hashing (`4g` and `4096m` are one ceiling;
 * mount declaration order is not a fact), so equal environments hash equally.
 *
 * And one rule keeps the component set growable: **an undeclared component
 * contributes nothing to the hash.** A component added after the initial set
 * is absent from the preimage when the spec does not declare it, so teaching
 * the fingerprint about networks did not move the fingerprint of any unit that
 * never declared one. That is not a compatibility shim — it follows from what
 * a fingerprint means. A fingerprint must change when the environment changes;
 * a unit that declared no network before and declares none now is running in
 * the same place (docker's default bridge), so its fingerprint must not move.
 */
import { createHash } from 'node:crypto'
import type { AcquireSpec, FingerprintComponents, MountSpec, ResourceLimits } from './types.ts'

/** Scheme prefix of a composite fingerprint; anything else is a legacy bare digest. */
export const FINGERPRINT_SCHEME = 'lab-env:'

/**
 * Version of the HASHING RULES — canonicalization, value normalization, and
 * the undeclared-is-absent rule below. It is hashed. It does NOT number the
 * component inventory: growing that inventory is handled by
 * {@link ADDITIVE_COMPONENTS} instead, precisely so a wider definition does
 * not move the fingerprint of a unit whose environment did not change.
 */
export const COMPONENTS_VERSION = 1

/**
 * Components added after the initial set, omitted from the hash preimage when
 * `null`. Every later addition joins this list; the initial four cannot,
 * because their preimage bytes are what the stability rule is anchored to.
 */
const ADDITIVE_COMPONENTS = ['network', 'user'] as const

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
 * is not an environment fact — cannot split two identical units. The `source`
 * is deliberately absent for both kinds: a bind's host path differs per
 * machine, and a volume's name is per-cell by design (one credential volume
 * per harness), while the layout — what is mounted where, and whether it can
 * be written — is what the cells must share.
 */
function normalizeMounts(mounts: MountSpec[] | undefined): FingerprintComponents['mounts'] {
  return (mounts ?? [])
    .map((mount) => ({ target: mount.target, type: mount.type ?? 'bind', readonly: mount.readonly === true }))
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
    // Undeclared is a real, single value here — docker's default bridge, and
    // the image's own USER — so recording it as null loses nothing.
    network: spec.network ?? null,
    user: spec.user ?? null,
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
 * The bytes actually hashed: the component set minus every
 * {@link ADDITIVE_COMPONENTS} entry the spec did not declare. See the module
 * header — an undeclared component contributes nothing, so a unit's
 * fingerprint moves only when its environment does.
 */
function hashPreimage(components: FingerprintComponents): Record<string, unknown> {
  const preimage: Record<string, unknown> = { ...components }
  for (const key of ADDITIVE_COMPONENTS) {
    if (preimage[key] === null || preimage[key] === undefined) delete preimage[key]
  }
  return preimage
}

/**
 * Hash a component set into the fingerprint string recorded in mission refs.
 * @param components - the component set.
 * @returns `lab-env:<sha256 hex>`.
 */
export function hashComponents(components: FingerprintComponents): string {
  return `${FINGERPRINT_SCHEME}${createHash('sha256').update(canonicalJson(hashPreimage(components))).digest('hex')}`
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
