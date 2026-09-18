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
  | 'page.design'
  | 'page.runs'
  | 'page.compare'
  | 'page.review'
  | 'detail.back'
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
  | 'overview.meta'
  | 'overview.job'
  | 'overview.validation'
  | 'overview.validationOk'
  | 'overview.validationFailed'
  | 'report.loading'
  | 'report.error'
  | 'report.noBundle'
  | 'report.searched'
  | 'report.exportNow'
  | 'report.lookInDir'
  | 'report.lookInGo'
  | 'report.counts'
  | 'report.cliHint'
  | 'report.exportedAt'
  | 'report.exportedAtUnknown'
  | 'report.summaryIn'
  | 'report.summaryMissing'
  | 'report.staleAfterFinal'
  | 'report.reexport'
  | 'report.reexporting'
  | 'report.reexportNeedsDialog'
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
  | 'report.criteria'
  | 'report.criteriaHint'
  | 'report.criteriaTotal'
  | 'report.criteriaUndeclared'
  | 'report.criteriaEvidence'
  | 'report.criteriaNoEvidence'
  | 'report.criteriaExpand'
  | 'report.criteriaReps'
  | 'report.criteriaWeighted'
  | 'report.criteriaNotJudged'
  | 'report.humanOverride'
  | 'report.supersededBy'
  | 'report.sampleLine'
  | 'report.holds'
  | 'report.holdsNot'
  | 'report.polarityNegative'
  | 'report.polarityPositive'
  | 'report.col.criterion'
  | 'report.col.axis'
  | 'report.col.weight'
  | 'report.col.polarity'
  | 'source.human'
  | 'source.llm'
  | 'source.script'
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
  | 'report.finalizeUnits'
  | 'report.finalizeUnitsUnknown'
  | 'report.unitsLoading'
  | 'report.unitsError'
  | 'report.unitsUnknown'
  | 'report.unitsNone'
  | 'report.unitsHeld'
  | 'report.unitsTitle'
  | 'report.unitsHint'
  | 'report.unitRunning'
  | 'report.unitStopped'
  | 'report.reclaim'
  | 'report.reclaimConfirm'
  | 'report.reclaimConfirmAsk'
  | 'notice.finalized'
  | 'notice.reexported'
  | 'judge.loading'
  | 'judge.error'
  | 'judge.empty'
  | 'judge.blindNotice'
  | 'judge.queue'
  | 'judge.graded'
  | 'judge.materialNone'
  | 'judge.scrubbed'
  | 'judge.criteria'
  | 'judge.criteriaNone'
  | 'judge.negative'
  | 'judge.veto'
  | 'judge.weight'
  | 'judge.criterionEvidence'
  | 'judge.drafts'
  | 'judge.draftsNone'
  | 'judge.selfJudged'
  | 'judge.pass'
  | 'judge.fail'
  | 'judge.unanswered'
  | 'judge.evidence'
  | 'judge.evidencePlaceholder'
  | 'judge.humanFinal'
  | 'judge.humanFinalNone'
  | 'judge.submitting'
  | 'judge.submitBlocked'
  | 'judge.bundleStale'
  | 'judge.reexport'
  | 'judge.reexporting'
  | 'judge.regrade'
  | 'judge.scoringMix'
  | 'judge.stats'
  | 'judge.statsSame'
  | 'judge.statsCross'
  | 'judge.statsHuman'
  | 'judge.statsSelf'
  | 'judge.panel'
  | 'notice.humanFinal'
  | 'notice.humanFinalDuplicate'
  | 'new.title'
  | 'new.description'
  | 'new.name'
  | 'new.namePlaceholder'
  | 'new.dataset'
  | 'new.datasetPick'
  | 'new.commit'
  | 'new.commitPlaceholder'
  | 'new.items'
  | 'new.itemsEmpty'
  | 'new.conditions'
  | 'new.conditionsEmpty'
  | 'new.mintOpen'
  | 'new.mintClose'
  | 'new.mintTitle'
  | 'new.mintId'
  | 'new.mintIdPlaceholder'
  | 'new.mintFrom'
  | 'new.mintFromPick'
  | 'new.mintUnchanged'
  | 'new.mintOneFactor'
  | 'new.mintFactors'
  | 'new.mint.harness'
  | 'new.mint.model'
  | 'new.mint.scope'
  | 'new.mint.preset'
  | 'new.mint.permissions'
  | 'new.mint.reasoning'
  | 'new.judges'
  | 'new.judgeSamples'
  | 'new.stages'
  | 'new.stagesEmpty'
  | 'new.reps'
  | 'new.seed'
  | 'new.interleave'
  | 'new.budget'
  | 'new.activeMinutes'
  | 'new.turns'
  | 'new.unit'
  | 'new.unitImage'
  | 'new.unitNetwork'
  | 'new.egress'
  | 'new.notes'
  | 'new.notesPlaceholder'
  | 'new.notStarting'
  | 'new.save'
  | 'new.saving'
  | 'new.cancel'
  | 'new.error'
  | 'new.optionsError'
  | 'notice.drafted'
  | 'notice.draftedWithErrors'
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
  | 'cells.col.cell'
  | 'cells.col.attempt'
  | 'cells.col.duration'
  | 'drawer.close'
  | 'drawer.loading'
  | 'drawer.error'
  | 'drawer.resourceNone'
  | 'drawer.checkpoints'
  | 'drawer.attempts'
  | 'drawer.history'
  | 'drawer.probes'
  | 'drawer.probesNone'
  | 'drawer.openSession'
  | 'drawer.noSession'
  | 'drawer.releasable'
  | 'drawer.notReleasable'
  | 'action.retry'
  | 'action.release'
  | 'action.export'
  | 'retry.reason'
  | 'retry.category'
  | 'notice.failed'
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
  | 'export.doneWithReport'
  | 'export.doneNoReport'
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
  | 'review.retry'
  | 'review.retryDefault'
  | 'review.exports'
  | 'review.exportsDefault'
  | 'review.items'
  | 'review.checks'
  | 'review.checksNone'
  | 'severity.ok'
  | 'severity.warn'
  | 'severity.error'
  | 'review.keepUnits'
  | 'review.keepUnitsHint'
  | 'review.sendBack'
  | 'review.sentBack'
  | 'review.started'
  | 'review.startedValue'
  | 'review.parentSession'
  | 'review.refusal'
  | 'review.approveError'
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
  | 'conditions.col.endpoint'
  | 'conditions.col.scope'
  | 'conditions.col.preset'
  | 'conditions.col.lock'
  | 'conditions.col.ready'
  | 'conditions.col.action'
  | 'conditions.endpointUnset'
  | 'conditions.endpointEdit'
  | 'conditions.endpointPlaceholder'
  | 'conditions.endpointSave'
  | 'conditions.endpointCancel'
  | 'conditions.endpointWritten'
  | 'conditions.endpointUnchanged'
  | 'conditions.endpointLockStale'
  | 'conditions.endpointFailed'
  | 'conditions.provision'
  | 'conditions.provisioning'
  | 'conditions.provisionHint'
  | 'conditions.provisionResult'
  | 'conditions.provisionWritten'
  | 'conditions.provisionRefused'
  | 'conditions.provisionWroteBack'
  | 'conditions.provisionHome'
  | 'conditions.provisionFailed'
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
  | 'error.notGitRepo'
  | 'error.notGitRepo.fix'
  | 'error.notDatasetRepo'
  | 'error.notDatasetRepo.fix'
  | 'error.pathMissing'
  | 'error.pathMissing.fix'
  | 'error.unbound'
  | 'error.unbound.fix'
  | 'error.serviceMissing'
  | 'error.serviceMissing.fix'
  | 'error.cancelled'
  | 'error.cancelled.fix'
  | 'error.unknownFix'
  | 'error.details'
  | 'error.detailsPath'
  | 'dur.s'
  | 'dur.ms'
  | 'dur.hm'
  | 'dur.dh'
  | 'agreement.high'
  | 'agreement.medium'
  | 'agreement.low'
  | 'agreement.none'
  | 'judge.addJudge'
  | 'judge.filterAll'
  | 'judge.filterUngraded'
  | 'judge.filterGraded'
  | 'judge.queueRow'
  | 'cells.col.state'
  | 'report.judgeSampleCount'
  | 'factors.plusIncidental'
  | 'list.emptyHint'
  | 'list.emptyAction'
  | 'draft.notStarted'
  | 'draft.notStartedHint'
  | 'draft.starting'
  | 'draft.startingHint'
  | 'overview.metaRaw'
  | 'role.judge'
  | 'stage.pending'
  | 'stage.ws-ready'
  | 'stage.stage-1'
  | 'stage.stage-2'
  | 'stage.stage-3'
  | 'stage.stage-4'
  | 'stage.stage-5'
  | 'stage.stage-6'
  | 'stage.stageN'
  | 'stage.judged'
  | 'stage.halted'
  | 'stage.archived'
  | 'stage.releasable'
  | 'stage.released'
  | 'stage.unknown'
  | 'stage.mixed'
  | 'bucket.ready'
  | 'bucket.scheduled'
  | 'bucket.blocked'
  | 'bucket.active'
  | 'bucket.done'
  | 'bucket.other'
  | 'retry.cat.infrastructure'
  | 'retry.cat.operator'
  | 'retry.cat.outcome'
  | 'retry.cat.other'
  | 'factor.harness.name'
  | 'factor.harness.version'
  | 'factor.harness.drive'
  | 'factor.model.declared'
  | 'factor.model.endpoint'
  | 'factor.reasoning.effort'
  | 'factor.permissions'
  | 'factor.instructions'
  | 'factor.preset'
  | 'factor.skills.pack'
  | 'factor.scope'
  | 'factor.home.sha'
  | 'factor.env.keys'
  | 'factor.unit.scopedHome.container'
  | 'factor.unit.scopedHome.var'
  | 'factor.other'
  | 'matrix.arrange'
  | 'matrix.columnIs'
  | 'matrix.legendToggle'
  | 'matrix.repLabel'
  | 'matrix.noCondition'
  | 'matrix.hashMismatchChip'
  | 'matrix.hashUnknownChip'
  | 'matrix.stuckChip'
  | 'matrix.incidental'
  | 'matrix.incidentalHint'
  | 'matrix.emptyHint'
  | 'cells.emptyHint'
  | 'cells.emptyClear'
  | 'drawer.attemptNo'
  | 'drawer.probeOk'
  | 'drawer.probeFailed'
  | 'conditions.emptyHint'
  | 'conditions.provisionCredential'
  | 'conditions.provisionHomeFold'
  | 'review.refusalLead'
  | 'review.refusalRaw'
  | 'report.noBundleHint'
  | 'report.whereFold'
  | 'report.finalizeRaw'
  | 'report.unitHeldChip'
  | 'report.refusedChip'
  | 'judge.emptyHint'
  | 'judge.pickHint'
  | 'cta.draft'
  | 'cta.draftHint'
  | 'cta.pending'
  | 'cta.pendingHint'
  | 'cta.running'
  | 'cta.runningHint'
  | 'cta.judging'
  | 'cta.judgingHint'
  | 'cta.done'
  | 'cta.doneHint'
  | 'cta.refused'
  | 'cta.refusedHint'
  | 'cta.cancelled'
  | 'cta.cancelledHint'
  | 'cta.blocked'
  | 'cta.waiting'
  | 'design.scale'
  | 'design.groups'
  | 'design.grid'
  | 'design.advanced'
  | 'design.advancedHint'
  | 'design.planned'
  | 'design.single'
  | 'design.addGroup'
  | 'design.addGroupHint'
  | 'design.notes'
  | 'design.verdictSources'
  | 'design.gridHint'
  | 'design.bind'
  | 'design.noRepo'
  | 'design.noRepoHint'
  | 'design.bindTitle'
  | 'design.bindWhere'
  | 'design.bindShape'
  | 'ready.badge'
  | 'ready.recheck'
  | 'ready.pending'
  | 'ready.failedCount'
  | 'ready.rawFold'
  | 'runs.filter.all'
  | 'runs.filter.active'
  | 'runs.filter.done'
  | 'runs.filter.failed'
  | 'runs.filter.blocked'
  | 'runs.col.verdict'
  | 'runs.filtered'
  | 'verdict.none'
  | 'verdict.human'
  | 'verdict.llm'
  | 'verdict.script'
  | 'verdict.hint'
  | 'record.head'
  | 'record.ok'
  | 'record.failed'
  | 'record.scoreWhere'
  | 'record.scoreMixed'
  | 'record.timeline'
  | 'record.timelineNone'
  | 'record.params'
  | 'record.attachments'
  | 'record.attachmentsNone'
  | 'record.filePending'
  | 'record.param.task'
  | 'record.param.condition'
  | 'record.param.rep'
  | 'record.param.attempt'
  | 'record.param.material'
  | 'record.param.fingerprint'
  | 'record.param.unit'
  | 'record.param.judge'
  | 'artifact.materialization'
  | 'artifact.archive'
  | 'artifact.verdicts'
  | 'artifact.stage'
  | 'artifact.log'
  | 'artifact.other'
  | 'invariant.why.materialization'
  | 'invariant.why.fingerprint'
  | 'invariant.why.subject'
  | 'invariant.why.procedure'
  | 'report.chart'
  | 'report.chart.activeMs'
  | 'report.chart.outputTokens'
  | 'report.chart.cacheRead'
  | 'report.chartNone'
  | 'judge.itemPick'
  | 'judge.itemCount'
  | 'judge.column'
  | 'judge.submitOne'
  | 'judge.sideBySide'
  | 'new.step'
  | 'new.step1'
  | 'new.step2'
  | 'new.step3'
  | 'new.step4'
  | 'new.back'
  | 'new.next'
  | 'new.stepBlocked'
  | 'runs.settled'
  | 'error.planUnreadable'
  | 'error.planUnreadable.fix'
  | 'why.endpoint'
  | 'why.homeSha'
  | 'why.lock'
  | 'why.file'
  | 'why.other'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The lab session-tab copy. */
    'dshEval': EvalKey
  }
}

