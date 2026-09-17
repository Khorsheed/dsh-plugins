/**
 * The reader's dictionaries. Keys are referenced as translation ids from the
 * pane and the tab definition, so adding a key here is what makes it usable.
 *
 * @module @khorsheed/dsh-reader/client/locales
 */
export const NS = 'reader'

/** The reader dictionary key set (the source of truth for both locales). */
export type ReaderKey =
  | 'tab.label' | 'tab.subtitle' | 'guide.description'
  | 'filter.today' | 'filter.all' | 'filter.unreadOnly' | 'filter.unreadOn'
  | 'search.placeholder'
  | 'sort.title' | 'sort.newest' | 'sort.oldest' | 'sort.source'
  | 'action.refresh' | 'action.refreshOne' | 'action.add' | 'action.back'
  | 'action.copyLink' | 'action.openExternal' | 'action.quote' | 'action.manage'
  | 'action.remove' | 'action.submit'
  | 'add.title' | 'add.help' | 'add.placeholder'
  | 'verdict.subscribed' | 'verdict.savedLink' | 'verdict.duplicate'
  | 'verdict.invalidUrl' | 'verdict.unsupportedContent' | 'verdict.fetchFailed'
  | 'state.loading' | 'state.emptyTitle' | 'state.emptyBody' | 'state.noMatch'
  | 'state.fetching' | 'state.incomplete' | 'state.error' | 'state.stale'
  | 'detail.incomplete' | 'detail.readOriginal' | 'detail.extractFailed'
  | 'detail.alsoFrom' | 'detail.composerLabel' | 'detail.composerEmpty'
  | 'foot.refreshedAt' | 'foot.scheduled' | 'foot.never' | 'foot.unread'
  | 'quote.copied' | 'quote.copyFailed' | 'quote.quoted'
  | 'quote.toSideChat' | 'quote.sideChatUnavailable'
  | 'when.justNow' | 'when.minutes' | 'when.hours' | 'when.yesterday' | 'when.days'

export const en = {
  'tab.label': 'Reader',
  'tab.subtitle': 'Subscriptions and saved links',
  'guide.description': 'RSS/Atom subscriptions plus any article link you save',

  'filter.today': 'Today',
  'filter.all': 'All',
  'filter.unreadOnly': 'Unread only',
  'filter.unreadOn': 'Showing unread only',
  'search.placeholder': 'Search titles, authors, sources…',
  'sort.title': 'Sort',
  'sort.newest': 'Newest first',
  'sort.oldest': 'Oldest first',
  'sort.source': 'Group by source',

  'action.refresh': 'Refresh all',
  'action.refreshOne': 'Refresh',
  'action.add': 'Add a feed or link',
  'action.back': 'Back to list',
  'action.copyLink': 'Copy link',
  'action.openExternal': 'Open in browser',
  'action.quote': 'Quote',
  'action.manage': 'Manage sources',
  'action.remove': 'Remove',
  'action.submit': 'Fetch',

  'add.title': 'Add',
  'add.help': 'Paste a feed address or any article link. What comes back decides how it is stored: a feed becomes a subscription, a web page is saved as a single item.',
  'add.placeholder': 'https://',
  'verdict.subscribed': 'Subscribed to {label} — it will refresh on schedule.',
  'verdict.savedLink': 'Saved this article — one item, no subscription.',
  'verdict.duplicate': 'That source is already in the list.',
  'verdict.invalidUrl': 'That is not an http(s) address.',
  'verdict.unsupportedContent': 'That address did not return a feed or an article.',
  'verdict.fetchFailed': 'Could not fetch that address.',

  'state.loading': 'Loading…',
  'state.emptyTitle': 'Nothing here yet',
  'state.emptyBody': 'Add a feed address, or paste a link to an article you want to keep.',
  'state.noMatch': 'Nothing matches “{query}”.',
  'state.fetching': 'Fetching…',
  'state.incomplete': 'Incomplete',
  'state.error': 'Failed',
  'state.stale': 'Refresh failed: {message}',

  'detail.incomplete': 'Limited length, content shown in part',
  'detail.readOriginal': 'Read the original',
  'detail.extractFailed': 'Could not extract the body locally — the page is larger than the host fetch cap.',
  'detail.alsoFrom': 'Also from this source',
  'detail.composerLabel': 'Current conversation draft',
  'detail.composerEmpty': '(empty)',

  'foot.refreshedAt': 'Refreshed {when}',
  'foot.scheduled': 'daily {time}',
  'foot.never': 'Not refreshed yet',
  'foot.unread': 'unread',

  'quote.copied': 'Copied',
  'quote.copyFailed': 'Could not reach the clipboard',
  'quote.quoted': 'Quoted {count} characters',
  'quote.toSideChat': 'Sent to side chat',
  'quote.sideChatUnavailable': 'No side chat in this composition',

  'when.justNow': 'just now',
  'when.minutes': '{count} min ago',
  'when.hours': '{count} h ago',
  'when.yesterday': 'yesterday',
  'when.days': '{count} d ago',
}

