/**
 * The PRODUCER side of capability-composition evidence: pure data, computed
 * where the composition runs, for a consumer in another process to verify.
 *
 * {@link produceCapabilityEvidence} answers "what is the capability face of
 * THIS composition, and how completely was it measured?" — the composition
 * digest plus a per-section completeness descriptor, the measurement object
 * (what claims to have been measured), and the caller's coverage declaration
 * (what directories/services were read). It reuses this package's own
 * snapshot and digest algorithms (`catalogSnapshot`, `hashOf` — via
 * `remote.ts` and `capabilities.ts`), so the digest it reports is the digest
 * `snapshotFor` would stamp over the same registries: parity is by
 * construction, and a test pins it.
 *
 * Two deliberate absences, both by design:
 *
 * - **No standing-scope mount.** The function takes no roster and no cordis
 *   Context, so it CANNOT resolve a preset's standing scope — resolving one
 *   mounts the preset (see `preset-scope.ts`), and a target-side producer
 *   must not pay that side effect to measure. The normal target-side
 *   topology needs no scope at all: the producer's own registries already
 *   ARE the composition's face. A caller holding an already-resolved scope
 *   may pass it as `scope`; resolution and release stay the caller's
 *   business.
 * - **No service registration.** Nothing is mounted, provided or injected as
 *   a side effect; the function reads the slices it is handed and returns
 *   plain JSON-safe data. It runs in a bare process (node builtins and this
 *   package's existing dependencies only).
 *
 * The digest algorithm is owned by THIS package. A consumer MUST NOT
 * recompute it from the rows, and MUST treat a `partial` or `unavailable`
 * section as "not verified" — never as complete, and never as "the section
 * is empty". An empty-but-complete section (scanned, zero found) and an
 * unmeasured section produce distinguishable descriptors, which is the
 * point: an empty digest is not a complete one unless every section says so.
 * @module @khorsheed/dsh-capability-catalog/evidence
 */

import { isAbsolute } from 'node:path'
import { catalogSnapshot, type CatalogSnapshotReport } from './remote.ts'
import type { RegistrySlice, SkillsCollectionReport } from './skills.ts'
import { collectToolFace, type CatalogToolsSlice, type ToolFaceCollection } from './tool-face.ts'
import type { CatalogSectionCompleteness } from './types.ts'

/**
 * What the evidence claims was measured: a preset composition at a given
 * presetId and workdir, plus the caller-declared revision of that
 * composition when one is available (e.g. its configuration digest). Every
 * field is caller-verified input, echoed — the producer measures, it does
 * not authenticate.
 */
export interface CapabilityEvidenceMeasurement {
  readonly kind: 'preset-composition'
  /** The preset the measured composition runs, as verified by the caller. */
  readonly presetId?: string
  /** The workdir whose project-scoped roots were measured (absolute). */
  readonly workdir?: string
  /** The measured composition's revision, when the caller has one. */
  readonly revision?: string
}

/**
 * The caller's declaration of what was measured: which directories and which
 * services the measurement read. Echoed into the evidence verbatim so a
 * consumer can check the measurement against what it expected to be
 * measured — a digest says nothing about its own coverage.
 */
export interface CapabilityEvidenceCoverage {
  /** Directories the measurement read (skill roots, project roots). */
  readonly directories?: readonly string[]
  /** Services the measurement read (e.g. `skills`, `tools`). */
  readonly services?: readonly string[]
}

/** What {@link produceCapabilityEvidence} needs. Every input is explicit. */
export interface ProduceCapabilityEvidenceOptions {
  /**
   * The preset the measured composition runs — caller-verified. Stamped onto
   * the snapshot (and echoed into the measurement) as given; it never enters
   * the digest, the way `snapshotFor`'s `preset` stamp never does.
   */
  readonly presetId?: string
  /**
   * The workdir whose project-scoped skill roots were measured — absolute
   * and caller-verified. A relative path is refused rather than resolved:
   * what it would resolve to depends on a cwd nobody verified.
   */
  readonly workdir?: string
  /** The measured composition's revision, when the caller has one. */
  readonly revision?: string
  /**
   * An already-resolved reading scope (opaque to this package), passed
   * through to the registry reads. Never resolved here — resolution mounts,
   * and mounting is the caller's decision. The caller owns any lease.
   */
  readonly scope?: unknown
  /** The skills registry to measure; absent = the skills section is `unavailable`. */
  readonly skills?: RegistrySlice
  /** The tools registry to measure; absent = the tools section is `unavailable`. */
  readonly tools?: CatalogToolsSlice
  /** Tools that appeared after the registry baseline (channel-heuristic input). */
  readonly appearedAfterApply?: ReadonlySet<string>
  /** The caller's coverage declaration — required, because a digest without one cannot be checked against expectations. */
  readonly coverage: CapabilityEvidenceCoverage
  /** Optional warning sink for the same diagnostics the Remote verbs log; dropped when absent. */
  readonly warn?: (message: string) => void
}

