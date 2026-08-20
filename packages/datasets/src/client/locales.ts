/** `datasets` namespace dictionaries (the session tab copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'datasets'

/** The datasets tab dictionary key set (the source of truth for both locales). */
export type DatasetsKey =
  | 'open'
  | 'binding.none'
  | 'binding.repo'
  | 'binding.allDatasets'
  | 'binding.allLayers'
  | 'binding.bind'
  | 'binding.edit'
  | 'binding.unbind'
  | 'binding.form.title'
  | 'binding.form.repo'
  | 'binding.form.datasets'
  | 'binding.form.layers'
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
  | 'tree.fileCount'
  | 'tree.shared'
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
  'binding.allLayers': '全部 layers',
  'binding.bind': '绑定',
  'binding.edit': '改白名单',
  'binding.unbind': '解绑',
  'binding.form.title': '绑定数据集仓库',
  'binding.form.repo': '仓库路径（git 仓库）',
  'binding.form.datasets': '数据集白名单，逗号分隔（留空为全部）',
  'binding.form.layers': 'layers 白名单，逗号分隔（留空为全部）',
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
  'tree.fileCount': '{count} 个文件',
  'tree.shared': '共享',
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
  'binding.allLayers': 'all layers',
  'binding.bind': 'Bind',
  'binding.edit': 'Edit whitelist',
  'binding.unbind': 'Unbind',
  'binding.form.title': 'Bind a dataset repository',
  'binding.form.repo': 'Repository path (a git repository)',
  'binding.form.datasets': 'Dataset whitelist, comma-separated (empty = all)',
  'binding.form.layers': 'Layer whitelist, comma-separated (empty = all)',
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
  'tree.fileCount': '{count} files',
  'tree.shared': 'Shared',
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
