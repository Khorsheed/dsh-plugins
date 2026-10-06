/**
 * The library's dictionaries. Keys are referenced as translation ids from the
 * pane and the tab definition, so adding a key here is what makes it usable.
 *
 * @module @khorsheed/dsh-library/client/locales
 */
export const NS = 'library'

/** The library's dictionary key set (the source of truth for both locales). */
export type LibraryKey =
  | 'tab.label' | 'guide.description'
  | 'state.loading' | 'state.error' | 'state.emptyProjectsTitle' | 'state.emptyProjectsBody'
  | 'wall.title' | 'wall.meta' | 'wall.newProject' | 'wall.progress'
  | 'wall.dueSection' | 'wall.dueBadge' | 'wall.currentAt' | 'wall.cardMeta' | 'wall.cardDue'
  | 'project.booksSection' | 'project.drop' | 'project.dropHint' | 'project.ingesting' | 'project.tocSection'
  | 'project.deleteTitle' | 'project.deleteConfirm' | 'project.back' | 'project.meta' | 'project.bookMeta'
  | 'project.noBooks'
  | 'book.roadmapSection' | 'book.regenerate' | 'book.regenerateTitle' | 'book.regenerateDone'
  | 'book.noRoadmap' | 'book.nodeGoals' | 'book.nodeChapters' | 'book.unlockRule' | 'book.meta'
  | 'book.stateDone' | 'book.stateCurrent' | 'book.stateLocked' | 'book.score'
  | 'vocab.title' | 'vocab.meta' | 'vocab.search' | 'vocab.box' | 'vocab.due' | 'vocab.photo'
  | 'vocab.keypoint' | 'vocab.empty'
  | 'ingest.failed' | 'ingest.notZip' | 'ingest.notEpub' | 'ingest.encrypted' | 'ingest.noSpine'
  | 'ingest.noChapters' | 'ingest.empty' | 'ingest.tooLarge' | 'ingest.done'
  | 'newProject.title' | 'newProject.namePlaceholder' | 'newProject.domainPlaceholder'
  | 'action.submit' | 'action.cancel' | 'action.refresh'

export const en = {
  'tab.label': 'Library',
  'guide.description': 'Deep-reading projects: books, roadmaps, the vocab book and quizzes',

  'state.loading': 'Loading…',
  'state.error': 'Something went wrong: {reason}',
  'state.emptyProjectsTitle': 'No learning project yet',
  'state.emptyProjectsBody': 'Create one for a subject — a book to read closely, a vocab book that grows with it.',

  'wall.title': 'Library',
  'wall.meta': '{projects} projects · {books} books · {vocab} cards',
  'wall.newProject': 'New learning project',
  'wall.progress': 'Roadmap {percent}%',
  'wall.dueSection': 'Due for review · {count}',
  'wall.dueBadge': 'due',
  'wall.currentAt': 'Reading {book} · {node}',
  'wall.cardMeta': '{books} books · {vocab} cards',
  'wall.cardDue': '{count} due',

  'project.booksSection': 'Books · {count}',
  'project.meta': '{books} books · {vocab} cards',
  'project.bookMeta': '{format} · {chapters} chapters',
  'project.noBooks': 'No books yet — drop an EPUB or Markdown file above.',
  'project.drop': 'Drop an EPUB / Markdown file, or click to choose',
  'project.dropHint': 'PDF is not supported (structure extraction is unreliable)',
  'project.ingesting': 'Parsing {name}…',
  'project.tocSection': '{title} · contents',
  'project.deleteTitle': 'Delete the project and everything it holds',
  'project.deleteConfirm': 'Delete 「{name}」 for good? Its books, vocab book and quizzes go with it.',
  'project.back': 'Back to the library',

  'book.roadmapSection': 'Learning path · {done}/{total}',
  'book.regenerate': 'Re-split',
  'book.regenerateTitle': 'Ask the coach to split the book again (the conversation does the splitting)',
  'book.regenerateDone': 'The request is in the conversation draft — send it to re-split',
  'book.noRoadmap': 'No roadmap yet — ask the coach in a learning-mode session to split this book.',
  'book.nodeGoals': '{count} goals',
  'book.nodeChapters': 'Ch. {range}',
  'book.unlockRule': 'Quiz ≥ {percent}% to unlock',
  'book.stateDone': 'done',
  'book.stateCurrent': 'current',
  'book.stateLocked': 'locked',
  'book.score': '{score}',
  'book.meta': '{chapters} chapters · {nodes} nodes · {percent}%',

  'vocab.title': 'Vocab · {project}',
  'vocab.meta': '{count} cards · {due} due',
  'vocab.search': 'Search terms…',
  'vocab.box': 'box {box}',
  'vocab.due': 'due',
  'vocab.photo': 'photo',
  'vocab.keypoint': 'key point',
  'vocab.empty': 'No cards yet — the coach logs them as you read together.',

  'ingest.failed': 'Ingest failed: {reason}',
  'ingest.notZip': 'not a zip archive — an EPUB is one',
  'ingest.notEpub': 'not an EPUB (no mimetype marker)',
  'ingest.encrypted': 'DRM-encrypted EPUBs cannot be read',
  'ingest.noSpine': 'the EPUB declares no reading order (no spine)',
  'ingest.noChapters': 'no readable chapter came out of it',
  'ingest.empty': 'the file is empty',
  'ingest.tooLarge': 'the file is too large ({size} MB)',
  'ingest.done': '《{title}》 is on the shelf — {count} chapters',

  'newProject.title': 'New learning project',
  'newProject.namePlaceholder': 'Subject (神经科学, 雅思英语…)',
  'newProject.domainPlaceholder': 'Domain, optional (neuroscience, IELTS…)',

  'action.submit': 'Create',
  'action.cancel': 'Cancel',
  'action.refresh': 'Reload',
}

