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
  | 'filter.searchSource' | 'filter.noSourceMatch' | 'filter.byKind' | 'filter.deleteTag'
  | 'action.translate' | 'translate.view' | 'translate.onlyTranslation' | 'translate.bilingual'
  | 'translate.onlyOriginal' | 'translate.retry' | 'translate.tip' | 'translate.preparing'
  | 'translate.working' | 'translate.local' | 'translate.failed' | 'translate.dismiss'
  | 'translate.nothing' | 'translate.failedAll' | 'translate.unsupported'
  | 'action.fetchBody' | 'detail.bodyStale' | 'action.more' | 'action.addTag'
  | 'tag.title' | 'tag.placeholder' | 'tag.hint' | 'tag.create' | 'tag.empty'
  | 'search.placeholder'
  | 'sort.title' | 'sort.newest' | 'sort.oldest' | 'sort.source'
  | 'action.refresh' | 'action.refreshOne' | 'action.add' | 'action.back'
  | 'action.copyLink' | 'action.openExternal' | 'action.quote' | 'action.manage'
  | 'action.remove' | 'action.submit' | 'action.done' | 'action.cancel' | 'action.clearSearch'
  | 'add.title' | 'add.help' | 'add.placeholder'
  | 'verdict.subscribed' | 'verdict.savedLink' | 'verdict.savedLinkNoPreview' | 'verdict.duplicate'
  | 'verdict.invalidUrl' | 'verdict.unsupportedContent' | 'verdict.fetchFailed'
  | 'preview.blocked' | 'preview.login' | 'preview.unsupportedType' | 'preview.redirected'
  | 'preview.empty' | 'preview.unreachable' | 'preview.http'
  | 'detail.linkOnlyBadge' | 'detail.removeLink' | 'detail.fetchingBody'
  | 'detail.refetch' | 'detail.refetching' | 'detail.refetchTitle'
  | 'state.loading' | 'state.emptyTitle' | 'state.emptyBody' | 'state.noMatch'
  | 'state.fetching' | 'state.incomplete' | 'state.error' | 'state.stale'
  | 'state.emptyWall' | 'state.incompleteReason' | 'state.matches' | 'detail.scriptFigures'
  | 'fetch.none' | 'fetch.fetching' | 'fetch.raw' | 'fetch.ready' | 'fetch.failed'
  | 'fetch.noneTitle' | 'fetch.readyTitle' | 'fetch.failedTitle'
  | 'sources.title' | 'sources.count' | 'sources.empty' | 'sources.help'
  | 'sources.enabled' | 'sources.disabled' | 'sources.time' | 'sources.timeHelp'
  | 'sources.failed' | 'sources.items' | 'sources.never' | 'sources.cardHint'
  | 'sources.name' | 'sources.url' | 'sources.cache' | 'sources.cacheHelp'
  | 'sources.cacheHours' | 'sources.cacheForever' | 'sources.blocked'
  | 'sources.unreachable' | 'sources.httpError' | 'detail.fetchFailed'
  | 'sources.kindRss' | 'sources.kindLink' | 'sources.kindFilter' | 'sources.noMatch'
  | 'sources.sortAdded' | 'sources.sortName' | 'sources.sortFetched'
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
  'action.translate': 'Translate',
  'translate.view': 'Translation view',
  'translate.onlyTranslation': 'Translation only',
  'translate.bilingual': 'Side by side',
  'translate.onlyOriginal': 'Original only',
  'translate.retry': 'Translate again',
  'translate.tip': 'Click any sentence to see its original; click again to hide it',
  'translate.preparing': 'Preparing the Chinese language pack',
  'translate.working': 'Translating',
  'translate.local': 'On-device · Chinese (Simplified)',
  'translate.failed': 'Translation stopped: {reason}',
  'translate.failedAll': 'No batch came back — try again from the globe menu',
  'translate.nothing': 'Nothing in this body to translate',
  'translate.unsupported': 'This browser cannot translate {pair} — the model for that pair is not available (see chrome://on-device-internals, "Broker State")',
  'translate.dismiss': 'Dismiss',
  'detail.bodyStale': 'The saved copy is out of date — fetch it again?',
  'tag.title': 'Tags',
  'tag.placeholder': 'Tag name, then Enter',
  'tag.hint': 'Enter to add',
  'tag.create': 'Create “{name}”',
  'tag.empty': 'No tags yet — type a name to make the first one',
  'filter.byTag': 'By tag',
  'filter.byKind': 'By type',
  'filter.deleteTag': 'Delete this tag',
  'filter.searchSource': 'Search sources…',
  'filter.noSourceMatch': 'No source matches',
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
  'action.clearSearch': 'Clear',

  'add.title': 'Add inspiration',
  'add.help': 'Paste a feed address or any article link. What comes back decides how it is stored: a feed is subscribed and refreshed on schedule, a web page is kept as a single item.',
  'add.placeholder': 'https://',
  'verdict.subscribed': 'Subscribed to {label} — it will refresh on schedule.',
  'verdict.savedLink': 'Saved this article — one item, no subscription.',
  'verdict.savedLinkNoPreview': 'Saved the link to {label} — no preview here: {reason}',
  'verdict.duplicate': 'That source is already in the list.',
  'verdict.invalidUrl': 'That is not an http(s) address.',
  'verdict.unsupportedContent': 'That address did not return a feed or an article.',
  'verdict.fetchFailed': 'Could not fetch that address.',
  'preview.blocked': 'this site refuses automatic fetches (it answers with a bot challenge)',
  'preview.login': 'this address is behind a login (an institutional proxy or single sign-on)',
  'preview.unsupportedType': 'this address is not a web page (a PDF or another file)',
  'preview.redirected': 'this address moves to another site, and the redirect cannot be followed here',
  'preview.empty': 'this page has no readable text',
  'preview.unreachable': 'the site could not be reached just now',
  'preview.http': 'the site answered with an HTTP error',
  'detail.linkOnlyBadge': 'Link only',
  'detail.fetchingBody': 'Fetching the full text…',
  'detail.refetch': 'Fetch again',
  'detail.refetching': 'Fetching…',
  'detail.refetchTitle': 'Fetch this article again — what is on screen is the copy fetched earlier',
  'detail.removeLink': 'Delete this link',

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
  'state.matches': '{count} matching “{query}”',

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
  'sources.cacheHelp': 'A fetched article is served from the cache until this deadline; after that, opening the entry fetches it once more. 0 means keep it until the storage budget evicts it.',
  'sources.cacheHours': '{count} hours',
  'sources.cacheForever': 'Until evicted',
  'sources.blocked': 'This publisher refuses automatic fetches (its page answers with a bot challenge), so only the feed’s own text can be shown.',
  'sources.unreachable': 'The publisher’s page could not be reached at all (the request failed before any content arrived), so only the feed’s own text can be shown.',
  'sources.httpError': 'The publisher answered with an error, so only the feed’s own text can be shown.',
  'sources.kindRss': 'Feed',
  'sources.kindLink': 'Saved link',
  'sources.kindFilter': 'Filter by type',
  'sources.noMatch': 'Nothing of that type.',
  'sources.sortAdded': 'Added',
  'sources.sortName': 'Name',
  'sources.sortFetched': 'Fetched',
  'detail.fetchFailed': 'Could not fetch the full text — {reason}',
  'sources.url': 'Feed address',

  'detail.incomplete': 'Limited length, content shown in part',
  'detail.readOriginal': 'Read the original',
  'detail.extractFailed': 'Could not extract a body from this page — open the original instead.',
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
  'detail.filledIn': 'The full text was fetched automatically and cached. The card still shows the feed’s own summary — open it to read.',
  'detail.filledInBadge': 'Full text',
  'detail.scriptFigures': 'This page draws {count} of its figures with its own scripts, so their pictures cannot be fetched — the captions are kept below —',
  'fetch.none': 'Fetch',
  'fetch.fetching': 'Fetching',
  'fetch.raw': 'Storing',
  'fetch.ready': 'Fetched',
  'fetch.failed': 'Fetch failed',
  'fetch.noneTitle': 'Fetch the article now — it keeps going when you leave this page',
  'fetch.readyTitle': 'The full text is cached — open it to read',
  'fetch.failedTitle': 'Fetch failed: {reason} — click to retry',

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
  'action.translate': '翻译',
  'translate.view': '翻译视图',
  'translate.onlyTranslation': '只看译文',
  'translate.bilingual': '双语对照',
  'translate.onlyOriginal': '只看原文',
  'translate.retry': '重新翻译',
  'translate.tip': '点任意一句可看原文，再点收起',
  'translate.preparing': '正在准备中文语言包',
  'translate.working': '翻译中',
  'translate.local': '浏览器本地 · 中文（简体）',
  'translate.failed': '翻译中断：{reason}',
  'translate.failedAll': '各批次都没翻出来 —— 可从地球菜单里重试',
  'translate.nothing': '这段正文里没有可翻译的散文',
  'translate.unsupported': '这个浏览器无法翻译 {pair} —— 该语言对的模型不可用（可在 chrome://on-device-internals 的 Broker State 看原因）',
  'translate.dismiss': '不再提示',
  'detail.bodyStale': '存的正文已过期 —— 重新抓取？',
  'tag.title': '标签',
  'tag.placeholder': '标签名，回车确认',
  'tag.hint': '回车确认',
  'tag.create': '新建「{name}」',
  'tag.empty': '还没有标签 —— 输入名字回车就能建第一个',
  'filter.byTag': '按标签',
  'filter.byKind': '按类型',
  'filter.deleteTag': '删除这个标签',
  'filter.searchSource': '搜索来源…',
  'filter.noSourceMatch': '没有匹配的来源',
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
  'action.clearSearch': '清空',

  'add.title': '新增灵感',
  'add.help': '粘贴订阅源地址或任意文章链接。抓回来是什么，就按什么处理：是 feed 就订阅、按计划刷新，是网页就只存这一篇。',
  'add.placeholder': 'https://',
  'verdict.subscribed': '已订阅《{label}》—— 会按计划自动刷新。',
  'verdict.savedLink': '已保存这篇 —— 只存这一条，不建订阅源。',
  'verdict.savedLinkNoPreview': '已保存《{label}》的链接 —— 这里看不到内容：{reason}',
  'verdict.duplicate': '这个源已经在列表里了。',
  'verdict.invalidUrl': '这不是 http(s) 地址。',
  'verdict.unsupportedContent': '这个地址返回的既不是订阅源也不是网页。',
  'verdict.fetchFailed': '抓取失败。',
  'preview.blocked': '这个站点拒绝自动抓取（返回的是验证页）',
  'preview.login': '这个地址需要登录（机构代理或单点登录），本插件取不到正文',
  'preview.unsupportedType': '这个地址不是网页（是 PDF 或其它文件）',
  'preview.redirected': '这个地址会跳到另一个站点，跨站跳转在本地无法跟随',
  'preview.empty': '这一页没有可读的正文',
  'preview.unreachable': '刚才连不上这个站点',
  'preview.http': '这个站点返回了 HTTP 错误',
  'detail.linkOnlyBadge': '仅链接',
  'detail.fetchingBody': '正在抓取正文…',
  'detail.refetch': '重新抓取',
  'detail.refetching': '抓取中',
  'detail.refetchTitle': '重新抓取这篇正文 —— 现在看到的是之前抓下来的版本',
  'detail.removeLink': '删除这条链接',

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
  'state.matches': '匹配「{query}」{count} 条',

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
  'sources.cacheHelp': '抓到的正文在这个期限前直接读缓存；过期后下次打开这一条会重新抓一次。0 = 一直留到存储预算淘汰它。',
  'sources.cacheHours': '{count} 小时',
  'sources.cacheForever': '留到被淘汰',
  'sources.blocked': '这个站点拒绝自动抓取（原文地址对人以外的请求返回验证页），所以只能展示订阅源自己发布的内容。',
  'sources.unreachable': '原文页面完全连不上（请求在拿到任何内容之前就失败了），所以只能展示订阅源自己发布的内容。',
  'sources.httpError': '原文页面返回了错误状态，所以只能展示订阅源自己发布的内容。',
  'sources.kindRss': '订阅源',
  'sources.kindLink': '保存的链接',
  'sources.kindFilter': '按类型筛选',
  'sources.noMatch': '这一类里还没有内容。',
  'sources.sortAdded': '按添加时间',
  'sources.sortName': '按名称',
  'sources.sortFetched': '按抓取时间',
  'detail.fetchFailed': '抓取全文失败 —— {reason}',
  'sources.url': '订阅地址',

  'detail.incomplete': '受限篇幅，内容未完整呈现',
  'detail.readOriginal': '阅读原文',
  'detail.extractFailed': '这一页抽不出正文 —— 点「阅读原文」打开它。',
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
  'detail.filledIn': '全文是自动抓取并缓存的。卡片上仍是 feed 自己的摘要 —— 点开看全文。',
  'detail.filledInBadge': '已抓全文',
  'detail.scriptFigures': '这一页有 {count} 张插图由页面自己的脚本绘制，抓取时拿不到画面（图注保留在正文里）——',
  'fetch.none': '抓取',
  'fetch.fetching': '抓取中',
  'fetch.raw': '待解析',
  'fetch.ready': '已抓取',
  'fetch.failed': '抓取失败',
  'fetch.noneTitle': '现在就把这篇抓下来 —— 离开这个页面也不会停',
  'fetch.readyTitle': '已有全文，点开就能读',
  'fetch.failedTitle': '抓取失败：{reason} —— 点一下重试',

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
