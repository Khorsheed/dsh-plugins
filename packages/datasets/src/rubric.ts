/**
 * Judgeability: can this item be judged at all, before anything runs?
 *
 * A rubric that declares axes but no leaf criteria passes every shape check
 * this plugin had — and then every judgement source comes up empty, because
 * all three of them (probes, an LLM judge, the human bench) read LEAVES.
 * The cell records `judge-skipped`, its verdicts stay empty, and it never
 * clears the archive gate. That is a fact about the ITEM, knowable from the
 * repository alone, so it belongs to a mechanical pre-run check rather than
 * to a run that discovers it one cell at a time.
 *
 * Scope — everything checked here is knowable from the dataset:
 * - the rubric has leaves, and each leaf carries the fields a judgement
 *   source needs to act on it;
 * - a leaf's polarity is stated once and consistently (`negative: true` and a
 *   negative `weight` are the same statement, so they may not disagree);
 * - a `kind: objective` leaf has an executable probe to produce its verdict.
 *
 * What is NOT knowable here: whether a run's plan actually supplies a judge
 * for the `llm-draft` leaves (a `judge` block belongs to the plan, not the
 * item) and whether the plan's expected namespaces match the item's sources.
 * That cross-check is `dsh-eval validate`'s; this side stops at the dataset.
 *
 * Layer names: `grading` (where the rubric lives) and `verify` (where probes
 * live) are the judging convention of the authoring protocol §6.7/§6.8, and
 * the orchestrator mounts exactly those two names. They are spelled here the
 * same way, and the whole check is opt-in on finding a rubric in a `grading`
 * layer — a dataset without that layout is never touched.
 *
 * Like the canary check, this reads file CONTENT, so it runs on the
 * `validate` path only and never on the `list`/`show` summary.
 */
import yaml from 'js-yaml'
import {
  datasetDir, itemDir, registeredFiles,
  type DatasetRegistry, type DescriptorWarning, type ItemRecord,
} from './dataset.ts'
import { showFile } from './git.ts'
import { GRADING_LAYER, VERIFY_LAYER } from './slots.ts'

// The two judging layer names live in `./slots.ts` — the browser half labels
// its tree with them and must not pull this module's yaml/git dependencies in.
// Re-exported here because this is where every consumer already looks for them.
export { GRADING_LAYER, VERIFY_LAYER }

/**
 * The three judgement sources a leaf may be routed to: `objective` → a probe
 * writes the verdict, `llm-draft` → a blind LLM judge does, `human` → the
 * judge bench does. A fourth value routes nowhere, so nothing would ever
 * produce that leaf's verdict.
 */
export const RUBRIC_KINDS: readonly string[] = ['objective', 'llm-draft', 'human']

/**
 * Fields every leaf must carry. `id` names the verdict, `axis` files it,
 * `weight` scores it, `kind` routes it to a source, `criterion` is what gets
 * judged, and `evidence` says where to look — a leaf missing any of them
 * cannot be acted on by whichever source it was routed to.
 */
export const RUBRIC_LEAF_FIELDS: readonly string[] = ['id', 'axis', 'weight', 'kind', 'criterion', 'evidence']

/** Stable, greppable codes for the judgeability errors. */
export type RubricErrorCode =
  | 'RUBRIC_UNREADABLE'
  | 'RUBRIC_NO_ITEMS'
  | 'RUBRIC_FIELD_MISSING'
  | 'RUBRIC_KIND_INVALID'
  | 'RUBRIC_POLARITY'

/** One judgeability error — structurally the `ValidateError` the service reports. */
export interface RubricError {
  code: RubricErrorCode
  message: string
}

