/**
 * Wire types shared by the host Remote and the browser panel.
 * @module @khorsheed/dsh-video-studio/types
 */
export type {
  Chapter, Edit, ExportKind, JobPayload, SettingValue, EditKind, EditState, Job, JobKind, JobState, PanelEvent, Project, ProjectStatus, ProposalGroup,
  Segment, SettingKey, Settings, Show, Source, SourceRole, Speaker, SpeakerOrigin, SubtitleStyle, Token, TokenKind, Voiceprint,
} from './core/types.ts'
export type { EffectiveSetting, SettingSource } from './core/settings.ts'
export type { GlobalConfig } from './store.ts'
export type { ModelState, ModelStatus } from './media/models.ts'
export type { Overview, ProjectSummary, ProjectView, Toolchain } from './service.ts'

import type { SettingValue } from './core/types.ts'

export interface ProjectRef {
  projectId: string
}

export interface CreateProjectRequest {
  name: string
  showId?: string | null
  /** Bind the new project to this session. */
  sessionId?: string
}

export interface CreateShowRequest {
  name: string
}

export interface ImportRequest extends ProjectRef {
  paths: string[]
}

export interface CutRequest extends ProjectRef {
  start: number
  end: number
  cut: boolean
}

export interface DecideRequest extends ProjectRef {
  groupId?: string
  editIds?: string[]
  state: 'applied' | 'rejected'
}

export interface SpeakerRenameRequest extends ProjectRef {
  speakerId: string
  name: string
}

export interface SpeakerMergeRequest extends ProjectRef {
  fromId: string
  intoId: string
}

export interface SegmentReassignRequest extends ProjectRef {
  segmentId: string
  speakerId: string
}

export interface ProjectSettingRequest extends ProjectRef {
  key: string
  /** Omitted for reset / save-to-show. */
  value?: SettingValue
  action: 'set' | 'reset' | 'saveToShow'
}

export interface ShowSettingRequest {
  showId: string
  name?: string
  key?: string
  value?: SettingValue
}

export interface VoiceprintDeleteRequest {
  showId: string
  voiceprintId: string
}

export interface GlobalPatchRequest {
  libraryDir?: string
  exportDir?: string
  ffmpegPath?: string
  ffprobePath?: string
  cleanupDays?: number
  key?: string
  value?: SettingValue
}

export interface ClipRequest extends ProjectRef {
  start: number
  end: number
  raw?: boolean
}

export interface ExportRequest extends ProjectRef {
  kinds: Array<'audio' | 'video' | 'subtitles' | 'text'>
}

export interface SessionRef {
  sessionId: string
}

export interface BindRequest extends SessionRef, ProjectRef {}

export interface JobRef {
  jobId: string
}

export interface TextFixRequest extends ProjectRef {
  start: number
  end: number
  text: string
}

export interface ReplaceRequest extends ProjectRef {
  from: string
  to: string
  /** Also store the rule in the show for later transcripts. */
  remember: boolean
}

export interface KeywordCutRequest extends ProjectRef {
  needle: string
}

export interface AudioChunkRequest extends ProjectRef {
  start: number
  duration: number
}

/** Raw 16-bit little-endian mono PCM, base64. */
export interface AudioChunk {
  sampleRate: number
  start: number
  samples: string
  ended: boolean
}
