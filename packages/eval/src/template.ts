/**
 * Run-template generation: the run template is the dataset-suite manifest's
 * stages plus the archive gate, as a DETERMINISTIC function — never
 * hand-written, never stored in the plan (protocol §6.4). Generated shape
 * (pinned by tests against the I1 hand-written `templates/bench-v1.json`):
 *
 *   pending → ws-ready → stage-1 → … → stage-N → judged → archived
 *                                     └→ halted → archived
 *   archived → releasable → released
 *
 * Guards: the earliest transition carries the run-meta schema-check
 * (`schemas/run-meta.json`, `datasetId` + `commit`); every stage exit carries
 * a schema-check on the stage's structured schema; a stage with `halt_on`
 * gains a `→ halted` edge whose guard is the stage's `<stageId>-halted.json`
 * const schema; entering `releasable` carries the archive file-check
 * (`workspace/`, `verdicts/` — non-empty per mission's G2 rule).
 *
 * Stage states are named `stage-<n>` by the stage's position in the manifest
 * (stage1 → `stage-1`), submission files are `<stageId>.json` / `<stageId>.md`
 * (the prompt names the stage), and schema paths are emitted relative to the
 * template's own location — the orchestrator writes the generated template
 * into the dataset's `plans/` directory, where `../schemas/…` resolves the
 * same way it does for the hand-written `templates/bench-v1.json`.
 * @module @khorsheed/dsh-eval
 */
import { loadManifest, schemaFileName, type SuiteManifest } from './manifest.ts'

/** One mission batch entry of a generated template (mission's TemplateMission shape). */
export interface TemplateMissionDoc {
  id: string
  title?: string
  labels?: Record<string, string>
}

/** One guard of a generated transition (mission's Guard shape, subset used here). */
export type TemplateGuardDoc =
  | { type: 'file-check'; dir: string; expectedFiles: string[] }
  | { type: 'schema-check'; schemaPath: string; inputFrom?: 'run-meta' }

/** One transition of a generated template. */
export interface TemplateTransitionDoc {
  from: string
  to: string
  guard?: TemplateGuardDoc
}

/** A generated run-template document (mission's RunTemplate shape). */
export interface GeneratedTemplate {
  name?: string
  states: string[]
  transitions: TemplateTransitionDoc[]
  releasableStates: string[]
  missions?: TemplateMissionDoc[]
}

/** Options of {@link generateTemplate}. */
export interface GenerateTemplateOptions {
  /**
   * The stage ids to include, in plan order (a plan names a subset of the
   * manifest's stages). Default: every manifest stage, in manifest order.
   */
  stages?: readonly string[]
  /** The cell batch to embed as the template's missions (e.g. from expandMatrix). */
  missions?: readonly TemplateMissionDoc[]
  /** Template name (e.g. `bench-v1`); omitted when absent. */
  name?: string
  /** Directory prefix for schema paths, relative to the template's own location. Default `../schemas`. */
  schemaPathPrefix?: string
}

/** The file-check the archive gate carries into `releasable`. */
export const ARCHIVE_FILE_CHECK: TemplateGuardDoc = {
  type: 'file-check',
  dir: 'archive',
  expectedFiles: ['workspace/', 'verdicts/'],
}

/**
 * Derive the template state name of a manifest stage: `stage-<n>` with n the
 * stage's 1-based position in the manifest's stage list.
 */
export function stageStateName(manifest: SuiteManifest, stageId: string): string {
  const position = manifest.stages.findIndex(stage => stage.id === stageId)
  if (position < 0) {
    throw new Error(`eval: stage ${JSON.stringify(stageId)} is not declared by the manifest`)
  }
  return `stage-${position + 1}`
}

/**
 * Generate a run template from a dataset-suite manifest. Pure with respect to
 * everything but the manifest file itself: no schema files are probed (that
 * is mission lint's job at runCreate time, with the template's own directory
 * as the resolution base).
 * @param manifestPath - path to the dataset-set `manifest.yml`.
 * @param options - stage subset, mission batch, name, schema-path prefix.
 * @returns the template document.
 * @throws when the manifest is unreadable/invalid, a requested stage is not
 *   declared, a requested stage's structured schema is not a file reference,
 *   or a stage id is declared twice in the selection.
 */
