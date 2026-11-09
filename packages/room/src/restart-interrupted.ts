/**
 * 被重启打断 (restart-recovery consolidation, 2026-11-09): a round a host
 * restart cut off is closed — `cancelled` + `endedBy: 'restart'` on its
 * `room/delivery-state` and `room/run-state` edges — and continued as a new
 * round. This module is the one reader of that fact, shared by the room
 * service and the browser, so every place that asks "was this round cut off
 * by a restart?" answers alike for new edges and for every shape older logs
 * carry (read by data, never by date).
 * @module @khorsheed/dsh-room/restart-interrupted
 */

/** The reason a closed round shows: its card's title line, the edge's text. */
export const RESTART_INTERRUPTED_TEXT = '被重启打断'

/**
 * The human pressed 「停止」 on a round a restart cut off: it is not continued.
 * The interrupted delivery's last edge carries it, and it is the one thing the
 * dispatcher hears about that round (user decision 2026-11-09, open item 5).
 */
export const RESTART_STOPPED_TEXT = '被重启打断，已停止'

/**
 * The note a message that continues a member's interrupted round carries
 * ahead of its own words (when it is not the continue message itself): the
 * member checks what it had done first.
 */
export const RESTART_CONTINUE_NOTE = '（你上一轮被实例重启打断了。先核对上一轮已经做过什么，再处理下面这件事。）'

// ── Legacy texts (read only; written before 2026-11-09) ────────────────────

/** A run a restart cut off, as recovery wrote it: the run row's failure reason. */
export const RESTART_UNKNOWN_TEXT = 'Execution outcome is unknown after restart; reconcile before retrying'
/** The prefix every legacy restart-failed run reason starts with. */
export const RESTART_INTERRUPTED_PREFIX = 'Execution outcome is unknown after restart'
/** A delivery a restart cut off, as recovery wrote it (`uncertain` edge). */
export const DELIVERY_UNKNOWN_TEXT = 'Host restarted before a durable settlement; reconcile before retrying'
/** A human message closed a lost round as not finished. */
export const MOVED_ON_TEXT = '你发了新消息；被重启打断的这一轮按没做完处理'
/** The room's auto-continue closed a lost round as not finished. */
export const AUTO_CONTINUE_MOVED_ON_TEXT = '重启后房间自动继续；被重启打断的这一轮按没做完处理'
/** A cross-room help request closed a lost round as not finished. */
export const HELP_MOVED_ON_TEXT = '另一个协作间来求助；被重启打断的这一轮按没做完处理'
/** A human stopped a task whose round a restart had lost. */
export const STOPPED_UNCHECKED_TEXT = '任务已被停止；这一轮的结果没有核对'
/** A message that queued behind a lost round, closed when an earlier move-on skipped it. */
export const SUPERSEDED_BACKLOG_TEXT = '被重启打断前排队，已被后续消息取代'
/** A message that queued behind a lost round and rode along with the move-on message. */
export const MERGED_BACKLOG_TEXT = '已并入下一条消息一起送达'
/** A round the core refused while its member waited for 待对账 (a run row that never ran). */
export const MEMBER_WAITING_TEXT = '等待对账：该成员有一轮被重启打断、结果不确定。在成员编辑弹窗的「待对账」里核对后，这条消息会自动发出'

/** The legacy cancellations that closed a lost round (the round counts as interrupted, and as handled). */
const LEGACY_CLOSED = new Set([MOVED_ON_TEXT, AUTO_CONTINUE_MOVED_ON_TEXT, HELP_MOVED_ON_TEXT, STOPPED_UNCHECKED_TEXT])

/**
 * One edge, or one projected row, in the shape every reader can give: a
 * delivery-state edge (`state`, `text`, `error`), a projected delivery
 * (`status` as `state`, `note` as `text`), a run (`state`, `error`).
 */
export interface RoundEnding {
  readonly state: string
  readonly endedBy?: string
  readonly text?: string
  readonly error?: string
}

/**
 * Whether a round ended because a host restart cut it off — by the new
 * `endedBy` mark, or by any shape an older log carries: a delivery's
 * `uncertain` edge, a legacy 「按没做完处理」/「任务已被停止」 cancellation, a
 * 「被取代」 queued message, or a run failed with the legacy restart reason.
 * (A run the core refused while its member waited — `MEMBER_WAITING_TEXT` —
 * never ran: not an interrupted round.)
 * @param edge - the edge or row (see {@link RoundEnding}).
 * @returns whether it reads 「被重启打断」.
 */
export function interruptedByRestart(edge: RoundEnding | undefined): boolean {
  if (edge === undefined) return false
  if (edge.endedBy === 'restart') return true
  if (edge.state === 'uncertain') return true
  if (edge.state === 'cancelled' && edge.text !== undefined && (LEGACY_CLOSED.has(edge.text) || edge.text === SUPERSEDED_BACKLOG_TEXT)) return true
  return edge.state === 'failed' && edge.error !== undefined && edge.error.startsWith(RESTART_INTERRUPTED_PREFIX)
}

/**
 * Whether an interrupted round needs no decision any more without being
 * continued: the human stopped it (「停止」), or an older version closed it
 * when a message moved on from it (that message was its continuation).
 * @param edge - the interrupted delivery's last edge (or projected row).
 */
export function restartHandled(edge: RoundEnding | undefined): boolean {
  if (edge?.text === undefined) return false
  return edge.text === RESTART_STOPPED_TEXT || LEGACY_CLOSED.has(edge.text)
}

/** A projected delivery (`status`/`note`) as a {@link RoundEnding}. */
export function deliveryEnding(row: { readonly status: string; readonly endedBy?: string; readonly note?: string; readonly error?: string } | undefined): RoundEnding | undefined {
  return row === undefined ? undefined : {
    state: row.status,
    ...row.endedBy === undefined ? {} : { endedBy: row.endedBy },
    ...row.note === undefined ? {} : { text: row.note },
    ...row.error === undefined ? {} : { error: row.error },
  }
}

/**
 * Whether a queued report is an obsolete restart artefact that must never
 * reach its recipient: the legacy 「结果不确定」 report, a 「被取代」/「已并入」
 * notice, or a 「Human reconciled …」 goal message.
 * @param text - the report dispatch's text.
 */
export function obsoleteRestartReport(text: string): boolean {
  return text === RESTART_UNKNOWN_TEXT || text === SUPERSEDED_BACKLOG_TEXT || text === MERGED_BACKLOG_TEXT || text.startsWith('Human reconciled task ')
}

/** The cancellation text written on an obsolete restart report when recovery retires it. */
export const OBSOLETE_RESTART_REPORT_TEXT = '重启恢复收敛：这条旧回报不再送达'
