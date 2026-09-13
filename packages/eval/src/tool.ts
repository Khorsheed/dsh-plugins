/**
 * The model-tool face of the orchestrator — READ ONLY, all four of them.
 *
 * The agent appears twice in an evaluation: while a plan is being drafted and
 * while a bundle is being analysed. Neither needs to write. Starting a run is
 * a human act (`/eval run`), and every write-class verb — materialize,
 * delegate, submit, transition, annotate, archive, export, finalize — belongs
 * to the orchestrator's service face or to the human's CLI. So this module
 * builds exactly four READ tools and there is deliberately no write one: an
 * agent that could start a run could start one the human never approved.
 *
 * `eval_cells` is the fourth (T46). An evaluation session no longer composes
 * the mission tool row, so the four mission read tools it used to carry for
 * per-cell detail are gone from that preset; this tool answers the same
 * question through eval's own projection, and the model side of an
 * evaluation never names mission again. Since I5·T35a it also answers WITHOUT
 * a run id, listing the experiments themselves — the gap `mission_run_list`
 * used to fill, now through the same projection the 实验室 tab reads, so the
 * two surfaces cannot disagree about what exists.
 *
 * Every tool is a thin adapter over {@link EvalService} — the service is the
 * body, the adapters only translate (the mission precedent). This module is
 * the core's `./tool` export: it BUILDS the definitions and registers
 * nothing — creating them is the companion `@khorsheed/dsh-eval-tool`'s job.
 * @module @khorsheed/dsh-eval
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { EvalService } from './service.ts'
import { expandHome } from './validate.ts'

/** The names this module registers, in registration order. */
export const EVAL_TOOL_NAMES: readonly string[] = ['eval_conditions', 'eval_plan_validate', 'eval_run_status', 'eval_cells']

/**
 * JSON pass-through output. The rendering is the whole document, pretty —
 * what the render emits IS what the model reads, and every field these four
 * tools return is one the caller asked for: a condition's sha and unresolved
 * list, a plan's diagnostics, a run's meta digest, a cell's stage and refs.
 * A one-line summary here
 * would be a second, lossier answer to the question the tool was called with
 * (the datasets read tools and `mission_get` render the same way).
 */
function jsonOutput() {
  return {
    schema: { type: 'json' } as const,
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  }
}

/** The session identity a tool call carries, when it has one. */
function sessionOf(exec: { agent?: { session: { id: string } } | undefined }): { id: string } | undefined {
  const id = exec.agent?.session.id
  return id === undefined ? undefined : { id }
}

/**
 * Build the four read tools. This module is the core's `./tool` export: it
 * BUILDS the definitions and registers nothing — creating them is the
 * companion `@khorsheed/dsh-eval-tool`'s job, and that row applies its own
 * origin tag (attribution follows the mounting package, not this core).
 * @param service - the eval service the adapters translate to.
 * @returns the four definitions, untagged and unregistered.
 */