/** English dictionary. */
export const en: Record<EvalKey, string> = {
  // The three-part error seat (ui-spec §九): one sentence on what happened,
  // one on the fix; the raw text and the path stay folded under Details.
  'error.notGitRepo': 'The bound dataset path is not a git repository',
  'error.notGitRepo.fix': 'Bind the repository root instead: /datasets bind <path> --layers visible',
  'error.notDatasetRepo': 'That repository holds no datasets (no datasets/ directory)',
  'error.notDatasetRepo.fix': 'Bind the dataset repository’s root, or create datasets/ in it first',
  'error.pathMissing': 'The bound dataset path is not on disk',
  'error.pathMissing.fix': 'Check the directory is still there, then bind again: /datasets bind <path> --layers visible',
  'error.unbound': 'This session has no dataset repository bound',
  'error.unbound.fix': 'Bind one first: /datasets bind <path> --layers visible',
  'error.serviceMissing': 'This instance is missing a service this page needs',
  'error.serviceMissing.fix': 'A member is absent from the preset; install it and reopen this tab',
  'error.cancelled': 'The request was cancelled',
  'error.cancelled.fix': 'Try again',
  'error.unknownFix': 'Try again; if it persists, send the raw text under Details to the maintainer',
  'error.details': 'Details',
  'error.detailsPath': 'Path',
  'open': 'Experiments',
  'list.title': 'Experiments',
  'list.new': 'New experiment',
  'list.loading': 'Loading…',
  'list.error': 'Failed to load the experiments',
  'list.empty': 'No experiment yet',
  'list.refresh': 'Refresh',
  'col.name': 'Name',
  'col.snapshot': 'Dataset version',
  'col.conditions': 'Arms',
  'col.items': 'Items',
  'col.reps': 'Takes',
  'col.factors': 'Variables',
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
  'factors.single': 'one arm only',
  'detail.back': 'Back to the list',
  'detail.error': 'Failed to open the experiment',
  'overview.snapshot': 'Dataset version',
  'overview.shape': 'Experiment size',
  'overview.shapeValue': '{items} item(s) × {conditions} arm(s) × {reps} take(s) = {cells} record(s)',
  'overview.factors': 'Variables',
  'overview.judge': 'Judge',
  'overview.judgeNone': 'none — no LLM judging this run',
  'overview.judgeSamples': '{samples} sample(s)',
  'overview.environment': 'Environment',
  'overview.environmentHost': 'host path (no unit segment)',
  'overview.readiness': 'Readiness check',
  'overview.meta': 'run.meta',
  'overview.job': 'Background job',
  'overview.validation': 'Validate',
  'overview.validationOk': 'ok',
  'overview.validationFailed': '{errors} error(s), {warnings} warning(s)',
  'judge.loading': 'Loading the judging queue…',
  'judge.error': 'Failed to open the judging queue',
  'judge.empty': 'This experiment has no record to grade yet.',
  'judge.blindNotice': 'Blind review: the harness, the model and the arm are deliberately absent from this page. Records are numbered in the run\u2019s own (seeded) order, and the panel reads Judge A / Judge B. Unblinding happens on the results page.',
  'judge.queue': 'Queue',
  'judge.graded': 'Graded ({count})',
  'judge.materialNone': 'This record archived none of the judged stage files — there is nothing to read, and a verdict on nothing would be a guess.',
  'judge.scrubbed': '{count} fingerprint(s) replaced',
  'judge.criteria': 'Criteria (kind: human)',
  'judge.criteriaNone': 'No human criteria to answer: {reason}',
  'judge.negative': 'defect',
  'judge.veto': 'veto',
  'judge.weight': 'weight {weight}',
  'judge.criterionEvidence': 'What counts as evidence: {evidence}',
  'judge.drafts': 'llm-draft',
  'judge.draftsNone': 'no llm-draft sample for this criterion',
  'judge.selfJudged': 'self-judged',
  'judge.pass': 'holds',
  'judge.fail': 'does not hold',
  'judge.unanswered': 'unanswered',
  'judge.evidence': 'Evidence',
  'judge.evidencePlaceholder': 'A checkable fact, not an opinion',
  'judge.humanFinal': 'human-final on record',
  'judge.humanFinalNone': 'nothing recorded yet',
  'judge.submitting': 'Recording…',
  'judge.submitBlocked': 'Answer at least one criterion, with evidence, before recording.',
  'judge.bundleStale': 'The exported bundle was written before these final verdicts, so it does not carry them. Export again to put them in it — the report goes with it, and the old directory is left alone.',
  'judge.reexport': 'Export again',
  'judge.reexporting': 'Exporting…',
  'judge.scoringMix': 'Your verdict covers only the criteria you answer here. The report scores each criterion from the most authoritative layer that judged IT, so these {count} criteria the judge answered and you do not ({criteria}) keep counting, on the judge\u2019s word. This record\u2019s score then comes from both, and the report says so beside it.',
  'judge.regrade': 'This record already carries a human-final verdict. Recording again APPENDS: the report reads the latest value per criterion, and the earlier one stays in the ledger.',
  'judge.stats': 'Grader agreement (live, from the ledger)',
  'judge.statsSame': 'One judge, resampled',
  'judge.statsCross': 'Across judges',
  'judge.statsHuman': 'llm-draft vs human-final',
  'judge.statsSelf': 'Self-judged criteria',
  'judge.panel': '{count} judge condition(s) on the panel',
  'notice.humanFinal': 'human-final recorded on record {no}: {count} verdict(s), by {by}',
  'notice.humanFinalDuplicate': 'Record {no} already carried exactly these verdicts — the ledger is append-only and identical repeats are a no-op, so nothing was written.',
  'new.title': 'New experiment',
  'new.description': 'Drafts plans/<name>.json (and any new condition file) into the bound repository working copy, then validates it. Nothing is committed and nothing is started — approving is the next page.',
  'new.name': 'Name',
  'new.namePlaceholder': 'The plan\'s file name, e.g. i5-walk',
  'new.dataset': 'Dataset set',
  'new.datasetPick': 'Pick a set…',
  'new.commit': 'Snapshot',
  'new.commitPlaceholder': 'Commit to pin; empty lets the run pin it at start',
  'new.items': 'Items',
  'new.itemsEmpty': 'Pick a dataset set first — its items fill this list',
  'new.conditions': 'Conditions',
  'new.conditionsEmpty': 'This set declares no conditions yet',
  'new.mintOpen': 'New condition',
  'new.mintClose': 'Drop the new condition',
  'new.mintTitle': 'A new condition is a COPY: pick one that exists and change a field. Two conditions differing in ONE field are a single-factor pair — that is what makes the comparison answerable.',
  'new.mintId': 'New id',
  'new.mintIdPlaceholder': 'conditions/<id>.json',
  'new.mintFrom': 'Copy from',
  'new.mintFromPick': 'Pick the condition to copy…',
  'new.mintUnchanged': 'unchanged',
  'new.mintOneFactor': 'One field changes: {field}. That is a single-factor pair.',
  'new.mintFactors': '{count} fields change — the comparison then cannot say which one moved the result.',
  'new.mint.harness': 'harness',
  'new.mint.model': 'model',
  'new.mint.scope': 'scope',
  'new.mint.preset': 'preset',
  'new.mint.permissions': 'permissions',
  'new.mint.reasoning': 'reasoning',
  'new.judges': 'Judge',
  'new.judgeSamples': 'samples per cell',
  'new.stages': 'Stages',
  'new.stagesEmpty': 'This set ships no stage schemas',
  'new.reps': 'Reps',
  'new.seed': 'Order seed',
  'new.interleave': 'interleave (spread same-condition cells apart)',
  'new.budget': 'Budget',
  'new.activeMinutes': 'active minutes per cell',
  'new.turns': 'turns per cell',
  'new.unit': 'Environment',
  'new.unitImage': 'image (empty = host path)',
  'new.unitNetwork': 'network (undeclared bridge HAS egress)',
  'new.egress': 'egress check argv, space separated',
  'new.notes': 'Notes',
  'new.notesPlaceholder': 'What this comparison is for, and what it cannot settle',
  'new.notStarting': 'Saving drafts and validates. Starting is 批准并启动 on the Design stage; logging the harnesses in and provisioning their comparison groups come first, and both are yours.',
  'new.save': 'Save draft and validate',
  'new.saving': 'Saving…',
  'new.cancel': 'Cancel',
  'new.error': 'The draft was not written',
  'new.optionsError': 'Could not read what this repository holds',
  'notice.drafted': 'Drafted {name} — validate found no errors. Approving and starting is on this page.',
  'notice.draftedWithErrors': 'Drafted {name} — validate found {errors} error(s), so it stays a draft. The list below says what.',
  'matrix.loading': 'Arranging the grid…',
  'matrix.error': 'Failed to arrange the grid',
  'matrix.empty': 'This experiment expanded no run record',
  'matrix.column': 'Column',
  'matrix.group': 'Group by',
  'matrix.filter': 'Filter',
  'matrix.filterAll': 'all',
  'matrix.noFactor': 'The arms agree on every field, so there is one column and no variable to compare.',
  'matrix.task': 'Item',
  'matrix.legend': 'dot: ● judged ◐ in progress ○ not started · red edge: this row disagrees on the item material',
  'matrix.hashMismatch': 'the item material differs from the rest of this row',
  'matrix.hashUnknown': 'no evidence of item consistency was recorded',
  'matrix.stuck': 'nothing has happened here for over {minutes} min',
  'matrix.reps': '{count} rep(s)',
  'summary.title': 'Experiment summary',
  'summary.materialization': 'Item consistency',
  'summary.fingerprint': 'Environment consistency',
  'summary.unreleased': 'Unreleased units',
  'summary.judge': 'Grader agreement',
  'summary.judgePending': 'awaiting the report',
  'summary.stuck': 'Stuck records',
  'summary.cells': 'Records shown',
  'invariant.ok': 'ok',
  'invariant.violated': 'violated',
  'invariant.unverifiable': 'unverifiable',
  'cells.loading': 'Loading the run records…',
  'cells.error': 'Failed to load the run records',
  'cells.empty': 'No run record matches this filter',
  'cells.col.cell': 'Item × arm × take',
  'cells.col.attempt': 'Attempts',
  'cells.col.duration': 'In state',
  'drawer.close': 'Close',
  'drawer.loading': 'Loading the record…',
  'drawer.error': 'Failed to open the record',
  'drawer.resourceNone': 'no unit (host path)',
  'drawer.checkpoints': 'Checkpoints',
  'drawer.attempts': 'Attempts',
  'drawer.history': 'Transitions',
  'drawer.probes': 'Verify output (verbatim)',
  'drawer.probesNone': 'this cell recorded no probe run',
  'drawer.openSession': 'Open the child session',
  'drawer.noSession': 'this attempt recorded no child session — nothing to open',
  'drawer.releasable': 'releasable — its resources may be destroyed',
  'drawer.notReleasable': 'NOT releasable',
  'action.retry': 'Re-run',
  'action.release': 'Release check',
  'action.export': 'Export bundle',
  'retry.reason': 'Reason for the re-run',
  'retry.category': 'Retry category',
  'notice.failed': 'That action did not go through',
  'notice.retried': 'record {id} opened attempt {attempt}',
  'notice.releasable': '{id}: releasable',
  'notice.notReleasable': '{id}: not releasable yet',
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
  'export.doneWithReport': 'exported {dir} ({count} files) — report written to {summary} ({rows} verdict row(s))',
  'export.doneNoReport': 'exported {dir} ({count} files) — the report was NOT written beside it, so run `dsh-eval report {dir}` by hand',
  'export.error': 'Export failed',
  'report.loading': 'Reading the bundle…',
  'report.error': 'Failed to build the report',
  'report.noBundle': 'This run has not been exported yet',
  'report.searched': 'Where it looked, and what it said',
  'report.exportNow': 'Export the bundle',
  'report.lookInDir': 'Export directory to look in (a run started with --out)',
  'report.lookInGo': 'Look here',
  'report.counts': '{rows} verdict row(s) · {missions} cell(s) · {attempts} attempt(s) · {retries} infrastructure retry/retries (aggregation uses each cell\'s current attempt)',
  'report.cliHint': 'Write it to disk',
  'report.exportedAt': 'Bundle written {at}',
  'report.exportedAtUnknown': 'Bundle write time unknown (no readable manifest.json)',
  'report.summaryIn': 'report/summary.md is in the bundle',
  'report.summaryMissing': 'This bundle carries no report/summary.md — it was exported before the export action wrote one. Export again to get it.',
  'report.staleAfterFinal': 'This bundle is OLDER than the last final verdict ({final}), so the numbers above were computed without it. Export again: a fresh bundle and its report go into a new directory, and this one is left alone.',
  'report.reexport': 'Export again',
  'report.reexporting': 'Exporting…',
  'report.reexportNeedsDialog': 'No earlier export is on record for this run, so there is nothing to repeat — use 导出 and choose the layers.',
  'report.toolOnlyNs': 'RED FLAG: every verdict in the expectedNs namespace `{ns}` was written by a `tool:` caller — the source disagrees with that namespace\'s contract, and conclusions resting on it are in doubt.',
  'report.invariants': 'Experiment validity checks',
  'report.comparisonClosed': '{count} validity check(s) did not pass, so this experiment\u2019s records are not comparable yet. What follows is each arm on its own.',
  'report.singleCondition': 'One arm only: there is nothing to compare against, so what follows is the baseline.',
  'report.noPairs': 'No pair of arms produced comparable data.',
  'report.pairTitle': '{a} vs {b}',
  'report.pairNoTasks': 'No paired item (the two conditions ran disjoint item sets).',
  'report.factorSingle': 'differs in {factor}: {detail}',
  'report.factorMulti': 'differs in several fields: {fields} ({detail})',
  'report.factorUnknown': 'factor unknown — {detail}',
  'report.ci': 'mean Δ = {mean}, 95% CI [{lo}, {hi}] (bootstrap over reps × {samples}, seed {seed})',
  'report.rank': 'Ranking',
  'report.selfJudged': 'self-judged',
  'report.col.task': 'Item',
  'report.col.delta': 'Δ score',
  'report.col.weightedDelta': 'Δ weighted',
  'report.col.deltas': 'Δ per rep',
  'report.col.n': 'n',
  'report.criteria': 'Per-criterion scores and the grounds behind them',
  'report.criteriaHint': 'Each cell is what this criterion concluded in that arm: ✓ / ✗, or the proportion for a proportionally scored one; over several reps, how many it held in. The small print is where the SCORE came from — each criterion independently takes the most authoritative layer that judged it (human > judge > script), so one cell may mix them. Click a cell for the evidence and who wrote it.',
  'report.criteriaTotal': 'Item total',
  'report.criteriaUndeclared': 'Not in the rubric weight table — only the verdicts name it, so it is treated as declaring no weight and no polarity.',
  'report.criteriaEvidence': 'Grounds',
  'report.criteriaNoEvidence': 'This verdict recorded no evidence text.',
  'report.criteriaExpand': 'Evidence for {criterion} in {condition}',
  'report.criteriaReps': '{count} rep',
  'report.criteriaWeighted': 'weighted {value}',
  'report.criteriaNotJudged': 'Not judged in this arm',
  'report.humanOverride': 're-judged by a person',
  'report.supersededBy': 'superseded — the judge\u2019s original verdict, kept',
  'report.sampleLine': 'rep {rep} · {source}',
  'report.holds': 'holds',
  'report.holdsNot': 'does not hold',
  'report.polarityNegative': 'defect',
  'report.polarityPositive': 'positive',
  'report.col.criterion': 'Criterion',
  'report.col.axis': 'Dimension',
  'report.col.weight': 'Weight',
  'report.col.polarity': 'Polarity',
  'source.human': 'Human',
  'source.llm': 'Judge',
  'source.script': 'Script',
  'report.col.judges': 'Judges',
  'report.col.condition': 'Arm',
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
  'report.judge': 'Grader agreement',
  'report.judgeSame': 'One judge, resampled',
  'report.judgeSameValue': '{criteria} criteria with ≥2 samples · agreed {agreement} · κ {kappa}',
  'report.judgeCross': 'Across judges',
  'report.judgeCrossValue': '{criteria} criteria judged by ≥2 judges · all agreed {agreement} · κ {kappa}',
  'report.judgeHuman': 'llm-draft vs human-final',
  'report.judgeSelf': 'Self-judged criteria',
  'report.notes': 'Notes and reservations',
  'report.finalize': 'Close out',
  'report.finalizeConfirm': 'Yes, walk the gate',
  'report.finalizeConfirmAsk': 'finalize walks EVERY archived cell of this run through the release gate (archived → releasable → released). A refused gate is recorded, never forced.',
  'report.finalizeCancel': 'Cancel',
  'report.finalizeResult': 'finalize',
  'report.finalizeCounts': '{released} released · {refused} gate-refused · {skipped} skipped ({skips})',
  'report.finalizeUnits': 'containers: {released} reclaimed · {held} still up',
  'report.finalizeUnitsUnknown': 'containers: unknown — this instance mounts no lab, so none were touched',
  'report.unitsLoading': 'units…',
  'report.unitsError': 'units',
  'report.unitsUnknown': 'units: unknown',
  'report.unitsNone': 'units: none held',
  'report.unitsHeld': 'unreclaimed units: {count}',
  'report.unitsTitle': 'Unreclaimed units',
  'report.unitsHint': "A unit whose cell is 'archived' is one Reclaim can still take; one whose cell is already 'released' is past every gate, and only dsh-lab release --force can end it — a human's call.",
  'report.unitRunning': 'up',
  'report.unitStopped': 'stopped',
  'report.reclaim': 'Reclaim',
  'report.reclaimConfirm': 'Yes, reclaim',
  'report.reclaimConfirmAsk': 'Reclaiming walks the SAME release gate finalize does: every archived cell goes archived → releasable → released and its container is destroyed there. A refused gate is recorded, never forced.',
  'notice.finalized': 'finalize: {released} released, {refused} gate-refused, {skipped} skipped; containers: {unitsReleased} reclaimed, {unitsHeld} still up',
  'notice.reexported': 'exported again into {dir} ({count} files) — report written, and the previous bundle is untouched',
  'review.loading': 'Validating the plan…',
  'review.error': 'Failed to read the plan',
  'review.noPlan': 'This run records no plan document, so there is nothing to review — its run.meta is on the overview.',
  'review.planPath': 'Plan document',
  'review.order': 'Order',
  'review.orderValue': 'seed {seed}',
  'review.orderInterleaved': 'interleaved (same-condition cells spread apart)',
  'review.orderSequential': 'not interleaved',
  'review.stages': 'Stages',
  'review.budget': 'Budget per cell',
  'review.budgetValue': '{minutes} active minute(s) · {turns} turn(s)',
  'review.retry': 'Infrastructure retries per cell',
  'review.retryDefault': 'plan default',
  'review.exports': 'Bundle export directory',
  'review.exportsDefault': '<dataset repo>/exports',
  'review.items': 'Items',
  'review.checks': 'Validate',
  'review.checksNone': 'validate reported nothing at all — the plan document could not be read',
  'severity.ok': 'ok',
  'severity.warn': 'warn',
  'severity.error': 'error',
  'review.keepUnits': 'Keep the units',
  'review.keepUnitsHint': "Every cell will stop at 'archived' and keep its container for you to open. Nothing is released until you finalize the run, so a matrix larger than lab's unit ceiling cannot finish this way.",
  'review.sendBack': 'Send back for changes',
  'review.sentBack': 'Sent back for changes. This is a note on this page only: the plan file is unchanged, and the experiment is shown as a draft until it validates again.',
  'review.started': 'Started',
  'review.startedValue': 'job {jobId} · run {runId}',
  'review.parentSession': 'Parent session',
  'review.refusal': 'Refused',
  'review.approveError': 'Could not send the approval',
  'review.jobLog': 'Run log (verbatim)',
  'review.jobLogEmpty': 'the run has emitted no line yet — refresh',
  'review.jobLogError': 'Failed to read the run log',
  'conditions.loading': 'Loading the arms…',
  'conditions.error': 'Failed to load the arms',
  'conditions.empty': 'This repository declares no arm',
  'conditions.repo': 'Repository',
  'conditions.col.id': 'Arm',
  'conditions.col.harness': 'Harness',
  'conditions.col.model': 'Model',
  'conditions.col.scope': 'Scope',
  'conditions.col.preset': 'Preset',
  'conditions.col.lock': 'Lock',
  'conditions.col.ready': 'Ready',
  'conditions.col.endpoint': 'Endpoint',
  'conditions.col.action': '',
  'conditions.endpointUnset': 'not set',
  'conditions.endpointEdit': 'Click to set the declared endpoint',
  'conditions.endpointPlaceholder': 'default',
  'conditions.endpointSave': 'Save',
  'conditions.endpointCancel': 'Cancel',
  'conditions.endpointWritten': 'Endpoint of {id} is now {value}.',
  'conditions.endpointUnchanged': 'Endpoint of {id} was already {value} — nothing written.',
  'conditions.endpointLockStale': 'The endpoint is part of the condition hash, so the lock beside it is now stale — provision again.',
  'conditions.endpointFailed': 'Could not set the endpoint',
  'conditions.provision': 'Prepare',
  'conditions.provisioning': 'Preparing…',
  'conditions.provisionHint': 'Turn this declaration into a real scoped home: check it field by field, write the home digest back into it, mint the lock. One action — it is ready afterwards, or the answer says where it stopped.',
  'conditions.provisionResult': 'Prepare · {id}',
  'conditions.provisionWritten': 'The lock is written — this arm is ready.',
  'conditions.provisionRefused': 'No lock was written — this arm is not ready.',
  'conditions.provisionWroteBack': 'The home digest was written back into the declaration and the arm re-hashed, so this step is not done twice.',
  'conditions.provisionHome': 'Scoped home {dir} · credential {credential}',
  'conditions.provisionFailed': 'Prepare did not run',
  'conditions.scopeDefault': 'default',
  'conditions.lockOk': 'ok',
  'conditions.lockStale': 'stale',
  'conditions.lockNone': 'none',
  'conditions.homeUnhashed': 'home not provisioned',
  'conditions.ready': 'ready',
  'conditions.unready': 'not ready',
  'conditions.missing': 'missing',
  'conditions.pickHint': 'Pick two arms to see what differs.',
  'conditions.pickOne': 'One picked — pick a second to see what differs.',
  'conditions.diff': 'Differences',
  'conditions.diffIdentical': '{a} and {b} are identical (notes excluded, as the hash excludes them)',
  'conditions.diffNotesOnly': 'Only the notes differ — a comment edit is not a new variable',
  'conditions.diffCount': '{count} field(s) differ',
  'conditions.diffAbsent': 'absent',
  'conditions.diffError': 'Failed to diff the two arms',

  // ── the word table (ui-spec §九) ────────────────────────────────────────
  // Every internal token this tab shows resolves through one of the four
  // groups below, so the same fact reads the same on every page.
  'role.judge': 'judge',
  'stage.pending': 'Not started',
  'stage.ws-ready': 'Workspace ready',
  'stage.stage-1': 'Stage 1',
  'stage.stage-2': 'Stage 2',
  'stage.stage-3': 'Stage 3',
  'stage.stage-4': 'Stage 4',
  'stage.stage-5': 'Stage 5',
  'stage.stage-6': 'Stage 6',
  'stage.stageN': 'Stage {n}',
  'stage.judged': 'Judged',
  'stage.halted': 'Halted',
  'stage.archived': 'Archived',
  'stage.releasable': 'Releasable',
  'stage.released': 'Released',
  'stage.unknown': 'Unknown stage ({token})',
  'stage.mixed': 'Mixed: {states}',
  'bucket.ready': 'Ready',
  'bucket.scheduled': 'Scheduled',
  'bucket.blocked': 'Blocked',
  'bucket.active': 'In progress',
  'bucket.done': 'Done',
  'bucket.other': 'Other ({token})',
  'retry.cat.infrastructure': 'Infrastructure',
  'retry.cat.operator': 'Operator',
  'retry.cat.outcome': 'Outcome',
  'retry.cat.other': 'Other ({token})',
  'factor.harness.name': 'Harness',
  'factor.harness.version': 'Version',
  'factor.harness.drive': 'Drive',
  'factor.model.declared': 'Model',
  'factor.model.endpoint': 'Endpoint',
  'factor.reasoning.effort': 'Reasoning effort',
  'factor.permissions': 'Permissions',
  'factor.instructions': 'System instructions',
  'factor.preset': 'Preset',
  'factor.skills.pack': 'Skill pack',
  'factor.scope': 'Scope',
  'factor.home.sha': 'Scoped-home digest',
  'factor.env.keys': 'Environment variable names',
  'factor.unit.scopedHome.container': 'Credential mount in the unit',
  'factor.unit.scopedHome.var': 'Credential variable in the unit',
  'factor.other': 'Other field',
  'factors.plusIncidental': '+{count} more',
  'list.emptyAction': 'Create the first experiment',
  'list.emptyHint': 'Draft one here, or ask the agent in chat for one — either way it lands in this list as a draft, and starting it is still a click on the Design stage.',
  'draft.notStarted': 'Not started yet',
  'draft.notStartedHint': 'This page fills in once a human approves the plan and starts the run — go to Design.',
  // The same seat, for a run that HAS been started: the approval receipt named
  // it, so 还没启动 would be false here — it is the ledger that has not caught
  // up yet, and this page catches up by itself (I5·T39 · G11).
  'draft.starting': 'Starting it',
  'draft.startingHint': 'The run is created and this page picks it up on its own in a moment — no need to refresh.',
  'overview.metaRaw': 'run.meta, verbatim',
  'matrix.arrange': 'Column, bands and pins',
  'matrix.columnIs': 'Columns separate the arms by',
  'matrix.legendToggle': 'Legend',
  'matrix.repLabel': '{task} {condition} take {rep} {stage}',
  'matrix.noCondition': 'no arm',
  'matrix.hashMismatchChip': 'item differs',
  'matrix.hashUnknownChip': 'item unknown',
  'matrix.stuckChip': 'stuck {minutes} min',
  'matrix.incidental': '{count} more field(s) vary with the arms',
  'matrix.incidentalHint': 'These follow from the variables above — the credential variable a harness dictates, the digest of a provisioned home — so they are reported rather than offered as a column.',
  'matrix.emptyHint': 'No record survives the current pins. Clear them under «Column, bands and pins», or check the Design stage.',
  'cells.emptyHint': 'No record of this experiment is in that state right now.',
  'cells.emptyClear': 'Show every state',
  'drawer.attemptNo': 'attempt {attempt}',
  'drawer.probeOk': 'passed',
  'drawer.probeFailed': 'did not pass',
  'conditions.emptyHint': 'The bound repository declares no arm yet. Minting one is part of 新建实验 — go back to the list and press it.',
  'conditions.provisionCredential': 'credential: {credential}',
  'conditions.provisionHomeFold': 'Scoped home',
  'review.refusalLead': 'The readiness gate refused this run — nothing was created, and the sentence below is the only record of why.',
  'review.refusalRaw': 'The refusal, verbatim',
  'report.noBundleHint': 'A report is read from an exported bundle. Export this run and the four invariants, the paired deltas and the judge numbers appear here.',
  'report.whereFold': 'Where this came from',
  'report.finalizeRaw': 'Refusals and the walk log, verbatim',
  'report.unitHeldChip': 'still held',
  'report.refusedChip': 'refused',
  'judge.emptyHint': 'Records reach this queue once they are archived — run the experiment first, or finalize it.',
  'judge.pickHint': 'The queue is in the run\u2019s own seeded order; the numbers say nothing about which records share an arm.',
  'dur.s': '{s}s',
  'dur.ms': '{m}m {s}s',
  'dur.hm': '{h}h {m}m',
  'dur.dh': '{d}d {h}h',
  'agreement.high': 'high',
  'agreement.medium': 'moderate',
  'agreement.low': 'low',
  'agreement.none': 'not enough pairs to say',
  'judge.addJudge': 'Graders disagree often here — consider adding a judge before trusting these scores.',
  'judge.filterAll': 'All',
  'judge.filterUngraded': 'Not graded',
  'judge.filterGraded': 'Graded',
  'judge.queueRow': '{task} · take {rep}',
  'cells.col.state': 'Run state',
  'report.judgeSampleCount': '{criteria} criterion(s) with pairs · agreed {agreement}',

  // ── the four stages, their one action each, and the run-record
  //    vocabulary (ui-spec §五 v2, I5·T67) ─────────────────────────────────
  'page.design': 'Design',
  'page.runs': 'Run records',
  'page.compare': 'Results',
  'page.review': 'Human review',
  'cta.draft': 'Validate it',
  'cta.draftHint': 'A draft on disk. Validate it to find out whether it can be approved.',
  'cta.pending': 'Approve and start',
  'cta.pendingHint': 'Validate passed. Approving starts the run — the readiness gate is checked first.',
  'cta.running': 'See run records',
  'cta.runningHint': 'The cells are running. The run records show each one as it lands.',
  'cta.judging': 'Go to human review',
  'cta.judgingHint': 'Every cell has run. The final verdict is yours to record.',
  'cta.done': 'See results',
  'cta.doneHint': 'The report is out. The results page holds the comparison.',
  'cta.refused': 'Check again',
  'cta.refusedHint': 'The readiness gate refused this run. The reason is under Details below.',
  'cta.cancelled': 'See run records',
  'cta.cancelledHint': 'This run was cancelled. Whatever it recorded is still in the run records.',
  'cta.blocked': 'Validate reports {errors} error(s) — fix the plan first.',
  'cta.waiting': 'Starting…',
  'design.scale': 'Scale and variables',
  'design.groups': 'Comparison groups and readiness',
  'design.grid': 'Planned grid',
  'design.gridHint': 'Rows are items, columns are comparison groups — the same grid the run records fill in.',
  'design.advanced': 'Advanced settings',
  'design.advancedHint': 'Order, stages, per-cell budget, verdict sources, environment, and the author’s note.',
  'design.planned': '{reps} planned',
  'design.single': 'Only one comparison group — add another to have anything to compare.',
  'design.addGroup': 'Add a comparison group',
  'design.addGroupHint': 'Copy an existing group and change one field; the wizard writes both it and the plan.',
  'design.notes': 'Author’s note',
  'design.verdictSources': 'Verdict sources',
  'design.bind': 'Bind a dataset',
  'design.noRepo': 'This session has no dataset bound',
  'design.noRepoHint': 'An experiment is designed against a dataset — items, comparison groups and plans all live in one.',
  'design.bindTitle': 'Bind a dataset',
  'design.bindWhere': 'Binding is a person’s act and it is made in the datasets tab: open it and use its import action, which takes a directory or a repository and a commit, validates it, and binds it to this session.',
  'design.bindShape': 'What it takes: a git repository organized by the dataset protocol — a dataset.json naming its layers, items under items/, and the conditions/ and plans/ directories this tab writes into.',
  'ready.badge': 'Environment ready',
  'ready.recheck': 'Check again',
  'ready.pending': 'Not checked yet — readiness is probed when the run starts.',
  'ready.failedCount': '{count} of {total} comparison groups are not ready',
  'ready.rawFold': 'Readiness records, verbatim',
  'runs.filter.all': 'All',
  'runs.filter.active': 'Running',
  'runs.filter.done': 'Done',
  'runs.filter.failed': 'Failed',
  'runs.filter.blocked': 'Blocked',
  'runs.col.verdict': 'Verdict',
  'runs.filtered': '{matched} of {total}',
  'verdict.none': 'Not judged',
  'verdict.human': 'Final verdict',
  'verdict.llm': 'Judge draft',
  'verdict.script': 'Script',
  'verdict.hint': 'The most authoritative verdict layer this cell carries. The scores themselves are computed from the exported bundle, per criterion from the best layer that judged it — they are on the results page.',

  // ── the record detail, the validity hovers, the side-by-side
  //    bench and the four-step wizard (ui-spec §五 v2, I5·T67) ────────────
  'record.head': '{task} × {condition} · rep {rep}',
  'record.ok': 'Finished',
  'record.failed': 'Stopped',
  'record.scoreWhere': 'The scores are computed from the exported bundle — they are on the results page.',
  'record.scoreMixed': 'This record carries verdicts in several layers ({sources}). The report scores EACH criterion from the most authoritative layer that judged it, so this record\u2019s score comes from more than one — the results page names which, criterion by criterion.',
  'record.timeline': 'Stage timeline',
  'record.timelineNone': 'The ledger recorded no transition times for this attempt.',
  'record.params': 'Parameters',
  'record.attachments': 'Attachments',
  'record.attachmentsNone': 'This attempt recorded no artifacts.',
  'record.filePending': 'Preview and download need a host file service this tab does not have yet; the path is here so it can be opened from a terminal.',
  'record.param.task': 'Item',
  'record.param.condition': 'Comparison group',
  'record.param.rep': 'Rep',
  'record.param.attempt': 'Attempt',
  'record.param.material': 'Item material',
  'record.param.fingerprint': 'Environment fingerprint',
  'record.param.unit': 'Unit',
  'record.param.judge': 'Verdict source',
  'artifact.materialization': 'Item material',
  'artifact.archive': 'Archived workspace',
  'artifact.verdicts': 'Verdicts',
  'artifact.stage': 'Stage submission',
  'artifact.log': 'Run log',
  'artifact.other': '{kind}',
  'invariant.why.materialization': 'Why it matters: every group has to have been given the same item, byte for byte. If they were not, the run asked different questions, and a difference between the answers is not a result.',
  'invariant.why.fingerprint': 'Why it matters: the cells have to have run in the same class of environment. If they did not, the difference carries the machine as well as the subject.',
  'invariant.why.subject': 'Why it matters: the model each cell actually ran has to be the one it declared. If it is not, this comparison is between something other than what it says it is.',
  'invariant.why.procedure': 'Why it matters: the run has to record which orchestrator version and which plan produced it. Without that nobody can reproduce it or check it.',
  'report.chart': 'Efficiency at a glance',
  'report.chart.activeMs': 'Active time',
  'report.chart.outputTokens': 'Output tokens',
  'report.chart.cacheRead': 'Cache read',
  'report.chartNone': 'Nothing was measured for this one.',
  'judge.itemPick': 'Pick an item to grade',
  'judge.itemCount': '{task} · {count} answer(s)',
  'judge.column': 'Answer {no}',
  'judge.submitOne': 'Record {count} verdict(s) for answer {no}',
  'judge.sideBySide': 'The answers to one item, side by side and de-identified, in the run’s own seeded order. Each one is graded on its own — this is not a choice between them.',
  'new.step': 'Step {step} of 4',
  'new.step1': 'Dataset and items',
  'new.step2': 'Comparison groups',
  'new.step3': 'Judges, reps and budget',
  'new.step4': 'Environment and confirm',
  'new.back': 'Back',
  'new.next': 'Next',
  'new.stepBlocked': 'Fill this step in before going on.',

  // ── the walkthrough fixups (I5·T67 補, W4–W15) ─────────────────────────
  'runs.settled': 'This record is finished — nothing is elapsing here. How long it took is on its timeline.',
  'error.planUnreadable': 'The plan document is not there any more',
  'error.planUnreadable.fix': 'Its dataset working tree was probably deleted. Re-create the working tree, or read the run from its run records and results — a finished run keeps its own copy of what the plan said.',
  'why.endpoint': 'the endpoint is not resolved',
  'why.homeSha': 'the home digest was never written back',
  'why.lock': 'no lock beside the declaration',
  'why.file': 'the declaration file is not there',
  'why.other': 'validate refused it — the reason is under Details',
}

