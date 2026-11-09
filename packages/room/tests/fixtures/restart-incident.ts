/**
 * A synthetic room shaped like the 2026-11-09 restart incident (design
 * proposals/active/2026-11-09-restart-recovery-consolidation.md, 「事件经过」 and
 * section G): the event SHAPES of that room's log, the two members' core
 * ledger rows and its last `room/plan-state` — no session content. Every
 * name and text below is invented; the comments name the incident's seqs
 * each step stands for.
 *
 * Cast: 总编排 (the coordinator, a CLI member) ran a formal-goal attempt
 * (task-a); 地图匠 ran a round the coordinator dispatched (#1530) with a goal
 * attempt queued behind it (task-b, #1539); 剧情师's report waited for the
 * coordinator (#1562). Then an OLD-version restart: 待对账 everywhere, an
 * English 「回报」, a human 「全部继续」, a human reconciliation of the goal
 * attempt on the members page, duplicate release reminders, and a plan left
 * paused with task-a's attempt `uncertain` and task-b's `queued` (#1613).
 * @module
 */
import type { Session } from '@deepseek-ai/dsh-session'
import type { RoomPlan } from '../../src/plan.ts'
import { DELIVERY_UNKNOWN_TEXT, MEMBER_WAITING_TEXT, MOVED_ON_TEXT, RESTART_UNKNOWN_TEXT, SUPERSEDED_BACKLOG_TEXT } from '../../src/dispatch.ts'

/** A ledger row the room's core double seeds (run-entry-shim's SeededRow plus the fields a real ledger carries). */
export interface IncidentLedgerRow {
  id: string
  key?: string
  caller: string
  status: string
  error?: string
  interrupted?: 'restart'
  reconciledAt?: number
}

/** Who sits in the room (their stable member ids). */
export interface IncidentCast {
  readonly coordinator: { readonly id: string; readonly name: string; readonly child: string }
  readonly mapper: { readonly id: string; readonly name: string; readonly child: string }
  readonly writer: { readonly id: string; readonly name: string }
}

/** What the seeded room holds, by the incident seq each id stands for. */
export interface SeededIncident {
  /** #1530: the coordinator's dispatch to 地图匠 (interrupted, then moved on from by the human's 全部继续). */
  readonly d1530: string
  /** #1539: task-b's attempt to 地图匠, queued, cancelled as 「被取代」 by recovery. */
  readonly d1539: string
  /** #1541: task-a's attempt to the coordinator (interrupted, reconciled `done` by a human in the core). */
  readonly d1541: string
  /** #1562: 剧情师's report held for the coordinator. */
  readonly d1562: string
  /** #1574: the timeout release (later really run). */
  readonly d1574: string
  /** #1580: the English 「结果不确定」 report on #1530 to the coordinator. */
  readonly d1580: string
  /** #1585 #1586 #1596 #1605 #1608: duplicate restart releases (R1's subject). */
  readonly releases: readonly string[]
  /** #1592: the human's 全部继续, one delivery per member. */
  readonly d1592: { readonly coordinator: string; readonly mapper: string }
  /** #1601: the 「被取代」 report on #1539 to the coordinator. */
  readonly d1601: string
  /** task-a's and task-b's first attempts. */
  readonly attemptA: string
  readonly attemptB: string
  /** The seeded plan (the #1613 shape). */
  readonly plan: RoomPlan
  /** The core's ledgers as they stand at #1613 (after the human's reconciliation and cancellations). */
  readonly ledgers: { readonly coordinator: readonly IncidentLedgerRow[]; readonly mapper: readonly IncidentLedgerRow[] }
}

const GOAL = 'north-ridge'

function basePlan(cast: IncidentCast, now: number): RoomPlan {
  const task = (id: string, owner: string, title: string): RoomPlan['tasks'][number] => ({
    id, title, stageId: 's1', kind: 'task', ownerMemberId: owner, instruction: `完成「${title}」`, criteria: ['有可核对的产物'],
    inputRefs: [], artifactPaths: [], dependsOn: [], status: 'pending', attempts: [],
  })
  return {
    version: 1, id: GOAL, revision: 3, objective: '北岭关卡上线', status: 'running', activeMs: 0, resumedAt: now,
    budget: { maxParallel: 3, maxAttempts: 12, maxAttemptsPerTask: 3, maxActiveMs: 7_200_000 },
    stages: [{ id: 's1', title: '北岭' }],
    tasks: [task('task-a', cast.coordinator.id, '整合北岭'), task('task-b', cast.mapper.id, '北岭关卡数据')],
    requests: [],
  }
}

