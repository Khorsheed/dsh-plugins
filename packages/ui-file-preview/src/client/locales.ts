/** `filePreview` namespace dictionaries (right-Sidebar tab + document renderer + turn card copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'filePreview'

/** The file-preview dictionary key set (the source of truth for both locales). */
export type FilePreviewKey =
  | 'open'
  | 'view.search.placeholder'
  | 'view.search.noMatch'
  | 'preview.search.placeholder'
  | 'preview.search.noMatch'
  | 'preview.search.prev'
  | 'preview.search.next'
  | 'preview.htmlToggle'
  | 'preview.htmlSource'
  | 'preview.htmlRender'
  | 'preview.htmlScript'
  | 'preview.htmlScriptStop'
  | 'preview.scriptConfirm'
  | 'preview.scriptRun'
  | 'preview.scriptCancel'
  | 'preview.slowHint'
  | 'preview.fullscreen'
  | 'preview.exitFullscreen'
  | 'preview.staticHint'
  | 'turn.count'
  | 'turn.summary'
  | 'turn.summaryOne'
  | 'turn.expand'
  | 'turn.collapse'
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
  | 'json.treeLabel'
  | 'markdown.copy'
  | 'markdown.copied'
  | 'markdown.footnotes'
  | 'drawer.kind.binary'
  | 'drawer.kind.missing'
  | 'drawer.kind.tooLarge'
  | 'drawer.kind.error'
  | 'drawer.truncated'
  | 'drawer.tab.diff'
  | 'drawer.tab.content'
  | 'drawer.missingPath'
  | 'diff.copy'
  | 'diff.copied'
  | 'diff.collapse'
  | 'diff.collapseAria'
  | 'diff.expand'
  | 'diff.expandAria'
  | 'diff.files'
  | 'diff.code'
  | 'diff.wrap'
  | 'diff.unwrap'
  | 'guide.title'
  | 'guide.description'
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
  | 'row.openIdeIn'
  | 'row.openIdeMore'
  | 'detail.back'
  | 'mention.open'
  // Printed by the shared content pane (@khorsheed/dsh-client-ui-content-preview).
  | 'action.chooseIDE'
  | 'action.copy'
  | 'action.copied'
  | 'action.copyPath'
  | 'action.openFolder'
  | 'action.openIDE'
  | 'detail.content'
  | 'detail.deleted'
  | 'detail.diff'
  | 'detail.noSelection'
  | 'detail.preview'
  | 'detail.source'
  | 'local.binary'
  | 'local.noSelection'
  | 'local.tooLarge'
  | 'local.unreadable'
  | 'search.hit'
  | 'search.next'
  | 'search.noMatch'
  | 'search.placeholder'
  | 'search.prev'
  | 'state.error'
  | 'state.loading'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The file-preview tab, document renderer, and turn card copy. */
    'filePreview': FilePreviewKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<FilePreviewKey, string> = {
  'open': '产物',
  'view.search.placeholder': '搜索文件…',
  'view.search.noMatch': '没有匹配的文件',
  'preview.search.placeholder': '搜索文件内容…',
  'preview.search.noMatch': '没有匹配内容',
  'preview.search.prev': '上一个匹配',
  'preview.search.next': '下一个匹配',
  'preview.htmlToggle': 'HTML 视图',
  'preview.htmlSource': '源码',
  'preview.htmlRender': '渲染',
  'preview.htmlScript': '运行脚本',
  'preview.htmlScriptStop': '停止运行',
  'preview.scriptConfirm': '此文件含脚本，将在隔离沙箱中运行（无网络、无法访问宿主）',
  'preview.scriptRun': '运行',
  'preview.scriptCancel': '取消',
  'preview.slowHint': '渲染超时——文档可能过大，可切源码视图或在浏览器中打开',
  'preview.fullscreen': '全屏',
  'preview.exitFullscreen': '退出全屏',
  'preview.staticHint': '静态预览：此页面含脚本，脚本不会运行——点右上角「运行脚本」可交互',
  'turn.count': '{count} 个产物',
  'turn.summary': '{count} 个文件已修改',
  'turn.summaryOne': '1 个文件已修改',
  'turn.expand': '展开其余 {count} 个',
  'turn.collapse': '收起',
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
  'json.treeLabel': 'JSON 结构',
  'markdown.copy': '复制',
  'markdown.copied': '已复制',
  'markdown.footnotes': '脚注',
  'drawer.kind.binary': '二进制文件，无法预览',
  'drawer.kind.missing': '文件不存在',
  'drawer.kind.tooLarge': '文件过大，仅显示大小',
  'drawer.kind.error': '读取失败',
  'drawer.truncated': '内容已截断',
  'drawer.tab.diff': '改动记录',
  'drawer.tab.content': '当前内容',
  'drawer.missingPath': '记录路径：{path}',
  'diff.copy': '复制差异',
  'diff.copied': '已复制',
  'diff.collapse': '收起',
  'diff.collapseAria': '收起差异',
  'diff.expand': '展开其余 {count} 行',
  'diff.expandAria': '展开其余 {count} 行',
  'diff.files': '{count} 个文件',
  'diff.code': '代码块',
  'diff.wrap': '自动换行',
  'diff.unwrap': '取消自动换行',
  'guide.title': '会话产物',
  'guide.description': '会话写过的每个文件：看内容，也看每一次改动',
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
  'row.openIdeIn': '在 {app} 打开',
  'row.openIdeMore': '选择应用打开',
  'detail.back': '返回产物列表',
  'mention.open': '在侧边栏打开 {name}',

  // The shared content pane's keys (see the header note above).
  'action.chooseIDE': '选择 IDE',
  'action.copy': '复制',
  'action.copied': '已复制',
  'action.copyPath': '复制路径',
  'action.openFolder': '打开目录',
  'action.openIDE': '在 IDE 中打开',
  'detail.content': '内容',
  'detail.deleted': '文件已删除',
  'detail.diff': '改动',
  'detail.noSelection': '选择一个文件查看详情',
  'detail.preview': '预览',
  'detail.source': '源码',
  'local.binary': '二进制文件，无法预览文本',
  'local.noSelection': '选择一个文件预览内容',
  'local.tooLarge': '文件过大，未载入预览',
  'local.unreadable': '无法读取该文件',
  'search.hit': '匹配 {current}/{total}',
  'search.next': '下一个匹配',
  'search.noMatch': '无匹配',
  'search.placeholder': '在内容中搜索…',
  'search.prev': '上一个匹配',
  'state.error': '加载失败：{message}',
  'state.loading': '加载中…',
}

