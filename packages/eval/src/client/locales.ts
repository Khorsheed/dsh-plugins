/** `dshEval` namespace dictionaries (the 实验室 / Experiments tab copy). */

/**
 * Dictionary namespace owned by this plugin. `dshEval`, not `eval`, for the
 * same reason the cordis service is: the loader evaluates `!!js` expressions
 * inside `with (ctx) { … }`, where a property named `eval` shadows the global.
 * The namespace has no such hazard, but one name for one plugin beats two.
 */
export const NS = 'dshEval'

/** The lab tab dictionary key set (the source of truth for both locales). */
export type EvalKey =
  | 'open'
  | 'list.title'
  | 'list.new'
  | 'list.loading'
  | 'list.error'
  | 'list.empty'
  | 'list.refresh'
  | 'col.name'
  | 'col.snapshot'
  | 'col.conditions'
  | 'col.items'
  | 'col.reps'
  | 'col.factors'
  | 'col.status'
  | 'col.progress'
  | 'col.startedAt'
  | 'status.draft'
  | 'status.pending-approval'
  | 'status.running'
  | 'status.judging'
  | 'status.done'
  | 'status.refused'
  | 'status.cancelled'
  | 'conditions.count'
  | 'conditions.withJudges'
  | 'factors.none'
  | 'factors.single'
  | 'page.overview'
  | 'page.plan'
  | 'page.conditions'
  | 'page.matrix'
  | 'page.cells'
  | 'page.report'
  | 'page.judging'
  | 'detail.back'
  | 'detail.loading'
  | 'detail.error'
  | 'overview.snapshot'
  | 'overview.shape'
  | 'overview.shapeValue'
  | 'overview.factors'
  | 'overview.judge'
  | 'overview.judgeNone'
  | 'overview.judgeSamples'
  | 'overview.environment'
  | 'overview.environmentHost'
  | 'overview.readiness'
  | 'overview.readinessNone'
  | 'overview.meta'
  | 'overview.buckets'
  | 'overview.states'
  | 'overview.unreleased'
  | 'overview.job'
  | 'overview.draftNotice'
  | 'overview.validation'
  | 'overview.validationOk'
  | 'overview.validationFailed'
  | 'ready.ok'
  | 'ready.failed'
  | 'placeholder.judging'
  | 'report.loading'
  | 'report.error'
  | 'report.noBundle'
  | 'report.searched'
  | 'report.exportNow'
  | 'report.lookInDir'
  | 'report.lookInGo'
  | 'report.counts'
  | 'report.cliHint'
  | 'report.toolOnlyNs'
  | 'report.invariants'
  | 'report.comparisonClosed'
  | 'report.singleCondition'
  | 'report.noPairs'
  | 'report.pairTitle'
  | 'report.pairNoTasks'
  | 'report.factorSingle'
  | 'report.factorMulti'
  | 'report.factorUnknown'
  | 'report.ci'
  | 'report.rank'
  | 'report.selfJudged'
  | 'report.col.task'
  | 'report.col.delta'
  | 'report.col.weightedDelta'
  | 'report.col.deltas'
  | 'report.col.n'
  | 'report.col.judges'
  | 'report.col.condition'
  | 'report.col.model'
  | 'report.col.activeMs'
  | 'report.col.rounds'
  | 'report.col.toolCalls'
  | 'report.col.outputTokens'
  | 'report.col.inputTokens'
  | 'report.col.cacheRead'
  | 'report.efficiency'
  | 'report.efficiencyScope'
  | 'report.efficiencyNone'
  | 'report.tokensCrossModel'
  | 'report.tokensSameModel'
  | 'report.excluded'
  | 'report.excludedNone'
  | 'report.judge'
  | 'report.judgeSame'
  | 'report.judgeSameValue'
  | 'report.judgeCross'
  | 'report.judgeCrossValue'
  | 'report.judgeHuman'
  | 'report.judgeSelf'
  | 'report.notes'
  | 'report.finalize'
  | 'report.finalizeConfirm'
  | 'report.finalizeConfirmAsk'
  | 'report.finalizeCancel'
  | 'report.finalizeResult'
  | 'report.finalizeCounts'
  | 'notice.finalized'
  | 'placeholder.new'
  | 'matrix.loading'
  | 'matrix.error'
  | 'matrix.empty'
  | 'matrix.column'
  | 'matrix.group'
  | 'matrix.filter'
  | 'matrix.filterAll'
  | 'matrix.noFactor'
  | 'matrix.task'
  | 'matrix.legend'
  | 'matrix.hashMismatch'
  | 'matrix.hashUnknown'
  | 'matrix.stuck'
  | 'matrix.reps'
  | 'summary.title'
  | 'summary.materialization'
  | 'summary.fingerprint'
  | 'summary.unreleased'
  | 'summary.judge'
  | 'summary.judgePending'
  | 'summary.stuck'
  | 'summary.cells'
  | 'invariant.ok'
  | 'invariant.violated'
  | 'invariant.unverifiable'
  | 'cells.loading'
  | 'cells.error'
  | 'cells.empty'
  | 'cells.matched'
  | 'cells.bucketAll'
  | 'cells.col.cell'
  | 'cells.col.bucket'
  | 'cells.col.stage'
  | 'cells.col.attempt'
  | 'cells.col.duration'
  | 'drawer.close'
  | 'drawer.loading'
  | 'drawer.error'
  | 'drawer.refs'
  | 'drawer.resourceNone'
  | 'drawer.checkpoints'
  | 'drawer.artifacts'
  | 'drawer.annotations'
  | 'drawer.attempts'
  | 'drawer.history'
  | 'drawer.probes'
  | 'drawer.probesNone'
  | 'drawer.materialization'
  | 'drawer.openSession'
  | 'drawer.noSession'
  | 'drawer.releasable'
  | 'drawer.notReleasable'
  | 'action.retry'
  | 'action.release'
  | 'action.export'
  | 'retry.reason'
  | 'retry.category'
  | 'notice.retried'
  | 'notice.releasable'
  | 'notice.notReleasable'
  | 'export.title'
  | 'export.description'
  | 'export.outDir'
  | 'export.layers'
  | 'export.snapshotDir'
  | 'export.snapshotRepo'
  | 'export.snapshotCommit'
  | 'export.snapshotDataset'
  | 'export.plan'
  | 'export.planOk'
  | 'export.guardedTitle'
  | 'export.confirmLayer'
  | 'export.confirm'
  | 'export.cancel'
  | 'export.close'
  | 'export.done'
  | 'export.error'
  | 'review.loading'
  | 'review.error'
  | 'review.noPlan'
  | 'review.planPath'
  | 'review.order'
  | 'review.orderValue'
  | 'review.orderInterleaved'
  | 'review.orderSequential'
  | 'review.stages'
  | 'review.budget'
  | 'review.budgetValue'
  | 'review.expectedNs'
  | 'review.retry'
  | 'review.retryDefault'
  | 'review.exports'
  | 'review.exportsDefault'
  | 'review.items'
  | 'review.notes'
  | 'review.checks'
  | 'review.checksNone'
  | 'review.conditions'
  | 'review.lockOk'
  | 'review.lockStale'
  | 'review.lockNone'
  | 'severity.ok'
  | 'severity.warn'
  | 'severity.error'
  | 'review.approve'
  | 'review.approving'
  | 'review.approveBlocked'
  | 'review.sendBack'
  | 'review.sentBack'
  | 'review.started'
  | 'review.startedValue'
  | 'review.parentSession'
  | 'review.refusal'
  | 'review.jobLog'
  | 'review.jobLogEmpty'
  | 'review.jobLogError'
  | 'conditions.loading'
  | 'conditions.error'
  | 'conditions.empty'
  | 'conditions.repo'
  | 'conditions.col.id'
  | 'conditions.col.harness'
  | 'conditions.col.model'
  | 'conditions.col.scope'
  | 'conditions.col.preset'
  | 'conditions.col.lock'
  | 'conditions.col.ready'
  | 'conditions.scopeDefault'
  | 'conditions.lockOk'
  | 'conditions.lockStale'
  | 'conditions.lockNone'
  | 'conditions.homeUnhashed'
  | 'conditions.ready'
  | 'conditions.unready'
  | 'conditions.missing'
  | 'conditions.pickHint'
  | 'conditions.pickOne'
  | 'conditions.diff'
  | 'conditions.diffIdentical'
  | 'conditions.diffNotesOnly'
  | 'conditions.diffCount'
  | 'conditions.diffAbsent'
  | 'conditions.diffError'
  | 'conditions.new'
  | 'conditions.newPlaceholder'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The lab session-tab copy. */
    'dshEval': EvalKey
  }
}

