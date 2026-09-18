/**
 * DRAFTING an experiment — step 2 of the eight-step flow (ui-spec §七), and
 * the one verb behind all three of its faces.
 *
 * Before this module the step took two different shapes depending on who was
 * taking it. An agent wrote `plans/<name>.json` with the `write` tool, wrote
 * each new condition the same way, then called `eval_plan_validate` and hoped
 * it had spelled the contract right; a person had no shape at all, because the
 * 新建实验 button was a placeholder. Both are now one function — the form's
 * Remote verb, the `eval_plan_draft` tool and the `eval-planning` skill all
 * land here — so a draft a person makes and a draft an agent makes are the
 * same file written by the same code, and the lab list cannot tell them apart.
 *
 * What it does NOT do is start anything. Drafting writes two kinds of file
 * into the bound dataset repository's pass-through area (`plans/` and
 * `conditions/`, the 其他文件 slot of ui-spec §三), validates what it wrote,
 * and stops. Nothing is committed — the working copy is where a draft lives
 * until a person commits it — and nothing is approved: 批准并启动 is the
 * plan-review page's button and R1 keeps it there.
 *
 * A new condition is a COPY, never an invention. `from` names a declaration
 * that already exists and the edit changes the seven fields ui-spec §五 lists
 * (harness, model, endpoint, scope, preset, permissions, reasoning effort);
 * everything else is carried over byte for byte. That is the discipline the
 * whole comparison rests on — an experiment is worth running when its
 * conditions differ in ONE field, and a condition written from scratch differs
 * in however many its author forgot to think about.
 *
 * `model.endpoint` is the seventh since I5·T58. It is a field the readiness
 * gate REFUSES a condition for leaving null, so a draft that could not set it
 * produced a plan nobody could run without opening the two JSON files in an
 * editor — and the two had to agree, or the experiment silently grew a second
 * factor (I5·T39 · G6).
 *
 * Two things the copy fills in that nobody named: `home.sha` is nulled (below),
 * and on a plan that declares a container unit the condition's own `unit`
 * segment is completed from {@link defaultConditionUnit} when the source has
 * none. A source written before the container path has no segment to copy and
 * the edit cannot express one, which left the container path unreachable from
 * a draft at all (I5·T39 · G4).
 * @module @khorsheed/dsh-eval
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { CONDITION_ID_RE, PLAN_SCHEMA_ID } from './schema.ts'
import { conditionUnitOf, defaultConditionUnit } from './unit.ts'

/**
 * Thrown when a draft cannot be written at all: an unresolvable repository, a
 * name that is not a file name, a source condition that does not exist, a
 * target file that does.
 *
 * Deliberately NOT the class of refusal a contract violation gets. A plan
 * whose conditions do not resolve is still a draft — it lands on disk, the
 * list shows it as 草稿, and validate says why. This error is for the cases
 * where there would be no draft to look at.
 */
export class EvalDraftRefused extends Error {}

/** The six condition fields a minted copy may change (ui-spec §五). */
export interface DraftConditionEdit {
  /** The new condition's id; it doubles as the file name (`conditions/<id>.json`). */
  id: string
  /** The existing condition to copy, by id, in the same dataset set. */
  from: string
  /** `harness.name`. Changing it nulls `harness.version` — that version was another CLI's. */
  harness?: string
  /** `model.declared`; null says "not resolved yet", which is a legal declaration. */
  model?: string | null
  /**
   * `model.endpoint` — the upstream route (frozen decision 5). `"default"`
   * means the harness's own endpoint with no base URL in force; any other
   * value is compared against the scope's endpoint hostname at provision time.
   * null says "not resolved yet", which the readiness gate refuses.
   */
  endpoint?: string | null
  /** The named scoped home, or null for the harness's default one. */
  scope?: string | null
  /** The agent-preset roster, or null for none. */
  preset?: string | null
  /** The harness's permission word (each harness accepts its own subset). */
  permissions?: string
  /** `reasoning.effort`. */
  reasoning?: string
}

/** The container segment a drafted plan may declare. */
export interface DraftUnit {
  image: string
  network?: string
  user?: string
  egressCheck?: { command: readonly string[]; timeoutMs?: number }
}

