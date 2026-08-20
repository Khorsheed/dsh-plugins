/** `mission` namespace dictionaries (the session tab copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'mission'

/** The missions tab dictionary key set (the source of truth for both locales). */
export type MissionKey =
  | 'open'
  | 'filter.all'
  | 'scope.session'
  | 'scope.all'
  | 'queue.loading'
  | 'queue.error'
  | 'queue.empty'
  | 'queue.missionCount'
  | 'table.title'
  | 'table.bucket'
  | 'table.state'
  | 'table.plan'
  | 'table.duration'
  | 'plan.waiting'
  | 'plan.after'
  | 'warning.unreleased'
  | 'detail.run'
  | 'detail.attempt'
  | 'detail.checkpoints'
  | 'detail.annotations'
  | 'detail.loading'
  | 'detail.error'
  | 'action.retry'
  | 'action.releasable'
  | 'action.export'
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
  | 'export.guardedTitle'
  | 'export.confirmLayer'
  | 'export.confirm'
  | 'export.cancel'
  | 'export.done'
  | 'export.error'
  | 'export.close'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The missions session-tab copy. */
    'mission': MissionKey
  }
}

/** English dictionary. */
export const en: Record<MissionKey, string> = {
  'open': 'Missions',
  'filter.all': 'All',
  'scope.session': 'This session',
  'scope.all': 'All runs',
  'queue.loading': 'Loading…',
  'queue.error': 'Failed to load the queue',
  'queue.empty': 'No missions in this scope — queue one with the mission_create tool',
  'queue.missionCount': '{count} mission(s)',
  'table.title': 'Title',
  'table.bucket': 'Bucket',
  'table.state': 'State',
  'table.plan': 'Plan / blocked',
  'table.duration': 'Duration',
  'plan.waiting': 'waiting: {ids}',
  'plan.after': 'after: {ids}',
  'warning.unreleased': '⚠ holding resource but not releasable: {ids}',
  'detail.run': 'run',
  'detail.attempt': 'attempt',
  'detail.checkpoints': 'checkpoints',
  'detail.annotations': 'annotations',
  'detail.loading': 'Loading detail…',
  'detail.error': 'Failed to load the mission',
  'action.retry': 'Retry',
  'action.releasable': 'Release check',
  'action.export': 'Export bundle',
  'notice.retried': 'attempt {attempt} opened',
  'notice.releasable': '{id}: releasable — resources may be destroyed',
  'notice.notReleasable': '{id}: NOT releasable',
  'export.title': 'Export run bundle',
  'export.description': 'A self-contained bundle of the run: template, missions, annotations, artifacts, and the included dataset layers.',
  'export.outDir': 'Output directory',
  'export.layers': 'Layers (comma-separated)',
  'export.snapshotDir': 'Snapshot directory',
  'export.snapshotRepo': 'Snapshot repo',
  'export.snapshotCommit': 'Snapshot commit',
  'export.snapshotDataset': 'Snapshot dataset id',
  'export.plan': 'Check',
  'export.guardedTitle': 'Guarded (modelFacing: false) layers — confirm each to include it:',
  'export.confirmLayer': 'include {layer}',
  'export.confirm': 'Export',
  'export.cancel': 'Cancel',
  'export.done': 'exported {dir} ({count} files)',
  'export.error': 'Export failed',
  'export.close': 'Close',
}

/** 中文词典。 */
export const zh: Record<MissionKey, string> = {
  'open': '任务',
  'filter.all': '全部',
  'scope.session': '本会话',
  'scope.all': '全部 run',
  'queue.loading': '加载中…',
  'queue.error': '队列加载失败',
  'queue.empty': '该范围没有任务——用 mission_create 工具排一个',
  'queue.missionCount': '{count} 个任务',
  'table.title': '标题',
  'table.bucket': '状态',
  'table.state': '模板状态',
  'table.plan': '计划/阻塞',
  'table.duration': '时长',
  'plan.waiting': '等待: {ids}',
  'plan.after': '前置: {ids}',
  'warning.unreleased': '⚠ 持有 resource 未 releasable: {ids}',
  'detail.run': 'run',
  'detail.attempt': 'attempt',
  'detail.checkpoints': '检查点',
  'detail.annotations': '注解',
  'detail.loading': '加载详情…',
  'detail.error': '任务加载失败',
  'action.retry': '重跑',
  'action.releasable': '释放检查',
  'action.export': '导出 bundle',
  'notice.retried': '已开 attempt {attempt}',
  'notice.releasable': '{id}：可释放——资源可以销毁',
  'notice.notReleasable': '{id}：不可释放',
  'export.title': '导出 run bundle',
  'export.description': '自包含的 run bundle：模板、mission、注解、产物，以及收录的数据集层。',
  'export.outDir': '输出目录',
  'export.layers': '收录层（逗号分隔）',
  'export.snapshotDir': '快照目录',
  'export.snapshotRepo': '快照仓库',
  'export.snapshotCommit': '快照 commit',
  'export.snapshotDataset': '快照数据集 id',
  'export.plan': '检查',
  'export.guardedTitle': 'guarded（modelFacing: false）层——逐项确认才会收录：',
  'export.confirmLayer': '收录 {layer}',
  'export.confirm': '导出',
  'export.cancel': '取消',
  'export.done': '已导出 {dir}（{count} 个文件）',
  'export.error': '导出失败',
  'export.close': '关闭',
}