export function evalToolDefinitions(service: EvalService): ToolDefinition[] {
  const definitions: ToolDefinition[] = []
  definitions.push(defineTool({
    name: 'eval_conditions',
    description:
      'List the evaluation conditions (the subjects under test) a dataset repository declares, with their '
      + 'harness, declared model, condition hash, and READINESS: whether conditions/<id>.lock.json exists and '
      + 'still matches the declaration, and which contract fields are still null. A condition is a data file — '
      + 'draft a new one by copying an existing one and changing ONE field, then have the human provision and '
      + 'lock it (/eval conditions provision — a human act, and the only writer of a lock). Each lock also '
      + 'reports the `provisioned` snapshot: what the scoped home actually read back when it was provisioned. '
      + 'With `diff` set to two conditions instead, answers which FIELDS the two declarations differ on and '
      + 'what each side says — facts only, no recommendation about whether the pair is worth running. '
      + 'Resolves against this session\'s bound dataset repository unless `repo` says otherwise.',
    parameters: {
      repo: { type: 'string', description: 'Dataset repository path. Omit to use the session\'s datasets binding.' },
      dataset: { type: 'string', description: 'One dataset set (default: every set in the repository that declares conditions).' },
      diff: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exactly two conditions (a condition id, or a path to a declaration) to compare field by field '
          + 'instead of listing. Two conditions differing in exactly one field are a single-factor pair — the '
          + 'shape an experiment wants — but this only SHOWS the difference; it never recommends one.',
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const session = sessionOf(exec)
      const scope = {
        ...(args.repo !== undefined ? { repo: args.repo } : {}),
        ...(args.dataset !== undefined ? { dataset: args.dataset } : {}),
        ...(session !== undefined ? { session } : {}),
      }
      const diff = args.diff
      if (diff === undefined) return (await service.conditions(scope)) as unknown as JsonValue
      if (diff.length !== 2) {
        throw new Error(`diff wants exactly two conditions, got ${diff.length} — a diff is between two declarations`)
      }
      return (await service.conditionDiff({ ...scope, a: diff[0] as string, b: diff[1] as string })) as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'eval_plan_validate',
    description:
      'Validate a dataseek.plan/1 document: schema, cross-field semantics (the judge must not be a player, '
      + 'expectedNs must match the judge, budgets must be positive), the referenced conditions (declaration, '
      + 'lock, resolved sha), and the stage schemas. Data problems come back as `errors` (the plan cannot run) '
      + 'and `warnings` (not resolved yet). Validating never starts anything — a human starts the run with '
      + '/eval run once they approve the plan.',
    parameters: {
      plan: {
        type: 'string',
        required: true,
        description: 'Path to the plan JSON (absolute, ~-relative, or relative to the working directory); '
          + 'plans live at <repo>/datasets/<dataset>/plans/<name>.json and eval_conditions reports <repo>.',
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      return (await service.validatePlan(expandHome(args.plan))) as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'eval_run_status',
    description:
      'Where one evaluation run stands: the run.meta digest (plan sha, pinned commit, conditions, seeded '
      + 'execution order, start time) and one row per cell — task, condition, rep, attempt, state, projection '
      + 'bucket, what the orchestrator last did to it, and how often a submission was rejected. Read-only: '
      + 'nothing here advances, retries, or annotates a cell.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'The run id — the /eval run reply names it, and so does the run bundle\'s run.json.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    execute(args) {
      return Promise.resolve(service.runStatus(args.run_id) as unknown as JsonValue)
    },
  }))

  definitions.push(defineTool({
    name: 'eval_cells',
    description:
      'One run CELL BY CELL — the detail eval_run_status leaves out because it answers about the run. Each row: '
      + 'the matrix coordinates (task, condition, rep) and every other label, the projection bucket, the stage the '
      + 'cell is in and how long it has been there, the attempt number, the unit the attempt holds (resource and '
      + 'environment fingerprint), the checkpoint names it reached, how many annotations each namespace carries, '
      + 'and the child session the delegation ran in when it started one — open that session to READ the player\'s '
      + 'transcript, never to steer it mid-run. Narrow with bucket / task / condition (exact matches). '
      + 'WITHOUT run_id it answers the other question instead: WHICH experiments exist — every evaluation run this '
      + 'instance holds plus every plan nobody has started yet, each with its dataset snapshot, condition count, '
      + 'matrix size, the factors a condition diff derived, status and progress. That is the same listing the '
      + '实验室 tab shows, so the two can never disagree; call it with no arguments to find a run id, then call it '
      + 'again with one. This is the whole per-cell view: an evaluation session grants no mission tools, so there is '
      + 'no mission_run_list, mission_list or mission_get to look for — the experiments are listed here, the run '
      + 'digest is eval_run_status, and the cells are here too. Read-only: nothing here starts, reruns, releases, '
      + 'annotates, or advances anything.',
    parameters: {
      run_id: {
        type: 'string',
        description: 'The run id — the /eval run reply names it, and so does the run bundle\'s run.json. '
          + 'Omit it to list the experiments instead of one run\'s cells.',
      },
      bucket: {
        type: 'string',
        description: 'Keep only cells in this projection bucket: ready / scheduled / blocked / active / done. Ignored without run_id.',
      },
      task: { type: 'string', description: 'Keep only cells of this task (the dataset item id, e.g. P0). Ignored without run_id.' },
      condition: { type: 'string', description: 'Keep only cells of this condition id. Ignored without run_id.' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.run_id === undefined) {
        // The listing mode reads the SAME projection the lab tab's `runs`
        // Remote verb does — one implementation, so the tab and the model can
        // never report different experiments.
        const session = sessionOf(exec)
        return (await service.experiments(session === undefined ? {} : { session })) as unknown as JsonValue
      }
      return service.cells(args.run_id, {
        ...(args.bucket !== undefined ? { bucket: args.bucket } : {}),
        ...(args.task !== undefined ? { task: args.task } : {}),
        ...(args.condition !== undefined ? { condition: args.condition } : {}),
      }) as unknown as JsonValue
    },
  }))

  return definitions
}
