/**
 * The eval service face: the offline verbs the CLI shares (contract checking,
 * deterministic hashing, the bundle report) plus — since I2 — the two
 * orchestration verbs: `generateTemplate` (manifest → run template) and
 * `run` (the stage-one/two run loop). The offline surface is read-only over
 * its inputs; the run verb resolves the datasets / mission / localAgent
 * services through the host at call time and refuses loudly naming whatever
 * is missing.
 * @module @khorsheed/dsh-eval
 */
import { hashConditionDocument, hashHome, type HomeHash } from './hash.ts'
import { writeEvalReport, type ReportWrite } from './report.ts'
import { CONDITION_SCHEMA_ID } from './schema.ts'
import {
  conditionDiagnostics, expandHome, normalizeRepoPath, sameRepoPath, validatePlan,
  type EvalDiagnostic, type PlanValidation,
} from './validate.ts'
import { generateTemplate, type GeneratedTemplate, type GenerateTemplateOptions } from './template.ts'
import { runPlan, EvalRunRefused, type RunDeps, type RunOptions, type RunReport } from './run.ts'
import { finalizeRun, EvalFinalizeRefused, type FinalizeOptions, type FinalizeReport, type FinalizeUnitsFace } from './finalize.ts'
import {
  EvalRunJobs,
  type EvalRunHandle,
  type EvalRunOutput,
  type EvalRunStatus,
} from './job.ts'
import {
  EvalReadRefused,
  diffConditions,
  listConditions,
  runCells,
  runStatus,
  type ConditionDiff,
  type ConditionsReport,
  type RunCellsQuery,
  type RunCellsReport,
  type RunStatusReport,
} from './read.ts'
import { EvalProvisionRefused, provisionCondition, type ProvisionReport } from './provision.ts'
import { conditionPathIn, setConditionEndpoint as writeConditionEndpoint } from './condition-edit.ts'
import { draftExperiment as writeDraft, draftOptions as readDraftOptions } from './draft.ts'
import { resolveRepoWrite, writeResolved, EvalWriteRefused, type RepoWriteResult } from './repo-write.ts'
import { experimentDetail, listExperiments, runsForItem } from './experiments.ts'
import { materializationShaOf, runCellDetail } from './cell-detail.ts'
import { judgeQueueView, writeHumanFinal } from './judge-bench.ts'
import { pivotMatrix, type MatrixInputCell } from './matrix-view.ts'
import { conditionDiffView, conditionsView, provisionChecks, reviewPlan } from './review.ts'
import { projectFinalize, runReportView } from './report-view.ts'
import {
  readExportState, recordExportNote, reexportDirOf,
  type EvalExportNote,
} from './export-note.ts'
import { instanceCapabilityProbe } from './capability-probe.ts'
import type {
  CapabilityCatalogFace, DatasetsBindingFace, DatasetsFace, LabFace, LabUnitRow, LocalAgentFace, MissionActionFace,
  MissionAnnotateFace, MissionExportRemoteFace,
  MissionFace, MissionFinalizeFace, MissionReadFace, MissionRunListFace,
} from './faces.ts'
import type {
  EvalApproveResult, EvalCellDetail, EvalCellsResult, EvalConditionDiffView,
  EvalConditionEndpointRequest, EvalConditionEndpointView,
  EvalConditionProvisionRequest, EvalConditionProvisionView, EvalConditionRow, EvalConditionsView,
  EvalDraftOptionsView, EvalDraftRequest, EvalDraftResult,
  EvalExperimentDetail, EvalExperimentsResult, EvalExportPlanRequest, EvalExportPlanView, EvalExportResultView,
  EvalExportRunRequest, EvalFinalizeView, EvalHumanFinalResult, EvalItemRunsResult, EvalJudgeQueueView,
  EvalJudgeVerdictInput, EvalMatrixView, EvalPlanReview, EvalReexportRequest, EvalRunReportView, EvalRunUnitsView,
} from './types.ts'

/** Thrown when a verb is handed a document that violates its contract. */
export class EvalContractError extends Error {}

/**
 * The export verbs' refusal. mission's Remote is where the leak gate lives, so
 * a composition without it gets no export at all — not an export with the gate
 * re-implemented on this side.
 */
const MISSION_EXPORT_ABSENT = new EvalReadRefused(
  'no mission Remote face: the bundle export and its guarded-layer gate live there, so this composition cannot export '
  + '— mount the dsh-mission plugin on a host with the Typert gateway, or export with the dsh-mission CLI',
)

/**
 * The run's PLAYER condition declarations, as `run.meta.conditions` carries
 * them since T8b. The matrix's factor set is derived from these and from
 * nothing else — the judge is a condition but not a contestant, so its
 * declaration never widens the factor set.
 */
function metaConditionDocuments(meta: Record<string, unknown>): Array<{ id: string; document: unknown }> {
  const entries = meta['conditions']
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    return typeof record['id'] === 'string' ? [{ id: record['id'], document: record['condition'] }] : []
  })
}

/** Result of hashing one condition document. */
export interface ConditionHash {
  /** sha256 hex of the canonical condition JSON (notes excluded). */
  sha: string
  /** Unresolved fields and the like — not failures, listed for the caller. */
  warnings: EvalDiagnostic[]
}

/**
 * The eval service. The offline kernel holds no state; the run verb carries
 * an optional host accessor so the in-host plugin can probe its upstream
 * services (the CLI builds the same kernel without a host — run stays
 * dry-run-only there).
 */
export class EvalService {
  /**
   * The run-as-job layer: `/eval run` registers the run here and returns, so
   * a run outlives the turn that started it. One instance per service, so a
   * finished run's output stays readable for as long as the service lives.
   */
  private readonly jobs: EvalRunJobs

  constructor(private readonly hosts?: { get(name: string): unknown }) {
    this.jobs = new EvalRunJobs(hosts)
  }

  /** Whether a run can be started as a background job in this composition. */
  runJobsAvailable(): boolean {
    return this.jobs.available()
  }

  /**
   * Validate a plan document against `dataseek.plan/1` and resolve what it
   * references (condition declarations, locks, stage schemas). Data problems
   * come back as diagnostics, never as throws.
   *
   * Running inside a live instance, this one can do a little more than the
   * offline CLI: the local-agent facade resolves each condition's scoped
   * home, so a lock whose preset copy was edited after provision reads STALE
   * here rather than `ready`. Without the facade it is exactly the offline
   * validation.
   */
  validatePlan(planPath: string): Promise<PlanValidation> {
    return validatePlan(expandHome(planPath), this.scopeHomeDirResolver())
  }

  /**
   * The scoped-home resolver the read verbs hand to validation, or `{}` in a
   * composition with no local-agent facade. Never throws: a facade that
   * cannot answer leaves the freshness check unrun, which is the same thing
   * as not having one.
   */
  private scopeHomeDirResolver(): { scopeHomeDir?: (harness: string, scope?: string) => string | undefined } {
    const localAgent = this.hosts?.get('localAgent') as LocalAgentFace | undefined
    if (typeof localAgent?.homeDir !== 'function') return {}
    return {
      scopeHomeDir: (harness: string, scope?: string): string | undefined => {
        try {
          return localAgent.homeDir?.(harness, scope)
        } catch {
          return undefined
        }
      },
    }
  }

  /**
   * Hash a condition document (canonical JSON, `notes` excluded).
   * @throws {@link EvalContractError} when the document violates
   * `dataseek.condition/1` — a hash of an invalid document means nothing.
   */
  hashCondition(condition: unknown): ConditionHash {
    const { errors, warnings } = conditionDiagnostics(condition)
    if (errors.length > 0) {
      throw new EvalContractError(
        `condition violates ${CONDITION_SCHEMA_ID}:\n${errors.map(e => `  - [${e.code}] ${e.message}`).join('\n')}`,
      )
    }
    return { sha: hashConditionDocument(condition), warnings }
  }

  /**
   * Hash a scoped home's config content (deny-listed files excluded, content
   * never leaves the digest).
   * @throws Error when the directory does not exist.
   */
  hashHome(homeDir: string): Promise<HomeHash> {
    return hashHome(homeDir)
  }

