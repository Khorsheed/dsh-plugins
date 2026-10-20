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
export type { Overview, ProjectSummary, ProjectView, Toolchain } from './service.ts'

import type { SettingValue } from './core/types.ts'

export type ModelState = 'missing' | 'downloading' | 'installed' | 'failed'

/**
 * One speech model as the transcription engine reports it — the same shape as
 * `@khorsheed/dsh-transcribe`'s `ModelStatus`, restated here so the panel's
 * wire types stand on their own (the engine is optional).
 */
export interface ModelStatus {
  id: string
  label: string
  bytes: number
  state: ModelState
  progress: number
  /** Bytes of resumable partial downloads left on disk (only when not installed). */
  partial?: number | undefined
  error?: string | undefined
}

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

export interface RenameProjectRequest extends ProjectRef {
  name: string
}

export interface ImportRequest extends ProjectRef {
  paths: string[]
  /** The recordings in this batch are legs of one continuous session (pause → resume), butt-joined in path order. */
  continuous?: boolean
}

export interface ListMediaRequest {
  dir: string
}

/** One audio/video file found directly inside a folder (the folder-pick import). */
export interface MediaFile {
  path: string
  name: string
  bytes: number
  kind: 'audio' | 'video'
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
  modelSource?: string
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
