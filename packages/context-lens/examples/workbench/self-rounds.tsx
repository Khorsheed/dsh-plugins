/**
 * Self-started rounds (member-self-started-rounds M8), on the REAL store with
 * the core-written log of `tests/fixtures/local-agent-contract.json`: a round
 * that starts a background task, then the round the member's CLI opens itself
 * when the task ends. Run
 *   pnpm exec tsx packages/context-lens/examples/workbench/serve.mts
 * then open /self-rounds.html?view=<room|member>[&turn=<member turn>][&narrow=1][&dark=1][&lang=en]
 * (`room`: the room round with the extra tab; `member`: the member's own lens
 * on the self turn, the previous turn titled without the room's preamble).
 */
import { createRoot } from 'react-dom/client'
import type { InspectorTabProps } from '../../src/client/contract.ts'
import { InspectorPanel } from '../../src/client/InspectorPanel.tsx'
import { en, zh } from '../../src/client/locales.ts'
import { foldLogRows, openCursor, reconstructSession, type SessionLogRow } from '../../src/log-lane.ts'
import { roomTurnSeq } from '../../src/room.ts'
import { InspectorStore } from '../../src/store.ts'
import fixture from '../../tests/fixtures/local-agent-contract.json'
import './preview.css'

const params = new URLSearchParams(location.search)
const dictionary: Record<string, string> = params.get('lang') === 'en' ? en : zh
const t = ((key: string, vars?: Record<string, string>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => vars?.[name] ?? match)) as InspectorTabProps['t']
const member = params.get('view') === 'member'

const child = fixture.childSessionId
const executions = fixture.executions as { executionId: string; turns: number[] }[]
const background = executions[3]!
const fixtureRows = fixture.rows as SessionLogRow[]
const at = (seq: number): number => fixtureRows.find(row => row.seq === seq)?.time ?? 0
const backgroundStart = fixtureRows.find(row => row.type === 'local-agent/execution' && (row.data as { executionId?: string }).executionId === background.executionId)!
const T = backgroundStart.time ?? 0

// The room: the round whose run is the background execution.
const room: SessionLogRow[] = [
  { type: 'room/member-added', seq: 1, time: T - 900_000, data: { id: 'm-ada', name: 'kimi' } },
  { type: 'room/dispatch', seq: 14, time: T - 20, data: { origin: 'human', text: '把插件部署到 3080', targets: ['kimi'], messageId: 'u-14' } },
  { type: 'subagent/catalog', seq: 15, time: T - 10, data: { childId: child, mode: 'session', label: 'Kimi' } },
  { type: 'room/run-state', seq: 16, time: T, data: { runId: '14:m-ada', member: 'kimi', state: 'done', startedAt: T, elapsedMs: 200, childSessionId: child, executionId: background.executionId } },
]

const store = new InspectorStore()
const success = <V,>(value: V) => Promise.resolve({ ok: true as const, value })
let sessionId: string
let turnSeq: number
if (member) {
  // The member's own log; the room put its handoff notice in front of the human's words of turn 3.
  sessionId = child
  const turnStart = fixtureRows.find(row => row.type === 'turn/start' && (row.data as { turn?: number }).turn === 3)!
  const preamble: SessionLogRow = { type: 'user/message', seq: turnStart.seq + 0.5, time: at(turnStart.seq), surfaceOp: 'append', data: { id: 'u-3', role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '你现在是本房间的协调者。\n【协调者交接】房间 把协调者交给了你（kimi）。从现在起，人发的不带 @ 的消息都由你来接。\n\n把插件部署到 3080' }] } }
  const rows = [...fixtureRows, preamble].sort((a, b) => a.seq - b.seq)
  store.insertLogTurns(child, reconstructSession(rows))
  turnSeq = Number(params.get('turn') ?? 4)
} else {
  sessionId = 'room-1'
  store.insertLogTurns(sessionId, reconstructSession(room))
  for (const row of room) store.noteRoomEvent(sessionId, row.type, row.data, row.seq, row.time)
  for (const request of foldLogRows(openCursor(), fixtureRows, { execution: record => store.noteExecution(child, record) })) store.appendLogRequest(sessionId, child, request)
  turnSeq = roomTurnSeq(14)
}

// One stable tab info: a fresh signal per render re-runs the panel's request effect on every render.
const tabInfo = { sidebar: { expanded: true, fullscreen: false }, panel: { id: 'p' }, tab: { navigation: { address: 'dsh-page://context-lens', params: { turnSeq }, revision: 1 }, signal: new AbortController().signal } }
const props = {
  sessionId,
  useTabInfo: () => tabInfo,
  t,
  listTurns: () => success(store.listTurns(sessionId)),
  getSessionTrend: () => success(store.getSessionTrend(sessionId)),
  getTurn: (_s: string, seq: number) => success(store.getTurn(sessionId, seq)),
  getRequest: (_s: string, seq: number) => success(store.getRequest(sessionId, seq)),
  getTurnTiming: (_s: string, seq: number) => success(store.getTurnTiming(sessionId, seq)),
} as unknown as InspectorTabProps

function Preview() {
  const narrow = params.get('narrow') === '1'
  return <main data-theme={params.get('dark') === '1' ? 'dark' : 'light'}>
    <div className="preview-panel" style={{ width: narrow ? '390px' : '100%', height: 'calc(100vh - 24px)' }}><InspectorPanel {...props} /></div>
  </main>
}

createRoot(document.getElementById('app')!).render(<Preview />)