  /**
   * Build the paired report for a mission export bundle: `results.jsonl`
   * (one verdict per line) and `summary.md` (the four invariants first;
   * comparison and ranking only when all four are established). Writes into
   * `<bundleDir>/report/` unless `out` names another directory.
   * @throws Error when the directory is not a bundle (no readable run.json).
   */
  report(bundleDir: string, options: { out?: string } = {}): Promise<ReportWrite> {
    return writeEvalReport(expandHome(bundleDir), options.out === undefined ? options : { out: expandHome(options.out) })
  }

  /**
   * WRITE one text file into the session's bound dataset repository working
   * tree — the analysis draft's door (ui-spec §六; I5·T39 · G16).
   *
   * The narrowest write in this family, and narrow on purpose. It resolves the
   * repository exactly as every other agent-facing verb does (the binding, and
   * `repo` may only restate it), then checks the path against a whitelist that
   * lives in code and admits only the repository's pass-through areas — no
   * item material, at any depth, whatever the binding admits for reading.
   *
   * The alternative it replaces was not a smaller grant made carefully; it was
   * the largest grant there is, made once per markdown file: `write` reaching
   * outside the session workspace asked a person to escalate the sandbox to
   * `danger-full-access`. Nothing about the act needed that, so the act got a
   * verb instead of the machine getting opened.
   * @param options - the path (repository-relative), the text, and whether an
   *   existing file may be replaced; `session` decides the repository.
   * @throws {@link EvalReadRefused} when no repository resolves for this session.
   * @throws {@link EvalWriteRefused} when the path is outside the door.
   */
  async writeRepoFile(options: {
    path: string
    content: string
    overwrite?: boolean
    repo?: string
    session?: { id: string }
    agent?: boolean
  }): Promise<RepoWriteResult> {
    const scope = this.resolveRepoScope({
      ...(options.repo === undefined ? {} : { repo: options.repo }),
      ...(options.session === undefined ? {} : { session: options.session }),
      ...(options.agent === undefined ? {} : { agent: options.agent }),
    })
    if (scope instanceof EvalReadRefused) throw scope
    if (options.content === '') {
      throw new EvalWriteRefused(
        `refusing to write an empty file at ${JSON.stringify(options.path)} — an empty analysis is not an analysis, `
        + 'and a file created by accident is harder to notice than a call that failed.',
      )
    }
    const target = await resolveRepoWrite(scope.repo, options.path, scope.datasets)
    return await writeResolved(scope.repo, target, options.content, {
      ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
    })
  }

  /**
   * List the conditions a dataset repository declares, with their hashes and
   * readiness (lock present and matching, scoped home verified, unresolved
   * fields). Read-only: minting a condition is a file the agent drafts, and
   * turning one into a real scoped home is `conditions provision` (I4).
   * @param options - the calling session's datasets binding decides the
   *   repository; `repo` overrides it for a human caller, and `agent: true`
   *   (the model-tool face) narrows it to a restatement of the binding.
   * @throws {@link EvalReadRefused} when no repository can be resolved, when
   *   the path is not a dataset repository, or when `dataset` is outside the
   *   session binding's whitelist.
   */
  conditions(
    options: { repo?: string; dataset?: string; session?: { id: string }; agent?: boolean } = {},
  ): Promise<ConditionsReport> {
    const scope = this.resolveRepoScope(options)
    if (scope instanceof EvalReadRefused) return Promise.reject(scope)
    return listConditions(scope.repo, scope.datasets, this.scopeHomeDirResolver())
  }

  /**
   * Diff two condition declarations field by field — SHOWS, never chooses.
   * Two conditions that differ in exactly one field are a single-factor pair,
   * which is worth seeing; whether the pair is worth running depends on things
   * no file knows, so the verb stops at the facts and makes no
   * recommendation.
   * @param options - the two references (a condition id, or a path), plus the
   *   same repo / dataset / session resolution {@link EvalService.conditions}
   *   uses.
   * @throws {@link EvalReadRefused} when a repository or a side cannot be resolved.
   */
  conditionDiff(
    options: { a: string; b: string; repo?: string; dataset?: string; session?: { id: string }; agent?: boolean },
  ): Promise<ConditionDiff> {
    const scope = this.resolveRepoScope(options)
    if (scope instanceof EvalReadRefused) return Promise.reject(scope)
    return diffConditions(scope.repo, options.a, options.b, scope.datasets)
  }

  /**
   * Provision one condition: resolve its `(harness, scope)` to a real scoped
   * home, refuse unless that scope holds a credential, check the declaration
   * against the scope's effective settings field by field, hash the home, and
   * write `conditions/<id>.lock.json` beside the declaration.
   *
   * The ONE writer of a condition lock. Writes go only into the working copy
   * `repo` names — nothing is committed, and the shared checkout stays
   * untouched.
   * @param conditionPath - path to the declaration (`~` expanded).
   * @param options - the working copy to write into, and whether provision may
   *   correct the declaration's `home.sha` from what it measures (default true;
   *   `false` is the two-step shape the human used to do by hand).
   * @throws {@link EvalProvisionRefused} when the path, the declaration, or
   *   the local-agent facade makes provisioning impossible; a condition that
   *   simply is not ready comes back as a report with `written: false`.
   */
  provision(
    conditionPath: string,
    options: { repo: string; writeBack?: boolean; log?: (message: string) => void },
  ): Promise<ProvisionReport> {
    const localAgent = this.hosts?.get('localAgent') as LocalAgentFace | undefined
    if (localAgent === undefined) {
      return Promise.reject(new EvalProvisionRefused(
        'no localAgent service: provision reads the scoped home, its credential grade and its effective settings from the harness family'
        + ' — run it from a live session (/eval conditions provision <condition.json> --repo <working copy>), or mount the dsh-local-agent plugin',
      ))
    }
    // The capability probe is the one part of provision that needs a LIVE
    // instance rather than a facade: the hash is what the instance's own
    // catalog reads for that preset. Absent catalog, absent measurement —
    // provision then warns CAPABILITIES_UNMEASURED and the readiness gate
    // refuses the condition, which is the honest degrade.
    const catalog = this.hosts?.get('capabilityCatalog') as CapabilityCatalogFace | undefined
    return provisionCondition(conditionPath, {
      repo: options.repo,
      localAgent,
      ...(options.writeBack === undefined ? {} : { writeBack: options.writeBack }),
      ...(options.log === undefined ? {} : { log: options.log }),
      ...(catalog === undefined
        ? {}
        : { capabilities: instanceCapabilityProbe({ catalog, ...(options.log === undefined ? {} : { log: options.log }) }) }),
    })
  }

  /**
   * Resolve which repository and which dataset sets a verb may see: the
   * calling session's datasets binding decides, `repo` overrides it for a
   * HUMAN caller, and the binding's dataset whitelist is honoured either way
   * — which datasets a session may see is the human's decision.
   *
   * `agent: true` marks a call that came from a MODEL TOOL, and there the
   * `repo` parameter stops being an override. It may only restate the binding;
   * anything else, including a repository named in a session nobody bound, is
   * refused with the bind command.
   *
   * That narrowing is the whole point. The parameter used to be a way around
   * the very refusal that told the agent to ask a person, and an agent took
   * it: told there was no binding, it searched the disk, found a checkout
   * several other agents share, and wrote three files onto somebody else's
   * branch (I5·T39 · G1 — the plan a pilot run was executing was edited that
   * way). "Findable" is not "mine to use", and the repository an evaluation
   * writes into is a human's choice about a shared machine, not a parameter.
   * A composition that mounts no datasets service has no binding for anyone to
   * make, so an agent call there is refused too rather than falling through.
   *
   * BOTH sources are normalized on the way out: a binding written before the
   * datasets plugin canonicalized `repoPath` still holds a literal `~`, and
   * `readdir(<repo>/datasets)` does not expand it — this reader must not be
   * the one that trips over it (I5 walkthrough gap G5).
   */
  private resolveRepoScope(
    options: { repo?: string; dataset?: string; session?: { id: string }; agent?: boolean },
  ): { repo: string; datasets: string[] | undefined } | EvalReadRefused {
    const binding = options.session === undefined
      ? undefined
      : (this.hosts?.get('datasets') as DatasetsBindingFace | undefined)?.binding(options.session)
    const asked = options.repo !== undefined && options.repo !== '' ? options.repo : undefined
    if (options.agent === true) {
      const bound = binding?.repoPath
      if (bound === undefined || bound === '') {
        return new EvalReadRefused(
          'no dataset repository bound to this session'
          + (asked === undefined ? '' : `, so ${JSON.stringify(asked)} is not this session's to read`)
          + ' — ask the person to bind one (/datasets bind <repoPath>), and use no repo argument afterwards.'
          + ' An unbound session has no repository an agent may pick for it, however many are on the disk.',
        )
      }
      if (asked !== undefined && !sameRepoPath(asked, bound)) {
        return new EvalReadRefused(
          `repo ${JSON.stringify(asked)} is not this session's bound dataset repository (${bound})`
          + ' — the repo argument may only restate the binding. Drop it, or ask the person to rebind'
          + ' (/datasets bind <repoPath>).',
        )
      }
      // Past the checks the binding is the answer, whether or not the caller
      // also spelled it out: one resolved path, whichever way in.
      return this.scopeOf(normalizeRepoPath(bound), binding, options.dataset)
    }
    const source = asked ?? binding?.repoPath
    const repo = source === undefined ? undefined : normalizeRepoPath(source)
    if (repo === undefined || repo === '') {
      return new EvalReadRefused(
        'no dataset repository: pass repo, or ask the human to bind one for this session (/datasets bind <repoPath>)',
      )
    }
    return this.scopeOf(repo, binding, options.dataset)
  }

