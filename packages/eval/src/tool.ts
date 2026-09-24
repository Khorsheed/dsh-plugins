/**
 * The model-tool face of the orchestrator — four reads and two writes.
 *
 * The agent appears twice in an evaluation: while a plan is being drafted and
 * while a bundle is being analysed. The second needs nothing but reads. The
 * first writes exactly two kinds of file — a `dataseek.plan/1` and the
 * conditions it names — and it wrote them with the `write` tool until I5·T34,
 * one `JSON.stringify` at a time, then validated and hoped. `eval_plan_draft`
 * is that same pair of files through the service verb the 新建实验 form uses,
 * validated in the same call.
 *
 * It is a write, and starting a run is not: `/eval run` and the plan-review
 * page's 批准并启动 are a human act, and every other write-class verb —
 * materialize, delegate, submit, transition, annotate, archive, export,
 * finalize — belongs to the orchestrator's service face or to the human's CLI.
 * Drafting is safe to hand a model for the reason the others are not: a draft
 * is a file and a 草稿 row, it starts nothing, and a person still has to read
 * it and press the button.
 *
 * `eval_analysis_write` is the second write (I5·T60, renamed from
 * `eval_repo_write` in T73), and the same shape of safe: one text file, into
 * one experiment's `analysis/` and nowhere else. It exists because the agent's
 * OTHER product — the analysis it writes after reading a bundle — belongs
 * with the experiment, and the session's workspace is not there. The `write`
 * tool reaching there asked a person to escalate the sandbox to
 * `danger-full-access`: the whole machine, once per markdown file (I5·T39 ·
 * G16). A narrow verb is the grant that matches the act.
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
 * No tool takes a repository path any more (T73). Experiments and the
 * condition library belong to the deployment, and a dataset is named by its
 * registration (`<id>/<set>`) and pinned at a commit — there is no path for an
 * agent to pick, which is the end state of the I5·T39 · G1 lesson: an agent
 * told to ask a person searched the disk, found a shared checkout, and wrote
 * onto another branch of it.
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
import type { DraftConditionEdit } from './draft.ts'
import { expandHome } from './validate.ts'

/** The names this module registers, in registration order. */
export const EVAL_TOOL_NAMES: readonly string[] =
  ['eval_conditions', 'eval_plan_validate', 'eval_plan_draft', 'eval_analysis_write', 'eval_run_status', 'eval_cells']

/**
 * JSON pass-through output. The rendering is the whole document, pretty —
 * what the render emits IS what the model reads, and every field these five
 * tools return is one the caller asked for: a condition's sha and unresolved
 * list, a plan's diagnostics, a draft's paths and verdict, a run's meta
 * digest, a cell's stage and refs.
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
 * One `new_conditions` entry, checked.
 *
 * The parameter subset carries `required` at the argument ROOT only, so a
 * nested record's keys are all optional to the schema however the description
 * reads. `id` and `from` are the two a mint cannot proceed without — `from`
 * especially, because a condition is always a copy — so they are checked here
 * and named in the refusal rather than surfacing later as an empty file name.
 * @param entry - the model's record.
 * @param index - its position, for a refusal that says which one.
 */
function mintArgument(entry: {
  id?: string
  from?: string
  harness?: string
  model?: string
  endpoint?: string
  scope?: string
  preset?: string
  permissions?: string
  reasoning?: string
}, index: number): DraftConditionEdit {
  if (entry.id === undefined || entry.id === '') throw new Error(`new_conditions[${index}] has no id — the id is the condition's file name`)
  if (entry.from === undefined || entry.from === '') {
    throw new Error(
      `new_conditions[${index}] (${entry.id}) has no "from" — a new condition is always a COPY of one that exists, `
      + 'because a declaration written from scratch differs in however many fields its author forgot to think about. '
      + 'Call eval_conditions to see what there is to copy.',
    )
  }
  return {
    id: entry.id,
    from: entry.from,
    ...(entry.harness === undefined ? {} : { harness: entry.harness }),
    ...(entry.model === undefined ? {} : { model: entry.model }),
    ...(entry.endpoint === undefined ? {} : { endpoint: entry.endpoint }),
    ...(entry.scope === undefined ? {} : { scope: entry.scope }),
    ...(entry.preset === undefined ? {} : { preset: entry.preset }),
    ...(entry.permissions === undefined ? {} : { permissions: entry.permissions }),
    ...(entry.reasoning === undefined ? {} : { reasoning: entry.reasoning }),
  }
}

