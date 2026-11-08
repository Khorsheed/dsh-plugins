/**
 * A member CLI's own subagents (member-cli-subagents M7), on the REAL store
 * with the core-written logs of `tests/fixtures/local-agent-cli-subagents.json`:
 * a member round with a foreground `Agent` subagent and a three-way
 * `AgentSwarm`, and a round that resumes the first subagent. Run
 *   pnpm exec tsx packages/context-lens/examples/workbench/serve.mts
 * then open /cli-subagents.html?view=<room|member>[&round=2][&narrow=1][&dark=1][&lang=en]
 * (`room`: the room round with the subagent tabs after the member; `member`:
 * the member's own lens on the turn that called them).
 */
import { createRoot } from 'react-dom/client'
import type { InspectorTabProps } from '../../src/client/contract.ts'
import { InspectorPanel } from '../../src/client/InspectorPanel.tsx'
import { en, zh } from '../../src/client/locales.ts'
import { foldLogRows, openCursor, reconstructSession, type SessionLogRow } from '../../src/log-lane.ts'
import { roomTurnSeq } from '../../src/room.ts'
import { InspectorStore } from '../../src/store.ts'
import fixture from '../../tests/fixtures/local-agent-cli-subagents.json'
import './preview.css'

const params = new URLSearchParams(location.search)
const dictionary: Record<string, string> = params.get('lang') === 'en' ? en : zh
const t = ((key: string, vars?: Record<string, string>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => vars?.[name] ?? match)) as InspectorTabProps['t']
const member = params.get('view') === 'member'
const second = params.get('round') === '2'

const child = fixture.childSessionId
const memberRows = fixture.rows as SessionLogRow[]
const grandchildren = fixture.grandchildren as { sessionId: string; rows: SessionLogRow[] }[]
const executionRows = memberRows.filter(row => row.type === 'local-agent/execution')
const record = (index: number) => ({ id: (executionRows[index]!.data as { executionId: string }).executionId, at: executionRows[index]!.time ?? 0 })
const [s1, e1, s2, e2] = [record(0), record(1), record(2), record(3)]

const room: SessionLogRow[] = [
  { type: 'room/member-added', seq: 1, time: s1.at - 900_000, data: { id: 'm-ada', name: '人物建模大师' } },
  { type: 'room/dispatch', seq: 20, time: s1.at - 5, data: { origin: 'human', text: '把阿沅的近景审查图里所有穿模的地方找出来，再出三段字幕', targets: ['人物建模大师'], messageId: 'u-20' } },
  { type: 'subagent/catalog', seq: 21, time: s1.at - 4, data: { childId: child, mode: 'session', label: '人物建模大师' } },
  { type: 'room/run-state', seq: 22, time: e1.at, data: { runId: '20:m-ada', member: '人物建模大师', state: 'done', startedAt: s1.at, elapsedMs: e1.at - s1.at, childSessionId: child, executionId: s1.id } },
  { type: 'room/dispatch', seq: 30, time: s2.at - 5, data: { origin: 'human', text: '左手袖口再看一处', targets: ['人物建模大师'], messageId: 'u-30' } },
  { type: 'room/run-state', seq: 31, time: e2.at, data: { runId: '30:m-ada', member: '人物建模大师', state: 'done', startedAt: s2.at, elapsedMs: e2.at - s2.at, childSessionId: child, executionId: s2.id } },
]

const store = new InspectorStore()
const success = <V,>(value: V) => Promise.resolve({ ok: true as const, value })
let sessionId: string
let turnSeq: number
/** What the service's log lane does: each grandchild's log into the session that holds its scope. */
const readGrandchildren = (root: string) => {
  for (const grandchild of grandchildren) {
    for (const request of foldLogRows(openCursor(), grandchild.rows, { execution: entry => store.noteExecution(grandchild.sessionId, entry) })) store.appendLogRequest(root, grandchild.sessionId, request)
  }
}
if (member) {
  sessionId = child
  store.insertLogTurns(child, reconstructSession(memberRows))
  readGrandchildren(child)
  turnSeq = second ? 2 : 1
} else {
  sessionId = 'room-1'
  store.insertLogTurns(sessionId, reconstructSession(room))
  for (const row of room) store.noteRoomEvent(sessionId, row.type, row.data, row.seq, row.time)
  const cursor = openCursor()
  for (const request of foldLogRows(cursor, memberRows, {
    execution: entry => store.noteExecution(child, entry),
    catalog: (id, label, at) => store.noteGrandchild(sessionId, child, id, label, at ?? 0),
  })) store.appendLogRequest(sessionId, child, request)
  readGrandchildren(sessionId)
  turnSeq = roomTurnSeq(second ? 30 : 20)
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