/** The per-section completeness of one produced evidence bundle (all four sections, always). */
export interface CapabilityEvidenceCompleteness {
  readonly skills: CatalogSectionCompleteness
  readonly tools: CatalogSectionCompleteness
  readonly mcpServers: CatalogSectionCompleteness
  readonly channels: CatalogSectionCompleteness
}

/**
 * What {@link produceCapabilityEvidence} answers. Plain JSON-safe data; safe
 * across a JSON boundary, and the round-trip is pinned by a test.
 */
export interface ProducedCapabilityEvidence {
  /** What claims to have been measured. */
  readonly measurement: CapabilityEvidenceMeasurement
  /**
   * The composition digest: `hashOf` over the fingerprinted snapshot, by this
   * package's own algorithm. Consumers compare it, they never recompute it.
   */
  readonly sha: string
  /** How completely each snapshot section was measured. */
  readonly completeness: CapabilityEvidenceCompleteness
  /** The caller's coverage declaration, echoed. */
  readonly coverage: CapabilityEvidenceCoverage
}

/** The registry that measures as "no skills", for a composition without a skills service. */
const EMPTY_REGISTRY: RegistrySlice = {
  snapshot: async () => ({ skills: [], complete: true }),
  get: async () => undefined,
}

/**
 * Wrap the caller's tools slice so a `get()` that throws degrades to an
 * unreadable origin tag (a partial section) instead of failing the whole
 * measurement. Member-call semantics are preserved — the slice may be a
 * traceable proxy whose methods need their receiver.
 */
function guardToolReads(tools: CatalogToolsSlice): CatalogToolsSlice {
  if (tools.get === undefined) return tools
  const get = tools.get
  return {
    schemas: (scope) => tools.schemas(scope),
    get: (name, scope) => {
      try {
        return get.call(tools, name, scope)
      } catch {
        return undefined
      }
    },
  }
}

/** The skills section's descriptor, from the collection's own report. */
function skillsCompleteness(skills: RegistrySlice | undefined, report: SkillsCollectionReport | undefined): CatalogSectionCompleteness {
  if (skills === undefined) return { state: 'unavailable', reason: 'the skills service is not installed' }
  if (report === undefined || report.attemptedScopes === 0) return { state: 'unavailable', reason: 'no skill scope was read' }
  if (report.failedScopes === report.attemptedScopes) {
    return { state: 'unavailable', reason: `the skill registry read failed for every scope (${report.attemptedScopes} attempted)` }
  }
  const problems: string[] = []
  if (report.failedScopes > 0) problems.push(`the skill registry read failed for ${report.failedScopes} of ${report.attemptedScopes} scopes`)
  if (report.incompleteReads > 0) problems.push('the registry reported incomplete skill discovery')
  if (report.unreadableBodies > 0) problems.push(`${report.unreadableBodies} skill bodies could not be read`)
  return problems.length === 0 ? { state: 'complete' } : { state: 'partial', reason: problems.join('; ') }
}

/** The tools section's descriptor, from how the tools-side read went. */
function toolsCompleteness(
  tools: CatalogToolsSlice | undefined,
  readFailed: boolean,
  face: ToolFaceCollection | undefined,
): CatalogSectionCompleteness {
  if (tools === undefined) return { state: 'unavailable', reason: 'the tools service is not installed' }
  if (readFailed || face === undefined) return { state: 'unavailable', reason: 'the tool registry read failed' }
  if (face.untaggedOrigins.length > 0) {
    return { state: 'partial', reason: `origin tags unreadable for ${face.untaggedOrigins.length} visible tools — channel attribution fell back to heuristics` }
  }
  return { state: 'complete' }
}

/** The MCP section is derived from the tools section, so it inherits its failures. */
function mcpCompleteness(tools: CatalogSectionCompleteness): CatalogSectionCompleteness {
  if (tools.state === 'unavailable') return { state: 'unavailable', reason: 'MCP servers are derived from the tools section, which is unavailable' }
  if (tools.state === 'partial') return { state: 'partial', reason: 'derived from a partially measured tools section' }
  return { state: 'complete' }
}

