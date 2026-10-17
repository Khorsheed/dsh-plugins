/**
 * The videoStudio Remote: the 剪辑 panel's data face, a thin adapter over the
 * same `ctx.videoStudio` service core the model tools use. Projects are
 * deployment-level, so every method takes pure JSON args (no caller lookup);
 * the session id is passed explicitly where the panel follows a session.
 * Every mutation here is a panel (user) edit and is logged as a PanelEvent.
 *
 * @module @khorsheed/dsh-video-studio
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DEFAULT_SETTINGS } from './core/settings.ts'
import type { SettingKey, Settings, Show } from './core/types.ts'
import type { GlobalConfig } from './store.ts'
import type { Overview, ProjectView, VideoStudioService } from './service.ts'
import type { ModelSourceChoice, ModelStatus } from './media/models.ts'
import type {
  BindRequest, ClipRequest, CreateProjectRequest, CreateShowRequest, CutRequest, DecideRequest, ExportRequest,
  GlobalPatchRequest, ImportRequest, JobRef, ListMediaRequest, MediaFile, ProjectRef, ProjectSettingRequest, RenameProjectRequest, SegmentReassignRequest, SessionRef,
  ShowSettingRequest, SpeakerMergeRequest, SpeakerRenameRequest, VoiceprintDeleteRequest,
  AudioChunk, AudioChunkRequest, KeywordCutRequest, ReplaceRequest, TextFixRequest,
} from './types.ts'
import type { Job } from './core/types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    videoStudioRemote: VideoStudioRemoteService
  }
}

export interface VideoStudioRemoteConfig {}

function settingKey(key: string | undefined): SettingKey {
  if (!key || !(key in DEFAULT_SETTINGS)) throw new Error(`未知设置项：${String(key)}`)
  return key as SettingKey
}

export class VideoStudioRemoteService extends TypertRemoteService<VideoStudioRemoteConfig> {
  static inject = ['videoStudio']

  constructor(ctx: Context, _config: VideoStudioRemoteConfig = {}) {
    super(ctx, 'videoStudioRemote', { namespace: 'videoStudio' })
  }

  private get svc(): VideoStudioService {
    return this.ctx.videoStudio
  }

  /** Shows, project summaries, global settings, toolchain and model status. */
  @Remote('overview')
  overview(): Promise<Overview> {
    return this.svc.overview()
  }

  /** The project a session is working on, or null. */
  @Remote('bound')
  bound(request: SessionRef): Promise<string | null> {
    return this.svc.bound(request.sessionId)
  }

  @Remote('bind')
  async bind(request: BindRequest): Promise<void> {
    await this.svc.bind(request.sessionId, request.projectId)
  }

  @Remote('createShow')
  createShow(request: CreateShowRequest): Promise<Show> {
    return this.svc.createShow(request.name)
  }

  @Remote('updateShow')
  updateShow(request: ShowSettingRequest): Promise<Show> {
    const settings: Partial<Settings> | undefined = request.key ? { [settingKey(request.key)]: request.value } : undefined
    return this.svc.updateShow(request.showId, { ...(request.name !== undefined ? { name: request.name } : {}), ...(settings ? { settings } : {}) })
  }

  @Remote('deleteVoiceprint')
  deleteVoiceprint(request: VoiceprintDeleteRequest): Promise<Show> {
    return this.svc.deleteVoiceprint(request.showId, request.voiceprintId)
  }

  @Remote('createProject')
  async createProject(request: CreateProjectRequest): Promise<ProjectView> {
    const p = await this.svc.createProject({ name: request.name, showId: request.showId ?? null })
    if (request.sessionId) await this.svc.bind(request.sessionId, p.id)
    return this.svc.view(p.id)
  }

  @Remote('renameProject')
  async renameProject(request: RenameProjectRequest): Promise<ProjectView> {
    await this.svc.renameProject(request.projectId, request.name, 'user')
    return this.svc.view(request.projectId)
  }

  @Remote('deleteProject')
  async deleteProject(request: ProjectRef): Promise<void> {
    await this.svc.deleteProject(request.projectId)
  }

  @Remote('project')
  project(request: ProjectRef): Promise<ProjectView> {
    return this.svc.view(request.projectId)
  }

  /** Media files directly inside a folder — the folder-pick import lists them. */
  @Remote('listMedia')
  listMedia(request: ListMediaRequest): Promise<MediaFile[]> {
    return this.svc.listMediaFiles(request.dir)
  }

  @Remote('importSources')
  async importSources(request: ImportRequest): Promise<ProjectView> {
    await this.svc.importSources(request.projectId, request.paths, 'user', request.continuous ?? false)
    return this.svc.view(request.projectId)
  }

  @Remote('setCut')
  async setCut(request: CutRequest): Promise<ProjectView> {
    await this.svc.setCut(request.projectId, request.start, request.end, request.cut, 'user')
    return this.svc.view(request.projectId)
  }

  @Remote('decide')
  async decide(request: DecideRequest): Promise<ProjectView> {
    await this.svc.decide(request.projectId, { ...(request.groupId ? { groupId: request.groupId } : {}), ...(request.editIds ? { editIds: request.editIds } : {}) }, request.state, 'user')
    return this.svc.view(request.projectId)
  }

  @Remote('scan')
  async scan(request: ProjectRef): Promise<ProjectView> {
    await this.svc.scan(request.projectId, 'user')
    return this.svc.view(request.projectId)
  }

  @Remote('fixText')
  async fixText(request: TextFixRequest): Promise<ProjectView> {
    await this.svc.fixText(request.projectId, request.start, request.end, request.text, 'user')
    return this.svc.view(request.projectId)
  }

  @Remote('replaceAll')
  async replaceAll(request: ReplaceRequest): Promise<ProjectView> {
    await this.svc.replaceAll(request.projectId, request.from, request.to, 'user', request.remember)
    return this.svc.view(request.projectId)
  }

  @Remote('cutMatches')
  async cutMatches(request: KeywordCutRequest): Promise<ProjectView> {
    await this.svc.cutMatches(request.projectId, request.needle, 'user')
    return this.svc.view(request.projectId)
  }

  /** Raw PCM of the reference recording for the panel player. */
  @Remote('audioChunk')
  audioChunk(request: AudioChunkRequest): Promise<AudioChunk> {
    return this.svc.audioChunk(request.projectId, request.start, request.duration)
  }

  @Remote('renameSpeaker')
  async renameSpeaker(request: SpeakerRenameRequest): Promise<ProjectView> {
    await this.svc.renameSpeaker(request.projectId, request.speakerId, request.name, 'user')
    return this.svc.view(request.projectId)
  }

  @Remote('mergeSpeakers')
  async mergeSpeakers(request: SpeakerMergeRequest): Promise<ProjectView> {
    await this.svc.mergeSpeakers(request.projectId, request.fromId, request.intoId, 'user')
    return this.svc.view(request.projectId)
  }

  @Remote('reassignSegment')
  async reassignSegment(request: SegmentReassignRequest): Promise<ProjectView> {
    await this.svc.reassignSegment(request.projectId, request.segmentId, request.speakerId, 'user')
    return this.svc.view(request.projectId)
  }

  @Remote('projectSetting')
  async projectSetting(request: ProjectSettingRequest): Promise<ProjectView> {
    const key = settingKey(request.key)
    if (request.action === 'set') await this.svc.setProjectSetting(request.projectId, key, request.value as Settings[typeof key], 'user')
    else if (request.action === 'reset') await this.svc.resetProjectSetting(request.projectId, key, 'user')
    else await this.svc.saveSettingToShow(request.projectId, key, 'user')
    return this.svc.view(request.projectId)
  }

  @Remote('setGlobal')
  setGlobal(request: GlobalPatchRequest): Promise<GlobalConfig> {
    const { key, value, ...rest } = request
    const patch: Parameters<VideoStudioService['setGlobal']>[0] = { ...rest }
    if (key) patch.settings = { [settingKey(key)]: value } as Partial<Settings>
    return this.svc.setGlobal(patch)
  }

  @Remote('clip')
  clip(request: ClipRequest): Promise<string> {
    return this.svc.clip(request.projectId, request.start, request.end, request.raw === true)
  }

  @Remote('startExport')
  startExport(request: ExportRequest): Promise<Job> {
    return this.svc.startExport(request.projectId, request.kinds)
  }

  @Remote('retryTranscribe')
  retryTranscribe(request: ProjectRef): Promise<Job> {
    return this.svc.enqueue(request.projectId, 'transcribe', '分人与转写')
  }

  @Remote('cancelJob')
  async cancelJob(request: JobRef): Promise<void> {
    await this.svc.cancelJob(request.jobId)
  }

  @Remote('models')
  models(): Promise<ModelStatus[]> {
    return this.svc.models.refresh()
  }

  /** Start downloading any missing speech models (returns at once). */
  @Remote('downloadModels')
  async downloadModels(): Promise<ModelStatus[]> {
    const g = await this.svc.store.global()
    void this.svc.models.ensure(g.modelSource as ModelSourceChoice)
    return this.svc.models.list()
  }
}