/**
 * Build the five tools. This module is the core's `./tool` export: it
 * BUILDS the definitions and registers nothing — creating them is the
 * companion `@khorsheed/dsh-eval-tool`'s job, and that row applies its own
 * origin tag (attribution follows the mounting package, not this core).
 * @param service - the eval service the adapters translate to.
 * @returns the five definitions, untagged and unregistered.
 */
export function evalToolDefinitions(service: EvalService): ToolDefinition[] {
  const definitions: ToolDefinition[] = []
  definitions.push(defineTool({
    name: 'eval_conditions',
    description:
      'List the evaluation conditions (the subjects under test) in this deployment\'s condition library, with their '
      + 'harness, declared model, condition hash, and READINESS: whether conditions/<id>.lock.json exists and '
      + 'still matches the declaration, and which contract fields are still null. A condition is a data file — '
      + 'draft a new one by copying an existing one and changing ONE field, then have the human provision and '
      + 'lock it (/eval conditions provision — a human act, and the only writer of a lock). Each lock also '
      + 'reports the `provisioned` snapshot: what the scoped home actually read back when it was provisioned. '
      + 'With `diff` set to two conditions instead, answers which FIELDS the two declarations differ on and '
      + 'what each side says — facts only, no recommendation about whether the pair is worth running. '
      + 'The library is the deployment\'s ($DSH_HOME/state/eval/conditions), shared by every experiment.',
    parameters: {
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
    async execute(args) {
      const diff = args.diff
      if (diff === undefined) return (await service.conditions()) as unknown as JsonValue
      if (diff.length !== 2) {
        throw new Error(`diff wants exactly two conditions, got ${diff.length} — a diff is between two declarations`)
      }
      return (await service.conditionDiff({ a: diff[0] as string, b: diff[1] as string })) as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'eval_plan_validate',
    description:
      'Validate a dataseek.plan/1 document: schema, cross-field semantics (the judge must not be a player, '
      + 'expectedNs must match the judge, budgets must be positive), the referenced conditions (declaration, '
      + 'lock, resolved sha), and the stage schemas. Data problems come back as `errors` (the plan cannot run) '
      + 'and `warnings` (not resolved yet). Validating never starts anything — a human starts the run with '
      + '/eval run <experimentId> once they approve the plan. eval_plan_draft already validates what it writes; '
      + 'use this to re-check an experiment later (a condition may have been provisioned since). An experiment is '
      + 'checked against the dataset commit it pins and the deployment\'s condition library.',
    parameters: {
      experiment: {
        type: 'string',
        description: 'The experiment id (eval_plan_draft returns it; eval_cells without run_id lists them).',
      },
      plan: {
        type: 'string',
        description: 'Legacy only: a path to an old plan JSON that is not an experiment yet. Pass experiment instead.',
      },
    },
    output: jsonOutput(),
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.experiment !== undefined && args.experiment !== '') {
        return (await service.validateExperiment(args.experiment)) as unknown as JsonValue
      }
      if (args.plan !== undefined && args.plan !== '') {
        return (await service.validatePlan(expandHome(args.plan))) as unknown as JsonValue
      }
      throw new Error('pass experiment (the experiment id) — or, for an old plan file, plan')
    },
  }))

  definitions.push(defineTool({
    name: 'eval_plan_draft',
    description:
      'DRAFT an experiment: create the experiment (its plan, pinned to a dataset commit) and mint any new conditions '
      + 'into the deployment\'s condition library, then validate what was written and answer with the experiment id '
      + 'and the verdict. One call instead of '
      + 'hand-writing each file and validating afterwards — and the same verb the 新建实验 form uses, so a draft you '
      + 'make and a draft a person makes are the same file and land in the same list. '
      + 'DRAFTING IS NOT STARTING: nothing here runs a cell, and there is no run tool to look for. The person '
      + 'approves the plan and starts it (实验室 › 计划审阅 › 批准并启动, or /eval run <experimentId>); logging the '
      + 'harnesses in and provisioning their conditions is theirs too. Report the paths and the validate result back '
      + 'and stop there. '
      + 'A plan validate REJECTS is still written — it lands as a 草稿 with its errors named, which is the honest '
      + 'thing to hand a person. The dataset repository is never written: it is read-only input, pinned at a commit. '
      + 'If the answer says the version is ambiguous, do what it says — ask the person which commit with '
      + 'ask_user_question and draft again with that commit; if they skip the question, stop. Nothing is ever '
      + 'overwritten: a condition id already taken is refused, so pick another. '
      + 'A new condition is always a COPY: `new_conditions` names an existing condition with `from` and changes some '
      + 'of seven fields (harness, model, endpoint, scope, preset, permissions, reasoning). That is the whole discipline of the '
      + 'comparison — two conditions differing in ONE field are a single-factor pair, and a declaration written from '
      + 'scratch differs in however many fields its author forgot to think about. A copy that changes nothing is '
      + 'refused; home.sha is nulled on every copy (the scoped home is not provisioned yet) and the notes record '
      + 'what was copied from what. On a plan that declares a unit_image, a copy whose source has no container segment '
      + 'gets one filled in from its harness\'s default credential mount, recorded in the notes. '
      + 'Call eval_conditions first to see what there is to copy. '
      + '起草时把人的问题原样写进 question: the plan carries what the experiment is FOR, and the conclusion card '
      + 'answers that sentence, so do not paraphrase it.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'The experiment name — shown in the lab list, and the stem of the experiment id.',
      },
      question: {
        type: 'string',
        description: 'The question this experiment answers — the person\'s own sentence, verbatim. The design page shows it first and the conclusion card answers it.',
      },
      expectation: {
        type: 'string',
        description: 'What the person expects the answer to be, in their words. Omit when they have no expectation.',
      },
      answered_when: {
        type: 'string',
        description: 'One sentence: what result would count as having answered the question.',
      },
      dataset: {
        type: 'string',
        required: true,
        description: 'The dataset as <registration id>/<set>, e.g. dataseek-eval/core (the datasets read tools list registrations).',
      },
      commit: {
        type: 'string',
        description: 'The dataset commit to pin. Omit it: the draft pins the tracked branch\'s latest commit when that is '
          + 'unambiguous. Pass it only after a person chose one from the candidates an ambiguous-version answer listed.',
      },
      items: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'The dataset item ids the matrix runs over (the rows). An id the set does not declare is refused with the list of the ones it does.',
      },
      conditions: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Player condition ids, in plan order. A condition minted by new_conditions is appended automatically when it is not named here.',
      },
      new_conditions: {
        type: 'array',
        description: 'Conditions to MINT, each a copy of one that exists with named fields changed.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'The new condition id; it doubles as its library file name (conditions/<id>.json).' },
            from: { type: 'string', description: 'The existing library condition to copy, by id.' },
            harness: { type: 'string', description: 'New harness.name. Changing it nulls harness.version — that version was the other CLI\'s.' },
            model: { type: 'string', description: 'New model.declared.' },
            endpoint: {
              type: 'string',
              description: 'New model.endpoint — the upstream route. "default" means the harness\'s own endpoint with no '
                + 'base URL in force, which is what a condition on this instance usually wants; any other value is compared '
                + 'against the scope\'s endpoint hostname when the human provisions it. Leaving it null makes the pre-run '
                + 'readiness gate refuse the condition, and two conditions of one experiment must declare the SAME value or '
                + 'the comparison has a second factor.',
            },
            scope: { type: 'string', description: 'New scoped-home name. Two conditions differing only in scope are two subjects: they log in as two accounts.' },
            preset: { type: 'string', description: 'New agent-preset roster (only the dsh harness can be given one).' },
            permissions: { type: 'string', description: 'New permission word; each harness accepts its own subset.' },
            reasoning: { type: 'string', description: 'New reasoning.effort.' },
          },
        },
      },
      judge_conditions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Judge condition ids. Omitted (or empty) writes NO judge block, and a plan expecting llm-draft then warns that nobody produces it. A judge is a condition but never a contestant — it needs its own id.',
      },
      judge_samples: { type: 'integer', description: 'How many judge samples each cell draws; ignored without judge_conditions. Default 1.' },
      reps: { type: 'integer', required: true, description: 'Independent samples per cell; each rep is its own mission.' },
      stages: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Stage names, each backed by schemas/<stage>.json in the set. A stage with no schema is a warning, not a refusal.',
      },
      seed: { type: 'integer', required: true, description: 'The execution-order seed, recorded with the run (frozen decision 11) so the order is reproducible.' },
      interleave: { type: 'boolean', description: 'Spread same-condition cells apart rather than running them back to back. Default true.' },
      active_minutes: { type: 'number', required: true, description: 'Per-cell budget in ACTIVE delegation minutes — not wall clock.' },
      turns: { type: 'integer', required: true, description: 'Per-cell delegation turn budget.' },
      expected_ns: {
        type: 'array',
        items: { type: 'string', enum: ['script', 'llm-draft', 'human-final'] },
        description: 'Verdict sources this run expects; the report marks the missing ones honestly. Default: all three.',
      },
      retry_infrastructure: { type: 'integer', description: 'Per-cell infrastructure-retry budget (spawn failures, facade errors, timeouts); 0 disables. Omit to leave the default.' },
      unit_image: { type: 'string', description: 'Run every cell inside a container unit built from this image. Omit for the host path.' },
      unit_network: { type: 'string', description: 'The docker network the units join. Undeclared is docker\'s default bridge, which HAS egress — a sealed run must name its internal network.' },
      unit_user: { type: 'string', description: 'In-container user (uid[:gid]); undeclared is the image\'s own USER.' },
      egress_command: {
        type: 'array',
        items: { type: 'string' },
        description: 'argv of a probe run inside each fresh unit before any delegation; a non-zero exit refuses the whole run. Declare one on any run whose units sit on an internal network — a unit that cannot reach its proxy answers NOTHING, which reads exactly like a subject with nothing to say.',
      },
      egress_timeout_ms: { type: 'number', description: 'Budget for that probe, in ms; default 30000.' },
      exports: { type: 'string', description: 'Bundle export directory. Omit for the experiment\'s own exports/.' },
      notes: { type: 'string', description: 'Review commentary written into the plan verbatim — say what the comparison is FOR and what it cannot settle.' },
    },
    output: jsonOutput(),
    // Two drafts at once would race on minting the same library condition, and
    // the second would be refused on an id the first had just taken — a
    // confusing way to learn that the tool is fine and the concurrency is not.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const session = sessionOf(exec)
      return (await service.draftExperiment({
        name: args.name,
        ...(args.question === undefined ? {} : { question: args.question }),
        ...(args.expectation === undefined ? {} : { expectation: args.expectation }),
        ...(args.answered_when === undefined ? {} : { answeredWhen: args.answered_when }),
        dataset: args.dataset,
        ...(args.commit === undefined ? {} : { commit: args.commit }),
        items: [...args.items],
        conditions: [...args.conditions],
        ...(args.new_conditions === undefined ? {} : { newConditions: args.new_conditions.map(mintArgument) }),
        ...(args.judge_conditions === undefined ? {} : { judgeConditions: [...args.judge_conditions] }),
        ...(args.judge_samples === undefined ? {} : { judgeSamples: args.judge_samples }),
        reps: args.reps,
        stages: [...args.stages],
        seed: args.seed,
        ...(args.interleave === undefined ? {} : { interleave: args.interleave }),
        activeMinutes: args.active_minutes,
        turns: args.turns,
        ...(args.expected_ns === undefined ? {} : { expectedNs: [...args.expected_ns] }),
        ...(args.retry_infrastructure === undefined ? {} : { retryInfrastructure: args.retry_infrastructure }),
        ...(args.unit_image === undefined
          ? {}
          : {
            unit: {
              image: args.unit_image,
              ...(args.unit_network === undefined ? {} : { network: args.unit_network }),
              ...(args.unit_user === undefined ? {} : { user: args.unit_user }),
              ...(args.egress_command === undefined ? {} : { egressCommand: [...args.egress_command] }),
              ...(args.egress_timeout_ms === undefined ? {} : { egressTimeoutMs: args.egress_timeout_ms }),
            },
          }),
        ...(args.exports === undefined ? {} : { exports: args.exports }),
        ...(args.notes === undefined ? {} : { notes: args.notes }),
      }, session === undefined ? {} : { session })) as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'eval_analysis_write',
    description:
      'WRITE one text file into an experiment\'s analysis/ directory — the analysis draft\'s door. Use it for the '
      + 'analysis you write after reading a bundle (step 8). The path is RELATIVE to the experiment directory and '
      + 'only analysis/<path> is writable; anything else — and the dataset repository always — is refused with the '
      + 'path and the allowed prefix quoted back, and nothing is written. Nothing is overwritten unless you pass '
      + 'overwrite, and an empty body is refused. The answer\'s `confirmation` is what to tell the person: the file '
      + 'shows on the experiment\'s report page (结果对比), in the 分析初稿 block.',
    parameters: {
      experiment: {
        type: 'string',
        required: true,
        description: 'The experiment id (eval_cells without run_id lists experiments; a run row names its experimentId).',
      },
      path: {
        type: 'string',
        required: true,
        description: 'Experiment-relative path under analysis/, e.g. analysis/<name>.md. Absolute paths, "~" and ".." are refused.',
      },
      content: { type: 'string', required: true, description: 'The file\'s full text (UTF-8). An empty body is refused.' },
      overwrite: { type: 'boolean', description: 'Replace the file when it already exists. Default false — an existing path is refused instead.' },
    },
    output: jsonOutput(),
    // Two writes at once may create the same parent directory and land in
    // either order; the door is per-file, so serializing is the cheap answer.
    isConcurrencySafe: () => false,
    async execute(args) {
      return (await service.writeAnalysis({
        experimentId: args.experiment,
        path: args.path,
        content: args.content,
        ...(args.overwrite === undefined ? {} : { overwrite: args.overwrite }),
      })) as unknown as JsonValue
    },
  }))

  definitions.push(defineTool({
    name: 'eval_run_status',
    description:
      'Where one evaluation run stands: the run.meta digest (plan sha, pinned commit, conditions, seeded '
      + 'execution order, start time) and one row per cell — task, condition, rep, attempt, state, projection '
      + 'bucket, what the orchestrator last did to it, and how often a submission was rejected. `status` is the '
      + 'same word the lab list shows (draft / pending-approval / running / stalled / judging / done / void / '
      + 'refused / cancelled — derived, never stored; `stalled` means nothing is driving unfinished cells and the '
      + 'ledger has not moved for over 10 minutes, with `stalledMinutes` saying how long), plus the human\'s '
      + '`closure` exit if one was taken and whether the run is `archived`. Read-only: '
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
      + 'instance holds plus every experiment nobody has started yet, each with its experiment id, dataset pin, condition count, '
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
