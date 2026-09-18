/** `datasets` namespace dictionaries (the 题集 tab copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'datasets'

/** The 题集 tab dictionary key set (the source of truth for both locales). */
export type DatasetsKey =
  | 'open'
  | 'chip.label'
  | 'chip.unbound'
  | 'chip.unboundHint'
  | 'chip.boundHint'
  | 'chip.layersFloor'
  | 'chip.layersNamed'
  | 'binding.none'
  | 'binding.repo'
  | 'binding.allDatasets'
  | 'binding.agentVisible'
  | 'binding.agentVisibleFloor'
  | 'binding.bind'
  | 'binding.edit'
  | 'binding.unbind'
  | 'binding.form.title'
  | 'binding.form.titleEdit'
  | 'binding.form.repo'
  | 'binding.form.useWorkspace'
  | 'binding.form.browse'
  | 'binding.form.restrict'
  | 'binding.form.restrictDatasets'
  | 'binding.form.restrictLayers'
  | 'binding.form.sensitive'
  | 'binding.form.taskFacingOnly'
  | 'binding.form.preview.loading'
  | 'binding.form.preview.ok'
  | 'binding.form.preview.empty'
  | 'binding.form.preview.failed'
  | 'binding.form.keepOne'
  | 'binding.form.submit'
  | 'binding.form.cancel'
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
  | 'list.empty'
  | 'list.itemCount'
  | 'list.unbound'
  | 'list.colDataset'
  | 'list.colSnapshot'
  | 'list.colItems'
  | 'list.colSlots'
  | 'list.colCanary'
  | 'list.colValidate'
  | 'list.colExperiments'
  | 'list.canaryOn'
  | 'list.canaryOff'
  | 'list.validateOk'
  | 'list.validateErrors'
  | 'list.validateWarnings'
  | 'list.validateUnknown'
  | 'list.experimentsNone'
  | 'list.newDataset'
  | 'list.slotLayer'
  | 'list.passthroughLayer'
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
  | 'detail.judgeRubric'
  | 'detail.judgeKind'
  | 'detail.judgeProbes'
  | 'detail.judgeShared'
  | 'detail.judgeSchemas'
  | 'detail.runs'
  | 'detail.runsEmpty'
  | 'list.unboundHint'
  | 'list.unboundAction'
  | 'list.emptyAction'
  | 'list.emptyHint'
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
  | 'error.unbound'
  | 'error.unbound.fix'
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
  'open': '题集',
  'chip.label': '题集',
  'chip.unbound': '未绑定',
  'chip.unboundHint': '本会话还没绑题库。用 /datasets bind <题库路径> 绑一个，或在题集 tab 里导入。',
  'chip.boundHint': '本会话绑定：{repo}（{layers}）。改绑用 /datasets bind <题库路径>。',
  'chip.layersFloor': '仅模型可见层',
  'chip.layersNamed': '层：{layers}',
  'binding.none': '本会话未绑定题库仓库',
  'binding.repo': '题库: {repo}',
  'binding.allDatasets': '全部题集',
  'binding.agentVisible': 'agent 可见：{layers}',
  'binding.agentVisibleFloor': 'agent 可见：可见层（敏感层默认拦截）',
  'binding.bind': '导入题集',
  'binding.edit': '改白名单',
  'binding.unbind': '解绑',
  'binding.form.title': '导入题集（指一个已按协议组织的仓库）',
  'binding.form.titleEdit': '修改题库与白名单',
  'binding.form.repo': '仓库路径（git 仓库）',
  'binding.form.useWorkspace': '使用当前工作区',
  'binding.form.browse': '浏览…',
  'binding.form.restrict': 'agent 可见范围',
  'binding.form.restrictDatasets': 'agent 可见的题集',
  'binding.form.restrictLayers': 'agent 可见的层',
  'binding.form.sensitive': '敏感',
  'binding.form.taskFacingOnly': '仅题面',
  'binding.form.preview.loading': '检查仓库…',
  'binding.form.preview.ok': '✓ 有效仓库 · {count} 个题集',
  'binding.form.preview.failed': '这个路径没预览出来',
  'binding.form.preview.empty': 'git 仓库有效，但没有题集（datasets/ 为空）',
  'binding.form.keepOne': '每组至少保留一项；要全部可见请折叠此区',
  'binding.form.submit': '确认',
  'binding.form.cancel': '取消',
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
  'list.empty': '这个仓库里没有题集（datasets/ 为空）',
  'list.itemCount': '{count} 道题',
  'list.unbound': '先导入一个题库仓库，或新建一个题集',
  'list.colDataset': '题集',
  'list.colSnapshot': '题库版本',
  'list.colItems': '题目数',
  'list.colSlots': '槽位 ← 层',
  'list.colCanary': '防泄标记',
  'list.colValidate': '校验',
  'list.colExperiments': '用于的实验',
  'list.canaryOn': '已设置',
  'list.canaryOff': '未设置',
  'list.validateOk': '通过',
  'list.validateErrors': '{count} 个错误',
  'list.validateWarnings': '{count} 个提示',
  'list.validateUnknown': '未校验',
  'list.experimentsNone': '尚未用于任何实验',
  'list.newDataset': '新建题集',
  'list.slotLayer': '{slot} ← {layers}',
  'list.passthroughLayer': '透传区',
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

  'list.unboundAction': '绑定一个题库仓库',
  'list.emptyAction': '新建第一个题集',
  'list.unboundHint': '绑定之后，这里按题集列出题库版本、题目数、槽位与层的对应、防泄标记与校验结果。',
  'list.emptyHint': '题集是 datasets/<id>/ 下的一个目录，带一份 dataset.json。新建一个会生成骨架，提交仍是你的。',
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
}