/** English dictionary. */
export const en: Record<EvalKey, string> = {
  'open': 'Experiments',
  'list.title': 'Experiments',
  'list.new': 'New experiment',
  'list.loading': 'Loading…',
  'list.error': 'Failed to load the experiments',
  'list.empty': 'No experiments yet — a plan lives at <repo>/datasets/<set>/plans/<name>.json',
  'list.refresh': 'Refresh',
  'col.name': 'Name',
  'col.snapshot': 'Snapshot',
  'col.conditions': 'Conditions',
  'col.items': 'Items',
  'col.reps': 'Reps',
  'col.factors': 'Factors',
  'col.status': 'Status',
  'col.progress': 'Progress',
  'col.startedAt': 'Started',
  'status.draft': 'Draft',
  'status.pending-approval': 'Awaiting approval',
  'status.running': 'Running',
  'status.judging': 'Judging',
  'status.done': 'Done',
  'status.refused': 'Refused',
  'status.cancelled': 'Cancelled',
  'conditions.count': '{count}',
  'conditions.withJudges': '{count} (+{judges} judge)',
  'factors.none': 'none',
  'factors.single': 'single condition',
  'page.overview': 'Overview',
  'page.plan': 'Plan review',
  'page.conditions': 'Conditions',
  'page.matrix': 'Matrix',
  'page.cells': 'Cells',
  'page.report': 'Report',
  'page.judging': 'Judging desk',
  'detail.back': 'Back to the list',
  'detail.loading': 'Loading the experiment…',
  'detail.error': 'Failed to open the experiment',
  'overview.snapshot': 'Snapshot',
  'overview.shape': 'Matrix',
  'overview.shapeValue': '{items} item(s) × {conditions} condition(s) × {reps} rep(s) = {cells} cell(s)',
  'overview.factors': 'Factors',
  'overview.judge': 'Judge',
  'overview.judgeNone': 'none — no LLM judging this run',
  'overview.judgeSamples': '{samples} sample(s)',
  'overview.environment': 'Environment',
  'overview.environmentHost': 'host path (no unit segment)',
  'overview.readiness': 'Readiness check',
  'overview.readinessNone': 'the run recorded no readiness probe',
  'overview.meta': 'run.meta',
  'overview.buckets': 'Buckets',
  'overview.states': 'Stages',
  'overview.unreleased': 'Holding a resource, not released',
  'overview.job': 'Background job',
  'overview.draftNotice': 'Not started yet: readiness, run.meta and the cell histograms appear once a human approves and starts it.',
  'overview.validation': 'Validate',
  'overview.validationOk': 'ok',
  'overview.validationFailed': '{errors} error(s), {warnings} warning(s)',
  'ready.ok': 'ok',
  'ready.failed': 'failed',
  'placeholder.judging': 'The judging desk belongs to T37.',
  'placeholder.new': 'The new-experiment form belongs to T36. Until then a plan is drafted as a file: <repo>/datasets/<set>/plans/<name>.json.',
  'matrix.loading': 'Arranging the matrix…',
  'matrix.error': 'Failed to arrange the matrix',
  'matrix.empty': 'This run expanded no cells',
  'matrix.column': 'Column',
  'matrix.group': 'Group by',
  'matrix.filter': 'Filter',
  'matrix.filterAll': 'all',
  'matrix.noFactor': 'the conditions agree on every field — one column, nothing to compare',
  'matrix.task': 'Item',
  'matrix.legend': 'dot: ● judged  ◐ in progress  ○ not started · red edge: this row disagrees on the item material',
  'matrix.hashMismatch': 'material differs from the rest of this item',
  'matrix.hashUnknown': 'no material hash recorded',
  'matrix.stuck': 'nothing has happened here for over {minutes} min',
  'matrix.reps': '{count} rep(s)',
  'summary.title': 'Run summary',
  'summary.materialization': 'Item material',
  'summary.fingerprint': 'Environment fingerprint',
  'summary.unreleased': 'Unreleased units',
  'summary.judge': 'Judge consistency',
  'summary.judgePending': 'awaiting the report',
  'summary.stuck': 'Stuck cells',
  'summary.cells': 'Cells shown',
  'invariant.ok': 'ok',
  'invariant.violated': 'violated',
  'invariant.unverifiable': 'unverifiable',
  'cells.loading': 'Loading the cells…',
  'cells.error': 'Failed to load the cells',
  'cells.empty': 'No cell matches this filter',
  'cells.matched': '{matched}/{total} cell(s)',
  'cells.bucketAll': 'All',
  'cells.col.cell': 'Item × condition × rep',
  'cells.col.bucket': 'Bucket',
  'cells.col.stage': 'Stage',
  'cells.col.attempt': 'Attempt',
  'cells.col.duration': 'In state',
  'drawer.close': 'Close',
  'drawer.loading': 'Loading the cell…',
  'drawer.error': 'Failed to open the cell',
  'drawer.refs': 'Unit',
  'drawer.resourceNone': 'no unit (host path)',
  'drawer.checkpoints': 'Checkpoints',
  'drawer.artifacts': 'Artifacts',
  'drawer.annotations': 'Annotations',
  'drawer.attempts': 'Attempts',
  'drawer.history': 'Transitions',
  'drawer.probes': 'Verify output (verbatim)',
  'drawer.probesNone': 'this cell recorded no probe run',
  'drawer.materialization': 'Item material',
  'drawer.openSession': 'Open the child session',
  'drawer.noSession': 'this attempt recorded no child session — nothing to open',
  'drawer.releasable': 'releasable — its resources may be destroyed',
  'drawer.notReleasable': 'NOT releasable',
  'action.retry': 'Re-run',
  'action.release': 'Release check',
  'action.export': 'Export bundle',
  'retry.reason': 'Reason for the re-run',
  'retry.category': 'Retry category',
  'notice.retried': '{id}: attempt {attempt} opened',
  'notice.releasable': '{id}: releasable — its resources may be destroyed',
  'notice.notReleasable': '{id}: NOT releasable',
  'export.title': 'Export the run bundle',
  'export.description': 'A self-contained bundle of the run: template, cells, annotations, artifacts and the dataset layers you include. Guarded layers must be confirmed one by one, and the check is re-run against a fresh plan before anything is written.',
  'export.outDir': 'Output directory',
  'export.layers': 'Layers (comma-separated)',
  'export.snapshotDir': 'Snapshot directory',
  'export.snapshotRepo': 'Snapshot repo',
  'export.snapshotCommit': 'Snapshot commit',
  'export.snapshotDataset': 'Snapshot dataset id',
  'export.plan': 'Check',
  'export.planOk': 'nothing guarded — {missions} cell(s), {attempts} attempt(s) into {dir}',
  'export.guardedTitle': 'Guarded (modelFacing: false) layers — confirm each one to include it:',
  'export.confirmLayer': 'include {layer}',
  'export.confirm': 'Export',
  'export.cancel': 'Cancel',
  'export.close': 'Close',
  'export.done': 'exported {dir} ({count} files)',
  'export.error': 'Export failed',
  'report.loading': 'Reading the bundle…',
  'report.error': 'Failed to build the report',
  'report.noBundle': 'No bundle exported yet',
  'report.searched': 'Looked in',
  'report.exportNow': 'Export the bundle',
  'report.lookInDir': 'Export directory to look in (a run started with --out)',
  'report.lookInGo': 'Look here',
  'report.counts': '{rows} verdict row(s) · {missions} cell(s) · {attempts} attempt(s) · {retries} infrastructure retry/retries (aggregation uses each cell\'s current attempt)',
  'report.cliHint': 'Write it to disk',
  'report.toolOnlyNs': 'RED FLAG: every verdict in the expectedNs namespace `{ns}` was written by a `tool:` caller — the source disagrees with that namespace\'s contract, and conclusions resting on it are in doubt.',
  'report.invariants': 'The four invariants',
  'report.comparisonClosed': 'Comparison is CLOSED: {invariants}. Facts only below — no deltas, no ranking (architecture §5).',
  'report.singleCondition': 'Single-condition run — there is no second condition to pair with, so there is nothing to compare. The facts are below.',
  'report.noPairs': 'No condition pair produced a comparison.',
  'report.pairTitle': '{a} vs {b}',
  'report.pairNoTasks': 'No paired item (the two conditions ran disjoint item sets).',
  'report.factorSingle': 'single factor `{factor}` ({detail})',
  'report.factorMulti': 'several factors: {fields} ({detail}) — descriptive only',
  'report.factorUnknown': 'factor unknown — {detail}',
  'report.ci': 'mean Δ = {mean}, 95% CI [{lo}, {hi}] (bootstrap over reps × {samples}, seed {seed})',
  'report.rank': 'Ranking',
  'report.selfJudged': 'self-judged',
  'report.col.task': 'Item',
  'report.col.delta': 'Δ score',
  'report.col.weightedDelta': 'Δ weighted',
  'report.col.deltas': 'Δ per rep',
  'report.col.n': 'n',
  'report.col.judges': 'Judges',
  'report.col.condition': 'Condition',
  'report.col.model': 'Model',
  'report.col.activeMs': 'Active time',
  'report.col.rounds': 'Rounds',
  'report.col.toolCalls': 'Tool calls',
  'report.col.outputTokens': 'Output tokens',
  'report.col.inputTokens': 'Input tokens',
  'report.col.cacheRead': 'cacheRead',
  'report.efficiency': 'Efficiency (parallel columns, never one score)',
  'report.efficiencyScope': 'Completed cells only (judged / archived / releasable / released): an unfinished cell bought an unknown amount of work, and pooling it makes two columns look comparable when they are not.',
  'report.efficiencyNone': 'No delegation record (durationMs / usage absent) — every efficiency column is blank.',
  'report.tokensCrossModel': 'Tokens do NOT compare across models: the rows are recorded faithfully, but only same-model conditions may be read against each other (frozen decision 10).',
  'report.tokensSameModel': 'Every condition ran the same model ({model}), so the token columns are comparable.',
  'report.excluded': 'Unfinished cells left out of the table ({total}): {detail} — their delegation time exists in the annotations, it just does not enter the efficiency numbers.',
  'report.excludedNone': 'Nothing was left out — every current cell finished.',
  'report.judge': 'Judge consistency',
  'report.judgeSame': 'One judge, resampled',
  'report.judgeSameValue': '{criteria} criteria with ≥2 samples · agreed {agreement} · κ {kappa}',
  'report.judgeCross': 'Across judges',
  'report.judgeCrossValue': '{criteria} criteria judged by ≥2 judges · all agreed {agreement} · κ {kappa}',
  'report.judgeHuman': 'llm-draft vs human-final',
  'report.judgeSelf': 'Self-judged criteria',
  'report.notes': 'Notes and reservations',
  'report.finalize': 'finalize',
  'report.finalizeConfirm': 'Yes, walk the gate',
  'report.finalizeConfirmAsk': 'finalize walks EVERY archived cell of this run through the release gate (archived → releasable → released). A refused gate is recorded, never forced.',
  'report.finalizeCancel': 'Cancel',
  'report.finalizeResult': 'finalize',
  'report.finalizeCounts': '{released} released · {refused} gate-refused · {skipped} skipped ({skips})',
  'notice.finalized': 'finalize: {released} released, {refused} gate-refused, {skipped} skipped',
  'review.loading': 'Validating the plan…',
  'review.error': 'Failed to review the plan',
  'review.noPlan': 'This run records no plan document, so there is nothing to review — its run.meta is on the overview.',
  'review.planPath': 'Plan document',
  'review.order': 'Order',
  'review.orderValue': 'seed {seed}',
  'review.orderInterleaved': 'interleaved (same-condition cells spread apart)',
  'review.orderSequential': 'not interleaved',
  'review.stages': 'Stages',
  'review.budget': 'Budget per cell',
  'review.budgetValue': '{minutes} active minute(s) · {turns} turn(s)',
  'review.expectedNs': 'Expected verdict sources',
  'review.retry': 'Infrastructure retries per cell',
  'review.retryDefault': 'plan default',
  'review.exports': 'Bundle export directory',
  'review.exportsDefault': '<dataset repo>/exports',
  'review.items': 'Items',
  'review.notes': 'Author notes',
  'review.checks': 'Validate',
  'review.checksNone': 'validate reported nothing at all — the plan document could not be read',
  'review.conditions': 'Conditions',
  'review.lockOk': 'lock ok',
  'review.lockStale': 'LOCK STALE',
  'review.lockNone': 'no lock',
  'severity.ok': 'ok',
  'severity.warn': 'warn',
  'severity.error': 'error',
  'review.approve': 'Approve and start',
  'review.approving': 'Starting…',
  'review.approveBlocked': 'validate found {errors} error(s) — fix them and refresh; nothing can be started over a plan whose conditions do not resolve',
  'review.sendBack': 'Send back for changes',
  'review.sentBack': 'Sent back for changes. This is a note on this page only: the plan file is unchanged, and the experiment is shown as a draft until it validates again.',
  'review.started': 'Started',
  'review.startedValue': 'job {jobId} · run {runId}',
  'review.parentSession': 'Parent session',
  'review.refusal': 'Refused',
  'review.jobLog': 'Run log (verbatim)',
  'review.jobLogEmpty': 'the run has emitted no line yet — refresh',
  'review.jobLogError': 'Failed to read the run log',
  'conditions.loading': 'Loading the conditions…',
  'conditions.error': 'Failed to list the conditions',
  'conditions.empty': 'This repository declares no condition — a condition lives at <repo>/datasets/<set>/conditions/<id>.json',
  'conditions.repo': 'Repository',
  'conditions.col.id': 'Condition',
  'conditions.col.harness': 'Harness',
  'conditions.col.model': 'Model (declared)',
  'conditions.col.scope': 'Scope',
  'conditions.col.preset': 'Preset',
  'conditions.col.lock': 'Lock',
  'conditions.col.ready': 'Ready',
  'conditions.scopeDefault': 'default',
  'conditions.lockOk': 'ok',
  'conditions.lockStale': 'stale',
  'conditions.lockNone': 'none',
  'conditions.homeUnhashed': 'home not provisioned',
  'conditions.ready': 'ready',
  'conditions.unready': 'not ready',
  'conditions.missing': 'missing',
  'conditions.pickHint': 'Pick two conditions to diff.',
  'conditions.pickOne': 'One picked — pick a second to diff.',
  'conditions.diff': 'Diff',
  'conditions.diffIdentical': '{a} and {b} are identical (notes excluded, as in the hash)',
  'conditions.diffNotesOnly': 'only notes differ — a comment edit is not a factor',
  'conditions.diffCount': '{count} field(s) differ',
  'conditions.diffAbsent': 'absent',
  'conditions.diffError': 'Failed to diff the two conditions',
  'conditions.new': 'New condition',
  'conditions.newPlaceholder': 'Choosing a model IS minting a condition, so the button leads to the new-experiment form, which belongs to T34. Until then a condition is drafted as a file and provisioned with /eval conditions provision.',
}

