/**
 * The dataset-suite manifest (`datasets/<id>/manifest.yml`): the stage list a
 * run template is generated from, plus the per-stage output-schema references.
 * Only the shapes the template generator and the run loop consume are typed;
 * everything else in the document is passthrough.
 *
 * Per protocol §6.6 the per-stage structured schema is AUTHORITATIVE as a
 * file reference (`schemas/<stage>.json`); an inline `structured` object is
 * the retired draft notation and is refused where a schema file is required.
 * @module @khorsheed/dsh-eval
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import yaml from 'js-yaml'

/** One stage declaration of the suite manifest. */
export interface ManifestStage {
  /** Stage id — the prompts/ file stem and the output_schema key. */
  id: string
  name?: string
  /** `parallel` | `exclusive` — advisory for the orchestrator's pool, not a guard. */
  concurrency?: string
  time_limit_min?: number
  /** The halt condition: a submission field that must equal this value to divert to `halted`. */
  halt_on?: { field: string; equals: unknown }
}

/** One stage's output_schema entry. Only the file-reference form gates submissions. */
export interface ManifestOutputSchema {
  /** Path of the structured schema file, relative to the dataset root (`schemas/<stage>.json`). */
  structured?: string
  narrative?: { file?: string }
}

/** The parsed suite manifest. */
export interface SuiteManifest {
  suiteId?: string
  /** Declared stages, in suite order (the template's `stage-<n>` states derive from this order). */
  stages: ManifestStage[]
  /** output_schema entries keyed by stage id. */
  outputSchema: Record<string, ManifestOutputSchema>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse and validate the manifest subset the orchestrator consumes.
 * @param raw - the parsed YAML document.
 * @param origin - where the document came from, for error messages.
 * @returns the manifest view.
 * @throws listing every problem found.
 */
export function parseSuiteManifest(raw: unknown, origin: string): SuiteManifest {
  const problems: string[] = []
  if (!isPlainObject(raw)) throw new Error(`eval: manifest ${origin} must be a mapping`)

  const suiteId = typeof raw['suite_id'] === 'string' ? raw['suite_id'] : undefined

  const stagesRaw = raw['stages']
  if (!Array.isArray(stagesRaw) || stagesRaw.length === 0) {
    throw new Error(`eval: manifest ${origin}: stages must be a non-empty list`)
  }
  const stages: ManifestStage[] = []
  const seen = new Set<string>()
  stagesRaw.forEach((entry, i) => {
    if (!isPlainObject(entry) || typeof entry['id'] !== 'string' || entry['id'] === '') {
      problems.push(`stages[${i}]: needs a non-empty string id`)
      return
    }
    const id = entry['id']
    if (seen.has(id)) problems.push(`stages[${i}]: duplicate stage id ${JSON.stringify(id)}`)
    seen.add(id)
    const stage: ManifestStage = { id }
    if (typeof entry['name'] === 'string') stage.name = entry['name']
    if (typeof entry['concurrency'] === 'string') stage.concurrency = entry['concurrency']
    if (typeof entry['time_limit_min'] === 'number') stage.time_limit_min = entry['time_limit_min']
    const haltOn = entry['halt_on']
    if (haltOn !== undefined) {
      if (!isPlainObject(haltOn) || typeof haltOn['field'] !== 'string' || haltOn['field'] === '') {
        problems.push(`stages[${i}] (${id}): halt_on needs a non-empty string field`)
      } else if (!('equals' in haltOn)) {
        problems.push(`stages[${i}] (${id}): halt_on needs an equals value`)
      } else {
        stage.halt_on = { field: haltOn['field'], equals: haltOn['equals'] }
      }
    }
    stages.push(stage)
  })

  const outputSchema: Record<string, ManifestOutputSchema> = {}
  const schemaRaw = raw['output_schema']
  if (schemaRaw !== undefined) {
    if (!isPlainObject(schemaRaw)) {
      problems.push('output_schema: must be a mapping keyed by stage id')
    } else {
      for (const [id, entry] of Object.entries(schemaRaw)) {
        if (!isPlainObject(entry)) {
          problems.push(`output_schema.${id}: must be a mapping`)
          continue
        }
        const record: ManifestOutputSchema = {}
        const structured = entry['structured']
        if (typeof structured === 'string') record.structured = structured
        // An inline `structured` object is the retired draft notation
        // (protocol §6.6): left ABSENT — generation for such a stage reports
        // the missing file reference instead of guessing.
        const narrative = entry['narrative']
        if (isPlainObject(narrative) && typeof narrative['file'] === 'string') {
          record.narrative = { file: narrative['file'] }
        }
        outputSchema[id] = record
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`eval: invalid manifest ${origin}:\n${problems.map(p => `  - ${p}`).join('\n')}`)
  }
  const manifest: SuiteManifest = { stages, outputSchema }
  if (suiteId !== undefined) manifest.suiteId = suiteId
  return manifest
}

/** A loaded manifest plus the directory it came from. */
export interface LoadedManifest {
  manifest: SuiteManifest
  /** The manifest's directory (the dataset-set root the schema refs resolve against). */
  dir: string
}

/**
 * Load and parse a suite manifest (`datasets/<id>/manifest.yml`).
 * @param manifestPath - path to the manifest file.
 * @returns the parsed manifest and its directory.
 * @throws on unreadable files, malformed YAML, or subset violations.
 */
export async function loadManifest(manifestPath: string): Promise<LoadedManifest> {
  let text: string
  try {
    text = await readFile(manifestPath, 'utf8')
  } catch (error) {
    throw new Error(`eval: cannot read manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let raw: unknown
  try {
    raw = yaml.load(text)
  } catch (error) {
    throw new Error(`eval: manifest ${manifestPath} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { manifest: parseSuiteManifest(raw, manifestPath), dir: dirname(manifestPath) }
}

/**
 * The schema FILE NAME a manifest reference points at (`schemas/stage1.json`
 * → `stage1.json`). Template guards carry `../schemas/<name>` so a template
 * written beside the manifest's owner (in `plans/` or `templates/`) resolves.
 */
export function schemaFileName(reference: string): string {
  return basename(reference)
}
