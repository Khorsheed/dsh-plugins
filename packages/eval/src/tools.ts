/**
 * The model-tool face of the orchestrator — READ ONLY, all three of them.
 *
 * The agent appears twice in an evaluation: while a plan is being drafted and
 * while a bundle is being analysed. Neither needs to write. Starting a run is
 * a human act (`/eval run`), and every write-class verb — materialize,
 * delegate, submit, transition, annotate, archive, export, finalize — belongs
 * to the orchestrator's service face or to the human's CLI. So this module
 * registers exactly three tools and there is deliberately no fourth: an agent
 * that could start a run could start one the human never approved.
 *
 * Every tool is a thin adapter over {@link EvalService} — the service is the
 * body, the adapters only translate (the mission precedent).
 * @module @khorsheed/dsh-eval
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { EvalService } from './service.ts'
import { expandHome } from './validate.ts'

/**
 * Tag model-visible tools with their origin (AGENTS.md § Tool origin tagging;
 * seam S12): the catalog reads this `Symbol.for`-keyed tag back through
 * `ctx.tools.get()`. The tag is host-side only — the model-facing schema is
 * rebuilt by `schemaOf()` and never carries it.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: '@khorsheed/dsh-eval' },
  })

/** The names this module registers, in registration order. */
export const EVAL_TOOL_NAMES: readonly string[] = ['eval_conditions', 'eval_plan_validate', 'eval_run_status']

/**
 * JSON pass-through output. The rendering is the whole document, pretty —
 * what the render emits IS what the model reads, and every field these three
 * tools return is one the caller asked for: a condition's sha and unresolved
 * list, a plan's diagnostics, a run's meta digest. A one-line summary here
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
 * Register the three read tools on the plugin context.
 * @param ctx - a context carrying the tool registry.
 * @param service - the eval service the adapters translate to.
 */
export function registerEvalTools(ctx: Context, service: EvalService): void {
  ctx.tools.register(definePluginTool(defineTool({
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
  })))

  ctx.tools.register(definePluginTool(defineTool({
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
  })))

  ctx.tools.register(definePluginTool(defineTool({
    name: 'eval_run_status',
    description:
      'Where one evaluation run stands: the run.meta digest (plan sha, pinned commit, conditions, seeded '
      + 'execution order, start time) and one row per cell — task, condition, rep, attempt, state, projection '
      + 'bucket, what the orchestrator last did to it, and how often a submission was rejected. Read-only: '
      + 'nothing here advances, retries, or annotates a cell.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'The run id (mission_run_list or the /eval run reply names it).' },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    execute(args) {
      return Promise.resolve(service.runStatus(args.run_id) as unknown as JsonValue)
    },
  })))
}