/**
 * Append the incident's shape to a room whose roster already holds the cast
 * (the coordinator and 地图匠 as CLI members with child sessions, 剧情师 any
 * kind). Writes the coordinator handoff first.
 * @param room - the live room session.
 * @param cast - the members' ids, names and child ids.
 * @param now - the time the incident's rounds started (defaults to now).
 * @returns the ids of what was written, the seeded plan and the core ledgers to seed.
 */
export function seedRestartIncident(room: Session, cast: IncidentCast, now = Date.now()): SeededIncident {
  const { coordinator, mapper, writer } = cast
  const id = (seq: number, member: string): string => `${seq}:${member}`
  room.append('room/coordinator', { version: 1, memberId: coordinator.id, revision: 1, previousMemberId: '', handoff: '你是协调者。' })
  // Before the restart: the goal runs; task-a's attempt is admitted, task-b's queued.
  const plan = basePlan(cast, now)
  const a = plan.tasks[0]!; const b = plan.tasks[1]!
  // #1530 — the coordinator's dispatch to 地图匠, admitted.
  const s1530 = room.append('room/dispatch', { id: 'inc-1530', origin: 'coordinator', kind: 'task', from: coordinator.id, replyTo: coordinator.id,
    targets: [mapper.name], targetIds: [mapper.id], text: '把北岭的地形格子补完。' }).seq
  room.append('room/delivery-state', { id: id(s1530, mapper.id), dispatchSeq: s1530, memberId: mapper.id, state: 'running' })
  room.append('room/run-state', { member: mapper.name, runId: id(s1530, mapper.id), state: 'running', startedAt: now, executionId: 'exec-1530' })
  // #1539 — task-b's attempt, queued behind #1530 in 地图匠's core queue.
  const s1539 = room.append('room/dispatch', { id: 'inc-1539', origin: 'coordinator', targets: [mapper.name], targetIds: [mapper.id], replyTo: coordinator.id,
    text: `Goal ${GOAL}, task task-b, attempt attempt-b1.`, plan: { goalId: GOAL, taskId: 'task-b', attemptId: 'attempt-b1' } }).seq
  b.status = 'running'; b.attempts.push({ id: 'attempt-b1', deliveryId: 'inc-1539', number: 1, status: 'queued', createdAt: now })
  // #1541 — task-a's attempt to the coordinator itself, admitted.
  const s1541 = room.append('room/dispatch', { id: 'inc-1541', origin: 'coordinator', targets: [coordinator.name], targetIds: [coordinator.id],
    text: `Goal ${GOAL}, task task-a, attempt attempt-a1.`, plan: { goalId: GOAL, taskId: 'task-a', attemptId: 'attempt-a1' } }).seq
  a.status = 'running'; a.attempts.push({ id: 'attempt-a1', deliveryId: 'inc-1541', number: 1, status: 'running', createdAt: now, startedAt: now })
  room.append('room/delivery-state', { id: id(s1541, coordinator.id), dispatchSeq: s1541, memberId: coordinator.id, state: 'running' })
  room.append('room/run-state', { member: coordinator.name, runId: id(s1541, coordinator.id), state: 'running', startedAt: now, executionId: 'exec-1541' })
  room.append('room/plan-state', structuredClone(plan))
  // #1562/#1563 — 剧情师's report held for the busy coordinator.
  const s1562 = room.append('room/dispatch', { id: 'inc-1562', origin: 'report', targets: [coordinator.name], targetIds: [coordinator.id], held: true, hop: 2,
    reportFor: `0:${writer.id}`, text: '北岭三段对话写好了。' }).seq
  room.append('room/report-gate', { dispatchSeq: s1562, memberId: coordinator.id, member: coordinator.name, verdict: 'hold', reason: 'model' })
  // #1574 — the timeout release (queued behind the coordinator's round).
  const release = (reason: 'timeout' | 'restart', key: string): number => room.append('room/dispatch', { id: key, origin: 'report', targets: [coordinator.name], targetIds: [coordinator.id], hop: 1,
    releases: [s1562], releaseReason: reason, text: '（以上 1 条回报一直等着交给你：#m1562。用户也已在房间里看到，不要复述。）' }).seq
  const s1574 = release('timeout', 'inc-1574')
  // #1576 — the OLD-version restart: the plan pauses, task-a's attempt turns uncertain.
  const paused = structuredClone(plan)
  paused.status = 'paused'; paused.reason = 'Reconcile uncertain attempts before continuing'; delete paused.resumedAt; paused.revision++
  paused.tasks[0]!.status = 'failed'
  Object.assign(paused.tasks[0]!.attempts[0]!, { status: 'uncertain', error: 'Execution outcome is unknown after restart' })
  room.append('room/plan-state', structuredClone(paused))
  // #1577/#1578 — #1530 uncertain, its card failed with the English reason.
  room.append('room/delivery-state', { id: id(s1530, mapper.id), dispatchSeq: s1530, memberId: mapper.id, state: 'uncertain', error: DELIVERY_UNKNOWN_TEXT })
  room.append('room/run-state', { member: mapper.name, runId: id(s1530, mapper.id), startedAt: now, state: 'failed', error: RESTART_UNKNOWN_TEXT, executionId: 'exec-1530' })
  // #1579–#1581 — the 「结果不确定」 report on #1530, delivered at once (rule `failure`).
  const s1580 = room.append('room/dispatch', { id: 'inc-1580', origin: 'report', targets: [coordinator.name], targetIds: [coordinator.id], hop: 2,
    reportFor: id(s1530, mapper.id), text: RESTART_UNKNOWN_TEXT }).seq
  room.append('room/report-gate', { dispatchSeq: s1580, memberId: coordinator.id, member: coordinator.name, verdict: 'deliver', reason: 'failure' })
  // #1582 — the core refused it: 等待对账.
  room.append('room/run-state', { member: coordinator.name, runId: id(s1580, coordinator.id), state: 'failed', startedAt: now, elapsedMs: 0, error: MEMBER_WAITING_TEXT })
  // #1583/#1584 — the coordinator's own attempt uncertain.
  room.append('room/delivery-state', { id: id(s1541, coordinator.id), dispatchSeq: s1541, memberId: coordinator.id, state: 'uncertain', error: DELIVERY_UNKNOWN_TEXT })
  room.append('room/run-state', { member: coordinator.name, runId: id(s1541, coordinator.id), startedAt: now, state: 'failed', error: RESTART_UNKNOWN_TEXT, executionId: 'exec-1541' })
  // #1585/#1586 — two identical restart releases.
  const s1585 = release('restart', 'inc-1585')
  const s1586 = release('restart', 'inc-1586')
  // #1587/#1592 — the human's 全部继续 to both (the coordinator's part waits behind its goal attempt).
  const s1592 = room.append('room/dispatch', { id: 'inc-1592', origin: 'human', targets: [mapper.name, coordinator.name], targetIds: [mapper.id, coordinator.id],
    continues: [id(s1530, mapper.id), id(s1541, coordinator.id)], text: '刚才实例重启，打断了你上一轮的工作。继续之前请先核对已经做完的部分。' }).seq
  // #1590/#1591 — #1530 closed as 「按没做完处理」.
  room.append('room/delivery-state', { id: id(s1530, mapper.id), dispatchSeq: s1530, memberId: mapper.id, state: 'cancelled', text: MOVED_ON_TEXT })
  room.append('room/run-state', { member: mapper.name, runId: id(s1530, mapper.id), startedAt: now, state: 'cancelled', executionId: 'exec-1530' })
  // #1595 — task-b's attempt superseded: written by recovery, never through the plan.
  room.append('room/delivery-state', { id: id(s1539, mapper.id), dispatchSeq: s1539, memberId: mapper.id, state: 'cancelled', text: SUPERSEDED_BACKLOG_TEXT })
  const s1596 = release('restart', 'inc-1596')
  // #1597–#1600 — 地图匠 checks and finishes the work in the 全部继续 round (reported to nobody).
  const later = now + 300_000
  room.append('room/delivery-state', { id: id(s1592, mapper.id), dispatchSeq: s1592, memberId: mapper.id, state: 'running' })
  room.append('room/run-state', { member: mapper.name, runId: id(s1592, mapper.id), state: 'running', startedAt: later, executionId: 'exec-1592m' })
  room.append('room/speech', { member: mapper.name, text: '核对过：格子补完了，测试通过。', runId: id(s1592, mapper.id), durationMs: 60_000 })
  room.append('room/run-state', { member: mapper.name, runId: id(s1592, mapper.id), state: 'done', startedAt: later, elapsedMs: 60_000, executionId: 'exec-1592m' })
  room.append('room/delivery-state', { id: id(s1592, mapper.id), dispatchSeq: s1592, memberId: mapper.id, state: 'done', text: '核对过：格子补完了，测试通过。' })
  // #1601 — the 「被取代」 cancellation reported to the coordinator as a report.
  const s1601 = room.append('room/dispatch', { id: 'inc-1601', origin: 'report', targets: [coordinator.name], targetIds: [coordinator.id], hop: 2,
    reportFor: id(s1539, mapper.id), plan: { goalId: GOAL }, text: SUPERSEDED_BACKLOG_TEXT }).seq
  // #1603/#1604 — a human 「确认已完成」 on the members page: the room follows the core.
  room.append('room/delivery-state', { id: id(s1541, coordinator.id), dispatchSeq: s1541, memberId: coordinator.id, state: 'done', text: '不确认是否做完' })
  room.append('room/run-state', { member: coordinator.name, runId: id(s1541, coordinator.id), startedAt: now, state: 'done', executionId: 'exec-1541' })
  const s1605 = release('restart', 'inc-1605')
  // #1606–#1610 — the coordinator finally runs #1574; #1562 is carried.
  room.append('room/delivery-state', { id: id(s1574, coordinator.id), dispatchSeq: s1574, memberId: coordinator.id, state: 'running' })
  room.append('room/run-state', { member: coordinator.name, runId: id(s1574, coordinator.id), state: 'running', startedAt: later, executionId: 'exec-1574' })
  room.append('room/delivery-state', { id: id(s1562, coordinator.id), dispatchSeq: s1562, memberId: coordinator.id, state: 'done', text: 'carried' })
  room.append('room/report-gate', { dispatchSeq: s1562, memberId: coordinator.id, member: coordinator.name, verdict: 'release', reason: 'carried' })
  const s1608 = release('restart', 'inc-1608')
  room.append('room/run-state', { member: coordinator.name, runId: id(s1574, coordinator.id), state: 'done', startedAt: later, elapsedMs: 30_000, executionId: 'exec-1574' })
  room.append('room/delivery-state', { id: id(s1574, coordinator.id), dispatchSeq: s1574, memberId: coordinator.id, state: 'done' })
  // #1613 — the coordinator retried task-a: pending again, its uncertain attempt still there; task-b's attempt still `queued`.
  const last = structuredClone(paused)
  last.revision++
  last.tasks[0]!.status = 'pending'
  last.tasks[0]!.attempts[0]!.retry = { by: coordinator.id, reason: '重新来', time: later }
  room.append('room/plan-state', structuredClone(last))
  const releases = [s1585, s1586, s1596, s1605, s1608].map(seq => id(seq, coordinator.id))
  const reconciledAt = later
  return {
    d1530: id(s1530, mapper.id), d1539: id(s1539, mapper.id), d1541: id(s1541, coordinator.id), d1562: id(s1562, coordinator.id),
    d1574: id(s1574, coordinator.id), d1580: id(s1580, coordinator.id), releases,
    d1592: { coordinator: id(s1592, coordinator.id), mapper: id(s1592, mapper.id) }, d1601: id(s1601, coordinator.id),
    attemptA: 'attempt-a1', attemptB: 'attempt-b1', plan: last,
    ledgers: {
      // The coordinator: #1541 reconciled `done` by a human; #1574 ran; the seven
      // rows that queued behind #1541 (#1580, five releases, #1592) cancelled by hand.
      coordinator: [
        { id: 'exec-1541', key: id(s1541, coordinator.id), caller: 'room', status: 'done', error: '不确认是否做完', reconciledAt },
        { id: 'exec-1580', key: id(s1580, coordinator.id), caller: 'room', status: 'cancelled' },
        ...releases.map((key, index) => ({ id: `exec-rel-${index}`, key, caller: 'room', status: 'cancelled' })),
        { id: 'exec-1592c', key: id(s1592, coordinator.id), caller: 'room', status: 'cancelled' },
        { id: 'exec-1574', key: id(s1574, coordinator.id), caller: 'room', status: 'done' },
      ],
      // 地图匠: #1530 「按没做完处理」 (a reconciliation), #1592 done.
      mapper: [
        { id: 'exec-1530', key: id(s1530, mapper.id), caller: 'room', status: 'cancelled', error: MOVED_ON_TEXT, reconciledAt },
        { id: 'exec-1592m', key: id(s1592, mapper.id), caller: 'room', status: 'done' },
      ],
    },
  }
}
