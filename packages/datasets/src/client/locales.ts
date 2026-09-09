/** `datasets` namespace dictionaries (the session tab copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'datasets'

/** The datasets tab dictionary key set (the source of truth for both locales). */
export type DatasetsKey =
  | 'open'
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
  | 'binding.form.keepOne'
  | 'binding.form.submit'
  | 'binding.form.cancel'
  | 'list.loading'
  | 'list.error'
  | 'list.empty'
  | 'list.itemCount'
  | 'list.unbound'
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

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The datasets session-tab copy. */
    'datasets': DatasetsKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<DatasetsKey, string> = {
  'open': '数据集',
  'binding.none': '本会话未绑定数据集仓库',
  'binding.repo': '本会话绑定: {repo}',
  'binding.allDatasets': '全部数据集',
  'binding.agentVisible': 'agent 可见：{layers}',
  'binding.agentVisibleFloor': 'agent 可见：可见层（敏感层默认拦截）',
  'binding.bind': '绑定',
  'binding.edit': '改白名单',
  'binding.unbind': '解绑',
  'binding.form.title': '绑定数据集仓库',
  'binding.form.titleEdit': '修改绑定与白名单',
  'binding.form.repo': '仓库路径（git 仓库）',
  'binding.form.useWorkspace': '使用当前工作区',
  'binding.form.browse': '浏览…',
  'binding.form.restrict': 'agent 可见范围',
  'binding.form.restrictDatasets': 'agent 可见的数据集',
  'binding.form.restrictLayers': 'agent 可见的层',
  'binding.form.sensitive': '敏感',
  'binding.form.taskFacingOnly': '仅题面',
  'binding.form.preview.loading': '检查仓库…',
  'binding.form.preview.ok': '✓ 有效仓库 · {count} 个数据集',
  'binding.form.preview.empty': 'git 仓库有效，但没有数据集（datasets/ 为空）',
  'binding.form.keepOne': '每组至少保留一项；要全部可见请折叠此区',
  'binding.form.submit': '确认',
  'binding.form.cancel': '取消',
  'list.loading': '加载中…',
  'list.error': '数据集列表加载失败',
  'list.empty': '绑定范围内没有数据集',
  'list.itemCount': '{count} 个 item',
  'list.unbound': '先在上方绑定一个数据集仓库',
  'preview.empty': '在左侧选择一个文件查看内容',
  'preview.loading': '加载中…',
  'preview.error': '读取失败',
  'preview.copy': '复制',
  'preview.copied': '已复制',
  'preview.footnotes': '脚注',
  'preview.treeLabel': 'JSON 结构树',
  'tree.fileCount': '{count} 个文件',
  'tree.shared': '题集级共享',
  'tree.unprotected': '不受白名单保护',
  'tree.agentReadable': 'agent 可读',
  'tree.passthrough': '透传 · {count} 个文件 · 不受白名单保护',
  'tree.passthroughShort': '透传',
  'tree.sensitive': '敏感',
  'tree.warnModelFacing': '层 {layer} 未显式声明 modelFacing，按默认 true 处理；混合敏感度数据集建议逐层表态',
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
}

/** English dictionary. */
export const en: Record<DatasetsKey, string> = {
  'open': 'Datasets',
  'binding.none': 'No dataset repository bound to this session',
  'binding.repo': 'Bound: {repo}',
  'binding.allDatasets': 'all datasets',
  'binding.agentVisible': 'agent-visible: {layers}',
  'binding.agentVisibleFloor': 'agent-visible: model-facing layers (sensitive blocked by default)',
  'binding.bind': 'Bind',
  'binding.edit': 'Edit whitelist',
  'binding.unbind': 'Unbind',
  'binding.form.title': 'Bind a dataset repository',
  'binding.form.titleEdit': 'Edit binding & whitelist',
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
  'binding.form.preview.empty': 'Valid git repository, but no datasets (empty datasets/)',
  'binding.form.keepOne': 'Keep at least one per group; collapse the section to keep everything visible',
  'binding.form.submit': 'Confirm',
  'binding.form.cancel': 'Cancel',
  'list.loading': 'Loading…',
  'list.error': 'Failed to load the dataset list',
  'list.empty': 'No datasets in the bound scope',
  'list.itemCount': '{count} items',
  'list.unbound': 'Bind a dataset repository above first',
  'preview.empty': 'Select a file on the left to preview it',
  'preview.loading': 'Loading…',
  'preview.error': 'Failed to read',
  'preview.copy': 'Copy',
  'preview.copied': 'Copied',
  'preview.footnotes': 'Footnotes',
  'preview.treeLabel': 'JSON tree',
  'tree.fileCount': '{count} files',
  'tree.shared': 'Dataset-level shared',
  'tree.unprotected': 'not whitelist-protected',
  'tree.agentReadable': 'agent-readable',
  'tree.passthrough': 'Passthrough · {count} files · not whitelist-protected',
  'tree.passthroughShort': 'Passthrough',
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
}
