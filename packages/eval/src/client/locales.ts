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
  | 'placeholder.matrix'
  | 'placeholder.cells'
  | 'placeholder.report'
  | 'placeholder.judging'
  | 'placeholder.new'
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
  'placeholder.matrix': 'The matrix page belongs to T35b.',
  'placeholder.cells': 'The cells page and the cell drawer belong to T35b.',
  'placeholder.report': 'The report page belongs to T38.',
  'placeholder.judging': 'The judging desk belongs to T37.',
  'placeholder.new': 'The new-experiment form belongs to T34. Until then a plan is drafted as a file: <repo>/datasets/<set>/plans/<name>.json.',
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
  'placeholder.matrix': '矩阵页归 T35b。',
  'placeholder.cells': '格子页与格子详情抽屉归 T35b。',
  'placeholder.report': '报告页归 T38。',
  'placeholder.judging': '判官台归 T37。',
  'placeholder.new': '新建实验表单归 T34。在那之前，实验用文件起草：<题库>/datasets/<题集>/plans/<名称>.json。',
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
