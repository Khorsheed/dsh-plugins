/**
 * Room rounds and execution records (batch 5 S8), on the REAL store: a room
 * log with an old round (no records), a new round whose member run is the
 * execution the local-agent core recorded in
 * `tests/fixtures/local-agent-contract.json`, a `/compact` and a decision
 * no record ties to a round. Run
 *   pnpm exec tsx packages/context-lens/examples/workbench/serve.mts
 * then open /room-records.html?turn=<old|new|compact|group>[&none=1][&narrow=1][&dark=1][&lang=en]
 * (`none=1`: a room whose rounds all lack records — the notice at the top).
 */
import { createRoot } from 'react-dom/client'
import type { InspectorTabProps } from '../../src/client/contract.ts'
import { InspectorPanel } from '../../src/client/InspectorPanel.tsx'
import { en, zh } from '../../src/client/locales.ts'
import { foldLogRows, openCursor, reconstructSession, type SessionLogRow } from '../../src/log-lane.ts'
import { ROOM_UNATTRIBUTED_TURN, roomTurnSeq } from '../../src/room.ts'
import { InspectorStore } from '../../src/store.ts'
import fixture from '../../tests/fixtures/local-agent-contract.json'
import './preview.css'

const params = new URLSearchParams(location.search)
const dictionary: Record<string, string> = params.get('lang') === 'en' ? en : zh
const t = ((key: string, vars?: Record<string, string>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => vars?.[name] ?? match)) as InspectorTabProps['t']
const none = params.get('none') === '1'

const child = fixture.childSessionId
const [live, , compact] = fixture.executions as { executionId: string }[]
const T0 = 1_800_000_000_000
const room: SessionLogRow[] = [
  { type: 'room/member-added', seq: 1, time: T0 - 900_000, data: { id: 'm-ada', name: '尼尔盖曼' } },
  { type: 'room/member-added', seq: 2, time: T0 - 900_000, data: { id: 'm-bea', name: '剪刀手' } },
  // An old round (before batch 5): its runs name no execution and no child turn.
  { type: 'room/dispatch', seq: 3, time: T0 - 600_000, data: { origin: 'human', text: '先把第一章的骨架搭起来', targets: ['尼尔盖曼', '剪刀手'] } },
  { type: 'subagent/catalog', seq: 4, time: T0 - 599_000, data: { childId: child, mode: 'session', label: 'Claude Code' } },
  { type: 'room/run-state', seq: 5, time: T0 - 540_000, data: { runId: '3:m-ada', member: '尼尔盖曼', state: 'done', startedAt: T0 - 599_000, elapsedMs: 58_000, childSessionId: child } },
  { type: 'room/run-state', seq: 6, time: T0 - 560_000, data: { runId: '3:m-bea', member: '剪刀手', state: 'done', startedAt: T0 - 598_000, elapsedMs: 38_000 } },
  { type: 'room/decision', seq: 7, time: T0 - 550_000, data: { id: 'd-loose', scenario: 'report-timing', outcome: 'now', probability: 0.88, about: { from: '剪刀手', to: 'dsh' },
    call: { model: 'jev-latest', latencyMs: 640, inputTokens: 512, outputTokens: 6, request: { state: { coordinatorNotes: [] }, questions: [{ id: 'deliver_now', type: 'noul', instructions: 'Should the results be handed over now?' }] }, response: [{ id: 'deliver_now', answer: 0.88 }] } } },
  ...none ? [] : [
    // A new round: its member run is the core's recorded execution.
    { type: 'room/dispatch', seq: 10, time: T0 + 40, data: { origin: 'human', text: '看一下文件，再说下一步', targets: ['尼尔盖曼'], messageId: 'u-10' } },
    { type: 'room/run-state', seq: 11, time: T0 + 60, data: { runId: '10:m-ada', member: '尼尔盖曼', state: 'running', startedAt: T0 + 60, childSessionId: child, executionId: live!.executionId } },
    { type: 'room/run-state', seq: 12, time: T0 + 200, data: { runId: '10:m-ada', member: '尼尔盖曼', state: 'done', startedAt: T0 + 60, elapsedMs: 140, childSessionId: child, executionId: live!.executionId, childTurn: 1 } },
    { type: 'room/dispatch', seq: 13, time: T0 + 560, data: { origin: 'human', text: '/compact', targets: ['尼尔盖曼'] } },
    { type: 'room/run-state', seq: 14, time: T0 + 620, data: { runId: '13:m-ada', member: '尼尔盖曼', state: 'done', operation: 'compact', startedAt: T0 + 570, elapsedMs: 50, childSessionId: child, executionId: compact!.executionId } },
  ] satisfies SessionLogRow[],
]

