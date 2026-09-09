/** Composed props contract for the missions session tab. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + the mission namespace).
import type {} from '@khorsheed/dsh-mission/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  MissionDetail, MissionExportPlanRequest, MissionExportPlanView, MissionExportRequest,
  MissionExportResultView, MissionGetRequest, MissionQueueRequest, MissionQueueResult, MissionRefRequest,
  MissionRetryRequest,
} from '../types.ts'
import type { createMissionsViewStore } from './store.ts'

/** The mission Remote namespace (queue/get/retry/isReleasable/exportPlan/exportRun), mounted by this plugin. */
export type MissionRemote = TypertRemoteNamespaceMap['mission']

/** Business face injected into the conversation.view missions entry. */
export interface MissionsViewInjected {
  /** The five-bucket queue (one RPC; bucket chips + run scope ride the request). */
  fetchQueue: (sessionId: SessionId, request: MissionQueueRequest) => Promise<RemoteResult<MissionQueueResult>>
  /** One mission's full detail (the row panel). */
  fetchMission: (sessionId: SessionId, request: MissionGetRequest) => Promise<RemoteResult<MissionDetail>>
  /** Re-run: open a new attempt (human gesture). */
  retryMission: (sessionId: SessionId, request: MissionRetryRequest) => Promise<RemoteResult<{ attempt: number }>>
  /** The release check. */
  checkReleasable: (sessionId: SessionId, request: MissionRefRequest) => Promise<RemoteResult<{ releasable: boolean }>>
  /** The export dialog's plan step: guarded layers to confirm. */
  planExport: (sessionId: SessionId, request: MissionExportPlanRequest) => Promise<RemoteResult<MissionExportPlanView>>
  /** The export dialog's confirm step: the confirmed list is re-checked host-side. */
  exportRun: (sessionId: SessionId, request: MissionExportRequest) => Promise<RemoteResult<MissionExportResultView>>
}

/** Full props of the missions view entry (runtime + store + injected + locale shares). */
export type MissionsViewProps =
  & PropsRuntime<'conversation.view'>
  & PropsStore<ReturnType<typeof createMissionsViewStore>>
  & InjectFace<MissionsViewInjected>
  & PropsLocale<'mission'>
