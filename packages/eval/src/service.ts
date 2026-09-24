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
  conditionDiagnostics, expandHome, validatePlan,
  type EvalDiagnostic, type PlanValidation, type ValidatePlanOptions,
} from './validate.ts'
import { generateTemplate, type GeneratedTemplate, type GenerateTemplateOptions } from './template.ts'
import {
  defaultStateRoot, runPlan, EvalRunRefused, type RunDeps, type RunExperiment, type RunOptions, type RunReport,
} from './run.ts'
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
import { writeAnalysisFile, type AnalysisWriteResult } from './analysis-write.ts'
import {
  conditionLibraryDir, conditionLibraryRoot, EvalExperimentError, readExperiment,
  type ExperimentRecord,
} from './experiment-store.ts'
import { listAnalysisFiles, readExperimentArtifact } from './experiment-artifact.ts'
import { composeExperimentGet, type EvalExperimentGetView } from './experiment-get.ts'
import { importExperiments, type ImportReport } from './import.ts'
import { recordArchive, recordClosure } from './closure.ts'
import { experimentDetail, listExperiments, pairRun, readPlans, runsForItem } from './experiments.ts'
import { materializationShaOf, runCellDetail } from './cell-detail.ts'
import { readCellArtifact } from './cell-artifact.ts'
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
  CapabilityCatalogFace, DatasetsFace, DatasetsRegistryFace, LabFace, LabUnitRow, LocalAgentFace, MissionActionFace,
  MissionAnnotateFace, MissionExportRemoteFace,
  MissionFace, MissionFinalizeFace, MissionReadFace, MissionRunListFace,
} from './faces.ts'
import { isDatasetsRegistryFace } from './faces.ts'
import type {
  EvalApproveResult, EvalArchiveWrite, EvalCellArtifactRequest, EvalClosureWrite, EvalCellArtifactView, EvalCellDetail, EvalCellsResult, EvalConditionDiffView,
  EvalConditionEndpointRequest, EvalConditionEndpointView,
  EvalConditionProvisionRequest, EvalConditionProvisionView, EvalConditionRow, EvalConditionsView,
  EvalDraftOptionsView, EvalDraftRequest, EvalDraftResult, EvalExperimentArtifactRequest, EvalExperimentArtifactView, EvalImportRequest,
  EvalExperimentDetail, EvalExperimentsResult, EvalExportPlanRequest, EvalExportPlanView, EvalExportResultView,
  EvalExportRunRequest, EvalFinalizeView, EvalHumanFinalResult, EvalItemRunsResult, EvalJudgeQueueView,
  EvalJudgeVerdictInput, EvalMatrixView, EvalPlanRequest, EvalPlanReview, EvalReexportRequest, EvalRunReportView, EvalRunUnitsView,
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
  validatePlan(planPath: string, options: Pick<ValidatePlanOptions, 'roots'> = {}): Promise<PlanValidation> {
    return validatePlan(expandHome(planPath), { ...this.scopeHomeDirResolver(), ...options })
  }

  /**
   * Validate one experiment's plan against what it pins: the dataset view
   * materialized at the experiment's commit and the deployment's condition
   * library. The plan's own dataset block locates nothing here — an imported
   * plan keeps its legacy `repo` verbatim, and that path must not decide what
   * is read.
   * @param experimentId - the experiment.
   * @throws {@link EvalReadRefused} when the experiment or its registration cannot be read.
   */
  async validateExperiment(experimentId: string): Promise<PlanValidation> {
    const record = await this.experimentRecord(experimentId)
    return this.validatePlan(record.planPath, { roots: await this.experimentRoots(record) })
  }

  /**
   * The eval state root: experiments, the condition library and the cell
   * directories all live under it.
   * @throws {@link EvalReadRefused} when DSH_HOME is unset.
   */
  stateRoot(): string {
    const root = defaultStateRoot()
    if (root === undefined) {
      throw new EvalReadRefused(
        'no eval state root: set DSH_HOME — experiments and the condition library live under $DSH_HOME/state/eval',
      )
    }
    return root
  }

  /**
   * The datasets REGISTRY face, which is how every dataset read is resolved
   * since T73: a registration id and a commit, never a path a session bound.
   * @throws {@link EvalReadRefused} when the composition mounts no registry.
   */
  private registryFace(): DatasetsRegistryFace {
    const face = this.hosts?.get('datasets')
    if (!isDatasetsRegistryFace(face)) {
      throw new EvalReadRefused(
        'no datasets registry: experiments pin a registered dataset repository at a commit, and this composition '
        + 'mounts no datasets service that can read one — mount the dsh-datasets plugin (register with `dsh datasets register`)',
      )
    }
    return face
  }

  /**
   * Read one experiment, the refusal worded for whoever asked.
   * @throws {@link EvalReadRefused} when the id is malformed or names nothing here.
   */
  async experimentRecord(experimentId: string): Promise<ExperimentRecord> {
    try {
      return await readExperiment(this.stateRoot(), experimentId)
    } catch (error) {
      if (error instanceof EvalExperimentError) throw new EvalReadRefused(error.message)
      throw error
    }
  }

  /** Where an experiment's plan is checked against: its pinned dataset view and the condition library. */
  private async experimentRoots(record: ExperimentRecord): Promise<{ datasetRoot: string; conditionsRoot: string }> {
    const pin = record.meta.dataset
    let view: { path: string }
    try {
      view = await this.registryFace().datasetView(pin.registry, pin.set, pin.commit)
    } catch (error) {
      if (error instanceof EvalReadRefused) throw error
      throw new EvalReadRefused(
        `experiment ${record.id}: cannot read ${pin.registry}/${pin.set} at ${pin.commit.slice(0, 7)} — `
        + (error instanceof Error ? error.message : String(error)),
      )
    }
    return { datasetRoot: view.path, conditionsRoot: conditionLibraryRoot(this.stateRoot()) }
  }

  /**
   * Everything the run loop needs about an experiment: the plan path and the
   * {@link RunExperiment} it writes into run.meta and reads its roots from.
   * @throws {@link EvalReadRefused} when the experiment or its registration cannot be read.
   */
  private async runExperimentOf(experimentId: string): Promise<{ planPath: string; experiment: RunExperiment }> {
    const record = await this.experimentRecord(experimentId)
    const pin = record.meta.dataset
    const roots = await this.experimentRoots(record)
    const registration = await this.registryFace().registration(pin.registry)
    return {
      planPath: record.planPath,
      experiment: { id: record.id, dir: record.dir, dataset: { ...pin }, roots, repo: registration.commonDir },
    }
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
   * WRITE one text file into an experiment's `analysis/` — the analysis
   * draft's door (ui-spec §六; I5·T39 · G16; T73).
   *
   * The narrowest write in this family, and narrow on purpose: one prefix,
   * `analysis/<path>`, rooted at the experiment directory. The dataset
   * repository is read-only input and never writable here. The answer carries
   * the read-back confirmation an agent relays: where the file is and that the
   * report page shows it.
   * @param options - the experiment, the path (experiment-relative), the text,
   *   and whether an existing file may be replaced.
   * @throws {@link EvalReadRefused} when the experiment cannot be read.
   * @throws {@link EvalWriteRefused} when the path is outside the door.
   */
  async writeAnalysis(options: {
    experimentId: string
    path: string
    content: string
    overwrite?: boolean
  }): Promise<AnalysisWriteResult & { confirmation: string }> {
    const record = await this.experimentRecord(options.experimentId)
    const result = await writeAnalysisFile(record, options.path, options.content, {
      ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
    })
    return {
      ...result,
      confirmation: `已写入实验 ${record.id} 的 ${result.relativePath}（${String(result.bytes)} 字节）。在结果对比页可看。`,
    }
  }

  /**
   * Read one file of one experiment in place — the report page's 分析初稿
   * block. Only that experiment's directory, text only, cut past the size
   * limit and said so.
   * @throws {@link EvalReadRefused} when the experiment cannot be read or the path is refused.
   */
  async experimentArtifact(request: EvalExperimentArtifactRequest): Promise<EvalExperimentArtifactView> {
    const record = await this.experimentRecord(request.experimentId)
    return readExperimentArtifact(record, request.path)
  }

  /**
   * List the deployment's CONDITION LIBRARY (`$DSH_HOME/state/eval/conditions`)
   * with hashes and readiness (lock present and matching, scoped home
   * verified, unresolved fields). Read-only: minting a condition is what a
   * draft does, and turning one into a real scoped home is provision.
   * @throws {@link EvalReadRefused} when DSH_HOME is unset.
   */
  conditions(): Promise<ConditionsReport> {
    return listConditions(conditionLibraryRoot(this.stateRoot()), this.scopeHomeDirResolver())
  }

  /**
   * Diff two library conditions field by field — SHOWS, never chooses. Two
   * conditions that differ in exactly one field are a single-factor pair,
   * which is worth seeing; whether the pair is worth running depends on things
   * no file knows, so the verb stops at the facts.
   * @param options - the two references (a condition id, or a path).
   * @throws {@link EvalReadRefused} when a side cannot be resolved.
   */
  conditionDiff(options: { a: string; b: string }): Promise<ConditionDiff> {
    return diffConditions(conditionLibraryRoot(this.stateRoot()), options.a, options.b)
  }

  /**
   * Provision one condition: resolve its `(harness, scope)` to a real scoped
   * home, refuse unless that scope holds a credential, check the declaration
   * against the scope's effective settings field by field, hash the home, and
   * write `conditions/<id>.lock.json` beside the declaration.
   *
   * The ONE writer of a condition lock. Writes go only into the directory
   * `repo` names — since T73 the deployment's condition library; a dataset
   * repository is never written.
   * @param conditionPath - path to the declaration (`~` expanded).
   * @param options - the library directory to write into, and whether provision may
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
        + ' — run it from a live session (/eval conditions provision <condition id>), or mount the dsh-local-agent plugin',
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
    const ledger = runStatus(mission, runId)
    // The same row the lab list derives, so the tool and the page say one word.
    const { row } = experimentDetail(mission, runId, this.jobs.list())
    return {
      ...ledger,
      status: row.status,
      stalledMinutes: row.stalledMinutes,
      closure: row.closure,
      archived: row.archived,
    }
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
   * eval started, plus every experiment in this deployment nobody has started
   * yet. Drafts and runs share one table because to the person planning the
   * next comparison they are the same kind of thing (ui-spec §五).
   *
   * Read-only, and degrading rather than refusing: a composition without
   * mission lists experiments only, a deployment without DSH_HOME lists runs
   * only, and each gap comes back as a sentence in `notes`. A run is paired
   * with its experiment by `run.meta.experimentId`, else by plan hash, else by
   * plan path; an old run that pairs with nothing is listed as one.
   * @param options - the calling session, echoed back.
   * @returns the rows, newest run first, then the unstarted experiments.
   */
  experiments(options: { session?: { id: string } } = {}): Promise<EvalExperimentsResult> {
    const mission = this.hosts?.get('mission') as MissionRunListFace | undefined
    const stateRoot = defaultStateRoot()
    return listExperiments({
      ...(mission === undefined ? {} : { mission }),
      ...(stateRoot === undefined ? {} : { stateRoot }),
      validate: async record => this.validatePlan(record.planPath, { roots: await this.experimentRoots(record) }),
      ...(options.session === undefined ? {} : { session: options.session.id }),
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
   * ONE experiment as the lab tab reads it, in one read — the
   * `eval_experiment_get` tool (I5·T76): the list row, the newest run's
   * digest and bucket counts, and the ANSWER INDEX (every 题 × 组 × 次 with the
   * names of the files its attempt registered). Composed from the reads the
   * page already makes (`experiments`, `runStatus`, `cells`), so the numbers
   * agree with it by construction; no path of this machine is in the answer.
   *
   * Read-only, and degrading: a draft answers with its row and an empty
   * index, a composition without mission answers with the row and a note.
   * @param ref - the experiment id, the list row id, or a run id.
   * @param options - the calling session, for the list's session split.
   * @throws {@link EvalReadRefused} when the ref names no experiment here.
   */
  async experimentGet(ref: string, options: { session?: { id: string } } = {}): Promise<EvalExperimentGetView> {
    const list = await this.experiments(options)
    const rows = list.rows.filter(row => row.experimentId === ref || row.id === ref || row.runId === ref)
    const first = rows[0]
    if (first === undefined) {
      throw new EvalReadRefused(`no experiment "${ref}" in this deployment — eval_cells (no run_id) lists them`)
    }
    // A run id names one run; an experiment id names every run of it, newest first (the list's own order).
    const scoped = first.experimentId === null || rows.some(row => row.runId === ref)
      ? rows
      : list.rows.filter(row => row.experimentId === first.experimentId)
    const notes = [...list.notes]
    const newest = scoped.find(row => row.runId !== null)
    const mission = this.hosts?.get('mission') as MissionReadFace | undefined
    let status: RunStatusReport | undefined
    let cells: RunCellsReport | undefined
    if (newest?.runId != null) {
      if (mission === undefined) {
        notes.push('no mission service: the run digest and the answer index live in the mission ledger')
      } else {
        status = this.runStatus(newest.runId)
        cells = this.cells(newest.runId)
      }
    }
    let analysis: string[] = []
    if (first.experimentId !== null) {
      const record = await this.experimentRecord(first.experimentId).catch(() => undefined)
      if (record !== undefined) analysis = (await listAnalysisFiles(record.dir)).map(file => file.name)
    }
    return composeExperimentGet({
      rows: scoped,
      ...(status === undefined ? {} : { status }),
      ...(cells === undefined ? {} : { cells }),
      ...(mission === undefined ? {} : { mission }),
      analysis,
      notes,
    })
  }

  /**
   * DRAFT an experiment — step 2 of ui-spec §七, and the one verb its three
   * faces share: the 新建实验 form's Remote, the `eval_plan_draft` tool, and
   * the `eval-planning` skill that tells an agent to call it.
   *
   * One call writes the experiment directory (`plan.json` + `meta.json`,
   * read back before it answers), mints each new condition into the
   * deployment's library, and runs the same `validatePlan` every other face
   * runs against what was written. The dataset is named `<registration>/<set>`
   * and pinned at a commit chosen by the version rule (dataset-version.ts): a
   * version that is not unique is refused, and the agent asks the person.
   *
   * Drafting is NOT starting. There is no path from this verb to `runStart`,
   * and a plan validate rejects still lands on disk — it is a 草稿, which is
   * what the lab list calls it, and 批准并启动 stays the plan-review page's
   * button (R1). The refusals here are the cases where there would be no draft
   * to look at: an unknown registration or set, an ambiguous version, a name
   * that is not a file name, a source condition that does not exist.
   * @param request - ui-spec §五's fields, flat.
   * @param options - the calling session, recorded as the experiment's origin.
   * @returns the experiment, where the files landed, and validate's verdict.
   * @throws {@link EvalReadRefused} when DSH_HOME or the registry is missing.
   * @throws {@link EvalDraftRefused} when the draft cannot be written.
   */
  async draftExperiment(
    request: EvalDraftRequest,
    options: { session?: { id: string } } = {},
  ): Promise<EvalDraftResult> {
    const write = await writeDraft({
      stateRoot: this.stateRoot(),
      registry: this.registryFace(),
      dataset: request.dataset,
      ...(options.session === undefined ? {} : { originSession: options.session.id }),
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
    return {
      experimentId: write.experimentId,
      dataset: write.dataset,
      planPath: write.planPath,
      conditionPaths: write.conditionPaths,
      conditions: write.conditions,
      judges: write.judges,
      review: await this.planReview({ experimentId: write.experimentId }),
    }
  }

  /**
   * What the 新建实验 form may offer: every registered dataset set at its
   * registration's latest commit, each with the items it declares and the
   * stage schemas it ships. One read fills every picker on the form.
   *
   * Degrades rather than refusing, like the lab list: a registration that
   * cannot be read answers with a sentence in `notes`.
   * @throws {@link EvalReadRefused} when the composition mounts no registry.
   */
  async draftOptions(): Promise<EvalDraftOptionsView> {
    return readDraftOptions(this.registryFace())
  }

  /**
   * IMPORT plans from `<registration id>@<ref>` as experiments — `git show`
   * only, bytes verbatim, conditions into the library (a same-id conflict
   * refuses and writes nothing). See import.ts.
   * @param request - the source, and optionally the one plan to import.
   * @throws {@link EvalReadRefused} when DSH_HOME or the registry is missing.
   * @throws {@link EvalImportRefused} when the import cannot proceed.
   */
  async importExperiments(request: EvalImportRequest): Promise<ImportReport> {
    return await importExperiments(this.registryFace(), this.stateRoot(), {
      from: request.from,
      ...(request.plan === undefined ? {} : { plan: request.plan }),
    })
  }

  /**
   * The PLAN-REVIEW page (ui-spec §五, step 3): the plan's own fields, and
   * `validatePlan`'s verdict as a flat `ok / warn / error` list. The same
   * function `dsh-eval validate` runs, rearranged for reading — the page and
   * the CLI cannot disagree about whether a plan is approvable.
   * An experiment is checked against what it pins and its digest shows that
   * pin; a bare plan path (an old plan) gets the legacy offline check.
   * @param request - the experiment id, or — legacy — a plan path.
   * @throws {@link EvalReadRefused} when neither is given or the experiment cannot be read.
   */
  async planReview(request: EvalPlanRequest): Promise<EvalPlanReview> {
    if (request.experimentId !== undefined && request.experimentId !== '') {
      const record = await this.experimentRecord(request.experimentId)
      const validation = await this.validatePlan(record.planPath, { roots: await this.experimentRoots(record) })
      return reviewPlan(record.planPath, { pin: record.meta.dataset, validation })
    }
    if (request.planPath !== undefined && request.planPath !== '') {
      return reviewPlan(request.planPath, { validation: await this.validatePlan(request.planPath) })
    }
    throw new EvalReadRefused('plan review needs an experimentId (or, for an old plan, a planPath)')
  }

  /**
   * The CONDITIONS page (ui-spec §五, step 4): the library listing projected
   * onto the table the page draws — harness, declared model, scope, preset,
   * the lock and the readiness word.
   */
  async conditionsPage(): Promise<EvalConditionsView> {
    return conditionsView(await this.conditions())
  }

  /**
   * PROVISION one library condition — the conditions page's one write-class
   * action, and a human's click. The same call hashes the scoped home,
   * corrects the declaration's `home.sha`, re-hashes the condition and writes
   * the lock against the document as it now reads.
   *
   * Never a model tool. Provisioning materializes a scoped home and anchors
   * what a subject IS — R1 keeps it on the human side with 批准并启动 and
   * 终评.
   * @param condition - the library condition id (a path is accepted for old callers).
   * @param options - whether provision may correct `home.sha` (default true), and a log sink.
   * @returns the full provision report.
   * @throws {@link EvalProvisionRefused} when provisioning cannot begin.
   */
  provisionLibraryCondition(
    condition: string,
    options: { writeBack?: boolean; log?: (message: string) => void } = {},
  ): Promise<ProvisionReport> {
    let stateRoot: string
    try {
      stateRoot = this.stateRoot()
    } catch (error) {
      return Promise.reject(error)
    }
    return this.provision(conditionPathIn(conditionLibraryRoot(stateRoot), condition), {
      repo: conditionLibraryDir(stateRoot),
      ...options,
    })
  }

  /**
   * Provision one library condition for the conditions page (see
   * {@link EvalService.provisionLibraryCondition}), answering with the page's
   * row as it now reads.
   */
  async provisionCondition(request: EvalConditionProvisionRequest): Promise<EvalConditionProvisionView> {
    const report = await this.provisionLibraryCondition(
      request.condition,
      request.keepDeclaration === true ? { writeBack: false } : {},
    )
    return {
      condition: report.condition,
      conditionPath: report.conditionPath,
      homeDir: report.homeDir,
      credentialState: report.credentialState,
      written: report.written,
      homeShaWritten: report.homeShaWritten,
      sha: report.sha,
      homeSha: report.home?.sha ?? null,
      checks: provisionChecks(report),
      row: await this.conditionRowOf(request.condition),
    }
  }

  /**
   * Set one library condition's `model.endpoint` — the conditions page's
   * other write, and the only field of an existing declaration any face may
   * change. It is a FACTOR edit: the condition hash changes and any lock goes
   * stale; the answer says so, and provisioning again is the next click.
   * @param request - the condition and the value.
   * @returns what changed, and the library row as it now reads.
   * @throws {@link EvalConditionEditRefused} when the declaration cannot be edited.
   */
  async setConditionEndpoint(request: EvalConditionEndpointRequest): Promise<EvalConditionEndpointView> {
    const report = await writeConditionEndpoint({
      root: conditionLibraryRoot(this.stateRoot()),
      condition: request.condition,
      endpoint: request.endpoint,
    })
    const row = await this.conditionRowOf(request.condition)
    return {
      condition: report.condition,
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
   * One condition's library row, re-read after a write so the page never has
   * to guess what its own action produced. Null rather than a throw when the
   * listing cannot be retaken: the action already happened and its report is
   * the answer.
   */
  private async conditionRowOf(condition: string): Promise<EvalConditionRow | null> {
    try {
      const view = conditionsView(await this.conditions())
      return view.rows.find(row => row.id === condition) ?? null
    } catch {
      return null
    }
  }

  /**
   * The CONDITIONS page's diff: {@link EvalService.conditionDiff} with each
   * side's value as canonical JSON text, and ONLY the fields that differ.
   */
  async conditionDiffPage(options: { a: string; b: string }): Promise<EvalConditionDiffView> {
    return conditionDiffView(await this.conditionDiff(options))
  }

  /**
   * APPROVE a plan and start it — the human act of ui-spec step 5, and the one
   * verb in this package that a human's click reaches and a model's tool call
   * never does (R1).
   *
   * Validate runs FIRST and an error refuses the whole thing: a run started
   * over a plan whose conditions do not resolve burns real delegations to
   * discover what an offline check already knew. Warnings do not refuse.
   *
   * The refusal is a RESULT, not a throw: the caller renders the same check
   * list either way, and the reason belongs beside the list that explains it.
   * Wiring failures (no job registry, no live parent agent) are caught here
   * for the same reason and arrive verbatim in `refusal`.
   * The run it starts walks the release gate cell by cell, which is the
   * default everywhere since T57; `keepUnits` is the dialog's 保留单元 box,
   * and the ONE reason it exists is a container a human wants to open
   * afterwards. It is off unless the approver ticked it.
   * @param experimentId - the experiment to start.
   * @param options - the approving session (the run's parent), its workspace,
   *   and whether the approver asked to keep the units.
   * @returns what validate said, and — when it started — the job and run ids.
   */
  async approve(experimentId: string, options: { parentSessionId: string; cwd?: string; keepUnits?: boolean }): Promise<EvalApproveResult> {
    const review = await this.planReview({ experimentId })
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
      const handle = await this.runExperimentStart(experimentId, {
        parentSessionId: options.parentSessionId,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.keepUnits === true ? { keepUnits: true } : {}),
        label: `eval run ${experimentId} (approved)`,
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
   * ONE artifact of one attempt, read in place — the attachment a person
   * clicks in the record detail.
   *
   * A READ and nothing else: no write, no delete, no download. The path is
   * resolved against that attempt's run-data directory and checked with
   * `realpath` on both sides, so an artifact path is the only thing this verb
   * can be pointed at (see `cell-artifact.ts` for why the check is on the
   * REAL paths rather than on the string).
   * @param request - the run, the cell, the attempt and the path.
   * @throws {@link EvalReadRefused} when mission is absent, when the path
   *   leaves the attempt directory, or when nothing is there.
   */
  async cellArtifact(request: EvalCellArtifactRequest): Promise<EvalCellArtifactView> {
    const mission = this.requireMissionRead('read a cell artifact')
    return await readCellArtifact({
      mission,
      runId: request.runId,
      missionId: request.missionId,
      attempt: request.attempt,
      path: request.path,
    })
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
   * Take one of the four closure exits (T72): ① `final` 提交终评, ② `flagged`
   * 带标记提交 (reason required), ③ `unreviewed` 不做终评直接收尾, ④ `void`
   * 放弃终评 (reason required). A run-level `eval-closure` annotation; the
   * newest wins and nothing is accepted after a `void`. A refusal comes back
   * as a structured field, not a throw — it is an answer the page shows.
   * @param runId - the run.
   * @param request - exit and reason.
   * @param by - caller tag (`tab:<sessionId>`).
   * @throws {@link EvalReadRefused} when mission's read or annotate face is absent.
   */
  async closeRun(runId: string, request: { exit: unknown; reason?: string | null }, by: string): Promise<EvalClosureWrite> {
    const mission = this.requireMissionRead('close an evaluation')
    const annotate = this.missionAnnotate()
    if (annotate === undefined) {
      throw new EvalReadRefused(
        'no mission annotate face: the closure lives in the mission ledger, so this composition cannot record one '
        + '— mount the dsh-mission plugin',
      )
    }
    return await recordClosure(annotate, mission, runId, { exit: request.exit, reason: request.reason ?? null, by })
  }

  /**
   * Archive or un-archive a run (`eval-archive`, newest wins). Grouping only.
   * @param runId - the run.
   * @param archived - the flag.
   * @param by - caller tag (`tab:<sessionId>`).
   * @throws {@link EvalReadRefused} when mission's read or annotate face is absent.
   */
  async archiveRun(runId: string, archived: boolean, by: string): Promise<EvalArchiveWrite> {
    const mission = this.requireMissionRead('archive an experiment')
    const annotate = this.missionAnnotate()
    if (annotate === undefined) {
      throw new EvalReadRefused(
        'no mission annotate face: the archive mark lives in the mission ledger, so this composition cannot record one '
        + '— mount the dsh-mission plugin',
      )
    }
    return await recordArchive(annotate, mission, runId, { archived: archived === true, by })
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
   * Run one EXPERIMENT — the entry every face uses since T73 (`eval run
   * --experiment <id>`, `/eval run <experimentId>`, 批准并启动). The plan is
   * read from the experiment directory and checked against what it pins; the
   * run writes `experimentId` into run.meta and exports into the experiment's
   * `exports/` unless told otherwise.
   * @throws {@link EvalReadRefused} when the experiment or its registration cannot be read.
   * @throws {@link EvalRunRefused} when the run is refused before executing.
   */
  async runExperiment(experimentId: string, options: RunOptions = {}): Promise<RunReport> {
    const { planPath, experiment } = await this.runExperimentOf(experimentId)
    return this.run(planPath, { ...options, experiment })
  }

  /**
   * {@link EvalService.runStart} for an experiment: resolved before the job
   * starts, so an unknown id is a refusal to the caller rather than a failed job.
   */
  async runExperimentStart(
    experimentId: string,
    options: RunOptions & { cwd?: string; label?: string } = {},
  ): Promise<EvalRunHandle> {
    const { planPath, experiment } = await this.runExperimentOf(experimentId)
    return this.runStart(planPath, { ...options, experiment, label: options.label ?? `eval run ${experimentId}` })
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
   * The run's experiment (paired the lab list's way) adds its `exports/` to
   * the directories tried and its `analysis/` files to the answer; an old run
   * with no experiment opens from its run.meta alone.
   * @param options - the export directory to try first (the dialog's).
   * @throws {@link EvalReadRefused} when mission is absent, or the run is unknown.
   */
  async runReport(runId: string, options: { outDir?: string } = {}): Promise<EvalRunReportView> {
    const mission = this.requireMissionRead('read a run\'s report')
    const experiment = await this.experimentOfRun(mission, runId)
    return runReportView(mission, runId, { ...options, ...(experiment === null ? {} : { experiment }) })
  }

  /** The experiment a run belongs to, or null (an old run, or no state root). */
  private async experimentOfRun(mission: MissionReadFace, runId: string): Promise<ExperimentRecord | null> {
    const stateRoot = defaultStateRoot()
    if (stateRoot === undefined) return null
    let meta: Record<string, unknown>
    try {
      meta = mission.runStatus(runId).run.meta
    } catch {
      return null
    }
    return pairRun(meta, await readPlans(stateRoot))
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
export { ANALYSIS_WRITE_PREFIX, EvalWriteRefused, resolveAnalysisWrite, writeAnalysisFile } from './analysis-write.ts'
export type { AnalysisWriteResult, AnalysisWriteTarget } from './analysis-write.ts'
export { decideDatasetVersion, DatasetVersionRefused } from './dataset-version.ts'
export type { DatasetVersionCandidate, DatasetVersionDecision, DatasetVersionFace } from './dataset-version.ts'
export {
  conditionLibraryDir, conditionLibraryRoot, createExperiment, EvalExperimentError, EXPERIMENT_ID_RE, EXPERIMENT_META_SCHEMA,
  experimentIdOfPlanPath, experimentsRoot, experimentSlug, listExperimentRecords, mintExperimentId, readExperiment,
} from './experiment-store.ts'
export type { CreateExperimentInput, ExperimentDataset, ExperimentMeta, ExperimentRecord } from './experiment-store.ts'
export { listAnalysisFiles, readExperimentArtifact } from './experiment-artifact.ts'
export { EvalImportRefused, importExperiments, parseImportSource } from './import.ts'
export type { ImportedExperiment, ImportRegistryFace, ImportReport } from './import.ts'
export type { ConditionDiff, ConditionFieldDiff, ConditionsReport, ConditionSummary, RunCellStatus, RunLedgerStatus, RunStatusReport } from './read.ts'
export { deriveExperimentStatus, experimentDetail, isJudgedOrBeyond, isReleased, listExperiments, pairRun, readPlans, runsForItem } from './experiments.ts'
export { conditionDiffView, conditionsView, reviewPlan } from './review.ts'
export { judgeSessionsOf, materializationShaOf, probeRunsOf, runCellDetail, summarizeAnnotations } from './cell-detail.ts'
export { ARTIFACT_MAX_BYTES, ARTIFACT_MAX_ENTRIES, TEXT_EXTENSIONS, extensionOf, isInside, readCellArtifact } from './cell-artifact.ts'
export { DEFAULT_STUCK_MS, pivotMatrix, repDot } from './matrix-view.ts'
export { bundleDirOf, exportDirCandidates, projectFinalize, projectReport, runReportView } from './report-view.ts'
export type { MatrixInput, MatrixInputCell } from './matrix-view.ts'
export type { ExperimentsInput, ExperimentStatusInput } from './experiments.ts'
export { EvalProvisionRefused } from './provision.ts'
export { EvalDraftRefused, draftExperiment, draftOptions } from './draft.ts'
export type { DraftConditionEdit, DraftExperimentInput, DraftOptions, DraftWrite } from './draft.ts'
export type { ProvisionReport } from './provision.ts'
export type { ProvisionCheck } from './effective.ts'
