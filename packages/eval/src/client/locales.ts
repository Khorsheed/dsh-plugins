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
  | 'placeholder.matrix'
  | 'placeholder.cells'
  | 'placeholder.report'
  | 'placeholder.judging'
  | 'placeholder.new'

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
  'placeholder.matrix': 'The matrix page belongs to T35b.',
  'placeholder.cells': 'The cells page and the cell drawer belong to T35b.',
  'placeholder.report': 'The report page belongs to T38.',
  'placeholder.judging': 'The judging desk belongs to T37.',
  'placeholder.new': 'The new-experiment form belongs to T36. Until then a plan is drafted as a file: <repo>/datasets/<set>/plans/<name>.json.',
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
  'placeholder.matrix': '矩阵页归 T35b。',
  'placeholder.cells': '格子页与格子详情抽屉归 T35b。',
  'placeholder.report': '报告页归 T38。',
  'placeholder.judging': '判官台归 T37。',
  'placeholder.new': '新建实验表单归 T36。在那之前，实验用文件起草：<题库>/datasets/<题集>/plans/<名称>.json。',
}