  /**
   * The resolved repository plus the dataset sets the binding admits — the
   * half of {@link EvalService.resolveRepoScope} that is the same whoever
   * called, so the agent path and the human path cannot drift on it.
   * @param repo - the resolved repository (`~` already expanded).
   * @param binding - the session's binding, when it has one.
   * @param dataset - the one set the caller asked for, if any.
   */
  private scopeOf(
    repo: string,
    binding: { datasets?: string[] } | undefined,
    dataset: string | undefined,
  ): { repo: string; datasets: string[] | undefined } | EvalReadRefused {
    const allowed = binding?.datasets
    if (dataset !== undefined && dataset !== '') {
      if (allowed !== undefined && !allowed.includes(dataset)) {
        return new EvalReadRefused(
          `dataset ${JSON.stringify(dataset)} is outside this session's binding (${allowed.join(', ')})`,
        )
      }
      return { repo, datasets: [dataset] }
    }
    return { repo, datasets: allowed === undefined ? undefined : [...allowed] }
  }

  /**
   * Project one run: the evaluation-relevant slice of `run.meta` plus a row
   * per cell (state, bucket, what the orchestrator last did, how often a
   * submission was rejected). Reads mission's ledger; writes nothing.
   * @param runId - the run to project.
   * @throws {@link EvalReadRefused} when the composition mounts no mission
   *   service — the run ledger lives there, so there is nothing to read.
   */
  runStatus(runId: string): RunStatusReport {
    const mission = this.hosts?.get('mission') as MissionReadFace | undefined
    if (mission === undefined) {
      // Named without its scope on purpose: a scoped `@khorsheed/…` string in
      // shipped code reads as a family edge to pack-dist, and this is a
      // sentence for a human, not a dependency.
      throw new EvalReadRefused(
        'no mission service: run records live in the mission ledger, so this composition cannot answer run '
        + 'status — mount the dsh-mission plugin',
      )
    }
    return runStatus(mission, runId)
  }

  /**
   * Project one run CELL BY CELL: the matrix coordinates, the bucket and
   * stage each cell sits in and for how long, the unit its attempt holds,
   * the checkpoints it reached, how many annotations each namespace carries,
   * and the delegation's child session when it has one.
   *
   * The companion of {@link EvalService.runStatus}, not a replacement: that
   * one answers about the RUN (the run.meta digest, the buckets, the leak
   * warning), this one about its cells. Both read mission's ledger through
   * the structural face, so the callers — the `eval_cells` tool and the lab
   * tab's Remote — never touch mission themselves.
   * @param runId - the run to project.
   * @param query - exact-match `bucket` / `task` / `condition` filters, and
   *   the clock the durations are taken against.
   * @throws {@link EvalReadRefused} when the composition mounts no mission
   *   service — the run ledger lives there, so there is nothing to read.
   */
  cells(runId: string, query: RunCellsQuery = {}): RunCellsReport {
    const mission = this.hosts?.get('mission') as MissionReadFace | undefined
    if (mission === undefined) {
      // Named without its scope for the same reason as in `runStatus`: this
      // is a sentence for a human, not a dependency edge.
      throw new EvalReadRefused(
        'no mission service: run records live in the mission ledger, so this composition cannot list a run\'s '
        + 'cells — mount the dsh-mission plugin',
      )
    }
    return runCells(mission, runId, query)
  }

  /**
   * The LAB LIST: one row per experiment — every run this ledger holds that
   * eval started, plus every plan in the session's dataset repository that
   * nobody has started yet. Drafts and runs share one table because to the
   * person planning the next comparison they are the same kind of thing
   * (ui-spec §五).
   *
   * Read-only, and degrading rather than refusing: a composition without
   * mission lists drafts only, a session without a datasets binding lists runs
   * only, and each gap comes back as a sentence in `notes`. That is deliberate
   * — an empty list with no explanation is the one answer a planning view must
   * never give.
   * @param options - resolved exactly as {@link EvalService.conditions} does,
   *   `agent: true` included.
   * @returns the rows, newest run first, then the drafts by name.
   */
  experiments(
    options: { repo?: string; dataset?: string; session?: { id: string }; agent?: boolean } = {},
  ): Promise<EvalExperimentsResult> {
    const mission = this.hosts?.get('mission') as MissionRunListFace | undefined
    const scope = this.resolveRepoScope(options)
    const resolved = scope instanceof EvalReadRefused ? undefined : scope
    return listExperiments({
      ...(mission === undefined ? {} : { mission }),
      ...(resolved === undefined ? {} : { repo: resolved.repo }),
      ...(resolved?.datasets === undefined ? {} : { datasets: resolved.datasets }),
      jobs: this.jobs.list(),
    })
  }

  /**
   * One started experiment's OVERVIEW: the list row, the run.meta digest, the
   * readiness records verbatim, the bucket and stage histograms, the leak
   * warning, and this instance's job record for the run.
   *
   * A DRAFT has no run and therefore no detail here — its overview is the list
   * row, which already carries the plan digest. The plan-review page (T36) is
   * where a draft gets a page of its own.
   * @param runId - the run to project.
   * @throws {@link EvalReadRefused} when the composition mounts no mission
   *   service — the run ledger lives there, so there is nothing to read.
   */
  experiment(runId: string): EvalExperimentDetail {
    const mission = this.hosts?.get('mission') as MissionRunListFace | undefined
    if (mission === undefined) {
      // Named without its scope like the two read verbs above: a sentence for
      // a human, not a dependency edge.
      throw new EvalReadRefused(
        'no mission service: run records live in the mission ledger, so this composition cannot open an experiment '
        + '— mount the dsh-mission plugin',
      )
    }
    return experimentDetail(mission, runId, this.jobs.list())
  }

