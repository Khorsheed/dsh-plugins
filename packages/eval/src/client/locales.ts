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
  | 'placeholder.plan'
  | 'placeholder.conditions'
  | 'placeholder.report'
  | 'placeholder.judging'
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
  'placeholder.plan': 'The plan review page (validate line by line, and the 批准并启动 button) belongs to T36.',
  'placeholder.conditions': 'The conditions page (the list and the two-condition diff) belongs to T36.',
  'placeholder.report': 'The report page belongs to T38.',
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
  'placeholder.plan': '计划审阅页（validate 逐条 + 「批准并启动」）归 T36。',
  'placeholder.conditions': '条件页（条件列表与两条件 diff）归 T36。',
  'placeholder.report': '报告页归 T38。',
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
}
