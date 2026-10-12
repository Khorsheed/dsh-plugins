/**
 * Compile-time contract between the 剪辑 panel and its host half: the wire
 * verbs the pane receives, as an injected face.
 *
 * @module @khorsheed/dsh-video-studio/client/contract
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { GlobalStandardProps, InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the generated Remote API (ctx.remote merge + our namespace).
import type {} from '@khorsheed/dsh-video-studio/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  ClipRequest, CreateProjectRequest, CutRequest, DecideRequest, ExportRequest, GlobalConfig, GlobalPatchRequest, ImportRequest,
  Job, ModelStatus, Overview, ProjectSettingRequest, ProjectView, SegmentReassignRequest, Show, ShowSettingRequest,
  SpeakerMergeRequest, SpeakerRenameRequest, VoiceprintDeleteRequest,
  AudioChunk, AudioChunkRequest, KeywordCutRequest, ReplaceRequest, TextFixRequest,
} from '../types.ts'
import type { createVideoStudioStore } from './store.ts'

export type { RemoteResult }

type R<T> = Promise<RemoteResult<T>>

/** The business face every panel instance receives (the Remote verbs, session-scoped where needed). */
export interface VideoPaneInjected {
  overview: () => R<Overview>
  bound: () => R<string | null>
  bind: (projectId: string) => R<void>
  createShow: (name: string) => R<Show>
  updateShow: (request: ShowSettingRequest) => R<Show>
  deleteVoiceprint: (request: VoiceprintDeleteRequest) => R<Show>
  createProject: (request: Omit<CreateProjectRequest, 'sessionId'>) => R<ProjectView>
  project: (projectId: string) => R<ProjectView>
  importSources: (request: ImportRequest) => R<ProjectView>
  setCut: (request: CutRequest) => R<ProjectView>
  decide: (request: DecideRequest) => R<ProjectView>
  scan: (projectId: string) => R<ProjectView>
  renameSpeaker: (request: SpeakerRenameRequest) => R<ProjectView>
  mergeSpeakers: (request: SpeakerMergeRequest) => R<ProjectView>
  reassignSegment: (request: SegmentReassignRequest) => R<ProjectView>
  fixText: (request: TextFixRequest) => R<ProjectView>
  replaceAll: (request: ReplaceRequest) => R<ProjectView>
  cutMatches: (request: KeywordCutRequest) => R<ProjectView>
  audioChunk: (request: AudioChunkRequest) => R<AudioChunk>
  projectSetting: (request: ProjectSettingRequest) => R<ProjectView>
  setGlobal: (request: GlobalPatchRequest) => R<GlobalConfig>
  clip: (request: ClipRequest) => R<string>
  startExport: (request: ExportRequest) => R<Job>
  retryTranscribe: (projectId: string) => R<Job>
  cancelJob: (jobId: string) => R<void>
  models: () => R<ModelStatus[]>
  downloadModels: () => R<ModelStatus[]>
}

/** Full props of the panel. */
export type VideoPaneProps =
  & { sessionId: SessionId }
  & GlobalStandardProps
  & PropsStore<ReturnType<typeof createVideoStudioStore>>
  & InjectFace<VideoPaneInjected>
  & PropsLocale<'videoStudio'>
