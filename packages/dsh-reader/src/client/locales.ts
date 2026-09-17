/**
 * The inspiration space's dictionaries. Keys are referenced as translation ids
 * from the pane and the tab definition, so adding a key here is what makes it
 * usable.
 *
 * The namespace stays `reader`: the package name, the tab kind and the Remote
 * namespace are stable identifiers, and renaming them would change a deployed
 * loader row and the on-disk state root for a copy change. What the reader
 * SEES is 「灵感空间」, which is what the surface became once saved links
 * joined subscriptions — a wall of things you chose to keep.
 *
 * @module @khorsheed/dsh-reader/client/locales
 */
export const NS = 'reader'

/** The inspiration space's dictionary key set (the source of truth for both locales). */
export type ReaderKey =
  | 'tab.label' | 'tab.subtitle' | 'guide.description'
  | 'filter.today' | 'filter.all' | 'filter.unreadOnly' | 'filter.unreadOn'
  | 'filter.readState' | 'filter.bySource' | 'filter.byTag' | 'action.filter'
  | 'action.fetchBody' | 'detail.bodyStale' | 'action.more' | 'action.addTag'
  | 'tag.title' | 'tag.placeholder'
  | 'search.placeholder'
  | 'sort.title' | 'sort.newest' | 'sort.oldest' | 'sort.source'
  | 'action.refresh' | 'action.refreshOne' | 'action.add' | 'action.back'
  | 'action.copyLink' | 'action.openExternal' | 'action.quote' | 'action.manage'
  | 'action.remove' | 'action.submit' | 'action.done' | 'action.cancel'
  | 'add.title' | 'add.help' | 'add.placeholder'
  | 'verdict.subscribed' | 'verdict.savedLink' | 'verdict.duplicate'
  | 'verdict.invalidUrl' | 'verdict.unsupportedContent' | 'verdict.fetchFailed'
  | 'state.loading' | 'state.emptyTitle' | 'state.emptyBody' | 'state.noMatch'
  | 'state.fetching' | 'state.incomplete' | 'state.error' | 'state.stale'
  | 'state.emptyWall' | 'state.incompleteReason'
  | 'sources.title' | 'sources.count' | 'sources.empty' | 'sources.help'
  | 'sources.enabled' | 'sources.disabled' | 'sources.time' | 'sources.timeHelp'
  | 'sources.failed' | 'sources.items' | 'sources.never' | 'sources.cardHint'
  | 'sources.name' | 'sources.url' | 'sources.cache' | 'sources.cacheHelp'
  | 'sources.cacheHours' | 'sources.cacheForever' | 'sources.blocked'
  | 'sources.unreachable' | 'sources.httpError' | 'detail.fetchFailed'
  | 'state.backfilling' | 'detail.filledIn' | 'detail.filledInBadge' | 'action.pause' | 'action.resume'
  | 'detail.incomplete' | 'detail.readOriginal' | 'detail.extractFailed'
  | 'detail.summaryOnly'
  | 'detail.alsoFrom' | 'detail.composerLabel' | 'detail.composerEmpty'
  | 'foot.refreshedAt' | 'foot.scheduled' | 'foot.never' | 'foot.unread'
  | 'foot.refreshing'
  | 'quote.copied' | 'quote.copyFailed' | 'quote.quoted'
  | 'quote.toSideChat' | 'quote.sideChatUnavailable'
  | 'when.justNow' | 'when.minutes' | 'when.hours' | 'when.yesterday' | 'when.days'