  /**
   * DRAFT an experiment — step 2 of ui-spec §七, and the one verb its three
   * faces share: the 新建实验 form's Remote, the `eval_plan_draft` tool, and
   * the `eval-planning` skill that tells an agent to call it.
   *
   * One action where there were two. Writing `plans/<name>.json`, writing each
   * new condition beside it and then validating the result used to be three
   * separate things an agent did with `write` and hoped it had spelled right,
   * and a person could not do at all. Here they are one call: the files land in
   * the session's bound repository (its pass-through area — `plans/` and
   * `conditions/`, the 其他文件 slot of ui-spec §三), nothing is committed, and
   * the same `validatePlan` every other face runs judges what was written.
   *
   * Drafting is NOT starting. There is no path from this verb to `runStart`,
   * and a plan validate rejects still lands on disk — it is a 草稿, which is
   * what the lab list calls it, and 批准并启动 stays the plan-review page's
   * button (R1). The refusals here are the cases where there would be no draft
   * to look at: an unresolvable repository, a name that is not a file name, a
   * source condition that does not exist, a target file that does.
   * @param request - ui-spec §五's fields, flat.
   * @param options - the calling session (its dataset binding resolves the
   *   repository), and whether the caller is the model-tool face — where
   *   `request.repo` may only restate the binding, never choose a repository.
   * @returns where the files landed, what the plan names, and validate's verdict.
   * @throws {@link EvalReadRefused} when no dataset repository can be resolved,
   *   or the named set is outside this session's binding.
   * @throws {@link EvalDraftRefused} when the draft cannot be written.
   */
  async draftExperiment(
    request: EvalDraftRequest,
    options: { session?: { id: string }; agent?: boolean } = {},
  ): Promise<EvalDraftResult> {
    const scope = this.resolveRepoScope({
      ...(request.repo === undefined ? {} : { repo: request.repo }),
      dataset: request.dataset,
      ...(options.session === undefined ? {} : { session: options.session }),
      ...(options.agent === undefined ? {} : { agent: options.agent }),
    })
    if (scope instanceof EvalReadRefused) throw scope
    const write = await writeDraft({
      repo: scope.repo,
      dataset: request.dataset,
      name: request.name,
      ...(request.commit === undefined ? {} : { commit: request.commit }),
      items: request.items,
      conditions: request.conditions,
      ...(request.newConditions === undefined ? {} : { newConditions: request.newConditions }),
      ...(request.judgeConditions === undefined || request.judgeConditions.length === 0
        ? {}
        : {
          judge: {
            conditions: request.judgeConditions,
            ...(request.judgeSamples === undefined ? {} : { samples: request.judgeSamples }),
          },
        }),
      reps: request.reps,
      stages: request.stages,
      order: { seed: request.seed, ...(request.interleave === undefined ? {} : { interleave: request.interleave }) },
      budget: { activeMinutes: request.activeMinutes, turns: request.turns },
      ...(request.expectedNs === undefined ? {} : { expectedNs: request.expectedNs }),
      ...(request.retryInfrastructure === undefined ? {} : { retryInfrastructure: request.retryInfrastructure }),
      ...(request.unit === undefined
        ? {}
        : {
          unit: {
            image: request.unit.image,
            ...(request.unit.network === undefined ? {} : { network: request.unit.network }),
            ...(request.unit.user === undefined ? {} : { user: request.unit.user }),
            ...(request.unit.egressCommand === undefined || request.unit.egressCommand.length === 0
              ? {}
              : {
                egressCheck: {
                  command: request.unit.egressCommand,
                  ...(request.unit.egressTimeoutMs === undefined ? {} : { timeoutMs: request.unit.egressTimeoutMs }),
                },
              }),
          },
        }),
      ...(request.exports === undefined ? {} : { exports: request.exports }),
      ...(request.notes === undefined ? {} : { notes: request.notes }),
    })
    // The review page's own projection, not a summary of it: what an agent
    // reports to a person and what that person then reads on the page come
    // from one call to one validate.
    return { ...write, review: await this.planReview(write.planPath) }
  }

  /**
   * What the 新建实验 form may offer: the dataset sets of the session's bound
   * repository, each with the items it declares and the stage schemas it
   * ships. One read fills every picker on the form.
   *
   * Degrades rather than refusing, like the lab list: a repository with no
   * `datasets/` directory answers with an empty list and a sentence saying so.
   * @param options - `repo` wins; otherwise the session's binding decides, and
   *   its dataset whitelist is honoured.
   * @throws {@link EvalReadRefused} when no repository can be resolved at all.
   */
  draftOptions(options: { repo?: string; session?: { id: string } } = {}): Promise<EvalDraftOptionsView> {
    const scope = this.resolveRepoScope(options)
    if (scope instanceof EvalReadRefused) return Promise.reject(scope)
    return readDraftOptions(scope.repo, scope.datasets)
  }

  /**
   * The PLAN-REVIEW page (ui-spec §五, step 3): the plan's own fields, and
   * `validatePlan`'s verdict as a flat `ok / warn / error` list. The same
   * function `dsh-eval validate` runs, rearranged for reading — the page and
   * the CLI cannot disagree about whether a plan is approvable.
   * @param planPath - path to a `dataseek.plan/1` document (`~` expanded).
   */
  planReview(planPath: string): Promise<EvalPlanReview> {
    return reviewPlan(planPath)
  }

  /**
   * The CONDITIONS page (ui-spec §五, step 4): {@link EvalService.conditions}
   * projected onto the table the page draws — harness, declared model, scope,
   * preset, the lock and the readiness word.
   * @param options - the same repo / dataset / session resolution the listing uses.
   */
  async conditionsPage(options: { repo?: string; dataset?: string; session?: { id: string } } = {}): Promise<EvalConditionsView> {
    return conditionsView(await this.conditions(options))
  }

  /**
   * PROVISION one condition of the session's bound repository — the
   * conditions page's one write-class action, and a human's click.
   *
   * It is {@link EvalService.provision} with the repository resolved from the
   * binding instead of a flag, which is what makes it ONE action: the same
   * call hashes the scoped home, corrects the declaration's `home.sha`,
   * re-hashes the condition and writes the lock against the document as it now
   * reads. Before I5·T58 the page had no provision at all and the slash
   * command needed two runs with a 64-character transcription between them
   * (I5·T39 · G7).
   *
   * Never a model tool. Provisioning materializes a scoped home and anchors
   * what a subject IS — R1 keeps it on the human side with 批准并启动 and
   * 终评.
   * @param request - the set, the condition, and whether to leave the
   *   declaration alone (the two-step shape).
   * @param options - the calling session; its binding names the working copy
   *   the lock is written into.
   * @returns what provision did, plus the registry row as it now reads.
   * @throws {@link EvalReadRefused} when no repository is bound.
   * @throws {@link EvalProvisionRefused} when provisioning cannot begin.
   */
  async provisionCondition(
    request: EvalConditionProvisionRequest,
    options: { session?: { id: string } } = {},
  ): Promise<EvalConditionProvisionView> {
    const scope = this.resolveRepoScope({
      dataset: request.dataset,
      ...(options.session === undefined ? {} : { session: options.session }),
    })
    if (scope instanceof EvalReadRefused) throw scope
    const conditionPath = conditionPathIn(scope.repo, request.dataset, request.condition)
    const report = await this.provision(conditionPath, {
      repo: scope.repo,
      ...(request.keepDeclaration === true ? { writeBack: false } : {}),
    })
    return {
      condition: report.condition,
      dataset: request.dataset,
      conditionPath: report.conditionPath,
      homeDir: report.homeDir,
      credentialState: report.credentialState,
      written: report.written,
      homeShaWritten: report.homeShaWritten,
      sha: report.sha,
      homeSha: report.home?.sha ?? null,
      checks: provisionChecks(report),
      row: await this.conditionRowOf(scope.repo, request.dataset, request.condition),
    }
  }

  /**
   * Set one condition's `model.endpoint` — the conditions page's other write,
   * and the only field of an existing declaration any face may change.
   *
   * It is a FACTOR edit: `model.endpoint` is condition-hash input, so the
   * subject changes identity and any lock beside it goes stale. The answer
   * says which, and provisioning again is the next click rather than something
   * this verb does on its own — a write that silently re-anchored a subject
   * would make «what is this condition» depend on when it was last looked at.
   * @param request - the set, the condition, and the value.
   * @param options - the calling session; its binding names the working copy.
   * @returns what changed, and the registry row as it now reads.
   * @throws {@link EvalReadRefused} when no repository is bound.
   * @throws {@link EvalConditionEditRefused} when the declaration cannot be edited.
   */
  async setConditionEndpoint(
    request: EvalConditionEndpointRequest,
    options: { session?: { id: string } } = {},
  ): Promise<EvalConditionEndpointView> {
    const scope = this.resolveRepoScope({
      dataset: request.dataset,
      ...(options.session === undefined ? {} : { session: options.session }),
    })
    if (scope instanceof EvalReadRefused) throw scope
    const report = await writeConditionEndpoint({
      repo: scope.repo,
      dataset: request.dataset,
      condition: request.condition,
      endpoint: request.endpoint,
    })
    const row = await this.conditionRowOf(scope.repo, request.dataset, request.condition)
    return {
      condition: report.condition,
      dataset: report.dataset,
      conditionPath: report.conditionPath,
      before: report.before,
      after: report.after,
      sha: report.sha,
      written: report.written,
      lockStale: row !== null && row.lock.present && !row.lock.matches,
      row,
    }
  }

  /**
   * One condition's registry row, re-read after a write so the page never has
   * to guess what its own action produced. Null rather than a throw when the
   * listing cannot be retaken: the action already happened and its report is
   * the answer — a failure to re-read is not a failure to provision.
   * @param repo - the resolved repository.
   * @param dataset - the set.
   * @param condition - the condition id.
   */
  private async conditionRowOf(repo: string, dataset: string, condition: string): Promise<EvalConditionRow | null> {
    try {
      const view = conditionsView(await listConditions(repo, [dataset]))
      return view.rows.find(row => row.id === condition) ?? null
    } catch {
      return null
    }
  }