export async function generateTemplate(manifestPath: string, options: GenerateTemplateOptions = {}): Promise<GeneratedTemplate> {
  const { manifest } = await loadManifest(manifestPath)
  return generateTemplateFromManifest(manifest, options)
}

/**
 * Generate a run template from an already-loaded manifest (the manifest-aware
 * core of {@link generateTemplate}).
 */
export function generateTemplateFromManifest(manifest: SuiteManifest, options: GenerateTemplateOptions = {}): GeneratedTemplate {
  const prefix = options.schemaPathPrefix ?? '../schemas'
  const requested = options.stages ?? manifest.stages.map(stage => stage.id)

  const selected: Array<{ id: string; state: string }> = []
  const seenStages = new Set<string>()
  for (const stageId of requested) {
    if (seenStages.has(stageId)) {
      throw new Error(`eval: stage ${JSON.stringify(stageId)} is selected more than once`)
    }
    seenStages.add(stageId)
    selected.push({ id: stageId, state: stageStateName(manifest, stageId) })
  }
  if (selected.length === 0) {
    throw new Error('eval: generateTemplate needs at least one stage')
  }

  const schemaPathOf = (fileName: string): string => `${prefix}/${fileName}`

  // The stage-exit schema: the manifest's file reference for the stage's
  // structured output. An inline draft notation (retired by protocol §6.6)
  // has no file to point a guard at and is refused.
  const stageSchemaPath = (stageId: string): string => {
    const entry = manifest.outputSchema[stageId]
    const reference = entry?.structured
    if (typeof reference !== 'string' || reference === '') {
      throw new Error(
        `eval: stage ${JSON.stringify(stageId)} has no structured schema file reference in the manifest`
          + ` (output_schema.${stageId}.structured must name schemas/<stage>.json — protocol §6.6)`,
      )
    }
    return schemaPathOf(schemaFileName(reference))
  }

  const haltStages = selected.filter(entry => manifest.stages.find(stage => stage.id === entry.id)?.halt_on !== undefined)

  const transitions: TemplateTransitionDoc[] = []
  // The earliest transition pins the run meta (datasetId, commit) — the
  // snapshot comparability the archive gate's file-check complements.
  transitions.push({
    from: 'pending',
    to: 'ws-ready',
    guard: { type: 'schema-check', schemaPath: schemaPathOf('run-meta.json'), inputFrom: 'run-meta' },
  })
  // Entering the first stage is unguarded; each stage's schema-check gates
  // its EXIT (the next stage's entry or judged), exactly like bench-v1.
  transitions.push({ from: 'ws-ready', to: selected[0]!.state })
  for (let i = 0; i < selected.length; i++) {
    const entry = selected[i] as { id: string; state: string }
    const next = selected[i + 1]
    if (next !== undefined) {
      transitions.push({ from: entry.state, to: next.state, guard: { type: 'schema-check', schemaPath: stageSchemaPath(entry.id) } })
    } else {
      transitions.push({ from: entry.state, to: 'judged', guard: { type: 'schema-check', schemaPath: stageSchemaPath(entry.id) } })
    }
  }
  transitions.push({ from: 'judged', to: 'archived' })
  if (haltStages.length > 0) transitions.push({ from: 'halted', to: 'archived' })
  transitions.push({ from: 'archived', to: 'releasable', guard: ARCHIVE_FILE_CHECK })
  transitions.push({ from: 'releasable', to: 'released' })
  // Halt edges last — the divert path of a stage whose halt_on fired. The
  // halted schema file is a naming convention (`<stageId>-halted.json`,
  // carrying the const check, e.g. `feasible: const false`); the manifest's
  // output_schema does not declare it, so no output_schema lookup here.
  for (const entry of haltStages) {
    transitions.push({
      from: entry.state,
      to: 'halted',
      guard: { type: 'schema-check', schemaPath: schemaPathOf(`${entry.id}-halted.json`) },
    })
  }

  const states = ['pending', 'ws-ready', ...selected.map(entry => entry.state), 'judged']
  if (haltStages.length > 0) states.push('halted')
  states.push('archived', 'releasable', 'released')

  const template: GeneratedTemplate = { states, transitions, releasableStates: ['releasable'] }
  if (options.name !== undefined) template.name = options.name
  if (options.missions !== undefined && options.missions.length > 0) template.missions = [...options.missions]
  return template
}
