// Component fixture only: the real ReaderPane over an in-memory host face.
// No production server, credentials or host writes. Query parameters:
//   ?w=390        frame width in px (default 390)
//   &theme=dark   dark palette
//   &touch=1      the touch values the mobile package sets (--dsh-panel-*)
import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { ReaderPane } from '../../src/client/ReaderPane.tsx'
import { createReaderStore } from '../../src/client/store.ts'
import { zh } from '../../src/client/locales.ts'
import './preview.css'

const params = new URLSearchParams(location.search)
const width = Number(params.get('w') ?? 390)
if (params.get('theme') === 'dark') document.body.dataset.previewTheme = 'dark'
if (params.get('touch') === '1') document.body.dataset.previewTouch = '1'

const t = (key, values = {}) => (zh[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match)
const now = new Date()
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toUTCString()
const source = (id, over = {}) => ({ id, kind: 'rss', url: `https://example.com/${id}.xml`, label: id, enabled: true, addedAt: now.toISOString(), hasBody: true, ...over })
const item = (feed: string, title: string, summary: string, hours: number, tags: string[] = []) => `<item><title>${title}</title><link>https://example.com/${feed}/${encodeURIComponent(title)}</link><pubDate>${ago(hours)}</pubDate>${tags.map(tag => `<category>${tag}</category>`).join('')}<description>${summary}</description><content:encoded><![CDATA[<p>${summary}</p><h2>小节标题</h2><p>${summary.repeat(3)}</p>]]></content:encoded></item>`
const rss = (id: string, items: string[]) => `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${id}</title>${items.join('')}</channel></rss>`

const sources = [
  source('anthropic', { label: 'Anthropic Research' }),
  source('arxiv', { label: 'arXiv cs.CL' }),
  source('springer', { kind: 'link', label: 'link.springer.com/s13688-025-00554-w', url: 'https://link.springer.com/article/10.1140/epjds/s13688-025-00554-w' }),
  source('weixin', { kind: 'link', label: 'mp.weixin.qq.com/U5zHz4byHw6zFcSCo1nvkw', url: 'https://mp.weixin.qq.com/s/U5zHz4byHw6zFcSCo1nvkw' }),
]
// Two feeds arrive cut off mid-document (the fetch cap), which is what puts them in the 「未完整」 notice.
const cut = (xml: string) => xml.slice(0, xml.lastIndexOf('</item>') - 40)
const payloads = {
  arxiv: cut(rss('arXiv cs.CL', [
    item('arxiv', 'Lucid dreaming as a testbed for world models', 'We argue that lucid dream reports give a natural benchmark for the consistency of generated worlds.', 30),
    item('arxiv', 'tail', 'tail', 30),
  ])),
  anthropic: cut(rss('anthropic', [
    item('anthropic', 'Claude-shaped science', 'Matthew Schwartz describes what happened when he stopped fighting Claude and allowed Claude to find “Claude-shaped” problems in theoretical physics.', 120, ['Science']),
    item('anthropic', 'What work can robots do?', 'What work can robots do? Anthropic’s robot exposure index finds robots can do 3/4 of US physical job tasks, but are cost-prohibitive for most of them today.', 144, ['Economics']),
    item('anthropic', 'tail', 'tail', 150),
  ])),
  springer: (rss('Dream content discovery from social media using natural language processing', [item('springer', 'Dream content discovery from social media using natural language processing', 'Dreaming is a fundamental but not fully understood part of human experience. Traditional dream content analysis relies on manual coding.', 1), item('springer', 'tail', 'tail', 1)])),
  weixin: (rss('梦境研究的十个问题', [item('weixin', '梦境研究的十个问题', '为什么我们会做梦？这篇文章从神经科学、心理学和人类学三个角度整理了十个仍在争论中的问题。', 3), item('weixin', 'tail', 'tail', 1)])),
}
const ok = value => Promise.resolve({ ok: true, value })
const instance = createReaderStore().create('preview')
const useStore = selector => useSyncExternalStore(instance.subscribe, () => selector(instance.getSnapshot()))
const face = {
  sessionId: 'preview', useStore, actions: instance.actions, t,
  listSources: () => ok({ sources }),
  getBodies: ids => ok({ bodies: ids.map(id => ({ id, raw: payloads[id], ...(id === 'anthropic' || id === 'arxiv' ? { truncated: true } : {}) })) }),
  capabilities: () => ok({ protocolVersion: 1, hasFs: true, hasSideChat: false, lastRefreshAt: ago(2), nextRefreshAt: ago(-20) }),
  entryFetchStates: ids => ok({ states: Object.fromEntries(ids.map((id, index) => [id, index === 0 ? { state: 'ready' } : { state: 'none' }])) }),
  listTags: () => ok({ tags: [], counts: {} }), entryTags: () => ok({ tags: [] }),
  listBackfillCandidates: () => ok({ candidates: [] }), listRecent: () => ok({ entries: [] }),
  getCachePolicy: () => ok({ ttlHours: 24, maxEntries: 500, translationBudgetChars: 64_000_000 }),
  getStorageStats: () => ok({ bodies: { entries: 0, chars: 0 }, translations: { entries: 0, chars: 0, memoryEntries: 0, memoryChars: 0 } }),
  getEntryTranslation: () => ok({}), getSentenceTranslations: () => ok({ translations: {} }),
  getEntryBody: request => ok({ entryId: request.entryId, cached: false, fresh: true, fromFeed: request.feedHtml !== undefined, ...(request.feedHtml === undefined ? {} : { html: request.feedHtml }) }),
  recordRead: () => ok({ entries: 1 }),
  readDraft: () => '', setDraft: () => {}, copyText: () => Promise.resolve(true),
  openExternal: () => true, browserTabAvailable: () => false, openBrowserTab: () => false, captureRemote: () => undefined,
}
// Every other verb the pane may call answers an empty success.
const quiet = ['addSource', 'refresh', 'removeSource', 'updateSource', 'quoteToSideChat', 'storeEntryBody', 'getRawBody', 'setCachePolicy',
  'clearTranslations', 'createTag', 'tagEntry', 'renameTag', 'deleteTag', 'pruneTags', 'clearRecent', 'rememberSentences', 'fetchEntryBody', 'fetchImage']
const props = { ...Object.fromEntries(quiet.map(name => [name, () => ok({})])), ...face }

createRoot(document.getElementById('root')!).render(
  <div className="frame" style={{ width }}><ReaderPane {...(props as never)} /></div>,
)
