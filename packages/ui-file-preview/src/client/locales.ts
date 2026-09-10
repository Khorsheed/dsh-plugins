/** `filePreview` namespace dictionaries (right-Sidebar tab + turn card copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'filePreview'

/** The file-preview dictionary key set (the source of truth for both locales). */
export type FilePreviewKey =
  | 'open'
  | 'guide.title'
  | 'guide.description'
  | 'view.search.placeholder'
  | 'view.search.noMatch'
  | 'list.empty'
  | 'list.error'
  | 'list.loading'
  | 'list.outsideWorkspace'
  | 'list.refresh'
  | 'history.title'
  | 'history.empty'
  | 'history.step'
  | 'history.step.count'
  | 'history.step.latest'
  | 'history.step.older'
  | 'history.step.newer'
  | 'row.copyPath'
  | 'row.copied'
  | 'row.openFolder'
  | 'row.openIde'
  | 'turn.summary'
  | 'turn.summaryOne'
  | 'turn.expand'
  | 'turn.collapse'
  | 'diff.copy'
  | 'diff.copied'
  | 'diff.collapse'
  | 'diff.collapseAria'
  | 'diff.expand'
  | 'diff.expandAria'
  | 'diff.files'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The file-preview tab and turn card copy. */
    'filePreview': FilePreviewKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<FilePreviewKey, string> = {
  'open': '产物',
  'guide.title': '会话产物',
  'guide.description': '本会话写入或修改的文件，含逐次改动记录',
  'view.search.placeholder': '搜索文件…',
  'view.search.noMatch': '没有匹配的文件',
  'list.empty': '这个会话还没有写过文件',
  'list.error': '文件列表加载失败',
  'list.loading': '加载中…',
  'list.outsideWorkspace': '位于工作区外，无内容预览',
  'list.refresh': '刷新',
  'history.title': '改动记录',
  'history.empty': '该文件没有记录到改动内容',
  'history.step': '第 {turn} 轮 · 第 {step} 步',
  'history.step.count': '修改 {current}/{total}',
  'history.step.latest': '最新',
  'history.step.older': '查看更早的修改',
  'history.step.newer': '查看更新的修改',
  'row.copyPath': '复制路径',
  'row.copied': '已复制',
  'row.openFolder': '在文件夹中打开',
  'row.openIde': '在 IDE 打开',
  'turn.summary': '{count} 个文件已修改',
  'turn.summaryOne': '1 个文件已修改',
  'turn.expand': '展开其余 {count} 个',
  'turn.collapse': '收起',
  'diff.copy': '复制差异',
  'diff.copied': '已复制',
  'diff.collapse': '收起',
  'diff.collapseAria': '收起差异',
  'diff.expand': '展开其余 {count} 行',
  'diff.expandAria': '展开其余 {count} 行',
  'diff.files': '{count} 个文件',
}

/** English dictionary. */
export const en: Record<FilePreviewKey, string> = {
  'open': 'Produced',
  'guide.title': 'Session products',
  'guide.description': 'Files this session wrote or edited, with per-change history',
  'view.search.placeholder': 'Search files…',
  'view.search.noMatch': 'No matching files',
  'list.empty': 'This session has not written any files yet',
  'list.error': 'Failed to load the file list',
  'list.loading': 'Loading…',
  'list.outsideWorkspace': 'Outside the workspace — no content preview',
  'list.refresh': 'Refresh',
  'history.title': 'Change history',
  'history.empty': 'No change content recorded for this file',
  'history.step': 'Turn {turn} · Step {step}',
  'history.step.count': 'Change {current}/{total}',
  'history.step.latest': 'latest',
  'history.step.older': 'View an earlier change',
  'history.step.newer': 'View a newer change',
  'row.copyPath': 'Copy path',
  'row.copied': 'Copied',
  'row.openFolder': 'Show in folder',
  'row.openIde': 'Open in IDE',
  'turn.summary': '{count} files changed',
  'turn.summaryOne': '1 file changed',
  'turn.expand': 'Show {count} more',
  'turn.collapse': 'Collapse',
  'diff.copy': 'Copy diff',
  'diff.copied': 'Copied',
  'diff.collapse': 'Collapse',
  'diff.collapseAria': 'Collapse the diff',
  'diff.expand': 'Show {count} more lines',
  'diff.expandAria': 'Show {count} more lines',
  'diff.files': '{count} files',
}