const store = new InspectorStore()
store.insertLogTurns('room-1', reconstructSession(room))
for (const row of room) if (row.type.startsWith('room/')) store.noteRoomEvent('room-1', row.type, row.data, row.seq, row.time)
// A later round the member's own page started (no room round claims it), with the CLI's own compaction inside.
const pageRound: SessionLogRow[] = [
  { type: 'local-agent/execution', seq: 100, time: T0 + 900, data: { phase: 'start', executionId: 'e-page', caller: 'composer', operation: 'prompt', parentSessionId: 'room-1', admittedAt: T0 + 900 } },
  { type: 'turn/start', seq: 101, time: T0 + 910, data: { turn: 3 } },
  { type: 'local-agent/compaction', seq: 102, time: T0 + 980, data: { source: 'auto', outcome: 'completed', provider: 'codex-local', beforeTokens: 240_000, startedAt: T0 + 950, endedAt: T0 + 975, boundarySeq: 101, unrecorded: ['usage'] } },
  { type: 'turn/end', seq: 103, time: T0 + 990, data: { turn: 3, reason: { kind: 'completed' } } },
  { type: 'local-agent/execution', seq: 104, time: T0 + 995, data: { phase: 'end', executionId: 'e-page', outcome: 'done', turns: [3], endedAt: T0 + 995 } },
]
const rows = [...fixture.rows as SessionLogRow[], ...none ? [] : pageRound]
for (const request of foldLogRows(openCursor(), none ? rows.filter(row => row.type !== 'local-agent/execution') : rows, { execution: record => store.noteExecution(child, record) })) {
  store.appendLogRequest('room-1', child, request)
}

const success = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const turn = params.get('turn') ?? 'new'
const turnSeq = turn === 'old' ? roomTurnSeq(3) : turn === 'group' ? ROOM_UNATTRIBUTED_TURN : turn === 'compact' ? roomTurnSeq(13) : roomTurnSeq(10)
const props = {
  sessionId: 'room-1',
  useTabInfo: () => ({ sidebar: { expanded: true, fullscreen: false }, panel: { id: 'p' }, tab: { navigation: { address: 'dsh-page://context-lens', params: { turnSeq }, revision: 1 }, signal: new AbortController().signal } }),
  t,
  listTurns: () => success(store.listTurns('room-1')),
  getSessionTrend: () => success(store.getSessionTrend('room-1')),
  getTurn: (_s: string, seq: number) => success(store.getTurn('room-1', seq)),
  getRequest: (_s: string, seq: number) => success(store.getRequest('room-1', seq)),
  getTurnTiming: (_s: string, seq: number) => success(store.getTurnTiming('room-1', seq)),
  openMemberAt: (session: string, at: number) => { console.log('openMemberAt', session, at) },
} as unknown as InspectorTabProps

function Preview() {
  const narrow = params.get('narrow') === '1'
  return <main data-theme={params.get('dark') === '1' ? 'dark' : 'light'}>
    <div className="preview-panel" style={{ width: narrow ? '390px' : '100%', height: 'calc(100vh - 24px)' }}><InspectorPanel {...props} /></div>
  </main>
}

createRoot(document.getElementById('app')!).render(<Preview />)
