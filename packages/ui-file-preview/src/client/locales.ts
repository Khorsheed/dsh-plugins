/** `filePreview` namespace dictionaries (drawer copy). */

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
  | 'turn.summary'
  | 'turn.summaryOne'
  | 'turn.expand'
  | 'turn.collapse'
  | 'drawer.title'
  | 'drawer.close'
  | 'drawer.openFolder'
  | 'drawer.openIde'
  | 'drawer.action.folder'
  | 'drawer.action.ide'
  | 'drawer.copyPath'
  | 'drawer.copied'
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
  | 'drawer.empty'
  | 'drawer.listError'
  | 'drawer.count'
  | 'drawer.op.read'
  | 'drawer.op.write'
  | 'drawer.op.edit'
  | 'drawer.step'
  | 'drawer.step.count'
  | 'drawer.step.latest'
  | 'drawer.step.older'
  | 'drawer.step.newer'
  | 'drawer.resize'
  | 'drawer.pin'
  | 'drawer.unpin'
  | 'drawer.previewEmpty'
  | 'drawer.loading'
  | 'drawer.kind.binary'
  | 'drawer.kind.missing'
  | 'drawer.kind.tooLarge'
  | 'drawer.kind.error'
  | 'drawer.truncated'
  | 'drawer.tab.diff'
  | 'drawer.tab.content'
  | 'drawer.missingPath'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The file-preview view copy. */
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
  'turn.summary': '{count} 个文件已修改',
  'turn.summaryOne': '1 个文件已修改',
  'turn.expand': '展开其余 {count} 个',
  'turn.collapse': '收起',
  'drawer.title': '文件预览',
  'drawer.close': '关闭',
  'drawer.pin': '固定抽屉（切换会话不收回）',
  'drawer.resize': '拖动调整抽屉宽度',
  'drawer.unpin': '取消固定（切换会话自动收回）',
  'drawer.openFolder': '在文件夹中打开',
  'drawer.openIde': '在 IDE 打开',
  'drawer.action.folder': '文件夹',
  'drawer.action.ide': 'IDE',
  'drawer.copyPath': '复制路径',
  'drawer.copied': '已复制',
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
  'drawer.empty': '这个会话还没有写过文件',
  'drawer.listError': '文件列表加载失败',
  'drawer.count': '{count} 个文件',
  'drawer.op.read': '阅读',
  'drawer.op.write': '新建',
  'drawer.op.edit': '修改',
  'drawer.step': '第 {turn} 轮 · 第 {step} 步',
  'drawer.step.count': '修改 {current}/{total}',
  'drawer.step.latest': '最新',
  'drawer.step.older': '查看更早的修改',
  'drawer.step.newer': '查看更新的修改',
  'drawer.previewEmpty': '选择一个文件查看内容',
  'drawer.loading': '加载中…',
  'drawer.kind.binary': '二进制文件，无法预览',
  'drawer.kind.missing': '文件不存在',
  'drawer.kind.tooLarge': '文件过大，仅显示大小',
  'drawer.kind.error': '读取失败',
  'drawer.truncated': '内容已截断',
  'drawer.tab.diff': '改动记录',
  'drawer.tab.content': '当前内容',
  'drawer.missingPath': '记录路径：{path}',
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
  'turn.summary': '{count} files changed',
  'turn.summaryOne': '1 file changed',
  'turn.expand': 'Show {count} more',
  'turn.collapse': 'Collapse',
  'drawer.title': 'File preview',
  'drawer.close': 'Close',
  'drawer.pin': 'Pin drawer (keep across session switches)',
  'drawer.resize': 'Drag to resize the drawer',
  'drawer.unpin': 'Unpin (collapse on session switch)',
  'drawer.openFolder': 'Show in folder',
  'drawer.openIde': 'Open in IDE',
  'drawer.action.folder': 'Folder',
  'drawer.action.ide': 'IDE',
  'drawer.copyPath': 'Copy path',
  'drawer.copied': 'Copied',
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
  'drawer.empty': 'This session has not written any files yet',
  'drawer.listError': 'Failed to load the file list',
  'drawer.count': '{count} files',
  'drawer.op.read': 'Read',
  'drawer.op.write': 'Created',
  'drawer.op.edit': 'Edited',
  'drawer.step': 'Turn {turn} · Step {step}',
  'drawer.step.count': 'Change {current}/{total}',
  'drawer.step.latest': 'latest',
  'drawer.step.older': 'View an earlier change',
  'drawer.step.newer': 'View a newer change',
  'drawer.previewEmpty': 'Select a file to preview',
  'drawer.loading': 'Loading…',
  'drawer.kind.binary': 'Binary file; preview unavailable',
  'drawer.kind.missing': 'File not found',
  'drawer.kind.tooLarge': 'File too large; size only',
  'drawer.kind.error': 'Failed to read',
  'drawer.truncated': 'Content truncated',
  'drawer.tab.diff': 'Change history',
  'drawer.tab.content': 'Current content',
  'drawer.missingPath': 'Recorded path: {path}',
}