/** Everything a draft needs. The repository is already resolved by the caller. */
export interface DraftExperimentInput {
  /** The dataset repository working copy to write into (absolute). */
  repo: string
  /** The dataset set; `<repo>/datasets/<dataset>/` must exist. */
  dataset: string
  /** The experiment name — the plan's file stem. */
  name: string
  /** The commit to pin, or null/absent to let the run's snapshot pin it. */
  commit?: string | null
  /** The dataset items the matrix runs over. */
  items: readonly string[]
  /** Player condition ids; minted conditions are appended when not already named. */
  conditions: readonly string[]
  /** Conditions to mint, each a copy of an existing declaration. */
  newConditions?: readonly DraftConditionEdit[]
  /** The judge conditions and how many samples each cell draws; absent writes no judge. */
  judge?: { conditions: readonly string[]; samples?: number }
  /** Independent samples per cell. */
  reps: number
  /** Stage names, each backed by `schemas/<stage>.json`. */
  stages: readonly string[]
  /** The execution order; the seed is recorded with the run (frozen decision 11). */
  order: { seed: number; interleave?: boolean }
  /** Per-cell budget in active minutes and delegation turns. */
  budget: { activeMinutes: number; turns: number }
  /** Verdict sources the run expects; absent writes the usual three. */
  expectedNs?: readonly string[]
  /** Per-cell infrastructure-retry budget; absent leaves the default. */
  retryInfrastructure?: number
  /** The container segment; absent takes the host path. */
  unit?: DraftUnit
  /** Bundle export directory; absent takes the repository's own `exports/`. */
  exports?: string
  /** Review commentary written into the plan verbatim. */
  notes?: string
}

/** What was written, and where. */
export interface DraftWrite {
  /** The dataset repository written into (absolute). */
  repo: string
  dataset: string
  /** The plan document (absolute). */
  planPath: string
  /** The condition declarations minted, in mint order (absolute). */
  conditionPaths: string[]
  /** The plan's player condition ids as written, minted ones included. */
  conditions: string[]
  /** The plan's judge condition ids as written; empty when it declares no judge. */
  judges: string[]
}

/**
 * The verdict sources a plan expects when the caller names none — and it
 * depends on whether the plan has a judge, because `expectedNs` is a CLAIM
 * about what this run can produce and validate treats a false one as an error
 * (`JUDGE_REQUIRED_FOR_LLM_DRAFT`). A run with no judge cannot produce
 * `llm-draft` verdicts, so the default does not say it will; `human-final`
 * stays either way, since a person can always grade at the judge bench.
 *
 * Every hand-written plan in the dataset repository declares all three and
 * carries an EMPTY judge block to keep validate quiet, which is the same claim
 * with the check switched off. Drafts do not do that — a default that lies and
 * then suppresses the complaint is worse than one that is briefly surprising.
 */
const DEFAULT_EXPECTED_NS: readonly string[] = ['script', 'human-final']

/** With a judge declared, the llm-draft source is real and the plan says so. */
const DEFAULT_EXPECTED_NS_JUDGED: readonly string[] = ['script', 'llm-draft', 'human-final']

/**
 * A generated run template is written beside its plan as
 * `<plan>.template.json`, and the lab list skips exactly that suffix — so a
 * plan whose own stem ends in `.template` would land on disk and never appear
 * anywhere. Refused rather than silently renamed.
 */
const TEMPLATE_STEM = /\.template$/i

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Write a path back in `~`-relative form when it is under this user's home.
 * The plans in a dataset repository are committed and read on other machines,
 * and every hand-written one pins its repository that way; a drafted plan that
 * hard-coded an absolute home path would be the odd one out in its own
 * directory.
 */
function contractHome(path: string): string {
  const home = homedir()
  if (path === home) return '~'
  return path.startsWith(home + sep) ? `~/${path.slice(home.length + 1)}` : path
}