/** 中文词典。 */
export const zh: Record<EvalKey, string> = {
  // 错误态三段式（ui-spec §九）：一句人话 + 一句修法，异常原文与路径折在「详情」里。
  'error.notGitRepo': '绑定的题库路径不是 git 仓库',
  'error.notGitRepo.fix': '改绑到仓库根目录：/datasets bind <路径> --layers visible',
  'error.notDatasetRepo': '这个仓库里没有题集（缺 datasets/ 目录）',
  'error.notDatasetRepo.fix': '改绑到题库仓库的根目录，或先在仓库里建出 datasets/',
  'error.pathMissing': '绑定的题库路径在磁盘上找不到',
  'error.pathMissing.fix': '确认目录还在，再重新绑定：/datasets bind <路径> --layers visible',
  'error.unbound': '本会话还没绑定题库',
  'error.unbound.fix': '先绑定题库：/datasets bind <路径> --layers visible',
  'error.serviceMissing': '这台实例缺少本页要用的服务',
  'error.serviceMissing.fix': '预设里少装了成员；补齐后重开这个 tab',
  'error.cancelled': '这次请求被取消了',
  'error.cancelled.fix': '再试一次',
  'error.unknownFix': '再试一次；仍然不行就把「详情」里的原文发给维护者',
  'error.details': '详情',
  'error.detailsPath': '路径',
  'open': '实验室',
  'list.title': '实验',
  'list.new': '新建实验',
  'list.loading': '加载中…',
  'list.error': '实验列表加载失败',
  'list.empty': '还没有实验',
  'list.refresh': '刷新',
  'col.name': '名称',
  'col.snapshot': '题库版本',
  'col.conditions': '对比组数',
  'col.items': '题数',
  'col.reps': '次数',
  'col.factors': '对比变量',
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
  'factors.single': '单个对比组',
  'detail.back': '回到列表',
  'detail.error': '实验打开失败',
  'overview.snapshot': '题库版本',
  'overview.shape': '实验规模',
  'overview.shapeValue': '{items} 题 × {conditions} 组 × {reps} 次 = {cells} 条记录',
  'overview.factors': '对比变量',
  'overview.judge': '判官',
  'overview.judgeNone': '无——本轮不做 LLM 判官',
  'overview.judgeSamples': '{samples} 次采样',
  'overview.environment': '环境',
  'overview.environmentHost': '宿主路径（没有 unit 段）',
  'overview.readiness': '就绪检查',
  'overview.meta': 'run.meta',
  'overview.job': '后台作业',
  'overview.validation': '校验',
  'overview.validationOk': '通过',
  'overview.validationFailed': '{errors} 个错误，{warnings} 条警告',
  'judge.loading': '人工评估加载中…',
  'judge.error': '人工评估打不开',
  'judge.empty': '这次实验还没有可评的记录。',
  'judge.blindNotice': '盲评：本页刻意不出现 harness、模型与对比组。记录按这次实验自己的（种子）顺序编号，判官只显示判官 A / 判官 B。揭盲在结果对比页。',
  'judge.queue': '队列',
  'judge.graded': '已评（{count}）',
  'judge.materialNone': '这条记录没有归档被判阶段的文件——没有可读的东西，对着空白下判定是猜。',
  'judge.scrubbed': '替换掉 {count} 处指纹',
  'judge.criteria': '判据（kind: human）',
  'judge.criteriaNone': '没有要人答的判据：{reason}',
  'judge.negative': '负向',
  'judge.veto': '一票否决',
  'judge.weight': '权重 {weight}',
  'judge.criterionEvidence': '出题人给的取证口径：{evidence}',
  'judge.drafts': 'llm-draft',
  'judge.draftsNone': '这条判据没有 llm-draft 样本',
  'judge.selfJudged': '自评',
  'judge.pass': '成立',
  'judge.fail': '不成立',
  'judge.unanswered': '未答',
  'judge.evidence': '证据',
  'judge.evidencePlaceholder': '写可核对的事实，不写观感',
  'judge.humanFinal': '已有 human-final',
  'judge.humanFinalNone': '还没有记录',
  'judge.submitting': '记录中…',
  'judge.submitBlocked': '至少答一条判据并写上证据，才能记录。',
  'judge.bundleStale': '已导出的 bundle 写在这些终评之前，里面没有它们。重新导出一次就带上了——报告一起写，旧目录不动。',
  'judge.reexport': '重新导出',
  'judge.reexporting': '正在导出…',
  'judge.scoringMix': '你在这里打的分**只覆盖你答的那几条判据**。报告逐条判据取最权威的那一层，所以这 {count} 条你不答、判官答过的判据（{criteria}）仍按判官的计入得分。这条记录的得分来源随之变成「人 + 判官」的混合，报告页会在得分旁标出来。',
  'judge.regrade': '这条记录已经有人工终评了。再记一次是**追加**：报告读每条判据的最新值，早先那次留在账本里。',
  'judge.stats': '评分者一致性（实时，来自账本）',
  'judge.statsSame': '同一判官重复采样',
  'judge.statsCross': '不同判官之间',
  'judge.statsHuman': '判官初评与人工终评',
  'judge.statsSelf': '自评判据',
  'judge.panel': '判官面板 {count} 位',
  'notice.humanFinal': '第 {no} 条已记人工终评：{count} 条判定，by {by}',
  'notice.humanFinalDuplicate': '第 {no} 条已经带着完全相同的判定——账本只追加，重复即空操作，所以什么都没写。',
  'new.title': '新建实验',
  'new.description': '把 plans/<名称>.json（以及新建的对比组文件）写进绑定题库的工作树并校验。不 commit，也不启动——批准在下一页。',
  'new.name': '名称',
  'new.namePlaceholder': '即 plan 的文件名，如 i5-walk',
  'new.dataset': '题集',
  'new.datasetPick': '选一个题集…',
  'new.commit': '题库版本',
  'new.commitPlaceholder': '要钉的 commit；留空则由 run 启动时钉',
  'new.items': '题目',
  'new.itemsEmpty': '先选题集——它的题目会填进这里',
  'new.conditions': '对比组',
  'new.conditionsEmpty': '这个题集还没有对比组',
  'new.mintOpen': '新建对比组',
  'new.mintClose': '不新建对比组',
  'new.mintTitle': '新对比组一律是「复制」：选一个已有的，改一个字段。两个只差一个字段才是单变量配对——比较能回答问题靠的就是这个。',
  'new.mintId': '新对比组 id',
  'new.mintIdPlaceholder': 'conditions/<id>.json',
  'new.mintFrom': '复制自',
  'new.mintFromPick': '选要复制的对比组…',
  'new.mintUnchanged': '不改',
  'new.mintOneFactor': '只改了 {field} 一项，是单变量配对。',
  'new.mintFactors': '改了 {count} 项——比较就说不清是哪一项让结果变了。',
  'new.mint.harness': 'harness',
  'new.mint.model': '模型',
  'new.mint.scope': 'scope',
  'new.mint.preset': 'preset',
  'new.mint.permissions': '权限',
  'new.mint.reasoning': '推理强度',
  'new.judges': '判官',
  'new.judgeSamples': '每格采样数',
  'new.stages': '阶段',
  'new.stagesEmpty': '这个题集没有阶段 schema',
  'new.reps': '次数',
  'new.seed': '顺序 seed',
  'new.interleave': '交错（同一对比组的运行记录不连着排）',
  'new.budget': '预算',
  'new.activeMinutes': '每格活跃分钟',
  'new.turns': '每格轮数',
  'new.unit': '环境',
  'new.unitImage': '镜像（留空即宿主路径）',
  'new.unitNetwork': '网络（不声明就是默认桥接网，那是通外网的）',
  'new.egress': '出网自检 argv，空格分隔',
  'new.notes': '备注',
  'new.notesPlaceholder': '这次比较是为了回答什么，又答不了什么',
  'new.notStarting': '保存＝起草并校验。启动是实验设计页的「批准并启动」；在那之前还要人去登录各家、给对比组准备环境。',
  'new.save': '保存草稿并校验',
  'new.saving': '保存中…',
  'new.cancel': '取消',
  'new.error': '草稿没写成',
  'new.optionsError': '读不到这个题库里有什么',
  'notice.drafted': '已起草 {name}——validate 没有 error。批准并启动就在本页。',
  'notice.draftedWithErrors': '已起草 {name}——validate 报了 {errors} 条 error，所以它仍是草稿。下面的清单说了是哪些。',
  'matrix.loading': '排网格…',
  'matrix.error': '网格排布失败',
  'matrix.empty': '这次实验没有展开出运行记录',
  'matrix.column': '列',
  'matrix.group': '分组',
  'matrix.filter': '筛选',
  'matrix.filterAll': '全部',
  'matrix.noFactor': '各对比组逐字段相同，只有一列——没有可对比的变量。',
  'matrix.task': '题',
  'matrix.legend': '圆点：● 已判 ◐ 进行中 ○ 未开始 · 红边：这一行的题面不一致',
  'matrix.hashMismatch': '这一格的题面与同题其余格不同',
  'matrix.hashUnknown': '没有记录题面一致性的证据',
  'matrix.stuck': '这里已经 {minutes} 分钟没有动静了',
  'matrix.reps': '{count} 个 rep',
  'summary.title': '本次实验汇总',
  'summary.materialization': '题面一致',
  'summary.fingerprint': '环境一致',
  'summary.unreleased': '未释放单元',
  'summary.judge': '评分者一致性',
  'summary.judgePending': '待报告',
  'summary.stuck': '卡住的记录',
  'summary.cells': '显示的记录',
  'invariant.ok': '一致',
  'invariant.violated': '不一致',
  'invariant.unverifiable': '无法核验',
  'cells.loading': '读运行记录…',
  'cells.error': '运行记录没读出来',
  'cells.empty': '这个筛选下没有运行记录',
  'cells.col.cell': '题 × 对比组 × 次',
  'cells.col.attempt': '尝试次数',
  'cells.col.duration': '在态时长',
  'drawer.close': '关闭',
  'drawer.loading': '读这条记录…',
  'drawer.error': '这条记录没打开',
  'drawer.resourceNone': '没有单元（宿主路径）',
  'drawer.checkpoints': '检查点',
  'drawer.attempts': '尝试',
  'drawer.history': '状态迁移',
  'drawer.probes': 'verify 原样输出',
  'drawer.probesNone': '这一格没有记录探针运行',
  'drawer.openSession': '打开子会话',
  'drawer.noSession': '这次 attempt 没有记录子会话——没有可打开的',
  'drawer.releasable': '可释放——资源可以销毁',
  'drawer.notReleasable': '不可释放',
  'action.retry': '带原因重跑',
  'action.release': '释放检查',
  'action.export': '导出 bundle',
  'retry.reason': '重跑原因',
  'retry.category': '重跑类别',
  'notice.failed': '这次操作没做成',
  'notice.retried': '第 {id} 条已开新的一次尝试（第 {attempt} 次）',
  'notice.releasable': '{id}：可以释放',
  'notice.notReleasable': '{id}：还不能释放',
  'export.title': '导出 run bundle',
  'export.description': '自包含的 run bundle：模板、运行记录、注解、产物，以及你收录的题库层。guarded 层要逐项确认，落盘之前还会按一份新鲜的导出计划复核一次。',
  'export.outDir': '输出目录',
  'export.layers': '收录层（逗号分隔）',
  'export.snapshotDir': '题库版本目录',
  'export.snapshotRepo': '题库版本仓库',
  'export.snapshotCommit': '题库版本 commit',
  'export.snapshotDataset': '题库版本的题集 id',
  'export.plan': '检查',
  'export.planOk': '没有 guarded 层——{missions} 格、{attempts} 次 attempt，导出到 {dir}',
  'export.guardedTitle': 'guarded（modelFacing: false）层——逐项确认才会收录：',
  'export.confirmLayer': '收录 {layer}',
  'export.confirm': '导出',
  'export.cancel': '取消',
  'export.close': '关闭',
  'export.done': '已导出 {dir}（{count} 个文件）',
  'export.doneWithReport': '已导出 {dir}（{count} 个文件）——报告写在 {summary}（判定行 {rows}）',
  'export.doneNoReport': '已导出 {dir}（{count} 个文件）——报告没能一并写进去，请手动跑 `dsh-eval report {dir}`',
  'export.error': '导出失败',
  'report.loading': '正在读 bundle…',
  'report.error': '报告生成失败',
  'report.noBundle': '这个 run 还没有导出',
  'report.searched': '找过哪些目录、原话是什么',
  'report.exportNow': '导出 bundle',
  'report.lookInDir': '换一个导出目录找（run 是带 --out 跑的就填这里）',
  'report.lookInGo': '在这里找',
  'report.counts': '判定行 {rows} · 运行记录 {missions} · 尝试 {attempts} · 基础设施重试 {retries}',
  'report.cliHint': '用 CLI 落盘',
  'report.exportedAt': 'bundle 写于 {at}',
  'report.exportedAtUnknown': 'bundle 的写入时间不明（manifest.json 读不到）',
  'report.summaryIn': 'report/summary.md 已在 bundle 里',
  'report.summaryMissing': '这份 bundle 里没有 report/summary.md——它是在「导出即写报告」之前导的。重新导出一次就有了。',
  'report.staleAfterFinal': 'bundle 早于终评（最后一条终评在 {final}），上面的数字是没算终评算出来的。重新导出一次：新的 bundle 与报告进新目录，这一份不动。',
  'report.reexport': '重新导出',
  'report.reexporting': '正在导出…',
  'report.reexportNeedsDialog': '这个 run 没有可重复的导出记录，先用「导出」选一次层。',
  'report.toolOnlyNs': '红字警告：expectedNs 中的 `{ns}` 的判定全部由 `tool:` 写入——判定来源与该 ns 的契约作者不符，相关结论效力存疑。',
  'report.invariants': '实验有效性校验',
  'report.comparisonClosed': '实验有效性校验有 {count} 条没通过，这次实验的各条记录之间还不可比。下面是各组各自的表现。',
  'report.singleCondition': '当前为单对比组实验，无对比数据，下方是基线表现。',
  'report.noPairs': '没有任何一对对比组给出了可比的数据。',
  'report.pairTitle': '{a} 对 {b}',
  'report.pairNoTasks': '没有共同的题（两个对比组的题集不相交）。',
  'report.factorSingle': '差在「{factor}」：{detail}',
  'report.factorMulti': '差在多项：{fields}（{detail}）',
  'report.factorUnknown': '对比变量未知——{detail}',
  'report.ci': '平均 Δ = {mean}，95% 置信区间 [{lo}, {hi}]（bootstrap 重采样 rep × {samples}，seed {seed}）',
  'report.rank': '名次判定',
  'report.selfJudged': '自评',
  'report.col.task': '题',
  'report.col.delta': 'Δ 得分',
  'report.col.weightedDelta': 'Δ 加权',
  'report.col.deltas': '逐次 Δ',
  'report.col.n': 'n',
  'report.criteria': '判据 × 对比组（每条判据的得分与判官依据）',
  'report.criteriaHint': '格内是该判据在该组的结论：✓ / ✗ 成立与否（负向判据成立即缺陷），按比例给分的写比例，多次运行写成立次数。小字是这格**得分的来源**——逐判据取最权威的那一层（人 > 判官 > 脚本），所以同一格可以混合。点格子看证据原文与是谁写的。',
  'report.criteriaTotal': '本题总分',
  'report.criteriaUndeclared': '不在 rubric 权重表里——只有判定记录提到它，按未声明权重与极性处理。',
  'report.criteriaEvidence': '判官依据',
  'report.criteriaNoEvidence': '这条判定没写证据原文。',
  'report.criteriaExpand': '{condition} 上 {criterion} 的证据',
  'report.criteriaReps': '{count} 次',
  'report.criteriaWeighted': '加权 {value}',
  'report.criteriaNotJudged': '这个对比组没判这条',
  'report.humanOverride': '人已改判',
  'report.supersededBy': '已被改判——判官原判，保留',
  'report.sampleLine': '第 {rep} 次 · {source}',
  'report.holds': '成立',
  'report.holdsNot': '不成立',
  'report.polarityNegative': '负向',
  'report.polarityPositive': '正向',
  'report.col.criterion': '判据',
  'report.col.axis': '维度',
  'report.col.weight': '权重',
  'report.col.polarity': '极性',
  'source.human': '人',
  'source.llm': '判官',
  'source.script': '脚本',
  'report.col.judges': '判官',
  'report.col.condition': '对比组',
  'report.col.model': '模型',
  'report.col.activeMs': '活跃时长',
  'report.col.rounds': '委派轮次',
  'report.col.toolCalls': '工具调用',
  'report.col.outputTokens': '输出 token',
  'report.col.inputTokens': '输入 token',
  'report.col.cacheRead': 'cacheRead',
  'report.efficiency': '效率（并列，不合成）',
  'report.efficiencyScope': '只统计已完成的运行记录（已判 / 已归档 / 可释放 / 已释放）：未完成记录的耗时买到的工作量未知，混进来会让两列看着可比而其实不可比。',
  'report.efficiencyNone': '无 orchestrator 委派记录（durationMs / usage 缺失）——效率列全部留空。',
  'report.tokensCrossModel': 'token 跨模型不适用：上表按对比组如实记录，但只在同模型的对比组之间比较（冻结决策 10）。',
  'report.tokensSameModel': '各对比组同模型（{model}），token 列可比。',
  'report.excluded': '未计入上表的未完成记录（{total} 条）：{detail}——它们的委派时长如实存在于注解里，只是不进效率口径。',
  'report.excludedNone': '未计入上表的未完成记录：无——所有记录都已完成。',
  'report.judge': '评分者一致性',
  'report.judgeSame': '同一判官重复采样',
  'report.judgeSameValue': '{criteria} 条判据有 ≥2 个样本 · 一致 {agreement} · κ {kappa}',
  'report.judgeCross': '不同判官之间',
  'report.judgeCrossValue': '{criteria} 条判据由 ≥2 个判官判过 · 全体一致 {agreement} · κ {kappa}',
  'report.judgeHuman': '判官初评与人工终评',
  'report.judgeSelf': '自评判据数',
  'report.notes': '附注与保留条款',
  'report.finalize': '终评收口',
  'report.finalizeConfirm': '确认走闸',
  'report.finalizeConfirmAsk': 'finalize 会把这次实验每一条已归档的运行记录走一遍释放闸（已归档 → 可释放 → 已释放），过闸的销毁其容器。要继续吗？',
  'report.finalizeCancel': '取消',
  'report.finalizeResult': 'finalize 结果',
  'report.finalizeCounts': '{released} 已释放 · {refused} 被闸拒 · {skipped} 跳过（{skips}）',
  'report.finalizeUnits': '容器：{released} 已回收 · {held} 仍在',
  'report.finalizeUnitsUnknown': '容器：未知——这个实例没挂 lab，容器没被碰过',
  'report.unitsLoading': '单元…',
  'report.unitsError': '单元',
  'report.unitsUnknown': '单元：未知',
  'report.unitsNone': '单元：无占用',
  'report.unitsHeld': '未回收单元：{count}',
  'report.unitsTitle': '未回收单元',
  'report.unitsHint': '运行记录还停在「已归档」的单元，「回收」还能收；记录已经「已释放」的，任何闸都不会再放行，只剩 dsh-lab 自己去清。',
  'report.unitRunning': '运行中',
  'report.unitStopped': '已停',
  'report.reclaim': '回收',
  'report.reclaimConfirm': '确认回收',
  'report.reclaimConfirmAsk': '回收走的就是 finalize 那条释放闸：每条已归档的记录走 已归档 → 可释放 → 已释放，过闸的销毁其容器。要继续吗？',
  'notice.finalized': 'finalize：{released} 释放、{refused} 被闸拒、{skipped} 跳过；容器：{unitsReleased} 已回收、{unitsHeld} 仍在',
  'notice.reexported': '已重新导出到 {dir}（{count} 个文件）——报告一并写了，上一份 bundle 原样保留',
  'review.loading': '正在校验计划…',
  'review.error': '计划读取失败',
  'review.noPlan': '这个 run 没有记录计划文件，无从审阅——它的 run.meta 在概览页。',
  'review.planPath': '计划文件',
  'review.order': '顺序',
  'review.orderValue': 'seed {seed}',
  'review.orderInterleaved': '交错（同一对比组不连续排列）',
  'review.orderSequential': '不交错',
  'review.stages': '阶段',
  'review.budget': '每格预算',
  'review.budgetValue': '{minutes} 活跃分钟 · {turns} 轮',
  'review.retry': '每格基础设施重试',
  'review.retryDefault': '按缺省',
  'review.exports': 'bundle 导出目录',
  'review.exportsDefault': '<题库>/exports',
  'review.items': '题目',
  'review.checks': '校验',
  'review.checksNone': 'validate 什么都没报——计划文件读不出来',
  'severity.ok': '通过',
  'severity.warn': '警告',
  'severity.error': '错误',
  'review.keepUnits': '保留单元',
  'review.keepUnitsHint': '每条运行记录跑完停在「已归档」，容器留着给你打开。不 finalize 就不会释放，记录数超过 lab 的单元上限时这样跑不完。',
  'review.sendBack': '退回修改',
  'review.sentBack': '已退回修改。这只是本页上的一段备注：计划文件没有改动，实验按草稿显示，直到它重新通过 validate。',
  'review.started': '已启动',
  'review.startedValue': 'job {jobId} · run {runId}',
  'review.parentSession': '父会话',
  'review.refusal': '被拒',
  'review.approveError': '批准没发出去',
  'review.jobLog': '运行日志（原文）',
  'review.jobLogEmpty': '这个 run 还没有输出——刷新试试',
  'review.jobLogError': '运行日志读取失败',
  'conditions.loading': '读对比组…',
  'conditions.error': '对比组没读出来',
  'conditions.empty': '这个题库没有声明对比组',
  'conditions.repo': '题库',
  'conditions.col.id': '对比组',
  'conditions.col.harness': 'harness',
  'conditions.col.model': '模型',
  'conditions.col.scope': '作用域',
  'conditions.col.preset': '预设',
  'conditions.col.lock': '锁',
  'conditions.col.ready': '就绪',
  'conditions.col.endpoint': '端点',
  'conditions.col.action': '',
  'conditions.endpointUnset': '未填',
  'conditions.endpointEdit': '点一下填写声明的 endpoint',
  'conditions.endpointPlaceholder': 'default',
  'conditions.endpointSave': '保存',
  'conditions.endpointCancel': '取消',
  'conditions.endpointWritten': '{id} 的 endpoint 已改为 {value}。',
  'conditions.endpointUnchanged': '{id} 的 endpoint 本来就是 {value}，没有写入。',
  'conditions.endpointLockStale': '端点进对比组哈希，旁边那把锁因此过期了——再准备一次环境。',
  'conditions.endpointFailed': 'endpoint 写入失败',
  'conditions.provision': '准备环境',
  'conditions.provisioning': '准备中…',
  'conditions.provisionHint': '把这条声明落成真的作用域家目录：逐字段核对、把 home 哈希写回声明、写锁。一步走完——要么就绪，要么告诉你卡在哪。',
  'conditions.provisionResult': '准备环境 · {id}',
  'conditions.provisionWritten': '锁已写——这个对比组就绪了。',
  'conditions.provisionRefused': '没有写锁——这个对比组还不就绪。',
  'conditions.provisionWroteBack': 'home 哈希已写回声明并重算了对比组哈希，所以这一步不用做两遍。',
  'conditions.provisionHome': '作用域家目录 {dir} · 凭据 {credential}',
  'conditions.provisionFailed': '准备环境没能跑起来',
  'conditions.scopeDefault': '默认',
  'conditions.lockOk': '有效',
  'conditions.lockStale': '过期',
  'conditions.lockNone': '无',
  'conditions.homeUnhashed': 'home 未 provision',
  'conditions.ready': '就绪',
  'conditions.unready': '未就绪',
  'conditions.missing': '缺失',
  'conditions.pickHint': '选两个对比组看差异。',
  'conditions.pickOne': '已选一个——再选一个看差异。',
  'conditions.diff': '差异',
  'conditions.diffIdentical': '{a} 与 {b} 完全相同（备注不计，与哈希口径一致）',
  'conditions.diffNotesOnly': '只有备注不同——改注释不是新的对比变量',
  'conditions.diffCount': '{count} 个字段不同',
  'conditions.diffAbsent': '无此字段',
  'conditions.diffError': '两个对比组的差异没算出来',

  // ── 状态词表（ui-spec §九）──────────────────────────────────────────────
  // 这个 tab 上出现的每个内部标识都经下面四组之一落成一个词，同一件事在
  // 每一页的写法相同。
  'role.judge': '判官',
  'stage.pending': '待起',
  'stage.ws-ready': '工作区就绪',
  'stage.stage-1': '阶段一',
  'stage.stage-2': '阶段二',
  'stage.stage-3': '阶段三',
  'stage.stage-4': '阶段四',
  'stage.stage-5': '阶段五',
  'stage.stage-6': '阶段六',
  'stage.stageN': '阶段 {n}',
  'stage.judged': '已判',
  'stage.halted': '已停',
  'stage.archived': '已归档',
  'stage.releasable': '可释放',
  'stage.released': '已释放',
  'stage.unknown': '未知阶段（{token}）',
  'stage.mixed': '多态：{states}',
  'bucket.ready': '就绪',
  'bucket.scheduled': '排期',
  'bucket.blocked': '阻塞',
  'bucket.active': '进行中',
  'bucket.done': '完成',
  'bucket.other': '其它（{token}）',
  'retry.cat.infrastructure': '基础设施',
  'retry.cat.operator': '操作',
  'retry.cat.outcome': '结果',
  'retry.cat.other': '其它（{token}）',
  'factor.harness.name': 'harness',
  'factor.harness.version': '版本',
  'factor.harness.drive': '驱动方式',
  'factor.model.declared': '模型',
  'factor.model.endpoint': '服务端点',
  'factor.reasoning.effort': '推理强度',
  'factor.permissions': '权限',
  'factor.instructions': '系统指令',
  'factor.preset': '预设',
  'factor.skills.pack': '技能包',
  'factor.scope': '作用域',
  'factor.home.sha': '家目录指纹',
  'factor.env.keys': '环境变量名',
  'factor.unit.scopedHome.container': '单元内凭据目录',
  'factor.unit.scopedHome.var': '单元内凭据变量',
  'factor.other': '其它字段',
  'factors.plusIncidental': '另 {count} 项',
  'list.emptyAction': '新建第一个实验',
  'list.emptyHint': '在这里起一个草稿，或者在会话里让 agent 起——两条路都落在这张列表里，都是草稿；启动仍是实验设计页上的一次点击。',
  'draft.notStarted': '还没启动',
  'draft.notStartedHint': '人在实验设计页批准并启动之后，这一页才有内容——去「实验设计」。',
  'draft.starting': '正在启动',
  'draft.startingHint': 'run 已经建了，这一页稍后自己会拉到，不用点刷新。',
  'overview.metaRaw': 'run.meta 原文',
  'matrix.arrange': '换列 · 分组 · 筛选',
  'matrix.columnIs': '列按这个对比变量区分对比组：',
  'matrix.legendToggle': '图例',
  'matrix.repLabel': '{task} {condition} 第 {rep} 次 {stage}',
  'matrix.noCondition': '无对比组',
  'matrix.hashMismatchChip': '题面不一致',
  'matrix.hashUnknownChip': '题面未记录',
  'matrix.stuckChip': '卡住 {minutes} 分钟',
  'matrix.incidental': '另有 {count} 项字段随对比组而变',
  'matrix.incidentalHint': '它们是上面那些对比变量带出来的——harness 决定凭据变量名，家目录落地才有指纹——所以只报告，不做成列或筛选。',
  'matrix.emptyHint': '当前筛选下没有记录。到「换列 · 分组 · 筛选」里清掉筛选，或回实验设计页看这次实验展开了什么。',
  'cells.emptyHint': '这次实验现在没有记录落在这个状态里。',
  'cells.emptyClear': '看全部状态',
  'drawer.attemptNo': '第 {attempt} 次尝试',
  'drawer.probeOk': '通过',
  'drawer.probeFailed': '未通过',
  'conditions.emptyHint': '绑定的题库里还没有对比组。新建对比组在「新建实验」表单里——回到实验室列表点它。',
  'conditions.provisionCredential': '凭据：{credential}',
  'conditions.provisionHomeFold': '作用域家目录',
  'review.refusalLead': '就绪闸拒绝了这次启动——什么都没创建，下面这段是唯一记着原因的地方。',
  'review.refusalRaw': '拒绝原文',
  'report.noBundleHint': '报告是从导出的 bundle 读出来的。把这个 run 导出，四条不变量、配对差值与判官一致性就会出现在这里。',
  'report.whereFold': '这份报告的出处',
  'report.finalizeRaw': '拒绝原因与走查日志原文',
  'report.unitHeldChip': '仍持有',
  'report.refusedChip': '被拒',
  'judge.emptyHint': '记录归档之后才进这个队列——先把实验跑完，或者先做 finalize。',
  'judge.pickHint': '左边的队列按这次实验自己的种子顺序排；编号说明不了哪些记录同属一个对比组。',
  'dur.s': '{s} 秒',
  'dur.ms': '{m} 分 {s} 秒',
  'dur.hm': '{h} 小时 {m} 分',
  'dur.dh': '{d} 天 {h} 小时',
  'agreement.high': '高',
  'agreement.medium': '中',
  'agreement.low': '低',
  'agreement.none': '配对不足，说不了',
  'judge.addJudge': '这里的评分者分歧较多——在采信这些分数之前，建议增加判官。',
  'judge.filterAll': '全部',
  'judge.filterUngraded': '未评',
  'judge.filterGraded': '已评',
  'judge.queueRow': '{task} · 第 {rep} 次',
  'cells.col.state': '运行状态',
  'report.judgeSampleCount': '{criteria} 条判据有配对 · 一致 {agreement}',

  // ── the four stages, their one action each, and the run-record
  //    vocabulary (ui-spec §五 v2, I5·T67) ─────────────────────────────────
  'page.design': '实验设计',
  'page.runs': '运行记录',
  'page.compare': '结果对比',
  'page.review': '人工评估',
  'cta.draft': '去校验',
  'cta.draftHint': '这是一份落盘的草稿。先校验，才知道能不能批准。',
  'cta.pending': '批准并启动',
  'cta.pendingHint': '校验已通过。批准即启动，启动前先过就绪检查。',
  'cta.running': '看运行记录',
  'cta.runningHint': '格子正在跑，运行记录里逐格落地。',
  'cta.judging': '去人工评估',
  'cta.judgingHint': '格子都跑完了，终评是你的事。',
  'cta.done': '看结果',
  'cta.doneHint': '报告已出，对比在结果页。',
  'cta.refused': '重新检查',
  'cta.refusedHint': '就绪检查拒绝了这次启动，原因在下面的「详情」里。',
  'cta.cancelled': '看运行记录',
  'cta.cancelledHint': '这次运行已取消；已经记下的东西仍在运行记录里。',
  'cta.blocked': '校验有 {errors} 条错误，先改计划。',
  'cta.waiting': '正在启动…',
  'design.scale': '实验规模与对比变量',
  'design.groups': '对比组与就绪',
  'design.grid': '计划网格',
  'design.gridHint': '行是题、列是对比组——和运行记录里那张是同一个网格。',
  'design.advanced': '高级设置',
  'design.advancedHint': '顺序、阶段、每格预算、判定来源、环境，以及作者备注。',
  'design.planned': '计划 {reps} 次',
  'design.single': '只有一个对比组，添加对比组才能比较。',
  'design.addGroup': '添加对比组',
  'design.addGroupHint': '从一个已有对比组复制，改一个字段；向导会把它和计划一起写出来。',
  'design.notes': '作者备注',
  'design.verdictSources': '判定来源',
  'design.bind': '绑定题库',
  'design.noRepo': '本会话还没绑定题库',
  'design.noRepoHint': '实验是对着题库设计的——题目、对比组、计划都住在题库里。',
  'design.bindTitle': '绑定题库',
  'design.bindWhere': '绑定是人的动作，在题集 tab 里做：打开它，用导入题集指一个目录或一个仓库加 commit，校验通过即绑定到本会话。',
  'design.bindShape': '它要的东西：一个按题库协议组织的 git 仓库——dataset.json 声明层，题目在 items/ 下，还有本 tab 要写入的 conditions/ 与 plans/ 两个目录。',
  'ready.badge': '环境就绪',
  'ready.recheck': '重新检查',
  'ready.pending': '还没做就绪检查——启动时才探。',
  'ready.failedCount': '{total} 个对比组里有 {count} 个未就绪',
  'ready.rawFold': '就绪检查原文',
  'runs.filter.all': '全部',
  'runs.filter.active': '运行中',
  'runs.filter.done': '完成',
  'runs.filter.failed': '失败',
  'runs.filter.blocked': '阻塞',
  'runs.col.verdict': '判定',
  'runs.filtered': '{matched} / {total}',
  'verdict.none': '未判',
  'verdict.human': '终评',
  'verdict.llm': '判官初判',
  'verdict.script': '脚本判定',
  'verdict.hint': '这格带的判定里最权威的那一层。分数本身是从导出的 bundle 里算的，逐条判据取判过它的最权威那一层，在结果对比页。',

  // ── the record detail, the validity hovers, the side-by-side
  //    bench and the four-step wizard (ui-spec §五 v2, I5·T67) ────────────
  'record.head': '{task} × {condition} · 第 {rep} 次',
  'record.ok': '成功',
  'record.failed': '异常',
  'record.scoreWhere': '分数是从导出的 bundle 里算的，在结果对比页。',
  'record.scoreMixed': '这条记录在多个层上都有判定（{sources}）。报告**逐条判据**取判过它的最权威那一层，所以这条记录的得分来自不止一个来源——具体哪条判据取了哪一层，在结果对比页上逐条标着。',
  'record.timeline': '阶段时间轴',
  'record.timelineNone': '账本没记这次尝试的转移时间。',
  'record.params': '参数配置',
  'record.attachments': '附件',
  'record.attachmentsNone': '这次尝试没记下产物。',
  'record.filePending': '预览和下载要宿主的文件服务，这个 tab 还没有；路径放在这里，可以从终端打开。',
  'record.param.task': '题',
  'record.param.condition': '对比组',
  'record.param.rep': '次',
  'record.param.attempt': '尝试次数',
  'record.param.material': '题面物化',
  'record.param.fingerprint': '环境指纹',
  'record.param.unit': '单元',
  'record.param.judge': '判定来源',
  'artifact.materialization': '题面物化',
  'artifact.archive': '归档工作区',
  'artifact.verdicts': '判定记录',
  'artifact.stage': '阶段提交',
  'artifact.log': '评测日志',
  'artifact.other': '{kind}',
  'invariant.why.materialization': '为什么影响比较：各组拿到的题面必须逐字节相同。不同，这次 run 就是问了不同的问题，答案之间的差值不是结果。',
  'invariant.why.fingerprint': '为什么影响比较：各格必须跑在同一类环境里。不是，差值里混进来的就是机器，而不只是被试。',
  'invariant.why.subject': '为什么影响比较：每一格实际跑的模型必须就是它声明的那个。不是，这份对比比的就不是它说的那两个东西。',
  'invariant.why.procedure': '为什么影响比较：这次 run 得记下是哪版编排器、按哪份计划跑的。记不下，谁都复现不了，也核对不了。',
  'report.chart': '效率一眼看',
  'report.chart.activeMs': '活跃时长',
  'report.chart.outputTokens': '输出 token',
  'report.chart.cacheRead': 'cache read',
  'report.chartNone': '这一项没量到。',
  'judge.itemPick': '先选一道题',
  'judge.itemCount': '{task} · {count} 份作答',
  'judge.column': '第 {no} 份',
  'judge.submitOne': '记第 {no} 份的 {count} 条判定',
  'judge.sideBySide': '同一道题的各份作答并排在这里，已去指纹，按 run 自己的种子顺序编号。每一份各自打分——这不是二选一。',
  'new.step': '第 {step} 步 / 共 4 步',
  'new.step1': '题库与题目',
  'new.step2': '对比组',
  'new.step3': '判官、次数与预算',
  'new.step4': '环境与确认',
  'new.back': '上一步',
  'new.next': '下一步',
  'new.stepBlocked': '这一步填完才能往下走。',

  // ── the walkthrough fixups (I5·T67 補, W4–W15) ─────────────────────────
  'runs.settled': '这条记录已经结束了，没有在走的时长。它花了多久看时间轴。',
  'error.planUnreadable': '计划文件不在了',
  'error.planUnreadable.fix': '多半是它那个题库工作树被删了。重建工作树，或者直接从运行记录与结果对比读这次 run——跑完的 run 自己留了一份计划说了什么。',
  'why.endpoint': '端点未解析',
  'why.homeSha': '家目录指纹未写回',
  'why.lock': '声明旁边没有锁',
  'why.file': '声明文件不在',
  'why.other': '校验没过——原因在「详情」里',
}
