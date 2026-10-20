// Component fixture only: the real ReaderPane over an in-memory host face.
// No production server, credentials or host writes. Query parameters:
//   ?w=390        frame width in px (default 390)
//   &theme=dark   dark palette
//   &touch=1      the touch values the mobile package sets (--dsh-panel-*)
//   &body=<url>   serve this stored-body HTML for every opened entry (a local
//                 copy of a real cached body, to reproduce a layout bug; the
//                 file stays out of the repo)
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

const ytFeed = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><title>Andrej Karpathy</title>
  <entry><id>yt:video:zjkBMFhNj_g</id><title>[1hr Talk] Intro to Large Language Models</title><link rel="alternate" href="https://www.youtube.com/watch?v=zjkBMFhNj_g"/>
  <updated>${new Date(now.getTime() - 5 * 3_600_000).toISOString()}</updated><media:group><media:thumbnail url="https://i.ytimg.com/vi/zjkBMFhNj_g/hqdefault.jpg"/><media:description>A general-audience introduction to large language models.</media:description></media:group></entry>
  <entry><id>ep214</id><title>Ep. 214 — On scaling and taste</title><link rel="alternate" href="https://pod.example/ep214"/><updated>${new Date(now.getTime() - 30 * 3_600_000).toISOString()}</updated>
  <link rel="enclosure" href="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" type="audio/mpeg"/><summary>In this episode we talk about whether taste can scale. 00:00 intro · 06:12 taste as refusal</summary></entry></feed>`
const transcriptHtml = [
  [0.2, 'hi everyone so recently I gave a 30-minute talk on large language models just kind of like an intro talk'],
  [38.5, 'so the Llama 2 70b model is really just two files on your file system: the parameters file and the run file'],
  [75, 'the parameters are the weights of the neural network that is the language model, and the run file is the code that runs it'],
  [600, 'now let me switch gears to how we actually obtain these parameters, which is the training stage'],
  [640, 'you can think of it as compressing a large chunk of the internet into the parameters'],
].map(([t, text]) => `<p data-t="${t}">${text}</p>`).join('')
const sources = [
  source('yt', { label: 'Andrej Karpathy' }),
  source('anthropic', { label: 'Anthropic Research' }),
  source('arxiv', { label: 'arXiv cs.CL' }),
  source('springer', { kind: 'link', label: 'link.springer.com/s13688-025-00554-w', url: 'https://link.springer.com/article/10.1140/epjds/s13688-025-00554-w' }),
  source('weixin', { kind: 'link', label: 'mp.weixin.qq.com/U5zHz4byHw6zFcSCo1nvkw', url: 'https://mp.weixin.qq.com/s/U5zHz4byHw6zFcSCo1nvkw' }),
]
// Two feeds arrive cut off mid-document (the fetch cap), which is what puts them in the 「未完整」 notice.
const cut = (xml: string) => xml.slice(0, xml.lastIndexOf('</item>') - 40)
// An arXiv-style body: a numbered equation set as a wide table, a long inline
// formula, a fixed-size figure box and a bare URL — the things that pushed the
// detail body sideways on a phone (2026-10-06).
const wideMath = `<p>We compute the entries <math display="inline"><mrow><mo>(</mo><mi>X</mi><mi>Y</mi><mo>)</mo><mo>[</mo><mi>i</mi><mo>,</mo><mi>j</mi><mo>]</mo><mo>,</mo><mo>(</mo><mi>i</mi><mo>,</mo><mi>j</mi><mo>)</mo><mo>∈</mo><mi>W</mi><mo>,</mo><mspace width="2em"></mspace><mi>O</mi><mo>(</mo><msup><mi>n</mi><mn>2</mn></msup><mo>/</mo><msup><mi>d</mi><mn>0.063</mn></msup><mo>)</mo><mspace width="6em"></mspace><mtext>operations in total over all queries</mtext></mrow></math> without writing down the product.</p><table><tbody><tr><td><math display="inline"><mrow><mi>T</mi><mo>(</mo><mi>n</mi><mo>)</mo><mo>=</mo><munder><mo>∑</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow></munder><msup><mi>n</mi><mrow><mn>2</mn><mo>−</mo><mi>ε</mi><mi>k</mi></mrow></msup><mo>+</mo><mi>O</mi><mo>(</mo><msup><mi>n</mi><mn>1.9992</mn></msup><mo>log</mo><mi>n</mi><mo>)</mo><mo>+</mo><mi>O</mi><mo>(</mo><msup><mi>m</mi><mrow><mn>2</mn><mi>ω</mi><mo>/</mo><mo>(</mo><mi>ω</mi><mo>+</mo><mn>1</mn><mo>)</mo></mrow></msup><mo>)</mo></mrow></math></td><td>(1)</td></tr></tbody></table><figure><div style="width: 345.0pt; height: 120pt"><svg width="460" height="160" viewBox="0 0 460 160"><rect x="4" y="4" width="452" height="152" rx="8" fill="none" stroke="currentColor"/><text x="20" y="84" fill="currentColor">a 460px drawing</text></svg></div><figcaption>Figure 1: a drawing sized for a desktop column.</figcaption></figure><p>Source: https://arxiv.org/html/2610.06783v1#S1.SS2.p3.this-is-a-long-anchor-without-breaks</p>`
const payloads = {
  yt: ytFeed,
  arxiv: cut(rss('arXiv cs.CL', [
    item('arxiv', 'Truly Subquadratic 3SUM via Triangles in Sparse Lopsided Graphs', wideMath, 20),
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
const bodyUrl = params.get('body')
const storedBody = bodyUrl === null ? null : fetch(bodyUrl).then(response => response.text())
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
  getEntryBody: request => storedBody !== null
    ? storedBody.then(html => ({ ok: true, value: { entryId: request.entryId, cached: true, fresh: true, fromFeed: false, html } }))
    : ok({ entryId: request.entryId, cached: false, fresh: true, fromFeed: request.feedHtml !== undefined, ...(request.feedHtml === undefined ? {} : { html: request.feedHtml }) }),
  recordRead: () => ok({ entries: 1 }),
  readDraft: () => '', setDraft: () => {}, copyText: () => Promise.resolve(true),
  openExternal: () => true, browserTabAvailable: () => false, openBrowserTab: () => false, captureRemote: () => undefined,
  // Notes, in memory (the host's notes.json, faked).
  useSessions: select => select({ byId: { preview: { displayTitle: '位置编码讨论' } } }),
  entryNotes: entryId => ok(notes[entryId] === undefined ? {} : { entry: notes[entryId] }),
  noteCounts: () => ok({ counts: Object.fromEntries(Object.entries(notes).map(([id, entry]) => [id, entry.notes.length])) }),
  addNote: request => {
    const entry = notes[request.entryId] ?? { entryId: request.entryId, title: request.title, notes: [], sessions: [], nextNote: 1, updatedAt: '' }
    const note = { id: `n${entry.nextNote}`, anchor: { block: request.block, quote: request.quote, ...(request.translated ? { translated: request.translated } : {}) }, ...(request.comment ? { comment: request.comment } : {}), createdAt: '', updatedAt: '' }
    notes[request.entryId] = { ...entry, notes: [...entry.notes, note].sort((a, b) => a.anchor.block - b.anchor.block), nextNote: entry.nextNote + 1 }
    return ok(note)
  },
  updateNote: request => {
    const entry = notes[request.entryId]
    if (entry) notes[request.entryId] = { ...entry, notes: entry.notes.map(note => note.id === request.noteId ? { ...note, comment: request.comment || undefined } : note) }
    return ok('ok')
  },
  deleteNote: request => {
    const entry = notes[request.entryId]
    if (entry) notes[request.entryId] = { ...entry, notes: entry.notes.filter(note => note.id !== request.noteId) }
    return ok('ok')
  },
  recordDiscussion: request => {
    const entry = notes[request.entryId]
    if (entry) notes[request.entryId] = { ...entry, sessions: [{ sessionId: request.sessionId, title: request.sessionTitle, lastAt: '' }] }
    return ok('ok')
  },
  snapshotEntry: () => ok('ok'),
  mediaTranscript: request => new Promise(resolve => setTimeout(() => resolve({ ok: true, value: { entryId: request.entryId, captions: 'platform', html: transcriptHtml } }), 600)),
  addReply: () => ok('ok'), editReply: () => ok('ok'), deleteDiscussion: () => ok('ok'), markSynced: () => ok('ok'),
  // &canvas=1 composes a fake canvas inbox (the canvas plugin's ctx.canvasInbox).
  canvasInbox: () => params.get('canvas') === '1' ? {
    current: () => null,
    listCanvases: () => Promise.resolve([{ id: 'a', title: 'Transformer 读书会', cardCount: 23 }, { id: 'b', title: '周报素材', cardCount: 8 }]),
    addCard: () => Promise.resolve({ ok: true, cardId: 'k1' }),
    openCard: () => {},
  } : undefined,
  canOpenSession: () => true, openSession: () => {},
}
const notes: Record<string, any> = {}
// The preview's stand-in for the model's reader_note writes (a screenshot driver pokes it).
;(window as any).__previewNotes = notes
// Every other verb the pane may call answers an empty success.
const quiet = ['addSource', 'refresh', 'removeSource', 'updateSource', 'quoteToSideChat', 'storeEntryBody', 'getRawBody', 'setCachePolicy',
  'clearTranslations', 'createTag', 'tagEntry', 'renameTag', 'deleteTag', 'pruneTags', 'clearRecent', 'rememberSentences', 'fetchEntryBody', 'fetchImage']
const props = { ...Object.fromEntries(quiet.map(name => [name, () => ok({})])), ...face }

createRoot(document.getElementById('root')!).render(
  <div className="frame" style={{ width }}><ReaderPane {...(props as never)} /></div>,
)
