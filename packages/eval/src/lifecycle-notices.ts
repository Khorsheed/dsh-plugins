import { appendPluginRecord, pluginRecordOf, type Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { readExperiment } from './design/experiment-store.ts'
import type { RunReport } from './run/run.ts'
import { EVAL_LIFECYCLE_RECORD, evalLifecycleNoticeOf, type EvalLifecycleStage } from './lifecycle-record.ts'

export { EVAL_LIFECYCLE_RECORD, evalLifecycleNoticeOf } from './lifecycle-record.ts'
export type { EvalLifecycleNotice, EvalLifecycleStage } from './lifecycle-record.ts'

interface Hosts {
  get(name: string): unknown
}

interface NoticeInput {
  readonly stage: EvalLifecycleStage
  readonly runId: string
  readonly experimentId: string | null
  readonly dedupeKey: string
}

export class EvalLifecycleNotifier {
  constructor(
    private readonly hosts: Hosts | undefined,
    private readonly stateRoot: string | undefined,
  ) {}

  async runCompleted(report: RunReport, originSession: string): Promise<void> {
    if (report.dryRun || report.meta['cancelled'] === true || report.cells.length === 0) return
    const experimentId = typeof report.meta['experimentId'] === 'string' ? report.meta['experimentId'] : null
    await this.notify({ stage: 'run-completed', runId: report.runId, experimentId, dedupeKey: `${report.runId}:run-completed` }, originSession)
    const judge = report.meta['judge'] as { conditions?: unknown; samples?: unknown } | undefined
    const configured = Array.isArray(judge?.conditions) && judge.conditions.length > 0 && judge.samples !== 0
    const terminal = new Set(['judged', 'archived', 'releasable', 'released'])
    const judged = configured && report.cells.every(cell =>
      terminal.has(cell.finalState) && cell.verdicts !== undefined
      && cell.rejected === undefined && cell.halted !== true && cell.skipped === undefined && cell.cancelled === undefined,
    )
    if (judged) {
      await this.notify({ stage: 'judge-completed', runId: report.runId, experimentId, dedupeKey: `${report.runId}:judge-completed` }, originSession)
    }
  }

  async humanFinal(input: {
    readonly runId: string
    readonly ticket: string
    readonly experimentId: string | null
    readonly originSession: string | null
    readonly duplicate: boolean
  }): Promise<void> {
    if (input.duplicate || input.originSession === null || input.originSession === '') return
    await this.notify({
      stage: 'human-final',
      runId: input.runId,
      experimentId: input.experimentId,
      dedupeKey: `${input.runId}:${input.ticket}:human-final`,
    }, input.originSession)
  }

  private async notify(input: NoticeInput, originSession: string): Promise<boolean> {
    try {
      const sessions = this.hosts?.get('sessions') as { get?: (id: SessionId) => Session | undefined } | undefined
      const agents = this.hosts?.get('agents') as { get?: (id: SessionId) => { session: Session } | undefined } | undefined
      const session = sessions?.get?.(originSession as SessionId) ?? agents?.get?.(originSession as SessionId)?.session
      if (session === undefined) return false
      if (session.snapshotEvents().some(event => pluginRecordOf(event)?.type === EVAL_LIFECYCLE_RECORD
        && evalLifecycleNoticeOf(event)?.dedupeKey === input.dedupeKey)) return false
      let title = input.experimentId ?? input.runId
      if (this.stateRoot !== undefined && input.experimentId !== null) {
        const experiment = await readExperiment(this.stateRoot, input.experimentId).catch(() => undefined)
        title = experiment?.meta.name ?? title
      }
      appendPluginRecord(session, EVAL_LIFECYCLE_RECORD, { version: 1, ...input, title })
      return true
    } catch (error) {
      const logger = this.hosts?.get('logger') as { warn?: (...args: unknown[]) => void } | undefined
      logger?.warn?.(`eval: lifecycle notice failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
}