/** The channel summary is derived from the skills and tools rows, so it is only as strong as they are. */
function channelsCompleteness(skills: CatalogSectionCompleteness, tools: CatalogSectionCompleteness): CatalogSectionCompleteness {
  if (skills.state === 'unavailable' && tools.state === 'unavailable') {
    return { state: 'unavailable', reason: 'neither the skills nor the tools section could be measured' }
  }
  if (skills.state !== 'complete' || tools.state !== 'complete') {
    return { state: 'partial', reason: `summarizes sections that are not fully measured (skills: ${skills.state}, tools: ${tools.state})` }
  }
  return { state: 'complete' }
}

/**
 * Produce the capability-composition evidence of the composition THIS
 * process runs, as plain data another process can verify.
 *
 * The measurement reuses the package's own algorithms end to end: the tools
 * side is read by `tool-face.ts` (the same reads the Remote verbs make), the
 * snapshot is `catalogSnapshot` in fingerprint mode, and the digest is its
 * stamped `sha` — nothing is re-implemented, so the answer is comparable
 * with a `snapshotFor` digest taken over the same registries.
 * @param options - every input, explicit; see {@link ProduceCapabilityEvidenceOptions}.
 * @returns the evidence bundle — digest, completeness, measurement, coverage.
 * @throws when `workdir` is given but not absolute, when `presetId` is given
 *   but blank, or when the coverage declaration is missing — the caller
 *   verifies identity and coverage; this function only measures.
 */
export async function produceCapabilityEvidence(
  options: ProduceCapabilityEvidenceOptions,
): Promise<ProducedCapabilityEvidence> {
  if (options.workdir !== undefined && !isAbsolute(options.workdir)) {
    throw new Error(`produceCapabilityEvidence needs an absolute workdir (caller-verified); got ${JSON.stringify(options.workdir)}`)
  }
  if (options.presetId !== undefined && options.presetId.trim() === '') {
    throw new Error(`produceCapabilityEvidence needs a non-empty presetId when one is given; got ${JSON.stringify(options.presetId)}`)
  }
  if (options.coverage === undefined || options.coverage === null) {
    throw new Error('produceCapabilityEvidence needs the caller\'s coverage declaration (what directories/services were measured)')
  }
  const warn = options.warn ?? (() => {})
  // The tools side: one read of the caller's slice, with a throwing `get`
  // degraded to an untagged origin. A throwing `schemas()` is the caller's
  // unavailable — nothing was measured.
  let toolFace: ToolFaceCollection | undefined
  let toolsReadFailed = false
  if (options.tools !== undefined) {
    try {
      toolFace = collectToolFace(guardToolReads(options.tools), options.scope, warn)
    } catch {
      toolsReadFailed = true
    }
  }
  // The skills side + the snapshot itself: the SAME catalogSnapshot call the
  // fingerprint verb makes, with the health report the verbs never ask for.
  const report: CatalogSnapshotReport = {}
  const snapshot = await catalogSnapshot(
    options.workdir,
    options.skills ?? EMPTY_REGISTRY,
    toolFace?.schemas ?? [],
    toolFace?.mcpServerNames ?? [],
    options.appearedAfterApply ?? new Set(),
    [options.scope],
    toolFace?.origins ?? new Map(),
    { fingerprint: true, report, ...options.presetId !== undefined ? { preset: options.presetId } : {} },
  )
  const skills = skillsCompleteness(options.skills, report.skills)
  const tools = toolsCompleteness(options.tools, toolsReadFailed, toolFace)
  return {
    measurement: {
      kind: 'preset-composition',
      ...options.presetId !== undefined ? { presetId: options.presetId } : {},
      ...options.workdir !== undefined ? { workdir: options.workdir } : {},
      ...options.revision !== undefined ? { revision: options.revision } : {},
    },
    sha: snapshot.sha as string,
    completeness: {
      skills,
      tools,
      mcpServers: mcpCompleteness(tools),
      channels: channelsCompleteness(skills, tools),
    },
    coverage: {
      ...options.coverage.directories !== undefined ? { directories: [...options.coverage.directories] } : {},
      ...options.coverage.services !== undefined ? { services: [...options.coverage.services] } : {},
    },
  }
}