  /**
   * The CONDITIONS page's diff: {@link EvalService.conditionDiff} with each
   * side's value as canonical JSON text, and ONLY the fields that differ.
   * @param options - the two references, plus the usual repo / dataset / session resolution.
   */
  async conditionDiffPage(options: { a: string; b: string; repo?: string; dataset?: string; session?: { id: string } }): Promise<EvalConditionDiffView> {
    return conditionDiffView(await this.conditionDiff(options))
  }

  /**
   * APPROVE a plan and start it — the human act of ui-spec step 5, and the one
   * verb in this package that a human's click reaches and a model's tool call
   * never does (R1).
   *
   * Validate runs FIRST and an error refuses the whole thing: a run started
   * over a plan whose conditions do not resolve burns real delegations to
   * discover what an offline check already knew. Warnings do not refuse —
   * `dataset.commit: null` is the normal shape of a plan whose snapshot pins
   * at run start.
   *
   * The refusal is a RESULT, not a throw: the caller renders the same check
   * list either way, and the reason belongs beside the list that explains it.
   * Wiring failures (no job registry, no live parent agent) are caught here
   * for the same reason and arrive verbatim in `refusal`.
   * The run it starts walks the release gate cell by cell, which is the
   * default everywhere since T57; `keepUnits` is the dialog's 保留单元 box,
   * and the ONE reason it exists is a container a human wants to open
   * afterwards. It is off unless the approver ticked it.
   * @param planPath - path to a `dataseek.plan/1` document (`~` expanded).
   * @param options - the approving session (the run's parent), its workspace,
   *   and whether the approver asked to keep the units.
   * @returns what validate said, and — when it started — the job and run ids.
   */
  async approve(planPath: string, options: { parentSessionId: string; cwd?: string; keepUnits?: boolean }): Promise<EvalApproveResult> {
    const review = await this.planReview(planPath)
    const refused = (refusal: string): EvalApproveResult => ({
      started: false,
      checks: review.checks,
      refusal,
      jobId: null,
      runId: null,
      parentSessionId: null,
    })
    if (!review.ok) {
      const errors = review.checks.filter(check => check.severity === 'error')
      return refused(
        `validate refuses this plan (${errors.length} error(s)) — nothing was started:\n`
        + errors.map(check => `  [${check.code}] ${check.message}`).join('\n'),
      )
    }
    try {
      const handle = await this.runStart(planPath, {
        parentSessionId: options.parentSessionId,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.keepUnits === true ? { keepUnits: true } : {}),
        label: `eval run ${planPath} (approved)`,
      })
      return {
        started: true,
        checks: review.checks,
        refusal: null,
        jobId: handle.jobId,
        runId: handle.runId,
        parentSessionId: handle.parentSessionId,
      }
    } catch (error) {
      return refused(`the run could not start: ${error instanceof Error ? error.message : String(error)}`)
    }
  }


  /**
   * The MATRIX page: this run's cells arranged rows-are-tasks, one factor on
   * the columns, the rest banded or pinned (ui-spec §五). The arrangement rule
   * is the pure {@link pivotMatrix}; this verb only feeds it — the ledger's
   * cells, the run's condition documents, and the per-attempt materialization
   * digest read from the run-data tree.
   *
   * The digest read is why this verb is async: the hash the「题面一致」
   * invariant compares lives in `materialization.json` beside each attempt,
   * not in the ledger. A composition whose mission face reports no `dataDir`
   * simply gets `unverifiable` — the matrix never invents a hash.
   * @param runId - the run to arrange.
   * @param options - which factor is the column, what is banded, what is pinned.
   * @throws {@link EvalReadRefused} when the composition mounts no mission service.
   */
  async matrix(runId: string, options: {
    column?: string
    groupBy?: readonly string[]
    filter?: Readonly<Record<string, string>>
    stuckMs?: number
    now?: number
  } = {}): Promise<EvalMatrixView> {
    const mission = this.requireMissionRead('arrange a run\'s matrix')
    const report = runCells(mission, runId, options.now === undefined ? {} : { now: options.now })
    const status = mission.runStatus(runId)
    const conditions = metaConditionDocuments(status.run.meta)
    const cells: MatrixInputCell[] = await Promise.all(report.cells.map(async cell => ({
      missionId: cell.missionId,
      task: cell.task,
      condition: cell.condition,
      rep: cell.rep,
      state: cell.state,
      bucket: cell.bucket,
      inStateMs: cell.inStateMs,
      materializationSha: await materializationShaOf(mission.dataDir, runId, cell.missionId, cell.attempt),
      fingerprint: cell.refs.fingerprint,
    })))
    return pivotMatrix({
      runId: status.run.id,
      conditions,
      cells,
      unreleased: status.unreleased,
      ...(options.column === undefined ? {} : { column: options.column }),
      ...(options.groupBy === undefined ? {} : { groupBy: options.groupBy }),
      ...(options.filter === undefined ? {} : { filter: options.filter }),
      ...(options.stuckMs === undefined ? {} : { stuckMs: options.stuckMs }),
    })
  }

  /**
   * The CELLS page's table: the same {@link EvalService.cells} projection,
   * narrowed to the columns the table shows. One implementation, two shapes —
   * the model reads the whole `cells` answer, the tab reads this.
   * @param runId - the run.
   * @param query - the same exact-match filters `cells` takes.
   * @throws {@link EvalReadRefused} when the composition mounts no mission service.
   */
  cellRows(runId: string, query: RunCellsQuery = {}): EvalCellsResult {
    const report = this.cells(runId, query)
    return {
      runId: report.runId,
      state: report.state,
      filter: report.filter,
      total: report.total,
      matched: report.matched,
      buckets: report.buckets,
      rows: report.cells.map(cell => ({
        missionId: cell.missionId,
        task: cell.task,
        condition: cell.condition,
        rep: cell.rep,
        state: cell.state,
        bucket: cell.bucket,
        attempt: cell.attempt,
        inStateMs: cell.inStateMs,
        refs: { resource: cell.refs.resource, fingerprint: cell.refs.fingerprint },
        checkpoints: [...cell.checkpoints],
        annotations: { ...cell.annotations },
        childSessionId: cell.childSessionId,
      })),
    }
  }

  /**
   * ONE cell in full — the drawer's payload (attempts, checkpoints, artifacts,
   * annotation namespaces, the verify output verbatim, the child session, and
   * the release answer).
   * @param runId - the run.
   * @param missionId - the cell.
   * @param options - the clock the duration is taken against.
   * @throws {@link EvalReadRefused} when mission is absent, or the cell is not in the run.
   */
  // `async` so the refusal is a REJECTION: the signature promises a promise,
  // and a caller that only attached `.catch` would otherwise be hit by a
  // synchronous throw.
  async cell(runId: string, missionId: string, options: { now?: number } = {}): Promise<EvalCellDetail> {
    const mission = this.requireMissionRead('open a cell')
    return await runCellDetail(mission, this.missionActions(), runId, missionId, options)
  }

  /**
   * Re-run one cell: open a fresh attempt. A HUMAN gesture from the drawer,
   * forwarded to mission unchanged — including its demand for an auditable
   * reason, which this verb re-states rather than relaxes.
   * @param runId - the run.
   * @param missionId - the cell.
   * @param options - the reason (required, non-empty), mission's retry
   *   category, and the caller tag recorded on the attempt.
   * @returns the new attempt number.
   * @throws {@link EvalReadRefused} when no mission service is mounted, or the
   *   reason is blank — an attempt nobody can account for is worse than none.
   */
  retryCell(runId: string, missionId: string, options: { reason: string; category: string; by?: string }): Promise<{ attempt: number }> {
    const actions = this.missionActions()
    if (actions === undefined) {
      return Promise.reject(new EvalReadRefused(
        'no mission service: attempts live in the mission ledger, so this composition cannot re-run a cell '
        + '— mount the dsh-mission plugin',
      ))
    }
    const reason = options.reason.trim()
    if (reason === '') {
      return Promise.reject(new EvalReadRefused('retry needs a reason: every fresh attempt is recorded with why it was opened'))
    }
    return actions.retry(missionId, {
      runId,
      reason,
      category: options.category,
      ...(options.by === undefined ? {} : { by: options.by }),
    })
  }

  /**
   * The release check: may this cell's resources be destroyed? Asked BEFORE
   * anything is destroyed, and answered by the state machine's own
   * `releasableStates` — eval adds no opinion.
   * @param runId - the run.
   * @param missionId - the cell.
   * @throws {@link EvalReadRefused} when no mission service is mounted.
   */
  releaseCheck(runId: string, missionId: string): { missionId: string; releasable: boolean } {
    const actions = this.missionActions()
    if (actions === undefined) {
      throw new EvalReadRefused(
        'no mission service: the release gate lives in the mission ledger, so this composition cannot answer '
        + '— mount the dsh-mission plugin',
      )
    }
    return { missionId, releasable: actions.isReleasable(missionId, runId) }
  }

  /**
   * The export dialog's first step, forwarded to mission's own Remote:
   * which layers would be written and which of them are GUARDED
   * (`modelFacing: false`, resolved through the datasets probe).
   *
   * Forwarded rather than re-derived on purpose. The guarded set and the
   * fail-closed gate are mission's, and a second implementation of a leak gate
   * is a second place for it to be wrong — eval relays the caller's
   * confirmations and can neither narrow nor widen them.
   * @param agent - the calling agent, passed through unchanged.
   * @param request - run, output directory, layers, snapshot reference.
   * @throws {@link EvalReadRefused} when mission's Remote is not mounted.
   */
  exportPlan(agent: unknown, request: EvalExportPlanRequest): Promise<EvalExportPlanView> {
    const remote = this.missionExport()
    if (remote === undefined) return Promise.reject(MISSION_EXPORT_ABSENT)
    return remote.exportPlan(agent, request)
  }

  /**
   * The export dialog's confirm step, forwarded the same way. mission
   * re-checks the `confirmed` list against a FRESH plan and refuses when a
   * guarded layer is unconfirmed — a dialog-stale confirmation never
   * authorizes a changed layer set, and that check stays on mission's side.
   *
   * ONE ACTION, two files since I5·T60: the bundle is mission's, and the
   * report (`report/summary.md` + `results.jsonl` + `usage.jsonl`) is written
   * into it here, by the same function `dsh-eval report` calls. The page used
   * to export and then print a command line for the reader to go and run —
   * which is how a walkthrough with every surface on screen still ended at a
   * terminal (I5·T39 · G15). Where the bundle went is recorded as a run-level
   * note in the same breath, because `run.meta` cannot say (I5·T53).
   * @param agent - the calling agent, passed through unchanged.
   * @param request - the export plus the confirmed guarded layers.
   * @param by - caller tag recorded against the run's export note.
   * @throws {@link EvalReadRefused} when mission's Remote is not mounted.
   */
  async exportRun(agent: unknown, request: EvalExportRunRequest, by?: string): Promise<EvalExportResultView> {
    const remote = this.missionExport()
    if (remote === undefined) throw MISSION_EXPORT_ABSENT
    const exported = await remote.exportRun(agent, request)
    return await this.completeExport(exported, request, by)
  }

  /**
   * EXPORT AGAIN, after the final verdicts — the report page's and the judge
   * bench's one-click repeat (I5·T39 · G17).
   *
   * The bundle is written when the run ends and the human-final verdicts are
   * written afterwards, from a page the bundle knows nothing about. Nothing
   * carried them in: the fix was to export a second time and re-run the report
   * command, and neither surface said so. This verb repeats the export the
   * run's own note recorded — the same layers, the same snapshot reference —
   * into a FRESH directory beside the first, and writes the report into it.
   *
   * It repeats and never widens. The layers come from the note, so a re-export
   * can only include what a person already confirmed; if one of them has since
   * become guarded, mission's fail-closed gate refuses the whole call and the
   * reader goes through the dialog, which is the only place a guarded layer is
   * ever confirmed. The old directory is left exactly as it was — somebody may
   * have quoted from it.
   * @param agent - the calling agent, passed through to mission unchanged.
   * @param request - the run to export again.
   * @param by - caller tag recorded against the new export note.
   * @throws {@link EvalReadRefused} when mission's Remote is absent, or when
   *   this run has no recorded export to repeat.
   */
  async reexportRun(agent: unknown, request: EvalReexportRequest, by?: string): Promise<EvalExportResultView> {
    const remote = this.missionExport()
    if (remote === undefined) throw MISSION_EXPORT_ABSENT
    const mission = this.requireMissionRead('export a run again')
    const note = readExportState(mission, request.runId).note
    if (note === null) {
      throw new EvalReadRefused(
        `run ${request.runId} records no earlier export to repeat — export it once from the dialog, `
        + 'which is where the layers and the guarded-layer confirmations are chosen; every export after that can be repeated here.',
      )
    }
    const repeated: EvalExportRunRequest = {
      runId: request.runId,
      outDir: reexportDirOf(note.outDir, Date.now()),
      layers: [...note.layers],
      ...(note.snapshotDir === null ? {} : { snapshotDir: note.snapshotDir }),
      ...(note.snapshot === null
        ? {}
        : {
          snapshot: {
            repo: note.snapshot.repo,
            commit: note.snapshot.commit,
            ...(note.snapshot.dataset === null ? {} : { dataset: note.snapshot.dataset }),
          },
        }),
      // Nothing guarded is re-confirmed here: a repeat may only carry what the
      // first export already carried, and mission re-checks that against a
      // FRESH plan. A layer that became guarded meanwhile refuses the call.
      confirmed: [],
    }
    const exported = await remote.exportRun(agent, repeated)
    return await this.completeExport(exported, repeated, by)
  }

  /**
   * The half of an export that is eval's: write the report INTO the bundle,
   * then record where the bundle went.
   *
   * Both are best-effort around an artifact that already exists. A bundle
   * whose report could not be rendered is still a bundle, and a note that the
   * ledger refused still leaves the directory on disk — so neither failure
   * turns a completed export into an error. What happened travels in the
   * answer instead, which is what lets the page say 「导出了，报告没写成」
   * rather than either lying or throwing.
   * @param exported - what mission's export answered.
   * @param request - the export as it was made (the note's content).
   * @param by - caller tag recorded against the note; defaults to `eval-export`.
   */
  private async completeExport(
    exported: { bundleDir: string; files: number },
    request: EvalExportRunRequest,
    by?: string,
  ): Promise<EvalExportResultView> {
    const exportedAt = Date.now()
    let summaryPath: string | null = null
    let reportRows = 0
    let reportError: string | null = null
    try {
      const written = await writeEvalReport(exported.bundleDir)
      summaryPath = written.summaryPath
      reportRows = written.rowCount
    } catch (error) {
      reportError = error instanceof Error ? error.message : String(error)
    }
    const note: EvalExportNote = {
      outDir: request.outDir,
      bundleDir: exported.bundleDir,
      exportedAt,
      layers: [...(request.layers ?? [])],
      snapshotDir: request.snapshotDir ?? null,
      snapshot: request.snapshot === undefined
        ? null
        : { repo: request.snapshot.repo, commit: request.snapshot.commit, dataset: request.snapshot.dataset ?? null },
      summaryPath,
      reportError,
    }
    const mission = this.hosts?.get('mission') as MissionReadFace | undefined
    const annotate = this.missionAnnotate()
    const recorded = mission === undefined || annotate === undefined
      ? { recorded: false, reason: 'no mission ledger in this composition' }
      : await recordExportNote(annotate, mission, request.runId, note, by ?? 'eval-export')
    return {
      bundleDir: exported.bundleDir,
      files: exported.files,
      exportedAt,
      summaryPath,
      reportRows,
      reportError,
      noteRecorded: recorded.recorded,
    }
  }

  /**
   * The JUDGE BENCH's queue (ui-spec step 8): every cell of the run as a
   * BLIND entry — an ordinal and an opaque ticket, its de-identified
   * material, the rubric's `human` criteria, every llm-draft sample already
   * recorded and whatever human-final it carries — plus the run's live
   * consistency numbers.
   *
   * Blind is a property of the PAYLOAD, not of the page: nothing naming a
   * condition, a harness or a model crosses this seam, so no amount of
   * client-side carelessness can unblind a grader. The report page is where
   * the same run is read with its labels on.
   * @param runId - the run whose cells are being graded.
   * @throws {@link EvalReadRefused} when no mission service is mounted.
   */
  // `async` so the refusal is a REJECTION, like `cell`: the signature promises
  // a promise, and a caller that only attached `.catch` would otherwise be hit
  // by a synchronous throw.
  async judgeQueue(runId: string): Promise<EvalJudgeQueueView> {
    const mission = this.requireMissionRead('open the judging queue')
    const datasets = this.hosts?.get('datasets') as DatasetsFace | undefined
    return await judgeQueueView({
      mission,
      runId,
      ...(datasets === undefined ? {} : { datasets }),
    })
  }

  /**
   * Write one cell's human-final verdicts — ui-spec step 8, and the ONLY door
   * `human-final` has in this family. A human's click, tagged by session, and
   * append-only: mission's `annotate` pushes and never rewrites.
   *
   * There is deliberately no model-facing twin of this verb, and adding one
   * would break R1 rather than extend it: 终评是人的 holds here because the
   * toolset has no path to this code, not because a check turns a model away.
   * @param runId - the run.
   * @param ticket - the blind handle the queue issued for the cell.
   * @param verdicts - one entry per criterion being answered.
   * @param sessionId - the calling session; recorded as `tab:<sessionId>`.
   * @throws {@link EvalReadRefused} when mission is absent, the ticket names
   *   no cell, or a verdict fails `dataseek.verdict/1`.
   */
  // `async` for the same reason as `judgeQueue`: every refusal on this verb
  // reaches the browser as a rejected RPC, never as a throw mid-call.
  async humanFinal(
    runId: string,
    ticket: string,
    verdicts: readonly EvalJudgeVerdictInput[],
    sessionId: string,
  ): Promise<EvalHumanFinalResult> {
    const mission = this.requireMissionRead('write a human-final verdict')
    const annotate = this.missionAnnotate()
    if (annotate === undefined) {
      throw new EvalReadRefused(
        'no mission annotate face: human-final verdicts live in the mission ledger, so this composition cannot record one '
        + '— mount the dsh-mission plugin',
      )
    }
    return await writeHumanFinal({ mission, annotate, runId, ticket, verdicts, sessionId })
  }

  /**
   * The 作答记录 of one dataset item: every evaluation run that answered it,
   * with its cells and their verdict counts. Consumed by the 题集 tab (T47);
   * degrades to an empty list plus a sentence when no ledger is mounted.
   * @param datasetId - the dataset set.
   * @param itemId - the item id (the cells' `task` label).
   */
  itemRuns(datasetId: string, itemId: string): EvalItemRunsResult {
    return runsForItem(this.hosts?.get('mission') as MissionRunListFace | undefined, datasetId, itemId)
  }

  /** The mission READ face, or a refusal naming what is missing. */
  private requireMissionRead(what: string): MissionReadFace {
    const mission = this.hosts?.get('mission') as MissionReadFace | undefined
    if (mission === undefined) {
      // Named without its scope like the other read verbs: a sentence for a
      // human, not a dependency edge.
      throw new EvalReadRefused(
        `no mission service: run records live in the mission ledger, so this composition cannot ${what} `
        + '— mount the dsh-mission plugin',
      )
    }
    return mission
  }

  /** The two mission writes the drawer forwards; undefined when mission is absent. */
  private missionActions(): MissionActionFace | undefined {
    const mission = this.hosts?.get('mission') as Partial<MissionActionFace> | undefined
    return typeof mission?.retry === 'function' && typeof mission.isReleasable === 'function'
      ? (mission as MissionActionFace)
      : undefined
  }

  /** The ONE mission write the judge bench makes; undefined when mission is absent. */
  private missionAnnotate(): MissionAnnotateFace | undefined {
    const mission = this.hosts?.get('mission') as Partial<MissionAnnotateFace> | undefined
    return typeof mission?.annotate === 'function' ? (mission as MissionAnnotateFace) : undefined
  }

  /** mission's own Remote service — the leak gate's one home. */
  private missionExport(): MissionExportRemoteFace | undefined {
    const remote = this.hosts?.get('missionRemote') as Partial<MissionExportRemoteFace> | undefined
    return typeof remote?.exportPlan === 'function' && typeof remote.exportRun === 'function'
      ? (remote as MissionExportRemoteFace)
      : undefined
  }

  /**
   * Generate a run template from a dataset-suite manifest (deterministic —
   * the same function `dsh-eval template` prints and the run loop writes
   * beside the plan).
   */
  generateTemplate(manifestPath: string, options?: GenerateTemplateOptions): Promise<GeneratedTemplate> {
    return generateTemplate(manifestPath, options)
  }

  /**
   * Run a plan: validate, snapshot, generate + write the template, expand
   * and order the matrix, then drive every cell to `archived` (or beyond
   * with `finalize`) and export the bundle. This is the body; `/eval run`
   * is its thin wrapper (decision 12).
   * @param planPath - path to a `dataseek.plan/1` document.
   * @param options - concurrency, dry-run, finalize, retry, export knobs.
   * @throws {@link EvalRunRefused} when the run is refused before executing.
   */
  run(planPath: string, options: RunOptions = {}): Promise<RunReport> {
    // Paths cross this seam from three faces — the slash command, the CLI,
    // and the Remote — and every one of them can carry a shell-unexpanded
    // `~`: a slash argument never saw a shell, and a CLI argument quoted to
    // survive one did not either. Expanding HERE means one rule for all
    // three instead of three call sites that must each remember.
    const plan = expandHome(planPath)
    const resolved: RunOptions = options.exportsDir === undefined
      ? options
      : { ...options, exportsDir: expandHome(options.exportsDir) }
    if (resolved.dryRun === true) {
      return runPlan(plan, resolved)
    }
    if (this.hosts === undefined) {
      return Promise.reject(new EvalRunRefused(
        'no host context: the run verb needs the datasets, mission, and localAgent services (the CLI supports --dry-run only)',
      ))
    }
    const datasets = this.hosts.get('datasets') as DatasetsFace | undefined
    const mission = this.hosts.get('mission') as MissionFace | undefined
    const localAgent = this.hosts.get('localAgent') as LocalAgentFace | undefined
    // Probed like the other three and just as optional: only a plan with a
    // `unit` segment needs it, and its absence is then a refusal that names
    // it — never a boot failure, never a silent fallback to the host path.
    const lab = this.hosts.get('lab') as LabFace | undefined
    // Provenance only: the orchestrating instance's own capability face goes
    // into run.meta and is never compared. Absent catalog, absent line.
    const capabilityCatalog = this.hosts.get('capabilityCatalog') as CapabilityCatalogFace | undefined
    const deps: Partial<RunDeps> & { stateRoot?: string } = {}
    if (datasets !== undefined) deps.datasets = datasets
    if (mission !== undefined) deps.mission = mission
    if (localAgent !== undefined) deps.localAgent = localAgent
    if (lab !== undefined) deps.lab = lab
    if (capabilityCatalog !== undefined) deps.capabilityCatalog = capabilityCatalog
    return runPlan(plan, resolved, deps)
  }

  /**
   * START a run in the background and answer immediately with its ids — the
   * default path of `/eval run` and the only path a CI runner has.
   *
   * The run is registered as an unowned `eval-run` job, so it outlives the
   * turn (and the session) that started it; its log lines are readable
   * through {@link runOutput} while it runs, and `job_kill` — through
   * {@link runCancel} — is its one cancellation entry.
   * @param planPath - path to a `dataseek.plan/1` document (`~` expanded).
   * @param options - the same run options `run` takes, minus the ones this
   *   owns (`runId`, `signal`).
   * @returns the job id, the minted run id, and the resolved parent session.
   * @throws {@link EvalJobsUnavailable} when the composition mounts no job
   *   registry (the caller then decides: `/eval run` waits synchronously and
   *   says so).
   */
  runStart(planPath: string, options: RunOptions & { cwd?: string; label?: string } = {}): Promise<EvalRunHandle> {
    const plan = expandHome(planPath)
    return this.jobs.start(
      runOptions => this.run(plan, runOptions),
      { ...options, plan, label: options.label ?? `eval run ${plan}` },
    )
  }

  /**
   * One background run's JOB status — lifecycle, not ledger. The run's CELLS
   * are `runStatus(runId)`, which reads mission; this one answers "is the job
   * still going, and what did it end as".
   * @param jobId - the id {@link runStart} returned.
   * @returns the status, or undefined when this service never started it.
   */
  runJobStatus(jobId: string): EvalRunStatus | undefined {
    return this.jobs.status(jobId)
  }

  /**
   * Read a background run's log from a cursor (non-consuming — the
   * model-facing `job_output` tool has its own cursor).
   * @param jobId - the id {@link runStart} returned.
   * @param cursor - the cursor from the previous read; absent reads from the top.
   * @returns the lines after the cursor, or undefined for an unknown job.
   */
  runJobOutput(jobId: string, cursor?: number): EvalRunOutput | undefined {
    return this.jobs.output(jobId, cursor)
  }

  /**
   * Cancel a background run. The same lever `job_kill` pulls, and the only
   * one: every in-flight delegation is cancelled and the cells the cancel
   * caught stay mid-stage, which is what makes `finalize` call them
   * `interrupted`.
   * @param jobId - the id {@link runStart} returned.
   * @returns what the registry did, or `unknown-job`.
   */
  runJobCancel(jobId: string): 'requested' | 'already-finished' | 'unknown-job' {
    return this.jobs.cancel(jobId)
  }

  /** Every background run this service started, in start order. */
  runJobList(): EvalRunStatus[] {
    return this.jobs.list()
  }

  /**
   * Finalize a run that already stopped at `archived`: walk every archived
   * cell through `archived → releasable → released` (the same gate
   * `/eval run --finalize` takes) and report every cell that was not
   * archived with its state. A gate refusal is recorded against that cell,
   * never forced — the re-entry point pilot A had to improvise with
   * per-cell `dsh-mission transition` calls (G13).
   * Since T57 the walk also RECLAIMS the units: each cell that passes the gate
   * has its container destroyed between the two transitions, exactly where the
   * run loop destroys it. lab is probed, not required — a host-path run has no
   * units and a composition without lab reports the list unknown rather than
   * claiming zero.
   * @param runId - the run to finalize.
   * @param options - caller tag and progress sink; the unit face is wired here.
   * @throws {@link EvalFinalizeRefused} when the composition mounts no
   *   mission service, or the run cannot be projected.
   */
  finalize(runId: string, options: FinalizeOptions = {}): Promise<FinalizeReport> {
    const mission = this.hosts?.get('mission') as MissionFinalizeFace | undefined
    if (mission === undefined) {
      return Promise.reject(new EvalFinalizeRefused(
        'no mission service: the release gate lives in the mission ledger, so this composition cannot finalize a run '
        + '— mount the dsh-mission plugin, or use the dsh-eval CLI (it drives the dsh-mission CLI in a child process)',
      ))
    }
    const lab = this.hosts?.get('lab') as FinalizeUnitsFace | undefined
    return finalizeRun(mission, runId, {
      ...options,
      ...(options.units !== undefined || lab === undefined ? {} : { units: lab }),
    })
  }

  /**
   * The REPORT page's payload (ui-spec §五): the four invariants, the paired
   * differences, the efficiency table and the judge numbers, read from the
   * run's exported bundle.
   *
   * A projection of an EXPORT, never of the ledger. The report's honesty rules
   * are `analyzeBundle`'s and stay there; this verb finds the bundle, hands it
   * over, and reshapes the answer. A run nobody has exported yet comes back
   * with `bundleDir: null` and the directories that were looked in — "not
   * exported" and "no report" are different facts, and only the first one has
   * a button.
   *
   * Writes NOTHING. `dsh-eval report --out` is still the way a report lands on
   * disk: where the archived artifact of a run goes is a human's decision, and
   * a page render must not make it.
   * @param runId - the run the page is open on.
   * @param options - the export directory to try first (the dialog's).
   * @throws {@link EvalReadRefused} when mission is absent, or the run is unknown.
   */
  runReport(runId: string, options: { outDir?: string } = {}): Promise<EvalRunReportView> {
    const mission = this.requireMissionRead('read a run\'s report')
    return runReportView(mission, runId, options)
  }

  /**
   * The units lab is holding for a run, RIGHT NOW — the report page's 未回收
   * count, and the one number that tells a reader whether the run actually
   * let go of its containers.
   *
   * Deliberately NOT mission's `unreleased`. That list is the ledger's belief,
   * derived from the refs a cell registered; this one is lab's own answer, and
   * the two disagree in exactly the case worth showing — a cell the ledger has
   * released whose container is still up, which is what T39's G18 found and
   * what no page could see. The cell's state is joined back on from the ledger
   * so the reader can tell a container the 回收 walk can still take (its cell
   * is `archived`) from one only `--force` can (its cell is `released`).
   *
   * A composition with no lab answers `available: false` — unknown, not zero.
   * @param runId - the run to ask about.
   * @returns the held units, or why the list is unknown.
   */
  async runUnits(runId: string): Promise<EvalRunUnitsView> {
    const lab = this.hosts?.get('lab') as FinalizeUnitsFace | undefined
    if (lab === undefined) {
      return {
        runId,
        available: false,
        units: [],
        refusal: 'no lab service: this composition runs no containers, so there is nothing to hold or reclaim',
      }
    }
    let rows: readonly LabUnitRow[]
    try {
      rows = await lab.status()
    } catch (error) {
      // A lab that cannot be asked is not a lab that holds nothing. The page
      // shows the refusal where the count would be.
      return {
        runId,
        available: false,
        units: [],
        refusal: `lab could not be asked which units this run holds: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    const states = new Map<string, string>()
    const mission = this.hosts?.get('mission') as MissionReadFace | undefined
    if (mission !== undefined) {
      try {
        for (const row of mission.runStatus(runId).rows) states.set(row.id, row.state)
      } catch {
        // An unknown run joins nothing; the units are still the units.
      }
    }
    return {
      runId,
      available: true,
      units: rows.filter(row => row.runId === runId).map(row => ({
        id: row.id,
        resource: row.resource,
        running: row.running,
        missionId: row.missionId ?? null,
        missionState: row.missionId === undefined ? null : states.get(row.missionId) ?? null,
      })),
      refusal: null,
    }
  }

  /**
   * {@link EvalService.finalize} for the report page's button: the same walk,
   * with its progress lines captured so the page can show what the gate said
   * cell by cell rather than only how many moved.
   * @param runId - the run to finalize.
   * @param by - caller tag recorded against the mission writes.
   * @throws {@link EvalFinalizeRefused} when mission is absent or the run cannot be projected.
   */
  async finalizeView(runId: string, by?: string): Promise<EvalFinalizeView> {
    const log: string[] = []
    const report = await this.finalize(runId, {
      log: (message) => { log.push(message) },
      ...(by === undefined ? {} : { by }),
    })
    return projectFinalize(report, log)
  }
}

export { EvalRunRefused } from './run.ts'
export type { RunOptions, RunReport, RunCellReport, RunSubset } from './run.ts'
export { EvalFinalizeRefused } from './finalize.ts'
export type { FinalizeOptions, FinalizeReport, FinalizeCellOutcome, FinalizeSkipCategory } from './finalize.ts'
export { EvalReadRefused } from './read.ts'
export { EvalWriteRefused } from './repo-write.ts'
export type { RepoWriteResult } from './repo-write.ts'
export type { ConditionDiff, ConditionFieldDiff, ConditionsReport, ConditionSummary, RunCellStatus, RunStatusReport } from './read.ts'
export { deriveExperimentStatus, experimentDetail, isJudgedOrBeyond, isReleased, listExperiments, runsForItem } from './experiments.ts'
export { conditionDiffView, conditionsView, reviewPlan } from './review.ts'
export { materializationShaOf, probeRunsOf, runCellDetail, summarizeAnnotations } from './cell-detail.ts'
export { DEFAULT_STUCK_MS, pivotMatrix, repDot } from './matrix-view.ts'
export { bundleDirOf, exportDirCandidates, projectFinalize, projectReport, runReportView } from './report-view.ts'
export type { MatrixInput, MatrixInputCell } from './matrix-view.ts'
export type { ExperimentsInput, ExperimentStatusInput } from './experiments.ts'
export { EvalProvisionRefused } from './provision.ts'
export { EvalDraftRefused, draftExperiment, draftOptions } from './draft.ts'
export type { DraftConditionEdit, DraftExperimentInput, DraftOptions, DraftWrite } from './draft.ts'
export type { ProvisionReport } from './provision.ts'
export type { ProvisionCheck } from './effective.ts'
