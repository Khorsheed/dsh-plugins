/** `datasets` namespace dictionaries (the 题集 tab copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'datasets'

/** The 题集 tab dictionary key set (the source of truth for both locales). */
export type DatasetsKey =
  | 'open'
  | 'panel'
  | 'registry.title'
  | 'registry.register'
  | 'registry.import'
  | 'registry.importing'
  | 'registry.edit'
  | 'registry.remove'
  | 'remove.titleDelete'
  | 'remove.titleUnregister'
  | 'remove.loading'
  | 'remove.planFailed'
  | 'remove.pathDelete'
  | 'remove.pathKeep'
  | 'remove.stateCount'
  | 'remove.choiceDelete'
  | 'remove.choiceUnregister'
  | 'remove.unregisterNote'
  | 'remove.keep.outside-home'
  | 'remove.keep.symlink'
  | 'remove.keep.not-repo-root'
  | 'remove.keep.other-checkouts'
  | 'remove.keep.missing'
  | 'remove.keep.registered'
  | 'remove.experiments'
  | 'remove.experimentsMore'
  | 'remove.experimentsNote'
  | 'remove.experimentsNone'
  | 'remove.irreversible'
  | 'remove.cancel'
  | 'remove.delete'
  | 'remove.unregisterOnly'
  | 'remove.unregister'
  | 'remove.working'
  | 'remove.close'
  | 'discard.action'
  | 'discard.actionTitle'
  | 'discard.title'
  | 'discard.planFailed'
  | 'discard.pathDelete'
  | 'discard.body'
  | 'discard.confirmDelete'
  | 'discard.confirm'
  | 'registry.tracking'
  | 'registry.authoring'
  | 'registry.noAuthoring'
  | 'registry.colSet'
  | 'registry.colLatest'
  | 'registry.colItems'
  /** T101 · the count's unit once the narrow fold drops the header: 「12 题」. */
  | 'registry.itemsUnit'
  | 'registry.colVisible'
  | 'registry.colUsed'
  | 'registry.colActions'
  | 'registry.more'
  | 'registry.usedCount'
  | 'registry.usedCountUnpinned'
  | 'registry.usedUnpinned'
  | 'layers.faceOnly'
  | 'layers.withAnswers'
  | 'layers.withAnswersPlus'
  | 'layers.raw'
  | 'layers.none'
  | 'layers.title'
  | 'layers.edit'
  | 'layers.editTitle'
  | 'layers.unknownTitle'
  | 'registry.problem'
  | 'registry.problemFix'
  | 'registry.noSets'
  | 'registry.empty'
  | 'registry.emptyHint'
  | 'registry.emptyAction'
  | 'import.done'
  | 'import.nothing'
  | 'import.created'
  | 'import.existing'
  | 'import.dangling'
  | 'import.why.missing'
  | 'import.why.notRepo'
  | 'import.why.other'
  | 'import.dismiss'
  | 'register.title'
  | 'register.titleEdit'
  | 'register.path'
  | 'register.browse'
  | 'register.id'
  | 'register.branch'
  | 'register.layers'
  | 'register.sensitive'
  | 'register.authoring'
  | 'register.preview.loading'
  | 'register.preview.ok'
  | 'register.preview.empty'
  | 'register.preview.noRef'
  | 'register.preview.failed'
  | 'register.keepOne'
  | 'register.submit'
  | 'register.save'
  | 'register.cancel'
  | 'error.alreadyRegistered'
  | 'error.alreadyRegistered.fix'
  | 'error.notRegistered'
  | 'error.notRegistered.fix'
  | 'error.refMissing'
  | 'error.refMissing.fix'
  | 'slot.prompt'
  | 'slot.standards'
  | 'slot.oracle'
  | 'slot.rubric'
  | 'slot.checks'
  | 'slot.other'
  | 'role.player'
  | 'role.judge'
  | 'role.probe'
  | 'role.withheld'
  | 'role.passthrough'
  | 'list.loading'
  | 'list.error'
  | 'notice.failed'
  | 'list.experimentsNone'
  | 'detail.back'
  | 'detail.filterAll'
  | 'detail.filterEmpty'
  | 'detail.itemsLabel'
  | 'detail.validate'
  | 'detail.validating'
  | 'detail.validateOk'
  | 'detail.validateFound'
  | 'detail.itemEmpty'
  | 'detail.player'
  | 'detail.playerHint'
  | 'detail.playerSummary'
  | 'detail.playerShared'
  | 'detail.playerEmpty'
  | 'detail.judge'
  | 'detail.judgeOnly'
  | 'detail.judgeOnlyHint'
  | 'detail.judgeOnlyEmpty'
  | 'detail.judgeRubric'
  | 'detail.judgeKind'
  | 'detail.judgeProbes'
  | 'detail.judgeShared'
  | 'detail.judgeSchemas'
  | 'detail.judgeLeaves'
  | 'detail.noProbes'
  | 'detail.probesNotWired'
  | 'detail.probesNotWiredHint'
  | 'judgeNote.no-rubric'
  | 'judgeNote.no-grading-layer'
  | 'judgeNote.rubric-invalid'
  | 'judgeNote.rubric-unreadable'
  | 'detail.readAt'
  | 'detail.readAtCommit'
  | 'detail.usedBy'
  | 'detail.usedByMore'
  | 'detail.runsOlder'
  | 'detail.runs'
  | 'detail.runsEmpty'
  | 'detail.itemEmptyHint'
  | 'detail.filterEmptyHint'
  | 'detail.runsEmptyHint'
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
  | 'bucket.ready'
  | 'bucket.scheduled'
  | 'bucket.blocked'
  | 'bucket.active'
  | 'bucket.done'
  | 'bucket.other'
  | 'detail.runsCell'
  | 'detail.briefLoading'
  | 'detail.briefError'
  | 'preview.empty'
  | 'preview.loading'
  | 'preview.error'
  | 'preview.copy'
  | 'preview.copied'
  | 'preview.footnotes'
  | 'preview.treeLabel'
  | 'tree.fileCount'
  | 'tree.shared'
  | 'tree.unprotected'
  | 'tree.agentReadable'
  | 'tree.passthrough'
  | 'tree.passthroughShort'
  | 'tree.sensitive'
  | 'tree.warnModelFacing'
  | 'tree.moreMeta'
  | 'json.copyValue'
  | 'json.copyJson'
  | 'json.copyPath'
  | 'json.copyPrettyJson'
  | 'json.copyCompactJson'
  | 'json.copied'
  | 'json.copyFailed'
  | 'json.collapseNode'
  | 'json.expandNode'
  | 'json.copyButtonTitle'
  | 'error.notGitRepo'
  | 'error.notGitRepo.fix'
  | 'error.notDatasetRepo'
  | 'error.notDatasetRepo.fix'
  | 'error.pathMissing'
  | 'error.pathMissing.fix'
  | 'error.noneRegistered'
  | 'error.noneRegistered.fix'
  | 'error.serviceMissing'
  | 'error.serviceMissing.fix'
  | 'error.cancelled'
  | 'error.cancelled.fix'
  | 'error.unknownFix'
  | 'error.details'
  | 'error.detailsPath'
  | 'add.title'
  | 'add.description'
  | 'add.source'
  | 'add.sourcePlaceholder'
  | 'add.sourceHelp'
  | 'add.name'
  | 'add.namePlaceholder'
  | 'add.nameHelp'
  | 'add.nameBad'
  | 'add.purpose'
  | 'add.purposePlaceholder'
  | 'add.required'
  | 'add.optional'
  | 'add.git'
  | 'add.gitNeeded'
  | 'add.repo'
  | 'add.repoHelp'
  | 'add.repoHelpPicked'
  | 'add.repoNameSlot'
  | 'add.repoChange'
  | 'add.repoReset'
  | 'add.browse'
  | 'add.organize'
  | 'add.cancel'
  | 'add.close'
  | 'add.advanced'
  | 'organize.sessionTitle'
  | 'organize.request'
  | 'organize.lineSource'
  | 'organize.lineName'
  | 'organize.linePurpose'
  | 'organize.lineRepo'
  | 'organize.updateRequest'
  | 'organize.lineCheckout'
  | 'organize.lineRef'
  | 'organize.lineWant'
  | 'organize.returnRequest'
  | 'organize.drafted'
  | 'organize.returned'
  | 'organize.copied'
  | 'organize.manual'
  | 'organize.failed'
  | 'organize.dismiss'
  | 'registry.add'
  | 'registry.askAgent'
  | 'registry.version'
  | 'registry.pending'
  | 'registry.advancedTitle'
  | 'banner.proposal'
  | 'banner.proposalUpdate'
  | 'banner.pending'
  | 'banner.review'
  | 'card.kindNew'
  | 'card.kindUpdate'
  | 'card.check'
  | 'card.checkOk'
  | 'card.checkProblems'
  | 'card.checkNote'
  | 'card.running'
  | 'card.failed'
  | 'card.unreadable'
  | 'card.filedNote'
  | 'card.handled'
  | 'card.handledNote'
  | 'card.warnings'
  | 'card.open'
  | 'card.view'
  | 'card.opened'
  | 'card.openedManual'
  | 'banner.reviewUpdate'
  | 'review.back'
  | 'review.titleNew'
  | 'review.titleUpdate'
  | 'review.loading'
  | 'review.error'
  | 'review.factSource'
  | 'review.factItems'
  | 'review.factValidate'
  | 'review.factVersion'
  | 'review.factName'
  | 'review.sourceKind.local'
  | 'review.sourceKind.public'
  | 'review.sourceKind.protocol'
  | 'review.validateOk'
  | 'review.validateWarn'
  | 'review.validateFail'
  | 'review.versionOne'
  | 'review.versionStep'
  | 'review.sets'
  | 'review.compareNew'
  | 'review.compareUpdate'
  | 'review.sum.split'
  | 'review.sum.copy'
  | 'review.sum.new'
  | 'review.sum.unused'
  | 'review.sum.added'
  | 'review.sum.modified'
  | 'review.sum.deleted'
  | 'review.sum.outside'
  | 'review.untouched'
  | 'review.sourceUnread'
  | 'review.sources'
  | 'review.outputs'
  | 'review.noSources'
  | 'review.disp.split'
  | 'review.disp.copy'
  | 'review.disp.unused'
  | 'review.originSplit'
  | 'review.originFrom'
  | 'review.originNew'
  | 'review.originUnexplained'
  | 'review.rowFiles'
  | 'review.rowRecords'
  | 'review.rowItems'
  | 'review.fieldTo'
  | 'review.fieldDropped'
  | 'review.unlayered'
  | 'review.unlayeredCount'
  | 'review.layerTag'
  | 'review.itemOne'
  | 'review.itemRandom'
  | 'review.fullList'
  | 'review.itemSource'
  | 'review.itemLine'
  | 'review.itemFiles'
  | 'review.itemNoSource'
  | 'review.itemPick'
  | 'review.close'
  | 'review.listTruncated'
  | 'review.layersTitle'
  | 'review.layerVisible'
  | 'review.layerHidden'
  | 'review.layerSuggest'
  | 'review.layerNow'
  | 'review.keepOne'
  | 'review.nameHelp'
  | 'review.notes'
  | 'review.problems'
  | 'review.warnings'
  | 'review.changes'
  | 'review.change.A'
  | 'review.change.M'
  | 'review.change.D'
  | 'review.changeVisible'
  | 'review.changeHidden'
  | 'review.deletions'
  | 'review.advanced'
  | 'review.advRepo'
  | 'review.advRef'
  | 'review.advCheckout'
  | 'review.advCommit'
  | 'review.advNone'
  | 'review.return'
  | 'review.returnNote'
  | 'review.returnSend'
  | 'review.returnNoSession'
  | 'review.confirm'
  | 'review.confirmUpdate'
  | 'review.confirming'
  | 'review.done'
  | 'review.cancel'
  | 'review.heldTitle'
  | 'review.heldBody'
  | 'review.finding.COMMIT_NOT_TIP.gone'
  | 'review.finding.COMMIT_NOT_TIP.moved'
  | 'review.finding.UNCOMMITTED'
  | 'review.finding.NO_SETS'
  | 'review.finding.HISTORY_REWRITTEN'
  | 'review.finding.OUTPUT_UNCOVERED'
  | 'review.finding.OUTPUT_MISSING'
  | 'review.finding.OUTPUT_COUNT'
  | 'review.finding.UNLAYERED_VISIBLE'
  | 'review.finding.SOURCE_UNREAD'
  | 'review.finding.DISPOSITION_INCOMPLETE.empty'
  | 'review.finding.DISPOSITION_INCOMPLETE.noReason'
  | 'review.finding.DISPOSITION_INCOMPLETE.noTarget'
  | 'review.finding.DISPOSITION_INCOMPLETE.field'
  | 'review.finding.SOURCE_MISSING'
  | 'review.finding.SOURCE_COUNT'
  | 'review.finding.FIELD_UNACCOUNTED'
  | 'review.finding.SOURCE_UNLISTED'
  | 'review.finding.SAMPLE_MISSING'
  | 'review.finding.LAYER_UNKNOWN'
  | 'review.finding.VALIDATE_FAILED'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The 题集 session-tab copy. */
    'datasets': DatasetsKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<DatasetsKey, string> = {
  // 错误态三段式（ui-spec §九）：一句人话 + 一句修法，异常原文与路径折在「详情」里。
  'error.notGitRepo': '这个路径不是 git 仓库',
  'error.notGitRepo.fix': '选仓库里的任一目录（或它的 .git）再登记',
  'error.notDatasetRepo': '这个仓库里没有题集（缺 datasets/ 目录）',
  'error.notDatasetRepo.fix': '换题库仓库的路径登记，或先在仓库里建出 datasets/',
  'error.pathMissing': '这个路径在磁盘上找不到',
  'error.pathMissing.fix': '确认目录还在，或换一个路径',
  'error.noneRegistered': '这个部署还没有登记任何题库',
  'error.noneRegistered.fix': '先在题集页点「登记仓库」登记题库',
  'error.serviceMissing': '这台实例缺少本页要用的服务',
  'error.serviceMissing.fix': '预设里少装了成员；补齐后重开这个 tab',
  'error.cancelled': '这次请求被取消了',
  'error.cancelled.fix': '再试一次',
  'error.unknownFix': '再试一次；仍然不行就把「详情」里的原文发给维护者',
  'error.details': '详情',
  'error.detailsPath': '路径',
  'open': '题集',
  'panel': '题集',
  'slot.prompt': '题干',
  'slot.standards': '验收标准',
  'slot.oracle': '参考答案',
  'slot.rubric': '评估标准',
  'slot.checks': '检查脚本',
  'slot.other': '其他文件',
  'role.player': '选手看得到',
  'role.judge': '只有判官',
  'role.probe': '只有探针',
  'role.withheld': '不发给选手',
  'role.passthrough': '所有人可读',
  'list.loading': '加载中…',
  'list.error': '题集列表加载失败',
  'notice.failed': '这次操作没做成',
  'list.experimentsNone': '尚未用于任何实验',
  'detail.back': '← 题集列表',
  'detail.filterAll': '全部',
  'detail.filterEmpty': '这个筛选下没有文件',
  'detail.itemsLabel': '题目',
  'detail.validate': '校验',
  'detail.validating': '校验中…',
  'detail.validateOk': '校验通过（{warnings} 个提示）',
  'detail.validateFound': '校验：{errors} 个错误 · {warnings} 个提示',
  'detail.itemEmpty': '在左侧选一道题，看选手和判官各看得到什么',
  'detail.player': '选手将看到',
  'detail.playerHint': '这道题在单元里的样子：可见层文件 + 题集级题干。其他槽位的字节不会进选手的运行记录。',
  'detail.playerSummary': '{count} 个文件 · {bytes} 字节',
  'detail.playerShared': '题集级',
  'detail.playerEmpty': '这道题没有任何可见层文件——选手会拿到一个空工作区',
  'detail.judge': '可判性',
  'detail.judgeOnly': '只有判官和探针看得到',
  'detail.judgeOnlyHint': '不进选手单元的层：判分标准、探针与参考答案。',
  'detail.judgeOnlyEmpty': '这道题没有只给判官的文件',
  'detail.judgeRubric': '评估标准 {leaves} 条',
  'detail.judgeKind': '{kind} {count}',
  'detail.judgeProbes': '探针 {count} 个',
  'detail.judgeShared': '题集级探针 {count} 个',
  'detail.judgeSchemas': '阶段 schema {count} 个',
  'detail.judgeLeaves': '{leaves} 条判据',
  'detail.noProbes': '没有检查脚本',
  'detail.probesNotWired': '有检查材料，但没接成可执行的探针：跑实验时不会自动判分',
  'detail.probesNotWiredHint': '探针是 verify 层 probes/ 下的 .mjs 或 .sh，实验在单元里执行它来判分。上面列出的检查材料（例如 test.py）只是原料，要接成探针才会自动判分；在那之前只能靠评估标准交给判官或人工。',
  'judgeNote.no-rubric': '这道题的 {layer} 层里没有评估标准（rubric），LLM 判官和人工评审都无从打分',
  'judgeNote.no-grading-layer': '这个题集没有声明 {layer} 层，判分约定（协议 §6.8）对它不适用',
  'judgeNote.rubric-invalid': '评估标准没通过检查：{detail}',
  'judgeNote.rubric-unreadable': '读不到评估标准 {path}：{detail}',
  'detail.readAt': '看的是 {ref} @ {commit}',
  'detail.readAtCommit': '看的是 @ {commit}',
  'detail.usedBy': '用过这道题的实验：{names}',
  'detail.usedByMore': '等 {count} 个',
  'detail.runsOlder': '更早的作答记录 · {count}',
  'detail.runs': '作答记录',
  'detail.runsEmpty': '这道题还没有在任何实验里作答过',
  'detail.runsCell': '{condition} · 第 {rep} 次',
  'detail.briefLoading': '读取题面与可判性…',
  'detail.briefError': '这道题的题面与可判性没读出来',
  'preview.empty': '在左侧选择一个文件查看内容',
  'preview.loading': '加载中…',
  'preview.error': '这个文件没读出来',
  'preview.copy': '复制',
  'preview.copied': '已复制',
  'preview.footnotes': '脚注',
  'preview.treeLabel': 'JSON 结构树',
  'tree.fileCount': '{count} 个文件',
  'tree.shared': '题集级共享',
  'tree.unprotected': '不受白名单保护',
  'tree.agentReadable': 'agent 可读',
  'tree.passthrough': '其他文件 · {count} 个 · 所有人可读',
  'tree.passthroughShort': '其他文件',
  'tree.sensitive': '敏感',
  'tree.warnModelFacing': '层 {layer} 未显式声明 modelFacing，按默认 true 处理；混合敏感度题集建议逐层表态',
  'tree.moreMeta': '+{count}',
  'json.copyValue': '复制值',
  'json.copyJson': '复制 JSON',
  'json.copyPath': '复制属性路径',
  'json.copyPrettyJson': '复制格式化 JSON',
  'json.copyCompactJson': '复制紧凑 JSON',
  'json.copied': '已复制',
  'json.copyFailed': '复制失败',
  'json.collapseNode': '折叠 JSON 节点',
  'json.expandNode': '展开 JSON 节点',
  'json.copyButtonTitle': '{action}；右键查看更多复制选项',

  'detail.itemEmptyHint': '右边并排两栏：「选手将看到」的每个文件与字节数（防泄题自查），和「只有判官和探针看得到」的文件与这道题能不能判。',
  'detail.filterEmptyHint': '这个题集在这些槽位下没有文件。点上面的「全部」看整棵树。',
  'detail.runsEmptyHint': '实验跑过这道题之后，每条运行记录会按对比组与次数列在这里。',
  // ── 状态词表（ui-spec §九）：与实验室 tab 同一张表 ──────────────────────
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
  'bucket.ready': '就绪',
  'bucket.scheduled': '排期',
  'bucket.blocked': '阻塞',
  'bucket.active': '进行中',
  'bucket.done': '完成',
  'bucket.other': '其它（{token}）',
  'registry.title': '已登记 {count} 个题库仓库',
  'registry.register': '登记仓库',
  'registry.import': '导入以前在会话里绑定的题库',
  'registry.importing': '正在导入…',
  'registry.edit': '编辑登记',
  'registry.remove': '删除',
  'remove.titleDelete': '删除「{id}」',
  'remove.titleUnregister': '移除「{id}」的登记',
  'remove.loading': '正在检查这个仓库…',
  'remove.planFailed': '读不出这个仓库的情况（{message}）。仍可以只移除登记，文件留在原处。',
  'remove.pathDelete': '将从磁盘删除这个目录',
  'remove.pathKeep': '仓库位置',
  'remove.stateCount': '本插件为它生成的 {count} 份只读副本也一并清理',
  'remove.choiceDelete': '：撤掉登记，并把上面这个目录从磁盘删除。',
  'remove.choiceUnregister': '：题集从列表里消失，文件留在原处，以后可以重新登记。',
  'remove.unregisterNote': '移除登记后，题集从列表里消失，以后可以重新登记。',
  'remove.keep.outside-home': '文件留在原处：这个仓库不在题集目录下，不是在这里建的，只移除登记。',
  'remove.keep.symlink': '文件留在原处：这条路径经过符号链接，为安全起见不删除，只移除登记。',
  'remove.keep.not-repo-root': '文件留在原处：这个目录和登记的仓库根目录对不上，不删除，只移除登记。',
  'remove.keep.other-checkouts': '文件留在原处：这个仓库在别处还有 {count} 个工作副本，删了会让它们失效，只移除登记。',
  'remove.keep.missing': '仓库目录已经不在磁盘上了，只需移除登记。',
  'remove.keep.registered': '文件留在原处：这个仓库已经登记过，放弃只删掉这份待登记记录。',
  'remove.experiments': '有 {count} 个实验用过它：',
  'remove.experimentsMore': '还有 {count} 个',
  'remove.experimentsNote': '这些实验的历史记录会保留，但删除后它们不能再运行。',
  'remove.experimentsNone': '没有实验用过它。',
  'remove.irreversible': '删除后无法撤销。',
  'remove.cancel': '取消',
  'remove.delete': '删除题集和文件',
  'remove.unregisterOnly': '只移除登记，文件保留',
  'remove.unregister': '移除登记',
  'remove.working': '正在处理…',
  'remove.close': '关闭',
  'discard.action': '放弃',
  'discard.actionTitle': '不要这份整理结果：删掉待登记记录和整理出的仓库',
  'discard.title': '放弃「{name}」的整理结果',
  'discard.planFailed': '读不出这份整理结果的情况（{message}）。仍可以放弃，只删掉待登记记录。',
  'discard.pathDelete': '将从磁盘删除整理出的仓库',
  'discard.body': '待登记记录会删掉，这条横幅不再出现。整理会话保留，可以回去接着聊。',
  'discard.confirmDelete': '放弃并删除仓库',
  'discard.confirm': '放弃',
  'registry.tracking': '跟踪 {ref}',
  'registry.authoring': '有写入检出',
  'registry.noAuthoring': '只读登记（没有写入检出）',
  'registry.colSet': '仓库 · 题集',
  'registry.colLatest': '最新版本',
  'registry.colItems': '题数',
  'registry.itemsUnit': '题',
  'registry.colVisible': 'agent 可见',
  'registry.colUsed': '用在哪些实验',
  'registry.colActions': '操作',
  'registry.more': '{id} 的更多操作',
  'registry.usedCount': '{count} 个实验 · 分布在 {versions} 个版本',
  'registry.usedCountUnpinned': '{count} 个实验',
  'registry.usedUnpinned': '未钉版本',
  'layers.faceOnly': '只看题面',
  'layers.withAnswers': '含答案',
  'layers.withAnswersPlus': '含答案 · {layers}',
  'layers.raw': '{layers}',
  'layers.none': '一层都看不到',
  'layers.title': 'agent 能读的层：{layers}',
  'layers.edit': '改',
  'layers.editTitle': '在登记表单里改 {set} 的 agent 可见层',
  'layers.unknownTitle': '{layers} 不在词表里，原样显示；这里不推断它是否含答案',
  'registry.problem': '这条登记现在读不出来',
  'registry.problemFix': '在「操作」的 ⋯ 里点「编辑登记」换一个存在的跟踪分支，或删除这条登记',
  'registry.noSets': '{ref} 上没有题集（datasets/ 为空）',
  'registry.empty': '还没有题集',
  'registry.emptyHint': '本地数据、下载好的文件或公开数据集，都从这里交给 Agent 整理；整理好由你确认登记，实验室和 agent 就能直接用。',
  'registry.emptyAction': '添加题集',
  'import.done': '旧绑定处理完：新登记 {created} 个仓库，并入已有登记 {merged} 个',
  'import.nothing': '没有找到旧绑定',
  'import.created': '{id}：合并了 {sessions} 个会话的绑定（{paths} 个路径），新登记',
  'import.existing': '{id}：已登记过，{sessions} 个会话的绑定并入这一条',
  'import.dangling': '{name} · {sessions} 个会话 · 已跳过：{why}',
  'import.why.missing': '路径已不存在',
  'import.why.notRepo': '不是 git 仓库',
  'import.why.other': '没法自动登记，请手动登记',
  'import.dismiss': '收起',
  'register.title': '登记题库仓库',
  'register.titleEdit': '编辑登记：{id}',
  'register.path': '仓库路径（任一检出、worktree 或 .git 目录）',
  'register.browse': '浏览…',
  'register.id': '登记名（agent 用「登记名/题集」引用）',
  'register.branch': '跟踪分支（「最新」= 这个分支的末端提交）',
  'register.layers': '每个题集 agent 可见的层',
  'register.sensitive': '敏感',
  'register.authoring': '新建题集、题目写进这个检出',
  'register.preview.loading': '检查仓库…',
  'register.preview.ok': '{count} 个题集 · {ref}@{short} · {date}',
  'register.preview.empty': 'git 仓库有效，但 {ref} 上没有题集',
  'register.preview.noRef': '这个仓库没有分支 {ref}：换一个跟踪分支；还没有提交的仓库，用「让 Agent 整理」',
  'register.preview.failed': '这个路径没法登记',
  'register.keepOne': '每个题集至少保留一层',
  'register.submit': '登记',
  'register.save': '保存',
  'register.cancel': '取消',
  'error.alreadyRegistered': '这个仓库已经登记过',
  'error.alreadyRegistered.fix': '在列表里点那条登记的「编辑登记」，不用再登记一次',
  'error.notRegistered': '这个题库不在本部署的登记表里',
  'error.notRegistered.fix': '先在题集页点「登记仓库」登记它',
  'error.refMissing': '登记跟踪的分支不存在',
  'error.refMissing.fix': '点「编辑登记」换一个存在的分支',
  'add.title': '添加题集',
  'add.description': '告诉 Agent 数据在哪，它会新开一个评测模式的会话，把数据整理成题集；整理好后回到这里，由你核对并确认登记。',
  'add.source': '数据在哪',
  'add.sourcePlaceholder': '本地目录、下载好的文件，或公开数据集的名字 / 链接',
  'add.sourceHelp': '原始数据只读，Agent 不会改动它。',
  'add.name': '题集名称',
  'add.namePlaceholder': '例如 gsm8k',
  'add.nameHelp': '登记名，agent 用它引用题集：字母、数字和 . _ -',
  'add.nameBad': '只能用字母、数字和 . _ -，且以字母或数字开头',
  'add.purpose': '想拿它测什么',
  'add.purposePlaceholder': '例如：比较两个模型的数学推理',
  'add.required': '必填',
  'add.optional': '可选',
  'add.git': '题集用 git 保存：每个版本都留着，实验总能在它用过的版本上原样重跑。你不需要会 git。',
  'add.gitNeeded': '机器上没有 git 时，Agent 会先征得你同意再安装。',
  'add.repo': '新仓库位置',
  'add.repoHelp': 'Agent 在这里新建题集仓库，默认放在题集目录下。',
  'add.repoHelpPicked': '放在你选的目录下。',
  'add.repoNameSlot': '<题集名称>',
  'add.repoChange': '更改…',
  'add.repoReset': '恢复默认',
  'add.browse': '选择目录…',
  'add.organize': '让 Agent 整理',
  'add.cancel': '取消',
  'add.close': '关闭',
  'add.advanced': '高级：已经是题库仓库？直接登记',
  'organize.sessionTitle': '题集整理 · {name}',
  'organize.request': '请用 dataset-authoring 技能把这份数据整理成题集，整理好后提交登记提案，我在「题集」页核对并确认登记。',
  'organize.lineSource': '数据在哪：{value}',
  'organize.lineName': '题集名称：{value}',
  'organize.linePurpose': '想拿它测什么：{value}',
  'organize.lineRepo': '新仓库放在：{value}',
  'organize.updateRequest': '请用 dataset-authoring 技能修改已登记的题集「{name}」，改完提交，再提一次登记提案。',
  'organize.lineCheckout': '仓库检出：{value}',
  'organize.lineRef': '跟踪分支：{value}',
  'organize.lineWant': '要改的是：',
  'organize.returnRequest': '我把登记提案「{name}」退回了，请按下面的意见修改，提交后再提一次：',
  'organize.drafted': '已新开整理题集的会话，请求写进了对话框，看一眼再发送。',
  'organize.returned': '已回到整理会话，意见写进了对话框，看一眼再发送。',
  'organize.copied': '没能写进对话框，请求已复制到剪贴板，粘贴进会话再发送。',
  'organize.manual': '没能写进对话框，也没能复制。把下面这段粘贴进会话：',
  'organize.failed': '没能新开整理会话',
  'organize.dismiss': '收起',
  'registry.add': '添加题集',
  'registry.askAgent': '交给 Agent 修改',
  'registry.version': '版本 {number} · {date}',
  'registry.pending': '新版本待确认',
  'registry.advancedTitle': '仓库 {path}\n跟踪分支 {ref}\n写入检出 {checkout}',
  'banner.proposal': 'Agent 整理好了「{name}」，等你确认登记',
  'banner.proposalUpdate': 'Agent 改好了「{name}」，等你确认新版本',
  'banner.pending': '「{name}」有新版本，改到了选手能看到的内容，等你确认',
  'banner.review': '核对并登记',
  'card.kindNew': '登记申请',
  'card.kindUpdate': '更新申请',
  'card.check': '登记自查',
  'card.checkOk': '自查通过',
  'card.checkProblems': '{count} 个问题',
  'card.checkNote': '只是自查，没有提交申请。',
  'card.running': '正在提交登记申请…',
  'card.failed': '这次提交没有成功，Agent 会说明原因。',
  'card.unreadable': '读不出这次调用的结果。',
  'card.filedNote': '等你核对：对照原目录看拆分结果，选好哪些层给选手看，再确认登记。',
  'card.handled': '已处理',
  'card.handledNote': '这份申请已经登记、退回或被更新的申请替代。',
  'card.warnings': '申请有 {count} 条提醒。',
  'card.open': '核对并登记',
  'card.view': '查看评审',
  'card.opened': '已在左侧「题集」打开评审',
  'card.openedManual': '评审已备好，打开本会话的「题集」页签即可',
  'banner.reviewUpdate': '核对新版本',
  'review.back': '返回题集列表',
  'review.titleNew': '核对并登记「{name}」',
  'review.titleUpdate': '核对「{name}」的新版本',
  'review.loading': '正在核对…',
  'review.error': '提案读不出来',
  'review.factSource': '来源',
  'review.factItems': '题数',
  'review.factValidate': '校验',
  'review.factVersion': '版本',
  'review.factName': '登记名',
  'review.sourceKind.local': '本地目录',
  'review.sourceKind.public': '公开数据集',
  'review.sourceKind.protocol': '已是题集格式',
  'review.validateOk': '通过',
  'review.validateWarn': '通过 · {count} 条提醒',
  'review.validateFail': '{count} 处错误',
  'review.versionOne': '版本 {number} · {date}',
  'review.versionStep': '版本 {from} → 版本 {to} · {date}',
  'review.sets': '{count} 个题集：{names}',
  'review.compareNew': '原目录 → 题集',
  'review.compareUpdate': '已登记版本 → 新版本',
  'review.sum.split': '拆分 {count}',
  'review.sum.copy': '原样复制 {count}',
  'review.sum.new': '新写 {count}',
  'review.sum.unused': '未使用 {count}',
  'review.sum.added': '新增 {count}',
  'review.sum.modified': '修改 {count}',
  'review.sum.deleted': '删除 {count}',
  'review.sum.outside': '题集外 {count}',
  'review.untouched': '原目录 {files} 个文件，一个没改；题集共 {outputs} 个文件',
  'review.sourceUnread': '原目录在这台机器上读不到，左栏是 Agent 的说明，没法逐个核对。',
  'review.sources': '原目录',
  'review.outputs': '题集',
  'review.noSources': '这份提案没有原目录（仓库本身就是来源）。',
  'review.disp.split': '拆分',
  'review.disp.copy': '原样复制',
  'review.disp.unused': '未使用',
  'review.originSplit': '← {from} · {field}',
  'review.originFrom': '← {from}',
  'review.originNew': '新写',
  'review.originUnexplained': '没有说明',
  'review.rowFiles': '{count} 个文件',
  'review.rowRecords': '{count} 条记录',
  'review.rowItems': '{count} 题',
  'review.fieldTo': '{name} → {to}',
  'review.fieldDropped': '{name}：没用（{reason}）',
  'review.unlayered': '不分层 · 选手可见',
  'review.unlayeredCount': '{count} 个文件不在任何层里，选手能看到',
  'review.layerTag': '{layer} 层',
  'review.itemOne': '逐条对照一题',
  'review.itemRandom': '随机抽看 3 题',
  'review.fullList': '完整清单',
  'review.itemSource': '原始记录 · {file}',
  'review.itemLine': '第 {line} 行',
  'review.itemFiles': '拆出来的 {count} 个文件',
  'review.itemNoSource': '这题没有可对照的原始记录',
  'review.itemPick': '换一题',
  'review.close': '收起',
  'review.listTruncated': '清单太长，只列出前面一部分',
  'review.layersTitle': '各层谁能看',
  'review.layerVisible': '选手可见',
  'review.layerHidden': '仅判题用',
  'review.layerSuggest': 'Agent 建议：{word}',
  'review.layerNow': '现在：{word}',
  'review.keepOne': '每个题集至少留一层给选手',
  'review.nameHelp': 'agent 用「登记名/题集」引用它',
  'review.notes': 'Agent 的说明',
  'review.problems': '这些问题解决前不能登记',
  'review.warnings': '登记前请看一眼',
  'review.changes': '改动清单',
  'review.change.A': '新增',
  'review.change.M': '修改',
  'review.change.D': '删除',
  'review.changeVisible': '选手可见',
  'review.changeHidden': '选手看不到',
  'review.deletions': '删除了 {count} 个文件（全部列出）',
  'review.advanced': '高级：仓库路径 · 跟踪分支 · 写入检出',
  'review.advRepo': '仓库',
  'review.advRef': '跟踪分支',
  'review.advCheckout': '写入检出',
  'review.advCommit': '提交',
  'review.advNone': '没有',
  'review.return': '退回给 Agent',
  'review.returnNote': '告诉 Agent 哪里要改',
  'review.returnSend': '退回',
  'review.returnNoSession': '这份提案没记下整理会话，意见已复制，粘贴到整理会话里。',
  'review.confirm': '确认登记',
  'review.confirmUpdate': '确认新版本',
  'review.confirming': '登记中…',
  'review.done': '已登记「{name}」',
  'review.cancel': '取消',
  'review.heldTitle': '这个版本没有整理提案',
  'review.heldBody': '它是直接提交进仓库的，Agent 没有附说明；改动清单就是它和已登记版本之间的全部差别。确认前选手仍然看到已登记版本。',
  'review.finding.COMMIT_NOT_TIP.gone': '跟踪分支 {ref} 已经不在了',
  'review.finding.COMMIT_NOT_TIP.moved': '提案之后分支 {ref} 又往前走了（现在 {now}，提案是 {commit}），请 Agent 重新提一次',
  'review.finding.UNCOMMITTED': '检出里 datasets/ 下有没提交的改动，它们不算在这个版本里',
  'review.finding.NO_SETS': '这个版本里没有任何题集（找不到 datasets/<题集>/dataset.json）',
  'review.finding.HISTORY_REWRITTEN': '这个版本不是接着已登记版本改的（分支被改写过），所有文件都按改动计',
  'review.finding.OUTPUT_UNCOVERED': '{path} 没有说明从哪来',
  'review.finding.OUTPUT_MISSING': '说明里的 {path} 在这个版本里一个文件也没有',
  'review.finding.OUTPUT_COUNT': '{path}：说明里是 {expected} 个文件，实际 {count} 个',
  'review.finding.UNLAYERED_VISIBLE': '{count} 个文件不在任何层里，选手能看到',
  'review.finding.SOURCE_UNREAD': '原目录 {path} 在这台机器上读不到，原目录一栏是 Agent 的说明，没法逐个核对',
  'review.finding.DISPOSITION_INCOMPLETE.empty': '没说明原数据的每个文件怎么处理的',
  'review.finding.DISPOSITION_INCOMPLETE.noReason': '{path} 标成未使用，但没说为什么',
  'review.finding.DISPOSITION_INCOMPLETE.noTarget': '{path} 没说放到了题集的哪里',
  'review.finding.DISPOSITION_INCOMPLETE.field': '{path} 的字段 {field} 既没去处也没理由',
  'review.finding.SOURCE_MISSING': '说明里的 {path} 在原目录里找不到',
  'review.finding.SOURCE_COUNT': '{path}：Agent 数的是 {expected} 条记录，文件里有 {count} 条',
  'review.finding.FIELD_UNACCOUNTED': '{path} 的字段 {fields} 没说明去处',
  'review.finding.SOURCE_UNLISTED': '原目录里的 {path} 没说明怎么处理的',
  'review.finding.SAMPLE_MISSING': '抽样题 {item} 在这个版本里不存在',
  'review.finding.LAYER_UNKNOWN': '层 {layer} 在这个版本里没有声明',
  'review.finding.VALIDATE_FAILED': '校验报了 {count} 处错误，第一处：{first}',
}