export const en = {
  'tab.label': 'Inspiration',
  'tab.subtitle': 'Subscriptions and saved links',
  'guide.description': 'RSS/Atom subscriptions plus any article link you save',

  'filter.today': 'Today',
  'filter.all': 'All',
  'filter.unreadOnly': 'Unread only',
  'filter.unreadOn': 'Showing unread only',
  'filter.readState': 'Read state',
  'filter.bySource': 'By source',
  'action.filter': 'Filter',
  'action.fetchBody': 'Fetch the text',
  'action.more': 'More actions',
  'action.addTag': 'Tags…',
  'detail.bodyStale': 'The saved copy is out of date — fetch it again?',
  'tag.title': 'Tags',
  'tag.placeholder': 'Tag name, then Enter',
  'filter.byTag': 'By tag',
  'search.placeholder': 'Search titles, authors, sources…',
  'sort.title': 'Sort',
  'sort.newest': 'Newest first',
  'sort.oldest': 'Oldest first',
  'sort.source': 'Group by source',

  'action.refresh': 'Refresh all',
  'action.refreshOne': 'Refresh',
  'action.add': 'Add inspiration',
  'action.back': 'Back',
  'action.copyLink': 'Copy link',
  'action.openExternal': 'Open in browser',
  'action.quote': 'Quote',
  'action.manage': 'Manage subscriptions',
  'action.remove': 'Remove',
  'action.pause': 'Pause',
  'action.resume': 'Resume',
  'action.submit': 'Fetch',
  'action.done': 'Done',
  'action.cancel': 'Cancel',

  'add.title': 'Add inspiration',
  'add.help': 'Paste a feed address or any article link. What comes back decides how it is stored: a feed is subscribed and refreshed on schedule, a web page is kept as a single item.',
  'add.placeholder': 'https://',
  'verdict.subscribed': 'Subscribed to {label} — it will refresh on schedule.',
  'verdict.savedLink': 'Saved this article — one item, no subscription.',
  'verdict.duplicate': 'That source is already in the list.',
  'verdict.invalidUrl': 'That is not an http(s) address.',
  'verdict.unsupportedContent': 'That address did not return a feed or an article.',
  'verdict.fetchFailed': 'Could not fetch that address.',

  'state.loading': 'Loading…',
  'state.emptyTitle': 'Nothing here yet',
  'state.emptyBody': 'Collect your first inspiration: subscribe to a source, or paste a link you want to keep.',
  'state.noMatch': 'Nothing matches “{query}”.',
  'state.fetching': 'Fetching…',
  'state.incomplete': 'Incomplete',
  'state.error': 'Failed',
  'state.stale': 'Refresh failed: {message}',
  'state.emptyWall': 'No entries yet. Add a source, or press refresh.',
  'state.incompleteReason': 'the payload hit the host’s 100,000-character fetch cap, so only the part that arrived is shown',

  'sources.title': 'Subscriptions',
  'sources.count': '{count} sources',
  'sources.empty': 'No subscriptions yet',
  'sources.help': 'A subscription is fetched on schedule and its new entries land in the wall below. A saved link is one item and never refetches on its own.',
  'sources.enabled': 'Updating',
  'sources.disabled': 'Paused',
  'sources.time': 'Daily refresh',
  'sources.timeHelp': 'Local time, 24-hour. A missed window is caught up once at the next boot.',
  'sources.failed': 'Last fetch failed',
  'sources.items': '{count} items',
  'sources.never': 'Not fetched yet',
  'sources.cardHint': 'Subscription',
  'sources.name': 'Name',
  'sources.cache': 'Keep fetched articles',
  'sources.cacheHelp': 'A fetched article is served from the cache until this deadline; after that, opening it offers the fetch again. 0 means keep it until the storage budget evicts it.',
  'sources.cacheHours': '{count} hours',
  'sources.cacheForever': 'Until evicted',
  'sources.blocked': 'This publisher refuses automatic fetches (its page answers with a bot challenge), so only the feed’s own text can be shown.',
  'sources.unreachable': 'The publisher’s page could not be reached at all (the request failed before any content arrived), so only the feed’s own text can be shown.',
  'sources.httpError': 'The publisher answered with an error, so only the feed’s own text can be shown.',
  'detail.fetchFailed': 'Could not fetch the full text — {reason}',
  'sources.url': 'Feed address',

  'detail.incomplete': 'Limited length, content shown in part',
  'detail.readOriginal': 'Read the original',
  'detail.extractFailed': 'Could not extract the body locally — the page is larger than the host fetch cap.',
  'detail.summaryOnly': 'This feed publishes only a summary for this entry — the full text lives on the original page.',
  'detail.alsoFrom': 'Also from this source',
  'detail.composerLabel': 'Current conversation draft',
  'detail.composerEmpty': '(empty)',

  'foot.refreshedAt': 'Refreshed {when}',
  'foot.scheduled': 'daily {time}',
  'foot.never': 'Not refreshed yet',
  'foot.unread': 'unread',
  'foot.refreshing': 'Refreshing…',
  'state.backfilling': 'Filling in {done}/{total} full articles…',
  'detail.filledIn': 'The full text was fetched automatically and is cached.',
  'detail.filledInBadge': 'full text',

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
  'tab.label': '灵感空间',
  'tab.subtitle': '订阅源与保存的链接',
  'guide.description': 'RSS/Atom 订阅，加上你保存的任意文章链接',

  'filter.today': '今日',
  'filter.all': '全部',
  'filter.unreadOnly': '只看未读',
  'filter.unreadOn': '只看未读',
  'filter.readState': '阅读状态',
  'filter.bySource': '按来源',
  'action.filter': '筛选',
  'action.fetchBody': '抓取正文',
  'action.more': '更多操作',
  'action.addTag': '打标签…',
  'detail.bodyStale': '存的正文已过期 —— 重新抓取？',
  'tag.title': '标签',
  'tag.placeholder': '标签名，回车确认',
  'filter.byTag': '按标签',
  'search.placeholder': '搜索标题、作者、来源…',
  'sort.title': '排序',
  'sort.newest': '最新在前',
  'sort.oldest': '最早在前',
  'sort.source': '按来源分组',

  'action.refresh': '刷新全部',
  'action.refreshOne': '刷新',
  'action.add': '新增灵感',
  'action.back': '返回',
  'action.copyLink': '复制链接',
  'action.openExternal': '在浏览器打开原文',
  'action.quote': '引用',
  'action.manage': '订阅管理',
  'action.remove': '删除',
  'action.pause': '暂停',
  'action.resume': '恢复',
  'action.submit': '抓取',
  'action.done': '完成',
  'action.cancel': '取消',

  'add.title': '新增灵感',
  'add.help': '粘贴订阅源地址或任意文章链接。抓回来是什么，就按什么处理：是 feed 就订阅、按计划刷新，是网页就只存这一篇。',
  'add.placeholder': 'https://',
  'verdict.subscribed': '已订阅《{label}》—— 会按计划自动刷新。',
  'verdict.savedLink': '已保存这篇 —— 只存这一条，不建订阅源。',
  'verdict.duplicate': '这个源已经在列表里了。',
  'verdict.invalidUrl': '这不是 http(s) 地址。',
  'verdict.unsupportedContent': '这个地址返回的既不是订阅源也不是网页。',
  'verdict.fetchFailed': '抓取失败。',

  'state.loading': '加载中…',
  'state.emptyTitle': '还没有内容',
  'state.emptyBody': '新增你的第一个灵感：订阅一个源，或粘贴一篇你想留住的文章链接。',
  'state.noMatch': '没有匹配「{query}」的条目。',
  'state.fetching': '抓取中…',
  'state.incomplete': '未完整',
  'state.error': '失败',
  'state.stale': '刷新失败：{message}',
  'state.emptyWall': '还没有条目。新增一个订阅源，或按一下刷新。',
  'state.incompleteReason': '内容超过宿主 100,000 字符的抓取上限，只展示已经拿到的那部分',

  'sources.title': '订阅管理',
  'sources.count': '{count} 个源',
  'sources.empty': '还没有订阅源',
  'sources.help': '订阅源会按计划抓取，新条目落进下面的灵感墙；保存的链接只有这一条，不会自己重抓。',
  'sources.enabled': '更新中',
  'sources.disabled': '已暂停',
  'sources.time': '每日刷新时间',
  'sources.timeHelp': '本地时间，24 小时制。错过的窗口会在下次启动时补刷一次。',
  'sources.failed': '上次抓取失败',
  'sources.items': '{count} 条',
  'sources.never': '尚未抓取',
  'sources.cardHint': '订阅源',
  'sources.name': '名称',
  'sources.cache': '正文保留',
  'sources.cacheHelp': '抓到的正文在这个期限前直接读缓存；过期后再打开会问你（这里问一次即可，页面上的按钮同样会提示）。0 = 一直留到存储预算淘汰它。',
  'sources.cacheHours': '{count} 小时',
  'sources.cacheForever': '留到被淘汰',
  'sources.blocked': '这个站点拒绝自动抓取（原文地址对人以外的请求返回验证页），所以只能展示订阅源自己发布的内容。',
  'sources.unreachable': '原文页面完全连不上（请求在拿到任何内容之前就失败了），所以只能展示订阅源自己发布的内容。',
  'sources.httpError': '原文页面返回了错误状态，所以只能展示订阅源自己发布的内容。',
  'detail.fetchFailed': '抓取全文失败 —— {reason}',
  'sources.url': '订阅地址',

  'detail.incomplete': '受限篇幅，内容未完整呈现',
  'detail.readOriginal': '阅读原文',
  'detail.extractFailed': '无法在本地提取正文 —— 页面超过宿主单次抓取的上限。',
  'detail.summaryOnly': '这条订阅源只发布了摘要 —— 全文在原文页面上。',
  'detail.alsoFrom': '同一来源',
  'detail.composerLabel': '当前会话草稿',
  'detail.composerEmpty': '（空）',

  'foot.refreshedAt': '刷出于 {when}',
  'foot.scheduled': '每日 {time}',
  'foot.never': '尚未刷新',
  'foot.unread': '未读',
  'foot.refreshing': '正在刷新…',
  'state.backfilling': '正在补齐全文 {done}/{total}…',
  'detail.filledIn': '全文是自动抓取并缓存的。',
  'detail.filledInBadge': '已补全',

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
    /** The inspiration space's copy. */
    'reader': ReaderKey
  }
}
