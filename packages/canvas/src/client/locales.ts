/** `canvas` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.label': '灵感画布',
  'guide.description': '灵感列表与写作区，稿子就是你自己目录里的 markdown 文件',

  'mode.edit': '编辑',
  'mode.preview': '预览',
  'mode.split': '并排',

  'meta.article': '文章',
  'meta.card': '灵感卡片',
  'meta.words': '{count} 字',

  'new.label': '新建',
  'new.article': '文章',
  'new.card': '灵感卡片',
  'new.articlePlaceholder': '文章叫什么？',
  'new.cardPlaceholder': '这张卡片写什么？',
  'new.confirm': '建立',
  'new.cancel': '取消',

  'list.fold': '收起列表',
  'list.unfold': '展开列表',
  'list.archived': '已归档 ({count})',
  'list.empty': '还没有灵感',
  'list.emptyHint': '点上面的「新建」开始',

  'action.archive': '归档',
  'action.restore': '恢复',
  'action.copyPath': '复制路径',
  'action.copied': '已复制',
  'action.convert': '选中转表格',

  'state.loading': '加载中…',
  'state.saveSaving': '保存中…',
  'state.saveSaved': '已保存',
  'state.saveConflict': '文件已被外部修改，本次保存已停下',
  'workspace.none': '该会话还没有工作区目录',

  'toast.created': '已创建 {name}',
  'toast.archived': '已归档「{title}」，文件未改动',
  'toast.restored': '已恢复「{title}」',
  'toast.copied': '已复制绝对路径',
  'toast.copyFailed': '剪贴板不可用，请手动复制',
  'toast.tableHtml': '已把 HTML 表格转成 markdown 表格',
  'toast.tableTsv': '已把制表符内容转成 markdown 表格',
  'toast.notTable': '未识别为表格，按原样粘贴',
  'toast.converted': '已把选中内容转成表格',
  'toast.convertNeedSelection': '先选中要转换的文字',
  'toast.convertNeedRows': '至少两行才能构成表格',
  'toast.needTitle': '给它起个名字',
  'toast.splitFolded': '并排时已自动收起列表',

  'error.exists': '同名灵感已存在',
  'error.stale': '文件在别处被改过了，请重新打开再改',
  'error.missing': '这条灵感已经不在了',
  'error.invalidName': '这个名字不能用作文件名',
  'error.denied': '这个位置不可写',
  'error.io': '读写失败',
  'error.read': '读取失败：{message}',
  'error.write': '保存失败：{message}',
  'error.unknown': '未知错误',

  'markdown.copy': '复制',
  'markdown.copied': '已复制',
  'markdown.footnotes': '脚注',
}

/** English dictionary (same key set). */
export const en: Record<keyof typeof zh, string> = {
  'tab.label': 'Inspiration canvas',
  'guide.description': 'The inspiration list and writing surface — your drafts are markdown files in your own folder',

  'mode.edit': 'Edit',
  'mode.preview': 'Preview',
  'mode.split': 'Split',

  'meta.article': 'Article',
  'meta.card': 'Card',
  'meta.words': '{count} words',

  'new.label': 'New',
  'new.article': 'Article',
  'new.card': 'Inspiration card',
  'new.articlePlaceholder': 'What is the article called?',
  'new.cardPlaceholder': 'What is on this card?',
  'new.confirm': 'Create',
  'new.cancel': 'Cancel',

  'list.fold': 'Collapse list',
  'list.unfold': 'Expand list',
  'list.archived': 'Archived ({count})',
  'list.empty': 'No inspirations yet',
  'list.emptyHint': 'Use “New” above to start one',

  'action.archive': 'Archive',
  'action.restore': 'Restore',
  'action.copyPath': 'Copy path',
  'action.copied': 'Copied',
  'action.convert': 'Selection to table',

  'state.loading': 'Loading…',
  'state.saveSaving': 'Saving…',
  'state.saveSaved': 'Saved',
  'state.saveConflict': 'The file changed elsewhere; this save stopped',
  'workspace.none': 'This session has no workspace directory yet',

  'toast.created': 'Created {name}',
  'toast.archived': 'Archived “{title}” — the file was not touched',
  'toast.restored': 'Restored “{title}”',
  'toast.copied': 'Absolute path copied',
  'toast.copyFailed': 'Clipboard unavailable; copy it by hand',
  'toast.tableHtml': 'HTML table converted to a markdown table',
  'toast.tableTsv': 'Tab-separated content converted to a markdown table',
  'toast.notTable': 'Not a table — pasted as-is',
  'toast.converted': 'Selection converted to a table',
  'toast.convertNeedSelection': 'Select the text to convert first',
  'toast.convertNeedRows': 'A table needs at least two rows',
  'toast.needTitle': 'Give it a name',
  'toast.splitFolded': 'List collapsed for split view',

  'error.exists': 'An inspiration with that name already exists',
  'error.stale': 'The file changed elsewhere — reopen it before editing',
  'error.missing': 'That inspiration is gone',
  'error.invalidName': 'That name cannot be a file name',
  'error.denied': 'That location is not writable',
  'error.io': 'Read/write failed',
  'error.read': 'Read failed: {message}',
  'error.write': 'Save failed: {message}',
  'error.unknown': 'Unknown error',

  'markdown.copy': 'Copy',
  'markdown.copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
}

/** The dictionary namespace this view binds. */
export const NS = 'canvas'

/** The canvas namespace key union (`zh` is the key-set source of truth). */
export type CanvasKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The inspiration canvas tab copy. */
    'canvas': CanvasKey
  }
}