/** English dictionary. */
export const en: Record<DatasetsKey, string> = {
  // The three-part error seat (ui-spec §九): one sentence on what happened,
  // one on the fix; the raw text and the path stay folded under Details.
  'error.notGitRepo': 'That path is not a git repository',
  'error.notGitRepo.fix': 'Pick any directory inside the repository (or its .git) and register again',
  'error.notDatasetRepo': 'That repository holds no datasets (no datasets/ directory)',
  'error.notDatasetRepo.fix': 'Register the dataset repository’s path, or create datasets/ in it first',
  'error.pathMissing': 'That path is not on disk',
  'error.pathMissing.fix': 'Check the directory is still there, or pick another path',
  'error.noneRegistered': 'No dataset repository is registered in this deployment',
  'error.noneRegistered.fix': 'Register one first: Datasets tab → Register repository',
  'error.serviceMissing': 'This instance is missing a service this page needs',
  'error.serviceMissing.fix': 'A member is absent from the preset; install it and reopen this tab',
  'error.cancelled': 'The request was cancelled',
  'error.cancelled.fix': 'Try again',
  'error.unknownFix': 'Try again; if it persists, send the raw text under Details to the maintainer',
  'error.details': 'Details',
  'error.detailsPath': 'Path',
  'open': 'Datasets',
  'panel': 'Datasets',
  'slot.prompt': 'Task statement',
  'slot.standards': 'Acceptance standards',
  'slot.oracle': 'Reference answer',
  'slot.rubric': 'Grading rubric',
  'slot.checks': 'Check scripts',
  'slot.other': 'Other files',
  'role.player': 'the player sees it',
  'role.judge': 'the judge only',
  'role.probe': 'the probes only',
  'role.withheld': 'withheld from the player',
  'role.passthrough': 'readable by everyone',
  'list.loading': 'Loading…',
  'list.error': 'Failed to load the dataset list',
  'notice.failed': 'That action did not go through',
  'list.experimentsNone': 'no experiment yet',
  'detail.back': '← All datasets',
  'detail.filterAll': 'All',
  'detail.filterEmpty': 'No file under this filter',
  'detail.itemsLabel': 'Items',
  'detail.validate': 'Validate',
  'detail.validating': 'Validating…',
  'detail.validateOk': 'Validation passes ({warnings} warnings)',
  'detail.validateFound': 'Validation: {errors} errors · {warnings} warnings',
  'detail.itemEmpty': 'Pick an item on the left to see what the player and the judge each get',
  'detail.player': 'What the player will see',
  'detail.playerHint': 'This item as it looks inside the unit: the model-facing layer files plus the dataset-level task prompts. No other slot’s bytes reach the player’s cell.',
  'detail.playerSummary': '{count} files · {bytes} bytes',
  'detail.playerShared': 'dataset-level',
  'detail.playerEmpty': 'This item has no model-facing file — the player would get an empty workspace',
  'detail.judge': 'Judgeability',
  'detail.judgeOnly': 'Only judges and probes see',
  'detail.judgeOnlyHint': 'Layers that never reach the player’s unit: rubric, probes, reference answers.',
  'detail.judgeOnlyEmpty': 'This item has no judge-only file',
  'detail.judgeRubric': '{leaves} rubric leaves',
  'detail.judgeKind': '{kind} {count}',
  'detail.judgeProbes': '{count} probes',
  'detail.judgeShared': '{count} dataset-level probes',
  'detail.judgeSchemas': '{count} stage schemas',
  'detail.judgeLeaves': '{leaves} criteria',
  'detail.noProbes': 'no check scripts',
  'detail.probesNotWired': 'Check material is here, but no executable probe is wired up: runs will not be scored automatically',
  'detail.probesNotWiredHint': 'A probe is a .mjs or .sh file under probes/ in the verify layer; the experiment executes it inside the unit to score. The check material listed above (test.py, say) is raw material until it is wired up as a probe; until then only the rubric — a judge or a human — can score this item.',
  'judgeNote.no-rubric': 'This item ships no rubric in its {layer} layer, so no LLM judge or human verdict has anything to score',
  'judgeNote.no-grading-layer': 'This dataset declares no {layer} layer, so judging conventions (protocol §6.8) do not apply to it',
  'judgeNote.rubric-invalid': 'The rubric does not pass its check: {detail}',
  'judgeNote.rubric-unreadable': 'Could not read the rubric {path}: {detail}',
  'detail.readAt': 'read at {ref} @ {commit}',
  'detail.readAtCommit': 'read at @ {commit}',
  'detail.usedBy': 'Experiments that used this item: {names}',
  'detail.usedByMore': 'and {count} more',
  'detail.runsOlder': 'Earlier answer records · {count}',
  'detail.runs': 'Answer record',
  'detail.runsEmpty': 'This item has not been answered in any experiment yet',
  'detail.runsCell': '{condition} · take {rep}',
  'detail.briefLoading': 'Reading the task face and judgeability…',
  'detail.briefError': 'Could not read this item’s task face and judgeability',
  'preview.empty': 'Select a file on the left to preview it',
  'preview.loading': 'Loading…',
  'preview.error': 'Could not read this file',
  'preview.copy': 'Copy',
  'preview.copied': 'Copied',
  'preview.footnotes': 'Footnotes',
  'preview.treeLabel': 'JSON tree',
  'tree.fileCount': '{count} files',
  'tree.shared': 'Dataset-level shared',
  'tree.unprotected': 'not whitelist-protected',
  'tree.agentReadable': 'agent-readable',
  'tree.passthrough': 'Other files · {count} · readable by everyone',
  'tree.passthroughShort': 'Other files',
  'tree.sensitive': 'sensitive',
  'tree.warnModelFacing': 'Layer {layer} does not declare modelFacing and defaults to true; declare it explicitly in a mixed-sensitivity dataset',
  'tree.moreMeta': '+{count}',
  'json.copyValue': 'Copy value',
  'json.copyJson': 'Copy JSON',
  'json.copyPath': 'Copy property path',
  'json.copyPrettyJson': 'Copy pretty JSON',
  'json.copyCompactJson': 'Copy compact JSON',
  'json.copied': 'Copied',
  'json.copyFailed': 'Copy failed',
  'json.collapseNode': 'Collapse JSON node',
  'json.expandNode': 'Expand JSON node',
  'json.copyButtonTitle': '{action}; right-click for copy options',

  'detail.itemEmptyHint': 'Two boxes side by side on the right: every file the player will receive, with byte counts (the anti-leak self-check), and the files only the judge and probes can see, with whether the item can be scored at all.',
  'detail.filterEmptyHint': 'This dataset has no file in those slots. Press All above to see the whole tree.',
  'detail.runsEmptyHint': 'Once an experiment has run this item, each of its run records is listed here by arm and take.',
  // ── the word table (ui-spec §九): the same table the 实验室 tab carries ──
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
  'bucket.ready': 'Ready',
  'bucket.scheduled': 'Scheduled',
  'bucket.blocked': 'Blocked',
  'bucket.active': 'In progress',
  'bucket.done': 'Done',
  'bucket.other': 'Other ({token})',
  'registry.title': '{count} registered dataset repositories',
  'registry.register': 'Register repository',
  'registry.import': 'Import datasets bound in earlier sessions',
  'registry.importing': 'Importing…',
  'registry.edit': 'Edit registration',
  'registry.remove': 'Delete',
  'remove.titleDelete': 'Delete 「{id}」',
  'remove.titleUnregister': 'Remove the registration of 「{id}」',
  'remove.loading': 'Checking this repository…',
  'remove.planFailed': 'Could not read this repository ({message}). You can still remove the registration only; the files stay where they are.',
  'remove.pathDelete': 'This directory will be deleted from disk',
  'remove.pathKeep': 'Repository location',
  'remove.stateCount': '{count} read-only copies this plugin made of it are cleared too',
  'remove.choiceDelete': ': drop the registration and delete the directory above from disk.',
  'remove.choiceUnregister': ': the set leaves the list, the files stay where they are, and you can register it again later.',
  'remove.unregisterNote': 'Once the registration is removed the set leaves the list; you can register it again later.',
  'remove.keep.outside-home': 'The files stay where they are: this repository is not inside the datasets directory and was not created here, so only the registration goes.',
  'remove.keep.symlink': 'The files stay where they are: the path goes through a symbolic link, so for safety nothing is deleted and only the registration goes.',
  'remove.keep.not-repo-root': 'The files stay where they are: this directory does not match the registered repository root, so nothing is deleted and only the registration goes.',
  'remove.keep.other-checkouts': 'The files stay where they are: this repository has {count} other working copies elsewhere that deleting would break, so only the registration goes.',
  'remove.keep.missing': 'The repository directory is no longer on disk; only the registration needs removing.',
  'remove.keep.registered': 'The files stay where they are: this repository is registered already, so discarding removes only this pending record.',
  'remove.experiments': '{count} experiments used it:',
  'remove.experimentsMore': 'and {count} more',
  'remove.experimentsNote': 'Their history is kept, but after the deletion they can no longer run.',
  'remove.experimentsNone': 'No experiment has used it.',
  'remove.irreversible': 'Deleting cannot be undone.',
  'remove.cancel': 'Cancel',
  'remove.delete': 'Delete the set and its files',
  'remove.unregisterOnly': 'Remove the registration only, keep the files',
  'remove.unregister': 'Remove registration',
  'remove.working': 'Working…',
  'remove.close': 'Close',
  'discard.action': 'Discard',
  'discard.actionTitle': 'Drop this organizing result: delete the pending record and the organized repository',
  'discard.title': 'Discard the organizing result 「{name}」',
  'discard.planFailed': 'Could not read this organizing result ({message}). You can still discard it; only the pending record is deleted.',
  'discard.pathDelete': 'The organized repository will be deleted from disk',
  'discard.body': 'The pending record is deleted and this banner goes away. The organizing session stays; you can go back and keep talking.',
  'discard.confirmDelete': 'Discard and delete the repository',
  'discard.confirm': 'Discard',
  'registry.tracking': 'tracking {ref}',
  'registry.authoring': 'has a checkout',
  'registry.noAuthoring': 'read-only registration (no authoring checkout)',
  'registry.colSet': 'Repository · set',
  'registry.colLatest': 'Latest version',
  'registry.colItems': 'Items',
  'registry.itemsUnit': 'items',
  'registry.colVisible': 'Agent sees',
  'registry.colUsed': 'Used by experiments',
  'registry.colActions': 'Actions',
  'registry.more': 'More actions for {id}',
  'registry.usedCount': '{count} experiments · across {versions} versions',
  'registry.usedCountUnpinned': '{count} experiments',
  'registry.usedUnpinned': 'no pinned version',
  'layers.faceOnly': 'Task only',
  'layers.withAnswers': 'Includes answers',
  'layers.withAnswersPlus': 'Includes answers · {layers}',
  'layers.raw': '{layers}',
  'layers.none': 'No layer at all',
  'layers.title': 'Layers the agent can read: {layers}',
  'layers.edit': 'Change',
  'layers.editTitle': 'Change what the agent can read of {set} in the registration form',
  'layers.unknownTitle': '{layers} is not in the word table and is shown as is; this page does not guess whether it carries answers',
  'registry.problem': 'This registration cannot be read right now',
  'registry.problemFix': 'Open ⋯ under Actions: edit the registration to pick an existing tracked branch, or delete it',
  'registry.noSets': 'No datasets on {ref} (empty datasets/)',
  'registry.empty': 'No datasets yet',
  'registry.emptyHint': 'Local data, downloaded files or a public dataset: hand it to the Agent from here. Once you confirm the registration, the lab and agents can use it.',
  'registry.emptyAction': 'Add a dataset',
  'import.done': 'Old bindings processed: {created} repositories newly registered, {merged} folded into existing registrations',
  'import.nothing': 'No old bindings found',
  'import.created': '{id}: merged {sessions} session bindings ({paths} paths) into a new registration',
  'import.existing': '{id}: registered already; {sessions} session bindings folded into it',
  'import.dangling': '{name} · {sessions} sessions · skipped: {why}',
  'import.why.missing': 'the path no longer exists',
  'import.why.notRepo': 'not a git repository',
  'import.why.other': 'cannot be registered automatically; register it by hand',
  'import.dismiss': 'Dismiss',
  'register.title': 'Register a dataset repository',
  'register.titleEdit': 'Edit registration: {id}',
  'register.path': 'Repository path (any checkout, worktree or .git directory)',
  'register.browse': 'Browse…',
  'register.id': 'Registry id (agents reference <id>/<set>)',
  'register.branch': 'Tracked branch (“latest” = this branch’s tip)',
  'register.layers': 'Agent-visible layers per set',
  'register.sensitive': 'sensitive',
  'register.authoring': 'Write new datasets and items into this checkout',
  'register.preview.loading': 'Checking the repository…',
  'register.preview.ok': '{count} sets · {ref}@{short} · {date}',
  'register.preview.empty': 'Valid git repository, but no datasets on {ref}',
  'register.preview.noRef': 'This repository has no branch {ref}: pick another tracked branch; for a repository with no commits yet, use Let the Agent organize it',
  'register.preview.failed': 'That path cannot be registered',
  'register.keepOne': 'Keep at least one layer per set',
  'register.submit': 'Register',
  'register.save': 'Save',
  'register.cancel': 'Cancel',
  'error.alreadyRegistered': 'This repository is registered already',
  'error.alreadyRegistered.fix': 'Use Edit registration on its row instead of registering it again',
  'error.notRegistered': 'That dataset repository is not in this deployment’s registry',
  'error.notRegistered.fix': 'Register it first: Datasets tab → Register repository',
  'error.refMissing': 'The registration’s tracked branch does not exist',
  'error.refMissing.fix': 'Edit the registration and pick an existing branch',
  'add.title': 'Add a dataset',
  'add.description': 'Tell the Agent where the data is. It opens a new evaluation-mode session and organizes the data into a dataset there; when it is done you check it here and confirm the registration.',
  'add.source': 'Where the data is',
  'add.sourcePlaceholder': 'A local directory, downloaded files, or a public dataset’s name / link',
  'add.sourceHelp': 'The original data is read only; the Agent never changes it.',
  'add.name': 'Dataset name',
  'add.namePlaceholder': 'e.g. gsm8k',
  'add.nameHelp': 'The registration name agents use: letters, digits and . _ -',
  'add.nameBad': 'Use letters, digits and . _ - only, starting with a letter or digit',
  'add.purpose': 'What you want to test with it',
  'add.purposePlaceholder': 'e.g. compare two models on math reasoning',
  'add.required': 'required',
  'add.optional': 'optional',
  'add.git': 'Datasets are kept in git: every version stays, and an experiment always reruns exactly on the version it used. You do not need to know git.',
  'add.gitNeeded': 'If this machine has no git, the Agent asks before installing it.',
  'add.repo': 'New repository',
  'add.repoHelp': 'The Agent creates the dataset repository here; by default under the datasets folder.',
  'add.repoHelpPicked': 'Under the folder you chose.',
  'add.repoNameSlot': '<dataset name>',
  'add.repoChange': 'Change…',
  'add.repoReset': 'Use default',
  'add.browse': 'Choose a folder…',
  'add.organize': 'Let the Agent organize it',
  'add.cancel': 'Cancel',
  'add.close': 'Close',
  'add.advanced': 'Advanced: already a dataset repository? Register it directly',
  'organize.sessionTitle': '题集整理 · {name}',
  'organize.request': 'Use the dataset-authoring skill to organize this data into a dataset, then file a registration proposal; I will check and confirm it on the Datasets tab.',
  'organize.lineSource': 'Where the data is: {value}',
  'organize.lineName': 'Dataset name: {value}',
  'organize.linePurpose': 'What I want to test with it: {value}',
  'organize.lineRepo': 'Put the new repository at: {value}',
  'organize.updateRequest': 'Use the dataset-authoring skill to change the registered dataset 「{name}」; commit, then file a registration proposal again.',
  'organize.lineCheckout': 'Repository checkout: {value}',
  'organize.lineRef': 'Tracked branch: {value}',
  'organize.lineWant': 'What to change:',
  'organize.returnRequest': 'I sent the registration proposal 「{name}」 back. Please fix it as below, commit, and propose again:',
  'organize.drafted': 'A new organizing session is open with the request in its chat box. Read it, then send.',
  'organize.returned': 'Back in the organizing session with your note in its chat box. Read it, then send.',
  'organize.copied': 'Could not write into the chat box; the request is on the clipboard. Paste it into the session and send.',
  'organize.manual': 'Could not write into the chat box or copy. Paste this into the session:',
  'organize.failed': 'Could not open an organizing session',
  'organize.dismiss': 'Dismiss',
  'registry.add': 'Add a dataset',
  'registry.askAgent': 'Ask the Agent to change it',
  'registry.version': 'version {number} · {date}',
  'registry.pending': 'new version to confirm',
  'registry.advancedTitle': 'repository {path}\ntracked branch {ref}\ncheckout {checkout}',
  'banner.proposal': 'The Agent has organized 「{name}」; it is waiting for you to confirm the registration',
  'banner.proposalUpdate': 'The Agent has changed 「{name}」; the new version is waiting for you to confirm',
  'banner.pending': '「{name}」 has a new version that changes what agents can see; it is waiting for you to confirm',
  'banner.review': 'Check and register',
  'card.kindNew': 'Registration proposal',
  'card.kindUpdate': 'Update proposal',
  'card.check': 'Registration check',
  'card.checkOk': 'Check passed',
  'card.checkProblems': '{count} problem(s)',
  'card.checkNote': 'A check only — nothing was filed.',
  'card.running': 'Filing the proposal…',
  'card.failed': 'This filing did not go through; the agent will say why.',
  'card.unreadable': 'This call’s result could not be read.',
  'card.filedNote': 'Waiting for you: compare it with the original directory, choose which layers agents see, then register.',
  'card.handled': 'Handled',
  'card.handledNote': 'This proposal was registered, returned, or replaced by a newer one.',
  'card.warnings': 'The proposal has {count} warning(s).',
  'card.open': 'Check and register',
  'card.view': 'View the review',
  'card.opened': 'The review is open in the Datasets panel',
  'card.openedManual': 'The review is ready — open this session’s Datasets tab',
  'banner.reviewUpdate': 'Check the new version',
  'review.back': 'Back to datasets',
  'review.titleNew': 'Check and register 「{name}」',
  'review.titleUpdate': 'Check the new version of 「{name}」',
  'review.loading': 'Checking…',
  'review.error': 'The proposal cannot be read',
  'review.factSource': 'Source',
  'review.factItems': 'Items',
  'review.factValidate': 'Validation',
  'review.factVersion': 'Version',
  'review.factName': 'Registration name',
  'review.sourceKind.local': 'local directory',
  'review.sourceKind.public': 'public dataset',
  'review.sourceKind.protocol': 'already in the dataset layout',
  'review.validateOk': 'passed',
  'review.validateWarn': 'passed · {count} warnings',
  'review.validateFail': '{count} errors',
  'review.versionOne': 'version {number} · {date}',
  'review.versionStep': 'version {from} → version {to} · {date}',
  'review.sets': '{count} sets: {names}',
  'review.compareNew': 'Original → dataset',
  'review.compareUpdate': 'Registered version → new version',
  'review.sum.split': 'split {count}',
  'review.sum.copy': 'copied {count}',
  'review.sum.new': 'new {count}',
  'review.sum.unused': 'unused {count}',
  'review.sum.added': 'added {count}',
  'review.sum.modified': 'modified {count}',
  'review.sum.deleted': 'deleted {count}',
  'review.sum.outside': 'outside datasets {count}',
  'review.untouched': '{files} original files, none changed; the dataset has {outputs} files',
  'review.sourceUnread': 'The original directory cannot be read on this machine; the left column is the Agent’s account and cannot be checked file by file.',
  'review.sources': 'Original',
  'review.outputs': 'Dataset',
  'review.noSources': 'This proposal has no original directory (the repository is the source).',
  'review.disp.split': 'split',
  'review.disp.copy': 'copied',
  'review.disp.unused': 'unused',
  'review.originSplit': '← {from} · {field}',
  'review.originFrom': '← {from}',
  'review.originNew': 'new',
  'review.originUnexplained': 'unexplained',
  'review.rowFiles': '{count} files',
  'review.rowRecords': '{count} records',
  'review.rowItems': '{count} items',
  'review.fieldTo': '{name} → {to}',
  'review.fieldDropped': '{name}: dropped ({reason})',
  'review.unlayered': 'in no layer · agents see it',
  'review.unlayeredCount': '{count} files sit in no layer; agents can see them',
  'review.layerTag': 'layer {layer}',
  'review.itemOne': 'Compare one item',
  'review.itemRandom': 'Spot-check 3 random items',
  'review.fullList': 'Full file list',
  'review.itemSource': 'Source record · {file}',
  'review.itemLine': 'line {line}',
  'review.itemFiles': '{count} files it became',
  'review.itemNoSource': 'No source record to compare for this item',
  'review.itemPick': 'Another item',
  'review.close': 'Close',
  'review.listTruncated': 'The list is long; only the first part is shown',
  'review.layersTitle': 'Who sees each layer',
  'review.layerVisible': 'agents see it',
  'review.layerHidden': 'grading only',
  'review.layerSuggest': 'Agent suggests: {word}',
  'review.layerNow': 'now: {word}',
  'review.keepOne': 'Leave agents at least one layer per set',
  'review.nameHelp': 'Agents reference it as <name>/<set>',
  'review.notes': 'The Agent’s notes',
  'review.problems': 'These must be fixed before registering',
  'review.warnings': 'Worth a look before registering',
  'review.changes': 'Changes',
  'review.change.A': 'added',
  'review.change.M': 'modified',
  'review.change.D': 'deleted',
  'review.changeVisible': 'agents see it',
  'review.changeHidden': 'agents do not see it',
  'review.deletions': '{count} files deleted (all listed)',
  'review.advanced': 'Advanced: repository path · tracked branch · checkout',
  'review.advRepo': 'Repository',
  'review.advRef': 'Tracked branch',
  'review.advCheckout': 'Checkout',
  'review.advCommit': 'Commit',
  'review.advNone': 'none',
  'review.return': 'Send back to the Agent',
  'review.returnNote': 'Tell the Agent what to change',
  'review.returnSend': 'Send back',
  'review.returnNoSession': 'This proposal recorded no organizing session; the note is copied — paste it into that session.',
  'review.confirm': 'Confirm registration',
  'review.confirmUpdate': 'Confirm the new version',
  'review.confirming': 'Registering…',
  'review.done': 'Registered 「{name}」',
  'review.cancel': 'Cancel',
  'review.heldTitle': 'No organizing proposal for this version',
  'review.heldBody': 'It was committed straight into the repository with no account from the agent; the change list is everything that differs from the registered version. Until you confirm, agents keep reading the registered one.',
  'review.finding.COMMIT_NOT_TIP.gone': 'The tracked branch {ref} no longer exists',
  'review.finding.COMMIT_NOT_TIP.moved': 'Branch {ref} moved on after this proposal (now {now}, proposal {commit}); ask the agent to file a new one',
  'review.finding.UNCOMMITTED': 'The checkout has uncommitted changes under datasets/; they are not part of this version',
  'review.finding.NO_SETS': 'This version holds no dataset (no datasets/<set>/dataset.json)',
  'review.finding.HISTORY_REWRITTEN': 'This version does not continue the registered one (the branch was rewritten); every file counts as changed',
  'review.finding.OUTPUT_UNCOVERED': '{path} has no account of where it came from',
  'review.finding.OUTPUT_MISSING': '{path} from the account matches no file in this version',
  'review.finding.OUTPUT_COUNT': '{path}: the account says {expected} files, the version has {count}',
  'review.finding.UNLAYERED_VISIBLE': '{count} files sit in no layer; agents can see them',
  'review.finding.SOURCE_UNREAD': 'The original directory {path} cannot be read here; the source rows are the agent’s account, unchecked',
  'review.finding.DISPOSITION_INCOMPLETE.empty': 'No account of what happened to each file of the original data',
  'review.finding.DISPOSITION_INCOMPLETE.noReason': '{path} is marked unused with no reason',
  'review.finding.DISPOSITION_INCOMPLETE.noTarget': '{path} names no place in the dataset',
  'review.finding.DISPOSITION_INCOMPLETE.field': '{path}: field {field} has neither a target nor a reason',
  'review.finding.SOURCE_MISSING': '{path} from the account is not in the original directory',
  'review.finding.SOURCE_COUNT': '{path}: the agent counted {expected} records, the file has {count}',
  'review.finding.FIELD_UNACCOUNTED': '{path}: fields {fields} are not accounted for',
  'review.finding.SOURCE_UNLISTED': '{path} of the original directory is not accounted for',
  'review.finding.SAMPLE_MISSING': 'Sample {item} is not an item in this version',
  'review.finding.LAYER_UNKNOWN': 'Layer {layer} is not declared in this version',
  'review.finding.VALIDATE_FAILED': 'Validation reports {count} error(s); the first: {first}',
}
