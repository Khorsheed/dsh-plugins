/** `datasets` namespace dictionaries (the 题集 tab copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'datasets'

/** The 题集 tab dictionary key set (the source of truth for both locales). */
export type DatasetsKey =
  | 'open'
  | 'registry.title'
  | 'registry.register'
  | 'registry.import'
  | 'registry.importing'
  | 'registry.edit'
  | 'registry.remove'
  | 'registry.removeConfirm'
  | 'registry.tracking'
  | 'registry.authoring'
  | 'registry.noAuthoring'
  | 'registry.colSet'
  | 'registry.colLatest'
  | 'registry.colItems'
  | 'registry.colVisible'
  | 'registry.colUsed'
  | 'registry.usedCount'
  | 'registry.usedCountUnpinned'
  | 'registry.usedUnpinned'
  | 'layers.faceOnly'
  | 'layers.withAnswers'
  | 'layers.withAnswersPlus'
  | 'layers.raw'
  | 'layers.none'
  | 'layers.title'
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
  | 'list.newDataset'
  | 'detail.back'
  | 'detail.filterAll'
  | 'detail.filterEmpty'
  | 'detail.itemsLabel'
  | 'detail.newItem'
  | 'detail.importItem'
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
  | 'form.newDatasetTitle'
  | 'form.datasetId'
  | 'form.datasetName'
  | 'form.newItemTitle'
  | 'form.itemId'
  | 'form.importItemTitle'
  | 'form.sourceDir'
  | 'form.submit'
  | 'form.cancel'
  | 'skeleton.written'
  | 'skeleton.skipped'
  | 'skeleton.commitHint'
  | 'skeleton.dismiss'
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
  'list.newDataset': '新建题集',
  'detail.back': '← 题集列表',
  'detail.filterAll': '全部',
  'detail.filterEmpty': '这个筛选下没有文件',
  'detail.itemsLabel': '题目',
  'detail.newItem': '题目骨架',
  'detail.importItem': '导入题目',
  'detail.validate': '校验',
  'detail.validating': '校验中…',
  'detail.validateOk': '校验通过（{warnings} 个提示）',
  'detail.validateFound': '校验：{errors} 个错误 · {warnings} 个提示',
  'detail.itemEmpty': '在左侧选一道题，看它的题面与可判性',
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
  'detail.runs': '作答记录',
  'detail.runsEmpty': '这道题还没有在任何实验里作答过',
  'detail.runsCell': '{condition} · 第 {rep} 次',
  'detail.briefLoading': '读取题面与可判性…',
  'detail.briefError': '这道题的题面与可判性没读出来',
  'form.newDatasetTitle': '新建题集（写 dataset.json 骨架、prompts/、schemas/、items/）',
  'form.datasetId': '题集 id（也是目录名）',
  'form.datasetName': '显示名（可选）',
  'form.newItemTitle': '题目骨架（按本题集的层与 register 落位）',
  'form.itemId': '题目 id（也是目录名）',
  'form.importItemTitle': '导入题目（把一个已有的题目目录原样拷入）',
  'form.sourceDir': '源目录的绝对路径',
  'form.submit': '写入工作区',
  'form.cancel': '取消',
  'skeleton.written': '已写入 {count} 个文件',
  'skeleton.skipped': '{count} 个文件已存在，未覆盖',
  'skeleton.commitHint': '文件只写进工作区。commit 仍是你的——树与 validate 读的是 HEAD，提交后才会看到它们。',
  'skeleton.dismiss': '知道了',
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

  'detail.itemEmptyHint': '右边会列出「选手将看到」的每个文件与字节数（防泄题自查），以及这道题能不能判。',
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
  'registry.import': '从旧绑定登记',
  'registry.importing': '正在登记旧绑定…',
  'registry.edit': '编辑登记',
  'registry.remove': '移除登记',
  'registry.removeConfirm': '确认移除（只删登记，仓库不动）',
  'registry.tracking': '跟踪 {ref}',
  'registry.authoring': '新建题集、题目写进登记的检出',
  'registry.noAuthoring': '只读登记（没有写入检出）',
  'registry.colSet': '仓库 · 题集',
  'registry.colLatest': '最新版本',
  'registry.colItems': '题数',
  'registry.colVisible': 'agent 可见',
  'registry.colUsed': '用在哪些实验',
  'registry.usedCount': '{count} 个实验 · 分布在 {versions} 个版本',
  'registry.usedCountUnpinned': '{count} 个实验',
  'registry.usedUnpinned': '未钉版本',
  'layers.faceOnly': '只看题面',
  'layers.withAnswers': '含答案',
  'layers.withAnswersPlus': '含答案 · {layers}',
  'layers.raw': '{layers}',
  'layers.none': '一层都看不到',
  'layers.title': 'agent 能读的层：{layers}',
  'layers.unknownTitle': '{layers} 不在词表里，原样显示；这里不推断它是否含答案',
  'registry.problem': '这条登记现在读不出来',
  'registry.problemFix': '点「编辑登记」换一个存在的跟踪分支，或移除这条登记',
  'registry.noSets': '{ref} 上没有题集（datasets/ 为空）',
  'registry.empty': '还没有登记题库仓库',
  'registry.emptyHint': '登记之后，这里按仓库列出每个题集：跟踪分支的最新提交、日期、agent 可见的层。agent 只能用「登记名/题集」引用它们，不读目录。',
  'registry.emptyAction': '登记第一个仓库',
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
  'register.preview.noRef': '这个仓库没有分支 {ref}，换一个跟踪分支',
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
  'list.newDataset': 'New dataset',
  'detail.back': '← All datasets',
  'detail.filterAll': 'All',
  'detail.filterEmpty': 'No file under this filter',
  'detail.itemsLabel': 'Items',
  'detail.newItem': 'Item skeleton',
  'detail.importItem': 'Import an item',
  'detail.validate': 'Validate',
  'detail.validating': 'Validating…',
  'detail.validateOk': 'Validation passes ({warnings} warnings)',
  'detail.validateFound': 'Validation: {errors} errors · {warnings} warnings',
  'detail.itemEmpty': 'Pick an item on the left to see its task face and judgeability',
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
  'detail.runs': 'Answer record',
  'detail.runsEmpty': 'This item has not been answered in any experiment yet',
  'detail.runsCell': '{condition} · take {rep}',
  'detail.briefLoading': 'Reading the task face and judgeability…',
  'detail.briefError': 'Could not read this item’s task face and judgeability',
  'form.newDatasetTitle': 'New dataset (writes the dataset.json skeleton, prompts/, schemas/, items/)',
  'form.datasetId': 'Dataset id (also its directory name)',
  'form.datasetName': 'Display name (optional)',
  'form.newItemTitle': 'Item skeleton (homed by this dataset’s layers and register)',
  'form.itemId': 'Item id (also its directory name)',
  'form.importItemTitle': 'Import an item (copies an existing item directory in verbatim)',
  'form.sourceDir': 'Absolute path of the source directory',
  'form.submit': 'Write into the working tree',
  'form.cancel': 'Cancel',
  'skeleton.written': '{count} files written',
  'skeleton.skipped': '{count} files already existed and were left alone',
  'skeleton.commitHint': 'The files land in the working tree only. The commit stays yours — the tree and validate read HEAD, so they appear once you commit.',
  'skeleton.dismiss': 'Got it',
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

  'detail.itemEmptyHint': 'The right pane lists every file the player will receive, with byte counts (the anti-leak self-check), and whether the item can be scored at all.',
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
  'registry.import': 'Register from old bindings',
  'registry.importing': 'Registering old bindings…',
  'registry.edit': 'Edit registration',
  'registry.remove': 'Remove registration',
  'registry.removeConfirm': 'Confirm removal (the repository is untouched)',
  'registry.tracking': 'tracking {ref}',
  'registry.authoring': 'new datasets and items are written to the registered checkout',
  'registry.noAuthoring': 'read-only registration (no authoring checkout)',
  'registry.colSet': 'Repository · set',
  'registry.colLatest': 'Latest version',
  'registry.colItems': 'Items',
  'registry.colVisible': 'Agent sees',
  'registry.colUsed': 'Used by experiments',
  'registry.usedCount': '{count} experiments · across {versions} versions',
  'registry.usedCountUnpinned': '{count} experiments',
  'registry.usedUnpinned': 'no pinned version',
  'layers.faceOnly': 'Task only',
  'layers.withAnswers': 'Includes answers',
  'layers.withAnswersPlus': 'Includes answers · {layers}',
  'layers.raw': '{layers}',
  'layers.none': 'No layer at all',
  'layers.title': 'Layers the agent can read: {layers}',
  'layers.unknownTitle': '{layers} is not in the word table and is shown as is; this page does not guess whether it carries answers',
  'registry.problem': 'This registration cannot be read right now',
  'registry.problemFix': 'Edit the registration to pick an existing tracked branch, or remove it',
  'registry.noSets': 'No datasets on {ref} (empty datasets/)',
  'registry.empty': 'No dataset repository is registered yet',
  'registry.emptyHint': 'Once registered, this page lists each set by repository: the tracked branch’s latest commit, its date and the agent-visible layers. Agents reference them as <id>/<set> only and never read directories.',
  'registry.emptyAction': 'Register the first repository',
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
  'register.preview.noRef': 'This repository has no branch {ref}; pick another tracked branch',
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
}