export const zh = {
  'tab.label': '图书馆',
  'guide.description': '精读学习项目：书籍、路线图、词书与测验',

  'state.loading': '加载中…',
  'state.error': '出错了：{reason}',
  'state.emptyProjectsTitle': '还没有学习项目',
  'state.emptyProjectsBody': '为一个主题建一个项目 —— 一本要精读的书，一本随读随长的词书。',

  'wall.title': '图书馆',
  'wall.meta': '{projects} 项目 · {books} 本书 · {vocab} 词卡',
  'wall.newProject': '新建学习项目',
  'wall.progress': '路线 {percent}%',
  'wall.dueSection': '待复习 · {count} 词条到期',
  'wall.dueBadge': '到期',
  'wall.currentAt': '在读《{book}》· {node}',
  'wall.cardMeta': '{books} 本书 · 词卡 {vocab}',
  'wall.cardDue': '{count} 到期',

  'project.booksSection': '书籍 · {count}',
  'project.meta': '{books} 本书 · 词卡 {vocab}',
  'project.bookMeta': '{format} · {chapters} 章',
  'project.noBooks': '还没有书 —— 把 EPUB 或 Markdown 拖到上方。',
  'project.drop': '拖入 EPUB / Markdown，或点击选择文件',
  'project.dropHint': 'PDF 暂不支持（结构提取不可靠）',
  'project.ingesting': '正在解析 {name}…',
  'project.tocSection': '《{title}》目录',
  'project.deleteTitle': '删除项目及其全部内容',
  'project.deleteConfirm': '确定删除「{name}」？书籍、词书与测验一并删除。',
  'project.back': '返回图书馆',

  'book.roadmapSection': '学习路线 · {done}/{total}',
  'book.regenerate': '重新拆书',
  'book.regenerateTitle': '让教练在会话里重新拆这本书（拆书由模型完成）',
  'book.regenerateDone': '请求已放进会话草稿 —— 发送即可重新拆书',
  'book.noRoadmap': '还没有路线图 —— 在学习模式会话里让教练拆这本书。',
  'book.nodeGoals': '{count} 个目标',
  'book.nodeChapters': '第 {range} 章',
  'book.unlockRule': '随堂测 ≥ {percent}% 解锁',
  'book.stateDone': '已完成',
  'book.stateCurrent': '当前',
  'book.stateLocked': '锁定',
  'book.score': '{score} 分',
  'book.meta': '{chapters} 章 · {nodes} 节点 · {percent}%',

  'vocab.title': '词书 · {project}',
  'vocab.meta': '{count} 卡 · {due} 到期',
  'vocab.search': '搜索词条…',
  'vocab.box': 'box {box}',
  'vocab.due': '到期',
  'vocab.photo': '照片',
  'vocab.keypoint': '重点',
  'vocab.empty': '还没有词卡 —— 和教练一起读，词条会随读随记。',

  'ingest.failed': '摄入失败：{reason}',
  'ingest.notZip': '不是 zip 归档 —— EPUB 应该是',
  'ingest.notEpub': '不是 EPUB（缺少 mimetype 标记）',
  'ingest.encrypted': 'DRM 加密的 EPUB 读不了',
  'ingest.noSpine': 'EPUB 没有声明阅读顺序（缺 spine）',
  'ingest.noChapters': '没有解析出可读的章节',
  'ingest.empty': '文件是空的',
  'ingest.tooLarge': '文件太大（{size} MB）',
  'ingest.done': '《{title}》已上架 —— {count} 章',

  'newProject.title': '新建学习项目',
  'newProject.namePlaceholder': '主题（神经科学、雅思英语…）',
  'newProject.domainPlaceholder': '领域，可选（neuroscience、IELTS…）',

  'action.submit': '创建',
  'action.cancel': '取消',
  'action.refresh': '重新加载',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The library's copy. */
    'library': LibraryKey
  }
}
