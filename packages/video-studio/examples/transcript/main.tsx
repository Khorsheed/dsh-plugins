// Component fixture only: the real TranscriptTab over an in-memory face, for
// screenshot review of the panel material (menu, find bar, bars, proposals).
// No production server, credentials or host writes. Query: ?w=420 &theme=dark
// &touch=1.
import { createRoot } from 'react-dom/client'
import { PanelRoot } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { TranscriptTab } from '../../src/client/TranscriptTab.tsx'
import { zh } from '../../src/client/locales.ts'
import css from '../../src/client/VideoPane.module.css'
import './preview.css'

const params = new URLSearchParams(location.search)
const width = Number(params.get('w') ?? 420)
if (params.get('theme') === 'dark') document.body.dataset.previewTheme = 'dark'
if (params.get('touch') === '1') document.body.dataset.previewTouch = '1'

const t = (key: string, values: Record<string, string> = {}): string =>
  ((zh as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (m, name) => values[name] ?? m)

// ── an in-memory episode: two speakers, one char per token, 0.28 s each ──
const STEP = 0.28
interface FxToken { text: string; start: number; end: number; kind: 'word' }
interface FxSeg { id: string; speakerId: string; start: number; end: number; tokens: FxToken[] }

let clock = 0
const mkSeg = (id: string, speakerId: string, text: string, gap = 1.4): FxSeg => {
  clock += gap
  const tokens = [...text].map((ch, i) => ({ text: ch, start: +(clock + i * STEP).toFixed(2), end: +(clock + (i + 1) * STEP).toFixed(2), kind: 'word' as const }))
  const seg = { id, speakerId, start: tokens[0]!.start, end: tokens[tokens.length - 1]!.end, tokens }
  clock = seg.end
  return seg
}
/** Reference-time range of the nth needle inside a segment's tokens. */
const rangeOf = (seg: FxSeg, needle: string, nth = 0): { start: number; end: number } => {
  const joined = seg.tokens.map((tk) => tk.text).join('')
  let at = -1
  for (let i = 0; i <= nth; i++) at = joined.indexOf(needle, at + 1)
  const a = seg.tokens[at]!
  const b = seg.tokens[at + needle.length - 1]!
  return { start: a.start, end: b.end }
}

const s1 = mkSeg('seg1', 'sp1', '我快速讲完，第一个是门法政治，还是以天子为中心。')
const s2 = mkSeg('seg2', 'sp1', '他的权利来自于天子，但是实际上，那个，司马家就是个挂件。')
const s3 = mkSeg('seg3', 'sp2', '对，门法政治在东晋的时候特别明显。')
const s4 = mkSeg('seg4', 'sp1', '跟欧洲那种封建还是不太一样，不太一样的。')
const s5 = mkSeg('seg5', 'sp2', '欧洲国王能力不行的时候，就直接换个国王就可以了。')
const s6 = mkSeg('seg6', 'sp1', '但是门法政治里，那个，皇帝更像个象征。')
clock += 1.2 // an extra-long pause before the next line (2.6 s total)
const s7 = mkSeg('seg7', 'sp1', '所以东晋的门法，本质上是几个大姓家族在把持。')
const s8 = mkSeg('seg8', 'sp2', '嗯，这个我同意。')
const s9 = mkSeg('seg9', 'sp1', '这段我们回头再展开。')
const s10 = mkSeg('seg10', 'sp1', '好，那第二个话题是这些家族之间的利益交换。')
const transcript = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10]
const total = s10.end

const edits = [
  // an accepted correction: 门法 → 门阀 on the first occurrence
  { id: 'e1', kind: 'text', ...rangeOf(s1, '门法'), text: '门阀', from: '门法', origin: 'user', state: 'applied', group: 'gu1' },
  // the user's own cut: the whole of segment 9
  { id: 'e2', kind: 'cut', start: s9.start, end: s9.end, origin: 'user', state: 'applied', group: 'gu2' },
  // the model's accepted cut: the repeated tail of segment 4
  { id: 'e3', kind: 'cut', ...rangeOf(s4, '，不太一样的'), origin: 'agent', state: 'applied', group: 'ga1', reason: '重复' },
  // proposals waiting for ✓/✗
  { id: 'e4', kind: 'cut', ...rangeOf(s2, '那个'), origin: 'agent', state: 'proposed', group: 'g1', reason: '语气词' },
  { id: 'e5', kind: 'cut', ...rangeOf(s6, '那个'), origin: 'agent', state: 'proposed', group: 'g1', reason: '语气词' },
  { id: 'e6', kind: 'shorten', start: s6.end, end: s7.start, value: 0.6, origin: 'agent', state: 'proposed', group: 'g1', reason: '长停顿' },
]

const project = {
  schema: 1, id: 'demo', showId: 'show1', name: '#23 · 门阀与封建',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'editing',
  settings: {}, overrides: [], referenceId: 'ref', sources: [],
  speakers: [
    { id: 'sp1', name: '鱼蛋', color: 's1', origin: { kind: 'diarization', cluster: 0 }, speechSec: 140 },
    { id: 'sp2', name: '雪兔', color: 's2', origin: { kind: 'diarization', cluster: 1 }, speechSec: 60 },
  ],
  transcript, edits,
  groups: [{ id: 'g1', title: '清理提议：语气词 2 处 · 长停顿 1 处', createdAt: new Date().toISOString() }],
  chapters: [], events: [], modelSeenSeq: 0,
}
const view = { project, durationSec: total, outputSec: total - (s9.end - s9.start) - 8 * STEP, jobs: [] }

const ok = { ok: true, value: view }
const p = {
  t,
  sessionId: 'fixture',
  primeConversation: () => true,
  audioChunk: () => new Promise(() => undefined),
  setCut: async () => ok,
  decide: async () => ok,
  scan: async () => ok,
  fixText: async () => ok,
  replaceAll: async () => ok,
  cutMatches: async () => ok,
  reassignSegment: async () => ok,
}
const act = async (fn: () => Promise<unknown>): Promise<void> => { await fn().catch(() => undefined) }
const report = (e: unknown): void => console.log('[notice]', e)

createRoot(document.getElementById('root')!).render(
  <div className="frame" style={{ width }}>
    <PanelRoot className={css.root}>
      <div className={css.body}>
        <TranscriptTab p={p as never} v={view as never} act={act} report={report} />
      </div>
    </PanelRoot>
  </div>,
)