/** 中文词典。 */
export const zh: Record<EvalKey, string> = {
  'open': '实验室',
  'list.title': '实验',
  'list.new': '新建实验',
  'list.loading': '加载中…',
  'list.error': '实验列表加载失败',
  'list.empty': '还没有实验——计划文件放在 <题库>/datasets/<题集>/plans/<名称>.json',
  'list.refresh': '刷新',
  'col.name': '名称',
  'col.snapshot': '题库快照',
  'col.conditions': '条件数',
  'col.items': '题数',
  'col.reps': 'rep',
  'col.factors': '因子',
  'col.status': '状态',
  'col.progress': '进度',
  'col.startedAt': '开始时间',
  'status.draft': '草稿',
  'status.pending-approval': '待批准',
  'status.running': '运行中',
  'status.judging': '评估中',
  'status.done': '已完成',
  'status.refused': '被拒',
  'status.cancelled': '已取消',
  'conditions.count': '{count}',
  'conditions.withJudges': '{count}（+{judges} 判官）',
  'factors.none': '无',
  'factors.single': '单条件',
  'page.overview': '概览',
  'page.plan': '计划审阅',
  'page.conditions': '条件',
  'page.matrix': '矩阵',
  'page.cells': '格子',
  'page.report': '报告',
  'page.judging': '判官台',
  'detail.back': '回到列表',
  'detail.loading': '加载实验…',
  'detail.error': '实验打开失败',
  'overview.snapshot': '快照',
  'overview.shape': '矩阵形状',
  'overview.shapeValue': '{items} 题 × {conditions} 条件 × {reps} rep = {cells} 格',
  'overview.factors': '因子',
  'overview.judge': '判官',
  'overview.judgeNone': '无——本轮不做 LLM 判官',
  'overview.judgeSamples': '{samples} 次采样',
  'overview.environment': '环境',
  'overview.environmentHost': '宿主路径（没有 unit 段）',
  'overview.readiness': '就绪检查',
  'overview.readinessNone': '这个 run 没有记录就绪检查',
  'overview.meta': 'run.meta',
  'overview.buckets': '桶',
  'overview.states': '阶段',
  'overview.unreleased': '持有单元未释放',
  'overview.job': '后台作业',
  'overview.draftNotice': '还没启动：就绪检查、run.meta 与格子分布要等人批准并启动之后才有。',
  'overview.validation': 'validate',
  'overview.validationOk': '通过',
  'overview.validationFailed': '{errors} 个错误，{warnings} 条警告',
  'ready.ok': '通过',
  'ready.failed': '未通过',
  'placeholder.judging': '判官台归 T37。',
  'placeholder.new': '新建实验表单归 T36。在那之前，实验用文件起草：<题库>/datasets/<题集>/plans/<名称>.json。',
  'matrix.loading': '排矩阵…',
  'matrix.error': '矩阵排布失败',
  'matrix.empty': '这个 run 没有展开出格子',
  'matrix.column': '列',
  'matrix.group': '分组',
  'matrix.filter': '筛选',
  'matrix.filterAll': '全部',
  'matrix.noFactor': '各条件逐字段相同——只有一列，没有可比的',
  'matrix.task': '题',
  'matrix.legend': '圆点：● 已判　◐ 进行中　○ 未起 · 红边：本行的题面与其余格不一致',
  'matrix.hashMismatch': '题面与本题其余格不一致',
  'matrix.hashUnknown': '没有记录物化哈希',
  'matrix.stuck': '已经 {minutes} 分钟没有动静',
  'matrix.reps': '{count} 个 rep',
  'summary.title': 'run 级汇总',
  'summary.materialization': '物化哈希',
  'summary.fingerprint': '环境指纹',
  'summary.unreleased': '未释放单元',
  'summary.judge': '判官一致性',
  'summary.judgePending': '待报告',
  'summary.stuck': '卡格数',
  'summary.cells': '显示的格子',
  'invariant.ok': '一致',
  'invariant.violated': '不一致',
  'invariant.unverifiable': '无法核验',
  'cells.loading': '加载格子…',
  'cells.error': '格子加载失败',
  'cells.empty': '这个筛选下没有格子',
  'cells.matched': '{matched}/{total} 格',
  'cells.bucketAll': '全部',
  'cells.col.cell': '题 × 条件 × rep',
  'cells.col.bucket': '桶',
  'cells.col.stage': '阶段',
  'cells.col.attempt': 'attempt',
  'cells.col.duration': '在态时长',
  'drawer.close': '关闭',
  'drawer.loading': '加载格子详情…',
  'drawer.error': '格子详情打开失败',
  'drawer.refs': '单元',
  'drawer.resourceNone': '没有单元（宿主路径）',
  'drawer.checkpoints': '检查点',
  'drawer.artifacts': '产物',
  'drawer.annotations': '注解',
  'drawer.attempts': 'attempt',
  'drawer.history': '状态迁移',
  'drawer.probes': 'verify 原样输出',
  'drawer.probesNone': '这一格没有记录探针运行',
  'drawer.materialization': '物化哈希',
  'drawer.openSession': '打开子会话',
  'drawer.noSession': '这次 attempt 没有记录子会话——没有可打开的',
  'drawer.releasable': '可释放——资源可以销毁',
  'drawer.notReleasable': '不可释放',
  'action.retry': '带原因重跑',
  'action.release': '释放检查',
  'action.export': '导出 bundle',
  'retry.reason': '重跑原因',
  'retry.category': '重跑类别',
  'notice.retried': '{id}：已开 attempt {attempt}',
  'notice.releasable': '{id}：可释放——资源可以销毁',
  'notice.notReleasable': '{id}：不可释放',
  'export.title': '导出 run bundle',
  'export.description': '自包含的 run bundle：模板、格子、注解、产物，以及你收录的题库层。guarded 层要逐项确认，落盘之前还会按一份新鲜的 plan 重核一次。',
  'export.outDir': '输出目录',
  'export.layers': '收录层（逗号分隔）',
  'export.snapshotDir': '快照目录',
  'export.snapshotRepo': '快照仓库',
  'export.snapshotCommit': '快照 commit',
  'export.snapshotDataset': '快照数据集 id',
  'export.plan': '检查',
  'export.planOk': '没有 guarded 层——{missions} 格、{attempts} 次 attempt，导出到 {dir}',
  'export.guardedTitle': 'guarded（modelFacing: false）层——逐项确认才会收录：',
  'export.confirmLayer': '收录 {layer}',
  'export.confirm': '导出',
  'export.cancel': '取消',
  'export.close': '关闭',
  'export.done': '已导出 {dir}（{count} 个文件）',
  'export.error': '导出失败',
  'report.loading': '正在读 bundle…',
  'report.error': '报告生成失败',
  'report.noBundle': '还没有 bundle',
  'report.searched': '找过',
  'report.exportNow': '导出 bundle',
  'report.lookInDir': '换一个导出目录找（run 是带 --out 跑的就填这里）',
  'report.lookInGo': '在这里找',
  'report.counts': '判定行 {rows} · 格子 {missions} · attempt {attempts} · 基础设施重试 {retries}（聚合只用各格最新 attempt）',
  'report.cliHint': '用 CLI 落盘',
  'report.toolOnlyNs': '红字警告：expectedNs 中的 `{ns}` 的判定全部由 `tool:` 写入——判定来源与该 ns 的契约作者不符，相关结论效力存疑。',
  'report.invariants': '四条不变量',
  'report.comparisonClosed': '比较节未开：{invariants}。下面只有事实表，没有差值与名次（architecture §5）。',
  'report.singleCondition': '单条件 run——没有第二个条件可配对，无可比较。事实见下。',
  'report.noPairs': '没有任何条件对给出比较。',
  'report.pairTitle': '{a} vs {b}',
  'report.pairNoTasks': '无配对题（两条件的题集不相交）。',
  'report.factorSingle': '单因子 `{factor}`（{detail}）',
  'report.factorMulti': '多因子：{fields}（{detail}）——只作描述',
  'report.factorUnknown': '因子未知——{detail}',
  'report.ci': '平均 Δ = {mean}，95% 置信区间 [{lo}, {hi}]（bootstrap 重采样 rep × {samples}，seed {seed}）',
  'report.rank': '名次判定',
  'report.selfJudged': '自评',
  'report.col.task': '题',
  'report.col.delta': 'Δ 得分',
  'report.col.weightedDelta': 'Δ 加权',
  'report.col.deltas': '逐 rep Δ',
  'report.col.n': 'n',
  'report.col.judges': '判官',
  'report.col.condition': '条件',
  'report.col.model': '模型',
  'report.col.activeMs': '活跃时长',
  'report.col.rounds': '委派轮次',
  'report.col.toolCalls': '工具调用',
  'report.col.outputTokens': '输出 token',
  'report.col.inputTokens': '输入 token',
  'report.col.cacheRead': 'cacheRead',
  'report.efficiency': '效率（并列，不合成）',
  'report.efficiencyScope': '只统计已完成的格子（judged / archived / releasable / released）：未完成格子的耗时买到的工作量未知，混进来会让两列看着可比而其实不可比。',
  'report.efficiencyNone': '无 orchestrator 委派记录（durationMs / usage 缺失）——效率列全部留空。',
  'report.tokensCrossModel': 'token 跨模型不适用：上表按条件如实记录，但只在同模型条件之间比较（冻结决策 10）。',
  'report.tokensSameModel': '各条件同模型（{model}），token 列可比。',
  'report.excluded': '未计入上表的未完成格子（{total} 格）：{detail}——它们的委派时长如实存在于注解里，只是不进效率口径。',
  'report.excludedNone': '未计入上表的未完成格子：无——所有当前格子都已完成。',
  'report.judge': '判官一致性',
  'report.judgeSame': '同判官重采样',
  'report.judgeSameValue': '{criteria} 条判据有 ≥2 个样本 · 一致 {agreement} · κ {kappa}',
  'report.judgeCross': '跨判官',
  'report.judgeCrossValue': '{criteria} 条判据由 ≥2 个判官判过 · 全体一致 {agreement} · κ {kappa}',
  'report.judgeHuman': 'llm-draft 与 human-final',
  'report.judgeSelf': '自评判据数',
  'report.notes': '附注与保留条款',
  'report.finalize': 'finalize',
  'report.finalizeConfirm': '确认走闸',
  'report.finalizeConfirmAsk': 'finalize 会把本 run 每一个 archived 格子走一遍释放闸（archived → releasable → released）。闸拒了就记下来，不强推。',
  'report.finalizeCancel': '取消',
  'report.finalizeResult': 'finalize 结果',
  'report.finalizeCounts': '{released} 已释放 · {refused} 被闸拒 · {skipped} 跳过（{skips}）',
  'notice.finalized': 'finalize：{released} 释放、{refused} 被闸拒、{skipped} 跳过',
  'review.loading': '正在校验计划…',
  'review.error': '计划审阅加载失败',
  'review.noPlan': '这个 run 没有记录计划文件，无从审阅——它的 run.meta 在概览页。',
  'review.planPath': '计划文件',
  'review.order': '顺序',
  'review.orderValue': 'seed {seed}',
  'review.orderInterleaved': '交错（同一条件不连续排列）',
  'review.orderSequential': '不交错',
  'review.stages': '阶段',
  'review.budget': '每格预算',
  'review.budgetValue': '{minutes} 活跃分钟 · {turns} 轮',
  'review.expectedNs': '期望的判定来源',
  'review.retry': '每格基础设施重试',
  'review.retryDefault': '按缺省',
  'review.exports': 'bundle 导出目录',
  'review.exportsDefault': '<题库>/exports',
  'review.items': '题目',
  'review.notes': '作者备注',
  'review.checks': 'validate',
  'review.checksNone': 'validate 什么都没报——计划文件读不出来',
  'review.conditions': '条件',
  'review.lockOk': 'lock 有效',
  'review.lockStale': 'lock 过期',
  'review.lockNone': '没有 lock',
  'severity.ok': '通过',
  'severity.warn': '警告',
  'severity.error': '错误',
  'review.approve': '批准并启动',
  'review.approving': '正在启动…',
  'review.approveBlocked': 'validate 有 {errors} 个错误——改掉再刷新；条件都解析不出来的计划不能启动。',
  'review.sendBack': '退回修改',
  'review.sentBack': '已退回修改。这只是本页上的一段备注：计划文件没有改动，实验按草稿显示，直到它重新通过 validate。',
  'review.started': '已启动',
  'review.startedValue': 'job {jobId} · run {runId}',
  'review.parentSession': '父会话',
  'review.refusal': '被拒',
  'review.jobLog': '运行日志（原文）',
  'review.jobLogEmpty': '这个 run 还没有输出——刷新试试',
  'review.jobLogError': '运行日志读取失败',
  'conditions.loading': '加载条件…',
  'conditions.error': '条件列表加载失败',
  'conditions.empty': '这个题库没有声明条件——条件文件放在 <题库>/datasets/<题集>/conditions/<id>.json',
  'conditions.repo': '题库',
  'conditions.col.id': '条件',
  'conditions.col.harness': 'harness',
  'conditions.col.model': 'model.declared',
  'conditions.col.scope': 'scope',
  'conditions.col.preset': 'preset',
  'conditions.col.lock': 'lock',
  'conditions.col.ready': '就绪',
  'conditions.scopeDefault': '默认',
  'conditions.lockOk': '有效',
  'conditions.lockStale': '过期',
  'conditions.lockNone': '无',
  'conditions.homeUnhashed': 'home 未 provision',
  'conditions.ready': '就绪',
  'conditions.unready': '未就绪',
  'conditions.missing': '缺失',
  'conditions.pickHint': '选两条条件出 diff。',
  'conditions.pickOne': '已选一条——再选一条出 diff。',
  'conditions.diff': 'diff',
  'conditions.diffIdentical': '{a} 与 {b} 完全相同（notes 不计，与哈希口径一致）',
  'conditions.diffNotesOnly': '只有 notes 不同——改注释不是新因子',
  'conditions.diffCount': '{count} 个字段不同',
  'conditions.diffAbsent': '无此字段',
  'conditions.diffError': '两条条件的 diff 失败',
  'conditions.new': '新建条件',
  'conditions.newPlaceholder': '选模型即新建条件，所以这个按钮回到新建实验表单，那张表归 T34。在那之前，条件用文件起草，再用 /eval conditions provision 落成。',
}