/** English dictionary. */
export const en: Record<DatasetsKey, string> = {
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
  'open': 'Datasets',
  'chip.label': 'Datasets',
  'chip.unbound': 'not bound',
  'chip.unboundHint': 'This session has no dataset repository. Bind one with /datasets bind <repoPath>, or import one in the Datasets tab.',
  'chip.boundHint': 'Bound to {repo} ({layers}). Rebind with /datasets bind <repoPath>.',
  'chip.layersFloor': 'model-facing layers',
  'chip.layersNamed': 'layers: {layers}',
  'binding.none': 'No dataset repository bound to this session',
  'binding.repo': 'Repository: {repo}',
  'binding.allDatasets': 'all datasets',
  'binding.agentVisible': 'agent-visible: {layers}',
  'binding.agentVisibleFloor': 'agent-visible: model-facing layers (sensitive blocked by default)',
  'binding.bind': 'Import a dataset',
  'binding.edit': 'Edit whitelist',
  'binding.unbind': 'Unbind',
  'binding.form.title': 'Import a dataset (point at a repository laid out by the protocol)',
  'binding.form.titleEdit': 'Edit repository & whitelist',
  'binding.form.repo': 'Repository path (a git repository)',
  'binding.form.useWorkspace': 'Use current workspace',
  'binding.form.browse': 'Browse…',
  'binding.form.restrict': 'Agent-visible scope',
  'binding.form.restrictDatasets': 'Agent-visible datasets',
  'binding.form.restrictLayers': 'Agent-visible layers',
  'binding.form.sensitive': 'sensitive',
  'binding.form.taskFacingOnly': 'Model-facing only',
  'binding.form.preview.loading': 'Checking the repository…',
  'binding.form.preview.ok': '✓ valid repository · {count} datasets',
  'binding.form.preview.failed': 'Could not preview that path',
  'binding.form.preview.empty': 'Valid git repository, but no datasets (empty datasets/)',
  'binding.form.keepOne': 'Keep at least one per group; collapse the section to keep everything visible',
  'binding.form.submit': 'Confirm',
  'binding.form.cancel': 'Cancel',
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
  'list.empty': 'This repository holds no dataset (empty datasets/)',
  'list.itemCount': '{count} items',
  'list.unbound': 'Import a dataset repository first, or create a new dataset',
  'list.colDataset': 'Dataset',
  'list.colSnapshot': 'Dataset version',
  'list.colItems': 'Items',
  'list.colSlots': 'Slot ← layer',
  'list.colCanary': 'Canary',
  'list.colValidate': 'Validate',
  'list.colExperiments': 'Used by',
  'list.canaryOn': 'declared',
  'list.canaryOff': 'not declared',
  'list.validateOk': 'passes',
  'list.validateErrors': '{count} errors',
  'list.validateWarnings': '{count} warnings',
  'list.validateUnknown': 'not validated',
  'list.experimentsNone': 'no experiment yet',
  'list.newDataset': 'New dataset',
  'list.slotLayer': '{slot} ← {layers}',
  'list.passthroughLayer': 'passthrough',
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

  'list.unboundAction': 'Bind a dataset repository',
  'list.emptyAction': 'Create the first dataset',
  'list.unboundHint': 'Once bound, this page lists each dataset with its snapshot, item count, slot \u2190 layer mapping, canary and validate result.',
  'list.emptyHint': 'A dataset is a directory under datasets/<id>/ with a dataset.json. Creating one writes the skeleton; the commit is still yours.',
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
}