/** Read one JSON document, or refuse naming the file and what was wrong with it. */
async function readJsonOrRefuse(path: string, what: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new EvalDraftRefused(`${what}: ${path} cannot be read`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new EvalDraftRefused(`${what}: ${path} is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  if (!isPlainObject(parsed)) throw new EvalDraftRefused(`${what}: ${path} is not a JSON object`)
  return parsed
}

/**
 * Write a JSON document that must not already exist. `wx` makes the check and
 * the write one operation: a draft never overwrites a plan somebody approved
 * or a condition somebody locked, and it cannot lose a race to another drafter
 * either.
 */
async function writeNewJson(path: string, document: unknown, what: string): Promise<void> {
  try {
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new EvalDraftRefused(
        `${what} already exists: ${path} — drafting never overwrites (a plan may be approved, a condition may be locked). `
        + 'Pick another name, or have the person delete that file first.',
      )
    }
    throw error
  }
}

/** Every dataset item id the set declares — the directories under `items/`. */
async function itemIdsOf(datasetRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(join(datasetRoot, 'items'), { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  } catch {
    return []
  }
}

/**
 * Apply one edit to a copied declaration.
 *
 * Three fields move without being named, and each is a correction rather than
 * an extra edit:
 * - `home.sha` is always nulled. It hashes the scoped home the ORIGINAL runs
 *   against; a copy that changed any of the six fields needs a different home,
 *   and carrying the old hash would claim a provision that never happened.
 * - `harness.version` is nulled when the harness name changed, for the same
 *   reason: that version is the other CLI's.
 * - `notes` is replaced by a provenance line. The original's commentary is
 *   about the original, and `notes` is excluded from the condition hash, so
 *   rewriting it changes no subject's identity.
 *
 * A fourth moves only on a plan that declares a container unit: the condition's
 * `unit.scopedHome` and the `env.keys` entry naming it, completed from
 * {@link defaultConditionUnit} when the source declares none. It is NOT counted
 * among the changed fields — it is the copy being made runnable where the plan
 * puts it, not a factor the author chose, and counting it would let a copy that
 * names no edit pass the "changes nothing" refusal below.
 * @param source - the declaration being copied.
 * @param edit - the fields to change.
 * @param planName - the drafting plan, for the provenance line.
 * @param containerPlan - whether the plan declares a `unit` segment.
 * @returns the minted document and the dotted paths the edit actually changed.
 */
function mintCondition(
  source: Record<string, unknown>,
  edit: DraftConditionEdit,
  planName: string,
  containerPlan: boolean,
): { document: Record<string, unknown>; changed: string[]; unitFilled: string | null } {
  const document = structuredClone(source)
  const changed: string[] = []
  const harness = isPlainObject(document['harness']) ? { ...document['harness'] } : {}
  const model = isPlainObject(document['model']) ? { ...document['model'] } : {}
  const reasoning = isPlainObject(document['reasoning']) ? { ...document['reasoning'] } : {}

  if (edit.harness !== undefined && edit.harness !== harness['name']) {
    harness['name'] = edit.harness
    harness['version'] = null
    changed.push('harness.name')
  }
  if (edit.model !== undefined && edit.model !== model['declared']) {
    model['declared'] = edit.model
    changed.push('model.declared')
  }
  if (edit.endpoint !== undefined && edit.endpoint !== (model['endpoint'] ?? null)) {
    model['endpoint'] = edit.endpoint
    changed.push('model.endpoint')
  }
  if (edit.reasoning !== undefined && edit.reasoning !== reasoning['effort']) {
    reasoning['effort'] = edit.reasoning
    changed.push('reasoning.effort')
  }
  if (edit.permissions !== undefined && edit.permissions !== document['permissions']) {
    document['permissions'] = edit.permissions
    changed.push('permissions')
  }
  if (edit.preset !== undefined && edit.preset !== (document['preset'] ?? null)) {
    document['preset'] = edit.preset
    changed.push('preset')
  }
  if (edit.scope !== undefined) {
    // `scope` absent and `scope: null` are the same declaration (the harness's
    // default scoped home), so clearing it REMOVES the key rather than writing
    // a null the contract has no slot for.
    const current = typeof document['scope'] === 'string' ? document['scope'] : null
    if (edit.scope !== current) {
      if (edit.scope === null) delete document['scope']
      else document['scope'] = edit.scope
      changed.push('scope')
    }
  }
  document['harness'] = harness
  document['model'] = model
  document['reasoning'] = reasoning

  if (changed.length === 0) {
    throw new EvalDraftRefused(
      `condition ${JSON.stringify(edit.id)} copies ${JSON.stringify(edit.from)} and changes nothing — `
      + 'that is the same subject under a second name, and it would double every count keyed by condition id. '
      + 'Name a field to change, or just use the condition you copied.',
    )
  }
  document['home'] = { sha: null }

  // The container completion. `conditionUnitOf` is the same reader the run
  // loop and the contract check use, so "has no usable segment" means here
  // exactly what it means there.
  let unitFilled: string | null = null
  if (containerPlan && conditionUnitOf(document) === null) {
    const fill = defaultConditionUnit(stringOrNull(harness['name']))
    if (fill !== undefined) {
      document['unit'] = fill
      // The variable must also be one `env.keys` admits, or the run would
      // inject a name the reviewed document never declared
      // (UNIT_SCOPED_HOME_VAR_UNDECLARED).
      const env = isPlainObject(document['env']) ? { ...document['env'] } : {}
      const keys = Array.isArray(env['keys']) ? env['keys'].filter((key): key is string => typeof key === 'string') : []
      env['keys'] = keys.includes(fill.scopedHome.var) ? keys : [...keys, fill.scopedHome.var]
      document['env'] = env
      unitFilled = fill.scopedHome.var
    }
  }

  document['notes'] = `Drafted with plan "${planName}": copied from condition "${edit.from}", changing ${changed.join(', ')}. `
    + 'home.sha is null because the scoped home is not provisioned yet — `/eval conditions provision` is a human act '
    + 'and the only writer of a lock.'
    + (unitFilled === null
      ? ''
      : ` The plan runs in a container and "${edit.from}" declares no unit segment, so unit.scopedHome`
        + ` (${JSON.stringify(fillDescription(document))}) and the ${unitFilled} entry in env.keys were completed`
        + ' from this harness\'s default mount — change them if this run mounts credentials somewhere else.')
  return { document, changed, unitFilled }
}

/** The filled segment as one readable phrase for the provenance line. */
function fillDescription(document: Record<string, unknown>): string {
  const decl = conditionUnitOf(document)
  return decl === null ? '' : `${decl.scopedHome.container} as $${decl.scopedHome.var}`
}

/** Refuse anything that cannot be a file stem in `plans/` or `conditions/`. */
function checkName(name: string, what: string): void {
  if (!CONDITION_ID_RE.test(name)) {
    throw new EvalDraftRefused(
      `${what} ${JSON.stringify(name)} is not a usable file name — it doubles as one, so it must start with a letter `
      + 'or digit and hold only letters, digits, dot, dash and underscore.',
    )
  }
}

/**
 * Draft one experiment: mint the new conditions, write the plan, and answer
 * with what landed where. Validation is the CALLER's next call — this function
 * writes, and the same `validatePlan` every other face runs judges what it
 * wrote, so a draft can never be approved by a check of its own.
 * @param input - the form's fields (or the tool's arguments), repository resolved.
 * @returns the paths written and the condition ids the plan names.
 * @throws {@link EvalDraftRefused} when there would be no draft to look at.
 */
export async function draftExperiment(input: DraftExperimentInput): Promise<DraftWrite> {
  const repo = resolve(input.repo)
  const dataset = input.dataset.trim()
  const name = input.name.trim()
  if (dataset === '') throw new EvalDraftRefused('no dataset set named — a plan is drafted into one set of the repository')
  checkName(dataset, 'dataset set')
  if (name === '') throw new EvalDraftRefused('no experiment name — the name is the plan\'s file name')
  checkName(name, 'experiment name')
  if (TEMPLATE_STEM.test(name)) {
    throw new EvalDraftRefused(
      `experiment name ${JSON.stringify(name)} ends in ".template" — a run writes its generated template beside the plan `
      + 'under exactly that suffix, and the lab list skips those, so this plan would never appear anywhere.',
    )
  }
  const datasetRoot = join(repo, 'datasets', dataset)
  try {
    await readdir(datasetRoot)
  } catch {
    throw new EvalDraftRefused(
      `no dataset set ${JSON.stringify(dataset)} in ${repo} — expected ${datasetRoot}. `
      + 'The 题集 tab is where a set is created or imported.',
    )
  }

  const items = input.items.map(item => item.trim()).filter(item => item !== '')
  if (items.length === 0) throw new EvalDraftRefused('no items selected — a matrix with no rows runs nothing')
  const known = await itemIdsOf(datasetRoot)
  // A WARNING's job, not a refusal's — except that nothing downstream warns:
  // validate checks the items against the rubric, not against the tree, and a
  // typo'd item id first surfaces as a cell that materializes nothing. The
  // list of what the set does hold makes the fix obvious.
  const unknown = known.length === 0 ? [] : items.filter(item => !known.includes(item))
  if (unknown.length > 0) {
    throw new EvalDraftRefused(
      `dataset set ${JSON.stringify(dataset)} declares no item(s) ${unknown.map(item => JSON.stringify(item)).join(', ')} `
      + `— it holds: ${known.join(', ')}`,
    )
  }

  if (!Number.isInteger(input.reps) || input.reps < 1) {
    throw new EvalDraftRefused(`reps must be a positive integer, got ${JSON.stringify(input.reps)}`)
  }
  const stages = input.stages.map(stage => stage.trim()).filter(stage => stage !== '')
  if (stages.length === 0) throw new EvalDraftRefused('no stages named — a cell with no stage has nothing to submit')

  // ── mint the new conditions ───────────────────────────────────────────────
  const conditionsDir = join(datasetRoot, 'conditions')
  const minted: string[] = []
  const conditionPaths: string[] = []
  for (const edit of input.newConditions ?? []) {
    const id = edit.id.trim()
    const from = edit.from.trim()
    checkName(id, 'condition id')
    if (from === '') {
      throw new EvalDraftRefused(
        `condition ${JSON.stringify(id)} names no condition to copy — a condition is always a copy of one that exists, `
        + 'because a declaration written from scratch differs in however many fields its author forgot to think about.',
      )
    }
    checkName(from, 'source condition id')
    const source = await readJsonOrRefuse(
      join(conditionsDir, `${from}.json`),
      `condition ${JSON.stringify(id)} copies ${JSON.stringify(from)}, which`,
    )
    const { document } = mintCondition(source, edit, name, input.unit !== undefined)
    await mkdir(conditionsDir, { recursive: true })
    const path = join(conditionsDir, `${id}.json`)
    await writeNewJson(path, document, `condition ${JSON.stringify(id)}`)
    minted.push(id)
    conditionPaths.push(path)
  }

  // ── the plan ──────────────────────────────────────────────────────────────
  const judgeIds = (input.judge?.conditions ?? []).map(id => id.trim()).filter(id => id !== '')
  const named = input.conditions.map(id => id.trim()).filter(id => id !== '')
  // A minted condition the caller forgot to name is APPENDED rather than
  // refused: minting a subject for an experiment and then leaving it out of
  // the experiment is not a thing anyone means. What the plan ended up naming
  // is in the answer, so nothing is hidden by doing it.
  const conditions = [...named, ...minted.filter(id => !named.includes(id) && !judgeIds.includes(id))]
  if (conditions.length === 0) throw new EvalDraftRefused('no conditions named — there is no subject under test')

  const plan: Record<string, unknown> = {
    schema: PLAN_SCHEMA_ID,
    dataset: {
      repo: contractHome(repo),
      commit: input.commit ?? null,
      id: dataset,
      items,
    },
    conditions,
    reps: input.reps,
    stages,
    order: { seed: input.order.seed, interleave: input.order.interleave ?? true },
    budget: { activeMinutes: input.budget.activeMinutes, turns: input.budget.turns },
    // Written only when there IS a judge. An empty `judge` block would still
    // count as one to validate, which would then stop warning that a plan
    // expecting `llm-draft` has nobody to produce it.
    ...(judgeIds.length === 0 ? {} : { judge: { conditions: judgeIds, samples: input.judge?.samples ?? 1 } }),
    expectedNs: [...(input.expectedNs ?? (judgeIds.length === 0 ? DEFAULT_EXPECTED_NS : DEFAULT_EXPECTED_NS_JUDGED))],
    ...(input.retryInfrastructure === undefined ? {} : { retry: { infrastructure: input.retryInfrastructure } }),
    ...(input.exports === undefined || input.exports.trim() === '' ? {} : { exports: input.exports.trim() }),
    ...(input.unit === undefined ? {} : { unit: unitOf(input.unit) }),
    ...(input.notes === undefined || input.notes.trim() === '' ? {} : { notes: input.notes.trim() }),
  }

  const plansDir = join(datasetRoot, 'plans')
  await mkdir(plansDir, { recursive: true })
  const planPath = join(plansDir, `${name}.json`)
  await writeNewJson(planPath, plan, `plan ${JSON.stringify(name)}`)

  return { repo, dataset, planPath, conditionPaths, conditions, judges: judgeIds }
}

/** The plan's `unit` block, with the optional keys left out rather than nulled. */
function unitOf(unit: DraftUnit): Record<string, unknown> {
  const command = (unit.egressCheck?.command ?? []).filter(word => word !== '')
  return {
    image: unit.image,
    ...(unit.network === undefined || unit.network === '' ? {} : { network: unit.network }),
    ...(unit.user === undefined || unit.user === '' ? {} : { user: unit.user }),
    ...(command.length === 0
      ? {}
      : {
        egressCheck: {
          command: [...command],
          ...(unit.egressCheck?.timeoutMs === undefined ? {} : { timeoutMs: unit.egressCheck.timeoutMs }),
        },
      }),
  }
}

/** One dataset set as the 新建实验 form's pickers read it. */
export interface DraftDatasetOption {
  id: string
  /** Item ids the set declares, sorted. */
  items: string[]
  /** Stage names it ships a schema for, sorted (`run-meta` is not a stage). */
  stages: string[]
}

/** Everything the 新建实验 form needs to fill its pickers, in one read. */
export interface DraftOptions {
  /** The dataset repository the options were read from (absolute); null when none resolved. */
  repo: string | null
  datasets: DraftDatasetOption[]
  /** Honest degrades, one sentence each — the list still answers. */
  notes: string[]
}

/** The run-meta schema sits beside the stage schemas and is not a stage. */
const NOT_A_STAGE: ReadonlySet<string> = new Set(['run-meta'])

/** Stage names a set ships a schema for. */
async function stageNamesOf(datasetRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(join(datasetRoot, 'schemas'))
    return entries
      .filter(entry => entry.endsWith('.json'))
      .map(entry => entry.slice(0, -'.json'.length))
      .filter(stage => !NOT_A_STAGE.has(stage))
      .sort()
  } catch {
    return []
  }
}

/**
 * What the 新建实验 form may offer: the dataset sets of the bound repository,
 * each with its items and its stage schemas.
 *
 * Read straight off the working copy's pass-through area, the way the plan and
 * condition listings already are — these are file NAMES in the 其他文件 slot,
 * not item content, and the layer discipline that governs content is the
 * datasets service's to enforce when something actually reads an item.
 * @param repo - the resolved dataset repository.
 * @param only - the session binding's dataset whitelist; absent means every set.
 */
export async function draftOptions(repo: string, only?: readonly string[]): Promise<DraftOptions> {
  const notes: string[] = []
  let names: string[]
  try {
    const entries = await readdir(join(repo, 'datasets'), { withFileTypes: true })
    names = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  } catch {
    return { repo, datasets: [], notes: [`${repo} holds no datasets/ directory — it is not a dataset repository`] }
  }
  const visible = only === undefined || only.length === 0 ? names : names.filter(name => only.includes(name))
  if (only !== undefined && only.length > 0) {
    const missing = only.filter(name => !names.includes(name))
    if (missing.length > 0) notes.push(`this session's binding names dataset set(s) the repository does not hold: ${missing.join(', ')}`)
  }
  const datasets: DraftDatasetOption[] = []
  for (const id of visible) {
    const root = join(repo, 'datasets', id)
    const [items, stages] = await Promise.all([itemIdsOf(root), stageNamesOf(root)])
    if (items.length === 0 && stages.length === 0) continue
    datasets.push({ id, items, stages })
  }
  if (datasets.length === 0) notes.push(`no dataset set in ${repo} declares items or stage schemas`)
  return { repo, datasets, notes }
}
