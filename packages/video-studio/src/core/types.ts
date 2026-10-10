/**
 * Video studio data model. Every edit is a range over the REFERENCE
 * recording's own timeline (seconds); output time is derived, never stored.
 * The shapes here are the on-disk format of project.json / shows/*.json —
 * changing a field is a storage-format change (see the Agent Note).
 */

export const SCHEMA_VERSION = 1

export type SubtitleStyle = 'standard' | 'big-center' | 'bottom-bar'

export interface Settings {
  /** Integrated loudness target for the podcast audio export (LUFS). */
  audioLoudness: number
  /** Integrated loudness target for the video export (LUFS). */
  videoLoudness: number
  /** Library-relative file names; '' = none. */
  introMusic: string
  outroMusic: string
  bedMusic: string
  subtitleStyle: SubtitleStyle
  /** Long pauses are shortened to this length (seconds), not cut. */
  pauseKeep: number
  /** Default pause threshold (seconds) — a gap longer than this is flagged. */
  pauseThreshold: number
  /** Per-speaker threshold overrides, keyed by speaker NAME (stable across episodes). */
  speakerPauseThreshold: Record<string, number>
  /** Tokens treated as fillers. */
  fillers: string[]
  /** Transcription corrections applied to every new transcript (wrong → right). */
  replacements: Record<string, string>
  /** Shownotes template; {title} {summary} {chapters} placeholders. */
  shownotes: string
}

export type SettingKey = keyof Settings

export interface Voiceprint {
  id: string
  name: string
  color: string
  /** Seconds of speech the embedding was averaged over. */
  sampleSec: number
  /** Number of projects this voice was matched in. */
  episodes: number
  updatedAt: string
}

export interface Show {
  schema: number
  id: string
  name: string
  createdAt: string
  settings: Settings
  voiceprints: Voiceprint[]
}

export type SourceRole = 'recording' | 'video' | 'music' | 'sfx'

export interface Source {
  id: string
  /** Absolute host path; files stay where they are. */
  path: string
  role: SourceRole
  durationSec: number
  hasAudio: boolean
  hasVideo: boolean
  /** Seconds to add to this source's time to get reference time (video alignment). */
  offsetSec: number
  width?: number | undefined
  height?: number | undefined
  sampleRate?: number | undefined
  channels?: number | undefined
}

export type SpeakerOrigin = { kind: 'diarization'; cluster: number } | { kind: 'track'; sourceId: string }

export interface Speaker {
  id: string
  /** Display name; '' until named. */
  name: string
  color: string
  origin: SpeakerOrigin
  /** Matched voiceprint id in the project's show, if any. */
  voiceprintId?: string | undefined
  /** Cosine similarity of the match, 0..1. */
  matchScore?: number | undefined
  /** Total seconds attributed to this speaker. */
  speechSec: number
}

export type TokenKind = 'word' | 'filler'

export interface Token {
  text: string
  start: number
  end: number
  kind: TokenKind
}

export interface Segment {
  id: string
  speakerId: string
  start: number
  end: number
  tokens: Token[]
}

export type EditKind = 'cut' | 'shorten' | 'gain' | 'text'
export type EditState = 'proposed' | 'applied' | 'rejected'

export interface Edit {
  id: string
  kind: EditKind
  start: number
  end: number
  /** text: the corrected text shown in place of the tokens in [start, end] (subtitles and transcript only, never audio). */
  text?: string | undefined
  /** text: what the tokens said before the correction. */
  from?: string | undefined
  /** shorten: kept length (s); gain: dB. */
  value?: number | undefined
  /** gain only: apply to this speaker's segments within the range. */
  speakerId?: string | undefined
  origin: 'user' | 'agent'
  state: EditState
  /** One ✓/✗ unit. User edits get their own singleton group. */
  group: string
  /** Why (shown in the panel for agent proposals). */
  reason?: string | undefined
}

export interface ProposalGroup {
  id: string
  title: string
  createdAt: string
}

export interface Chapter {
  id: string
  title: string
  /** Reference time. */
  start: number
}

export interface PanelEvent {
  seq: number
  at: string
  text: string
}

export type ProjectStatus = 'new' | 'processing' | 'editing' | 'exported'

export interface Project {
  schema: number
  id: string
  showId: string | null
  name: string
  createdAt: string
  updatedAt: string
  status: ProjectStatus
  settings: Settings
  overrides: SettingKey[]
  /** The source whose timeline every edit lives on. */
  referenceId: string | null
  sources: Source[]
  speakers: Speaker[]
  transcript: Segment[]
  edits: Edit[]
  groups: ProposalGroup[]
  chapters: Chapter[]
  events: PanelEvent[]
  /** Last event seq handed to the model. */
  modelSeenSeq: number
}

export type ExportKind = 'audio' | 'video' | 'subtitles' | 'text'

export interface JobPayload {
  kinds?: ExportKind[] | undefined
}

/** A settings value as it crosses the wire. */
export type SettingValue = number | string | string[] | Record<string, number> | Record<string, string>

export type JobKind = 'probe' | 'align' | 'proxy' | 'transcribe' | 'export'
export type JobState = 'queued' | 'running' | 'done' | 'failed'

export interface Job {
  id: string
  projectId: string
  kind: JobKind
  state: JobState
  /** 0..1 */
  progress: number
  label: string
  error?: string | undefined
  /** Export jobs: output files written. */
  outputs?: string[] | undefined
  /** Kind-specific input (export: which outputs). */
  payload?: JobPayload | undefined
  createdAt: string
  updatedAt: string
}