/** English dictionary. */
export const en: Record<FilePreviewKey, string> = {
  'open': 'Produced',
  'view.search.placeholder': 'Search files…',
  'view.search.noMatch': 'No matching files',
  'preview.search.placeholder': 'Search file content…',
  'preview.search.noMatch': 'No matching content',
  'preview.search.prev': 'Previous match',
  'preview.search.next': 'Next match',
  'preview.htmlToggle': 'HTML view',
  'preview.htmlSource': 'Source',
  'preview.htmlRender': 'Render',
  'preview.htmlScript': 'Run scripts',
  'preview.htmlScriptStop': 'Stop',
  'preview.scriptConfirm': 'This file contains scripts; they will run in an isolated sandbox (no network, no host access)',
  'preview.scriptRun': 'Run',
  'preview.scriptCancel': 'Cancel',
  'preview.slowHint': 'Render timed out — the document may be too large; try the source view or open it in a browser',
  'preview.fullscreen': 'Fullscreen',
  'preview.exitFullscreen': 'Exit fullscreen',
  'preview.staticHint': 'Static preview: this page contains scripts, which do not run here — use "Run scripts" above for interactivity',
  'turn.count': '{count} products',
  'turn.summary': '{count} files changed',
  'turn.summaryOne': '1 file changed',
  'turn.expand': 'Show {count} more',
  'turn.collapse': 'Collapse',
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
  'json.treeLabel': 'JSON structure',
  'markdown.copy': 'Copy',
  'markdown.copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
  'drawer.kind.binary': 'Binary file; preview unavailable',
  'drawer.kind.missing': 'File not found',
  'drawer.kind.tooLarge': 'File too large; size only',
  'drawer.kind.error': 'Failed to read',
  'drawer.truncated': 'Content truncated',
  'drawer.tab.diff': 'Change history',
  'drawer.tab.content': 'Current content',
  'drawer.missingPath': 'Recorded path: {path}',
  'diff.copy': 'Copy diff',
  'diff.copied': 'Copied',
  'diff.collapse': 'Collapse',
  'diff.collapseAria': 'Collapse the diff',
  'diff.expand': 'Show {count} more lines',
  'diff.expandAria': 'Show {count} more lines',
  'diff.files': '{count} files',
  'diff.code': 'Code block',
  'diff.wrap': 'Wrap lines',
  'diff.unwrap': 'Do not wrap lines',
  'guide.title': 'Session products',
  'guide.description': 'Every file the session wrote — its content and each change',
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
  'row.openIdeIn': 'Open in {app}',
  'row.openIdeMore': 'Choose an application',
  'detail.back': 'Back to products',
  'mention.open': 'Open {name} in the sidebar',

  // The shared content pane's keys (see the header note above).
  'action.chooseIDE': 'Choose IDE',
  'action.copy': 'Copy',
  'action.copied': 'Copied',
  'action.copyPath': 'Copy path',
  'action.openFolder': 'Open folder',
  'action.openIDE': 'Open in IDE',
  'detail.content': 'Content',
  'detail.deleted': 'File deleted',
  'detail.diff': 'Changes',
  'detail.noSelection': 'Select a file to view',
  'detail.preview': 'Preview',
  'detail.source': 'Source',
  'local.binary': 'Binary file — text preview unavailable',
  'local.noSelection': 'Select a file to preview',
  'local.tooLarge': 'File too large — not loaded into preview',
  'local.unreadable': 'This file could not be read',
  'search.hit': 'Match {current}/{total}',
  'search.next': 'Next match',
  'search.noMatch': 'No matches',
  'search.placeholder': 'Search in content…',
  'search.prev': 'Previous match',
  'state.error': 'Failed to load: {message}',
  'state.loading': 'Loading…',
}