/** What one rubric document yielded: its errors, plus what the other rules need from it. */
export interface RubricCheck {
  errors: RubricError[]
  /**
   * Whether the document yielded a leaf list at all. False means the two
   * downstream rules (probe source, `rubric.md` cross-reference) are skipped:
   * with no leaves, every reference is trivially dangling and the noise would
   * bury the one error that matters.
   */
  parsed: boolean
  /** Leaf ids that parsed, in document order. */
  ids: string[]
  /** The `kind` values present among the leaves. */
  kinds: Set<string>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Whether one leaf field is present in the form its consumers need. */
function hasLeafField(row: Record<string, unknown>, field: string): boolean {
  const value = row[field]
  if (field === 'weight') return typeof value === 'number' && Number.isFinite(value)
  return nonEmptyString(value) !== undefined
}

/**
 * Pick the rubric among an item's `grading` layer display paths: a file named
 * `rubric.yml` / `rubric.yaml`, shortest path first so a nested variant never
 * shadows the canonical one. Both dataset layouts are covered — the
 * convention form (`rubric.yml`) and the register form (`answers/rubric.yml`).
 * This is the same selection rule the orchestrator applies when it assembles
 * a judge prompt; the two must agree or the check would validate a file the
 * run never reads.
 * @param gradingPaths - display paths of the item's grading layer.
 * @returns the chosen display path, or undefined when the item ships no rubric.
 */
export function pickRubricPath(gradingPaths: readonly string[]): string | undefined {
  return [...gradingPaths]
    .filter(path => /(?:^|\/)rubric\.ya?ml$/i.test(path))
    .sort((left, right) => left.length - right.length || (left < right ? -1 : 1))[0]
}

/**
 * The executable probes among an item's `verify` layer display paths: a
 * `.mjs` or `.sh` file under any `probes/` segment (authoring protocol §6.7).
 * Both layouts again: `probes/x.mjs` and a re-homed `checks/probes/x.sh`.
 * @param verifyPaths - display paths of the item's verify layer.
 * @returns the probe display paths, sorted.
 */
export function probePaths(verifyPaths: readonly string[]): string[] {
  return [...verifyPaths]
    .filter(path => /(?:^|\/)probes\/[^/]+\.(?:mjs|sh)$/i.test(path))
    .sort((left, right) => (left < right ? -1 : 1))
}

/**
 * Leaf-id-shaped tokens in a rubric's prose companion: `A1-1`, `A-N1`,
 * `B2-3`. The shape is deliberately loose and the rule that uses it only
 * warns — prose is prose, and a token that merely looks like an id (a
 * standard's number, a table label) is a false positive an author dismisses
 * in a second, while a stale reference to a leaf that no longer exists is a
 * rubric whose narrative and whose structure have drifted apart.
 * @param markdown - the companion document's text.
 * @returns the distinct id-shaped tokens, sorted.
 */
export function referencedLeafIds(markdown: string): string[] {
  const matches = markdown.match(/(?<![0-9A-Za-z])[A-Z][0-9]?-N?[0-9]+(?![0-9A-Za-z-])/g) ?? []
  return [...new Set(matches)].sort()
}

/**
 * Check one rubric document's leaves.
 * @param text - the rubric YAML.
 * @param origin - the dataset-relative path, for the messages.
 * @returns the errors plus what the file-level rules need.
 */
export function checkRubric(text: string, origin: string): RubricCheck {
  const empty = { parsed: false, ids: [], kinds: new Set<string>() }
  let doc: unknown
  try {
    doc = yaml.load(text)
  } catch (error) {
    return {
      ...empty,
      errors: [{
        code: 'RUBRIC_UNREADABLE',
        message: `${origin}: not a readable YAML document — ${String(error)}`,
      }],
    }
  }
  const rows: unknown[] = isPlainObject(doc) && Array.isArray(doc['items']) ? doc['items'] : []
  if (rows.length === 0) {
    return {
      ...empty,
      errors: [{
        code: 'RUBRIC_NO_ITEMS',
        message: `${origin}: declares no leaf criteria (\`items\` is missing or empty). Axes alone cannot be `
          + 'judged — every judgement source (probe, LLM judge, human bench) reads leaves, so every cell of '
          + 'this item records judge-skipped, its verdicts stay empty, and it never clears the archive gate',
      }],
    }
  }
  const errors: RubricError[] = []
  const ids: string[] = []
  const kinds = new Set<string>()
  for (const [index, raw] of rows.entries()) {
    const position = `leaf #${index + 1}`
    if (!isPlainObject(raw)) {
      errors.push({
        code: 'RUBRIC_FIELD_MISSING',
        message: `${origin} ${position}: not a mapping — a leaf is a mapping of ${RUBRIC_LEAF_FIELDS.join(' / ')}`,
      })
      continue
    }
    const id = nonEmptyString(raw['id'])
    const where = `${origin} ${id === undefined ? position : `leaf ${id}`}`
    if (id !== undefined) ids.push(id)
    const missing = RUBRIC_LEAF_FIELDS.filter(field => !hasLeafField(raw, field))
    if (missing.length > 0) {
      errors.push({
        code: 'RUBRIC_FIELD_MISSING',
        message: `${where}: missing ${missing.join(', ')} `
          + '(id names the verdict, axis files it, weight scores it, kind routes it to a judgement source, '
          + 'criterion is what gets judged, evidence says where to look; weight is a number, the rest non-empty strings)',
      })
    }
    const kind = nonEmptyString(raw['kind'])
    if (kind !== undefined) {
      if (RUBRIC_KINDS.includes(kind)) kinds.add(kind)
      else {
        errors.push({
          code: 'RUBRIC_KIND_INVALID',
          message: `${where}: kind ${JSON.stringify(kind)} routes to no judgement source — `
            + `use one of ${RUBRIC_KINDS.join(' / ')}`,
        })
      }
    }
    const weight = raw['weight']
    if (typeof weight === 'number' && Number.isFinite(weight)) {
      const negative = raw['negative'] === true
      if (negative && weight >= 0) {
        errors.push({
          code: 'RUBRIC_POLARITY',
          message: `${where}: negative: true but weight is ${weight} — polarity is stated once; `
            + 'a negative leaf carries a negative weight',
        })
      } else if (!negative && weight < 0) {
        errors.push({
          code: 'RUBRIC_POLARITY',
          message: `${where}: weight is ${weight} but negative: true is absent — polarity is stated once; `
            + 'a negative weight IS the negative marking, and a verdict source never re-reads the sign',
        })
      }
    }
  }
  return { errors, parsed: true, ids, kinds }
}

/** The repo-relative git object path of one display path in one item layer. */
function objectPathOf(
  datasetId: string,
  itemId: string,
  layer: string,
  display: string,
  registry: DatasetRegistry,
): string {
  const registered = registeredFiles(registry, itemId, layer)?.find(file => file.display === display)
  return registered?.object ?? `${itemDir(datasetId, itemId)}/${layer}/${display}`
}

/**
 * Check one item's judgeability at a commit. Opt-in: an item whose `grading`
 * layer carries no rubric is not checked at all, so a dataset outside the
 * judging convention reports exactly what it did before.
 * @param repo - repository path.
 * @param commit - commit to read from.
 * @param datasetId - the dataset id.
 * @param item - the item record (its layer maps carry the display paths).
 * @param registry - the register role map at this commit.
 * @returns the errors and warnings this item contributes.
 */
export async function judgeabilityIssues(
  repo: string,
  commit: string,
  datasetId: string,
  item: ItemRecord,
  registry: DatasetRegistry,
): Promise<{ errors: RubricError[]; warnings: DescriptorWarning[] }> {
  const grading = item.layers[GRADING_LAYER] ?? []
  const rubricDisplay = pickRubricPath(grading)
  if (rubricDisplay === undefined) return { errors: [], warnings: [] }
  const base = `${datasetDir(datasetId)}/`
  const rubricObject = objectPathOf(datasetId, item.id, GRADING_LAYER, rubricDisplay, registry)
  const rubricRel = rubricObject.slice(base.length)
  const text = await showFile(repo, commit, rubricObject)
  if (text === undefined) {
    return {
      errors: [{ code: 'RUBRIC_UNREADABLE', message: `${rubricRel}: cannot be read at ${commit.slice(0, 12)}` }],
      warnings: [],
    }
  }
  const check = checkRubric(text, rubricRel)
  const warnings: DescriptorWarning[] = []
  if (check.parsed) {
    // An objective leaf's verdict is written by a probe and by nothing else.
    // No probe means that leaf is judged by nobody — the same silent gap the
    // leafless rubric produces, one kind at a time.
    if (check.kinds.has('objective') && probePaths(item.layers[VERIFY_LAYER] ?? []).length === 0) {
      warnings.push({
        code: 'OBJECTIVE_NO_PROBE',
        item: item.id,
        file: rubricRel,
        message: `item ${JSON.stringify(item.id)} has kind: objective leaves but its ${VERIFY_LAYER} layer carries `
          + 'no executable probe (a .mjs or .sh file under a probes/ segment) — a probe is the only writer of '
          + 'an objective verdict, so those leaves are judged by nobody',
      })
    }
    // The rubric's prose companion and its structured leaves must name the
    // same criteria: a reference to a leaf that does not exist is the exact
    // drift that leaves a run with a narrative nobody can score against.
    const mdDisplay = rubricDisplay.replace(/rubric\.ya?ml$/i, 'rubric.md')
    if (grading.includes(mdDisplay)) {
      const mdObject = objectPathOf(datasetId, item.id, GRADING_LAYER, mdDisplay, registry)
      const markdown = await showFile(repo, commit, mdObject)
      if (markdown !== undefined) {
        const declared = new Set(check.ids)
        const mdRel = mdObject.slice(base.length)
        for (const reference of referencedLeafIds(markdown)) {
          if (declared.has(reference)) continue
          warnings.push({
            code: 'RUBRIC_REF_DANGLING',
            item: item.id,
            file: mdRel,
            message: `${mdRel} refers to leaf ${JSON.stringify(reference)}, which ${rubricRel} does not declare `
              + '(the id shape is matched loosely, so a label that merely looks like a leaf id is a false '
              + 'positive — a stale reference is not)',
          })
        }
      }
    }
  }
  return { errors: check.errors, warnings }
}
