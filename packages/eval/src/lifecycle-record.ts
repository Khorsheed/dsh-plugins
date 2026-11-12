import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'

export const EVAL_LIFECYCLE_RECORD = 'plugin:eval/lifecycle'
export type EvalLifecycleStage = 'run-completed' | 'judge-completed' | 'human-final'

export interface EvalLifecycleNotice {
  readonly version: 1
  readonly stage: EvalLifecycleStage
  readonly runId: string
  readonly experimentId: string | null
  readonly title: string
  readonly dedupeKey: string
}

declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    'plugin:eval/lifecycle': EvalLifecycleNotice
  }
}

export function evalLifecycleNoticeOf(event: SessionEventLike): (EvalLifecycleNotice & { seq: number; time: number }) | undefined {
  const candidate = event as { type: string; data: unknown; seq: unknown; time: unknown; ignorable?: boolean }
  if (candidate.ignorable !== true || candidate.type !== EVAL_LIFECYCLE_RECORD) return undefined
  const data = candidate.data as Partial<EvalLifecycleNotice> | null
  if (data?.version !== 1 || typeof data.runId !== 'string' || typeof data.title !== 'string' || typeof data.dedupeKey !== 'string') return undefined
  if (data.stage !== 'run-completed' && data.stage !== 'judge-completed' && data.stage !== 'human-final') return undefined
  if (data.experimentId !== null && typeof data.experimentId !== 'string') return undefined
  if (typeof candidate.seq !== 'number' || typeof candidate.time !== 'number') return undefined
  return {
    version: 1,
    stage: data.stage,
    runId: data.runId,
    experimentId: data.experimentId,
    title: data.title,
    dedupeKey: data.dedupeKey,
    seq: candidate.seq,
    time: candidate.time,
  }
}