export const zh = {
  'tab.label': '阅读',
  'tab.subtitle': '订阅源与保存的链接',
  'guide.description': 'RSS/Atom 订阅，加上你保存的任意文章链接',

  'filter.today': '今日',
  'filter.all': '全部',
  'filter.unreadOnly': '只看未读',
  'filter.unreadOn': '只看未读',
  'search.placeholder': '搜索标题、作者、来源…',
  'sort.title': '排序',
  'sort.newest': '最新在前',
  'sort.oldest': '最早在前',
  'sort.source': '按来源分组',

  'action.refresh': '刷新全部',
  'action.refreshOne': '刷新',
  'action.add': '新增订阅源或链接',
  'action.back': '返回列表',
  'action.copyLink': '复制链接',
  'action.openExternal': '在浏览器打开原文',
  'action.quote': '引用',
  'action.manage': '订阅管理',
  'action.remove': '删除',
  'action.submit': '抓取',

  'add.title': '新增',
  'add.help': '粘贴订阅源地址或任意文章链接。抓回来是什么，就按什么处理：是 feed 就订阅，是网页就只存这一篇。',
  'add.placeholder': 'https://',
  'verdict.subscribed': '已订阅《{label}》—— 会按计划自动刷新。',
  'verdict.savedLink': '已保存这篇 —— 只存这一条，不建订阅源。',
  'verdict.duplicate': '这个源已经在列表里了。',
  'verdict.invalidUrl': '这不是 http(s) 地址。',
  'verdict.unsupportedContent': '这个地址返回的既不是订阅源也不是网页。',
  'verdict.fetchFailed': '抓取失败。',

  'state.loading': '加载中…',
  'state.emptyTitle': '还没有内容',
  'state.emptyBody': '添加一个订阅源地址，或粘贴一篇你想留住的文章链接。',
  'state.noMatch': '没有匹配「{query}」的条目。',
  'state.fetching': '抓取中…',
  'state.incomplete': '未完整',
  'state.error': '失败',
  'state.stale': '刷新失败：{message}',

  'detail.incomplete': '受限篇幅，内容未完整呈现',
  'detail.readOriginal': '阅读原文',
  'detail.extractFailed': '无法在本地提取正文 —— 页面超过宿主单次抓取的上限。',
  'detail.alsoFrom': '同一来源',
  'detail.composerLabel': '当前会话草稿',
  'detail.composerEmpty': '（空）',

  'foot.refreshedAt': '刷出于 {when}',
  'foot.scheduled': '每日 {time}',
  'foot.never': '尚未刷新',
  'foot.unread': '未读',

  'quote.copied': '已复制',
  'quote.copyFailed': '剪贴板不可用',
  'quote.quoted': '已引用 {count} 字',
  'quote.toSideChat': '已发送到侧边对话',
  'quote.sideChatUnavailable': '当前组合里没有侧边对话',

  'when.justNow': '刚刚',
  'when.minutes': '{count} 分钟前',
  'when.hours': '{count} 小时前',
  'when.yesterday': '昨天',
  'when.days': '{count} 天前',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The reader tab's copy. */
    'reader': ReaderKey
  }
}
