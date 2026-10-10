/**
 * The video-studio service core: shows, projects, settings layers, the media
 * job queue, and every mutation the panel (Remote) and the model (tools)
 * perform. Both faces call the same methods; a panel-originated mutation also
 * appends a PanelEvent so the model learns about it on its next read.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { alignEnvelopes, envelope } from './core/align.ts'
import { scanTranscript } from './core/scan.ts'
import { DEFAULT_SETTINGS, effectiveSettings, resetProjectSetting, saveAsShowDefault, setProjectSetting, type EffectiveSetting } from './core/settings.ts'
import { buildCues, toAss, toPlainText, toSrt } from './core/subtitles.ts'
import { formatClock, keptRanges, outputDuration, removedRanges, toOutputTime } from './core/timeline.ts'
import { SCHEMA_VERSION, type Edit, type Job, type JobKind, type JobPayload, type Project, type SettingKey, type Settings, type Show, type Source, type Speaker } from './core/types.ts'
import { audioGraph, exportAudio, exportVideo, hasFilter, renderClip, videoGraph, windowOf } from './media/export.ts'
import { decodeMono, findBinary, probe, writeAsrWav } from './media/ffmpeg.ts'
import { ModelManager, speechModelPaths, type ModelStatus } from './media/models.ts'
import { runSpeech } from './media/speech.ts'
import { Store, newId, resolveStateRoot, type GlobalConfig } from './store.ts'

export const SPEAKER_COLORS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] as const

export type Origin = 'user' | 'agent'

export interface Toolchain {
  ffmpeg: string | null
  ffprobe: string | null
  /** The `subtitles` filter (libass) — without it subtitles ship as a soft track. */
  burnSubtitles: boolean
}

export interface ProjectSummary {
  id: string
  name: string
  showId: string | null
  status: Project['status']
  createdAt: string
  updatedAt: string
  sourceCount: number
  durationSec: number
  outputSec: number
}

export interface Overview {
  shows: Show[]
  projects: ProjectSummary[]
  global: GlobalConfig
  toolchain: Toolchain
  models: ModelStatus[]
}

export interface ProjectView {
  project: Project
  show: Show | null
  effective: EffectiveSetting[]
  durationSec: number
  outputSec: number
  jobs: Job[]
}

export type { ExportKind } from './core/types.ts'
import type { ExportKind } from './core/types.ts'

interface Logger {
  info(...a: unknown[]): void
  warn(...a: unknown[]): void
  error(...a: unknown[]): void
}

const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.aiff', '.aif', '.wma'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi'])

export class VideoStudioService {
  readonly store: Store
  readonly models: ModelManager
  private toolchainCache: Toolchain | null = null
  private jobs: Job[] = []
  private jobsLoaded: Promise<void> | null = null
  private pumping = false
  private disposed = false
  private readonly aborts = new Map<string, AbortController>()

  constructor(
    stateRoot: string | undefined,
    private readonly logger: Logger = console,
  ) {
    this.store = new Store(resolveStateRoot(stateRoot))
    this.models = new ModelManager(this.store.modelsDir)
  }

  dispose(): void {
    this.disposed = true
    for (const a of this.aborts.values()) a.abort()
  }

  // ───────────────────────── toolchain ─────────────────────────

  async toolchain(refresh: boolean = false): Promise<Toolchain> {
    if (this.toolchainCache && !refresh) return this.toolchainCache
    const g = await this.store.global()
    const ffmpeg = await findBinary('ffmpeg', g.ffmpegPath || undefined)
    const ffprobe = await findBinary('ffprobe', g.ffprobePath || undefined)
    const burnSubtitles = ffmpeg ? await hasFilter(ffmpeg, 'subtitles') : false
    this.toolchainCache = { ffmpeg, ffprobe, burnSubtitles }
    return this.toolchainCache
  }

  private async requireTools(): Promise<{ ffmpeg: string; ffprobe: string; burnSubtitles: boolean }> {
    const t = await this.toolchain()
    if (!t.ffmpeg || !t.ffprobe) throw new Error('没有找到 ffmpeg / ffprobe：请安装 ffmpeg，或在设置 → 全局里填写它的路径')
    return { ffmpeg: t.ffmpeg, ffprobe: t.ffprobe, burnSubtitles: t.burnSubtitles }
  }

  // ───────────────────────── overview / settings ─────────────────────────

  async overview(): Promise<Overview> {
    const [shows, projects, global, toolchain, models] = await Promise.all([
      this.store.listShows(),
      this.store.listProjects(),
      this.store.global(),
      this.toolchain(),
      this.models.refresh(),
    ])
    return { shows, projects: projects.map(summarize), global, toolchain, models }
  }

  async setGlobal(patch: Partial<Omit<GlobalConfig, 'settings'>> & { settings?: Partial<Settings> }): Promise<GlobalConfig> {
    return this.store.locked('global', async () => {
      const g = await this.store.global()
      const next: GlobalConfig = { ...g, ...patch, settings: { ...g.settings, ...(patch.settings ?? {}) } as Settings }
      await this.store.saveGlobal(next)
      if (patch.ffmpegPath !== undefined || patch.ffprobePath !== undefined) this.toolchainCache = null
      return next
    })
  }

  // ───────────────────────── shows ─────────────────────────

  async createShow(name: string, settings?: Partial<Settings>): Promise<Show> {
    const g = await this.store.global()
    const show: Show = {
      schema: SCHEMA_VERSION,
      id: newId('show'),
      name: name.trim() || '未命名节目',
      createdAt: new Date().toISOString(),
      settings: { ...g.settings, ...(settings ?? {}) } as Settings,
      voiceprints: [],
    }
    await this.store.saveShow(show)
    return show
  }

  async updateShow(showId: string, patch: { name?: string; settings?: Partial<Settings> }): Promise<Show> {
    return this.store.locked(`show:${showId}`, async () => {
      const show = await this.mustShow(showId)
      if (patch.name !== undefined) show.name = patch.name.trim() || show.name
      if (patch.settings) show.settings = { ...show.settings, ...patch.settings } as Settings
      await this.store.saveShow(show)
      return show
    })
  }

  async deleteVoiceprint(showId: string, voiceprintId: string): Promise<Show> {
    return this.store.locked(`show:${showId}`, async () => {
      const show = await this.mustShow(showId)
      show.voiceprints = show.voiceprints.filter((v) => v.id !== voiceprintId)
      await this.store.saveShow(show)
      await this.store.deleteVoiceprint(showId, voiceprintId)
      return show
    })
  }

  private async mustShow(id: string): Promise<Show> {
    const s = await this.store.getShow(id)
    if (!s) throw new Error(`没有这个节目：${id}`)
    return s
  }

  // ───────────────────────── projects ─────────────────────────

  async createProject(input: { name: string; showId?: string | null }): Promise<Project> {
    const g = await this.store.global()
    const show = input.showId ? await this.mustShow(input.showId) : null
    const now = new Date().toISOString()
    const p: Project = {
      schema: SCHEMA_VERSION,
      id: newId('prj'),
      showId: show?.id ?? null,
      name: input.name.trim() || '未命名工程',
      createdAt: now,
      updatedAt: now,
      status: 'new',
      settings: structuredClone(show?.settings ?? g.settings),
      overrides: [],
      referenceId: null,
      sources: [],
      speakers: [],
      transcript: [],
      edits: [],
      groups: [],
      chapters: [],
      events: [],
      modelSeenSeq: 0,
    }
    await this.store.saveProject(p)
    return p
  }

  async renameProject(projectId: string, name: string, origin: Origin): Promise<Project> {
    return this.mutate(projectId, origin, (p) => {
      p.name = name.trim() || p.name
      return `工程改名为「${p.name}」`
    })
  }

  async deleteProject(projectId: string): Promise<void> {
    for (const j of this.jobs.filter((j) => j.projectId === projectId && (j.state === 'queued' || j.state === 'running'))) {
      this.aborts.get(j.id)?.abort()
      j.state = 'failed'
      j.error = '工程已删除'
    }
    await this.store.locked(`project:${projectId}`, () => this.store.deleteProject(projectId))
    const b = await this.store.bindings()
    for (const [k, v] of Object.entries(b)) if (v === projectId) delete b[k]
    await this.store.saveBindings(b)
  }

  async view(projectId: string): Promise<ProjectView> {
    const project = await this.mustProject(projectId)
    const show = project.showId ? await this.store.getShow(project.showId) : null
    const g = await this.store.global()
    await this.loadJobs()
    const duration = referenceDuration(project)
    return {
      project,
      show,
      effective: effectiveSettings(project, show?.settings ?? null, g.settings),
      durationSec: duration,
      outputSec: outputDuration(duration, project.edits),
      jobs: this.jobs.filter((j) => j.projectId === projectId),
    }
  }

  async mustProject(id: string): Promise<Project> {
    const p = await this.store.getProject(id)
    if (!p) throw new Error(`没有这个工程：${id}`)
    return p
  }

  /** Read-modify-write a project under its lock; `fn` returns an event line for panel edits. */
  async mutate(projectId: string, origin: Origin, fn: (p: Project) => string | void | Promise<string | void>): Promise<Project> {
    return this.store.locked(`project:${projectId}`, async () => {
      const p = await this.mustProject(projectId)
      const line = await fn(p)
      if (line && origin === 'user') {
        const seq = (p.events[p.events.length - 1]?.seq ?? 0) + 1
        p.events.push({ seq, at: new Date().toISOString(), text: line })
        if (p.events.length > 200) p.events = p.events.slice(-200)
      }
      p.updatedAt = new Date().toISOString()
      await this.store.saveProject(p)
      return p
    })
  }

  // ───────────────────────── session binding ─────────────────────────

  async bind(sessionId: string, projectId: string): Promise<void> {
    await this.mustProject(projectId)
    await this.store.locked('bindings', async () => {
      const b = await this.store.bindings()
      b[sessionId] = projectId
      await this.store.saveBindings(b)
    })
  }

  async bound(sessionId: string): Promise<string | null> {
    const id = (await this.store.bindings())[sessionId]
    if (!id) return null
    return (await this.store.getProject(id)) ? id : null
  }

  // ───────────────────────── settings layers ─────────────────────────

  private async fallbackFor(p: Project): Promise<{ show: Show | null; fallback: Settings }> {
    const show = p.showId ? await this.store.getShow(p.showId) : null
    return { show, fallback: show?.settings ?? (await this.store.global()).settings }
  }

  async setProjectSetting<K extends SettingKey>(projectId: string, key: K, value: Settings[K], origin: Origin): Promise<Project> {
    if (!(key in DEFAULT_SETTINGS)) throw new Error(`未知设置项：${String(key)}`)
    return this.mutate(projectId, origin, async (p) => {
      const { fallback } = await this.fallbackFor(p)
      setProjectSetting(p, fallback, key, value)
      return `设置「${String(key)}」改为 ${JSON.stringify(value)}`
    })
  }

  async resetProjectSetting(projectId: string, key: SettingKey, origin: Origin): Promise<Project> {
    return this.mutate(projectId, origin, async (p) => {
      const { fallback } = await this.fallbackFor(p)
      resetProjectSetting(p, fallback, key)
      return `设置「${key}」恢复为节目默认`
    })
  }

  async saveSettingToShow(projectId: string, key: SettingKey, origin: Origin): Promise<Project> {
    return this.mutate(projectId, origin, async (p) => {
      if (!p.showId) throw new Error('这个工程不属于任何节目')
      await this.store.locked(`show:${p.showId}`, async () => {
        const show = await this.mustShow(p.showId!)
        saveAsShowDefault(p, show, key)
        await this.store.saveShow(show)
      })
      return `设置「${key}」存为节目默认`
    })
  }

  // ───────────────────────── import ─────────────────────────

  async importSources(projectId: string, paths: string[], origin: Origin): Promise<Project> {
    const { ffprobe } = await this.requireTools()
    const probed: Source[] = []
    for (const raw of paths) {
      const path = expandHome(raw.trim())
      if (!path) continue
      const info = await probe(ffprobe, path).catch((e: unknown) => {
        throw new Error(`读不了 ${basename(path)}：${e instanceof Error ? e.message : String(e)}`)
      })
      if (!info.hasAudio && !info.hasVideo) throw new Error(`${basename(path)} 里没有音频或视频`)
      const ext = extname(path).toLowerCase()
      const role: Source['role'] = info.hasVideo && (VIDEO_EXT.has(ext) || !AUDIO_EXT.has(ext)) ? 'video' : 'recording'
      probed.push({
        id: newId('src'),
        path,
        role,
        durationSec: info.durationSec,
        hasAudio: info.hasAudio,
        hasVideo: info.hasVideo,
        offsetSec: 0,
        width: info.width,
        height: info.height,
        sampleRate: info.sampleRate,
        channels: info.channels,
      })
    }
    const p = await this.mutate(projectId, origin, (p) => {
      for (const s of probed) if (!p.sources.some((x) => x.path === s.path)) p.sources.push(s)
      if (!p.referenceId) {
        const ref = p.sources.find((s) => s.role === 'recording') ?? p.sources.find((s) => s.hasAudio)
        if (ref) {
          p.referenceId = ref.id
          if (ref.role === 'video' && !p.sources.some((s) => s.role === 'recording')) ref.role = 'recording'
        }
      }
      if (p.status === 'new') p.status = 'processing'
      return `导入了 ${probed.map((s) => basename(s.path)).join('、')}`
    })
    const ref = p.sources.find((s) => s.id === p.referenceId)
    if (ref) {
      if (p.sources.some((s) => s.role === 'video' && s.id !== ref.id && s.hasAudio)) await this.enqueue(projectId, 'align', '画面对齐')
      if (!p.transcript.length) await this.enqueue(projectId, 'transcribe', '分人与转写')
    }
    return p
  }

  // ───────────────────────── speakers ─────────────────────────

  async renameSpeaker(projectId: string, speakerId: string, name: string, origin: Origin): Promise<Project> {
    const clean = name.trim()
    return this.mutate(projectId, origin, async (p) => {
      const sp = p.speakers.find((s) => s.id === speakerId)
      if (!sp) throw new Error('没有这个说话人')
      const before = sp.name || '未命名'
      sp.name = clean
      if (p.showId && clean) await this.rememberVoice(p, sp)
      return `说话人「${before}」改名为「${clean}」`
    })
  }

  /** Store or refresh this speaker's voiceprint in the project's show. */
  private async rememberVoice(p: Project, sp: Speaker): Promise<void> {
    const embedding = await this.store.readJson<Record<string, string>>(join(this.store.cacheDir(p.id), 'embeddings.json'))
    const vec = embedding?.[sp.id]
    if (!vec || !p.showId) return
    await this.store.locked(`show:${p.showId}`, async () => {
      const show = await this.mustShow(p.showId!)
      let vp = show.voiceprints.find((v) => v.id === sp.voiceprintId) ?? show.voiceprints.find((v) => v.name === sp.name)
      if (!vp) {
        vp = { id: newId('vp'), name: sp.name, color: sp.color, sampleSec: Math.min(60, sp.speechSec), episodes: 1, updatedAt: new Date().toISOString() }
        show.voiceprints.push(vp)
      } else {
        vp.name = sp.name
        vp.updatedAt = new Date().toISOString()
      }
      sp.voiceprintId = vp.id
      await this.store.saveVoiceprint(show.id, vp.id, vec)
      await this.store.saveShow(show)
    })
  }

  async mergeSpeakers(projectId: string, fromId: string, intoId: string, origin: Origin): Promise<Project> {
    return this.mutate(projectId, origin, (p) => {
      const from = p.speakers.find((s) => s.id === fromId)
      const into = p.speakers.find((s) => s.id === intoId)
      if (!from || !into || from === into) throw new Error('合并需要两个不同的说话人')
      for (const seg of p.transcript) if (seg.speakerId === fromId) seg.speakerId = intoId
      into.speechSec += from.speechSec
      p.speakers = p.speakers.filter((s) => s.id !== fromId)
      return `把「${from.name || '未命名'}」合并进「${into.name || '未命名'}」`
    })
  }

  async reassignSegment(projectId: string, segmentId: string, speakerId: string, origin: Origin): Promise<Project> {
    return this.mutate(projectId, origin, (p) => {
      const seg = p.transcript.find((s) => s.id === segmentId)
      const sp = p.speakers.find((s) => s.id === speakerId)
      if (!seg || !sp) throw new Error('没有这段或这个说话人')
      const old = p.speakers.find((s) => s.id === seg.speakerId)
      const len = seg.end - seg.start
      if (old) old.speechSec = Math.max(0, old.speechSec - len)
      sp.speechSec += len
      seg.speakerId = speakerId
      return `${formatClock(seg.start)} 那段改给「${sp.name || '未命名'}」`
    })
  }

  /** Add a new empty speaker (for splitting a mis-merged voice by hand). */
  async addSpeaker(projectId: string, name: string, origin: Origin): Promise<Project> {
    return this.mutate(projectId, origin, (p) => {
      const color = SPEAKER_COLORS[p.speakers.length % SPEAKER_COLORS.length] ?? 's1'
      p.speakers.push({ id: newId('spk'), name: name.trim(), color, origin: { kind: 'diarization', cluster: -1 }, speechSec: 0 })
      return `新增说话人「${name.trim() || '未命名'}」`
    })
  }

  // ───────────────────────── edits ─────────────────────────

  /** Panel click: cut or restore a reference range (user edit, applied at once). */
  async setCut(projectId: string, start: number, end: number, cut: boolean, origin: Origin): Promise<Project> {
    return this.mutate(projectId, origin, (p) => {
      if (end <= start) throw new Error('区间无效')
      if (cut) {
        const group = newId('g')
        p.edits.push({ id: newId('e'), kind: 'cut', start, end, origin, state: 'applied', group })
        return `剪掉 ${formatClock(start)}–${formatClock(end)}`
      }
      // restore: reject every applied cut/shorten overlapping the range
      let n = 0
      for (const e of p.edits) {
        if (e.state === 'applied' && e.kind !== 'gain' && e.start < end && e.end > start) {
          e.state = 'rejected'
          n++
        }
      }
      return n ? `恢复 ${formatClock(start)}–${formatClock(end)}` : undefined
    })
  }

  async scan(projectId: string, origin: Origin): Promise<{ project: Project; groupId: string | null; counts: { fillers: number; pauses: number; repeats: number }; savedSec: number }> {
    let result: ReturnType<typeof scanTranscript> | null = null
    let groupId: string | null = null
    const project = await this.mutate(projectId, origin, (p) => {
      result = scanTranscript(p.transcript, p.speakers, p.settings, p.edits)
      if (!result.edits.length) return
      groupId = newId('g')
      const { fillers, pauses, repeats } = result.counts
      p.groups.push({ id: groupId, title: `清理提议：语气词 ${fillers} 处、长停顿 ${pauses} 处、重复 ${repeats} 处`, createdAt: new Date().toISOString() })
      for (const e of result.edits) p.edits.push({ ...e, id: newId('e'), group: groupId! })
      return '运行了语气词 / 停顿 / 重复扫描'
    })
    const r = result as ReturnType<typeof scanTranscript> | null
    return { project, groupId, counts: r?.counts ?? { fillers: 0, pauses: 0, repeats: 0 }, savedSec: r?.savedSec ?? 0 }
  }

  async propose(projectId: string, title: string, edits: Array<Pick<Edit, 'kind' | 'start' | 'end'> & Partial<Pick<Edit, 'value' | 'reason' | 'speakerId'>>>): Promise<{ project: Project; groupId: string }> {
    const groupId = newId('g')
    const project = await this.mutate(projectId, 'agent', (p) => {
      const dur = referenceDuration(p)
      p.groups.push({ id: groupId, title: title || '剪辑提议', createdAt: new Date().toISOString() })
      for (const e of edits) {
        const start = Math.max(0, Math.min(dur, e.start))
        const end = Math.max(0, Math.min(dur, e.end))
        if (end - start <= 0.01) continue
        p.edits.push({ id: newId('e'), kind: e.kind, start, end, value: e.value, reason: e.reason, speakerId: e.speakerId, origin: 'agent', state: 'proposed', group: groupId })
      }
    })
    return { project, groupId }
  }

  /** ✓ / ✗ on a proposal group (or on single edits by id). */
  async decide(projectId: string, target: { groupId?: string; editIds?: string[] }, state: 'applied' | 'rejected', origin: Origin): Promise<Project> {
    return this.mutate(projectId, origin, (p) => {
      const ids = new Set(target.editIds ?? [])
      let n = 0
      for (const e of p.edits) {
        if ((target.groupId && e.group === target.groupId) || ids.has(e.id)) {
          e.state = state
          n++
        }
      }
      if (!n) throw new Error('没有找到要处理的提议')
      const title = p.groups.find((g) => g.id === target.groupId)?.title ?? `${n} 处编辑`
      return `${state === 'applied' ? '采纳' : '拒绝'}：${title}`
    })
  }

  // ───────────────────────── reading for the model ─────────────────────────

  /** A compact text view for the model, plus panel events since its last read. */
  async readForModel(projectId: string, window?: { from?: number; to?: number }): Promise<string> {
    const view = await this.view(projectId)
    const p = view.project
    const removed = removedRanges(view.durationSec, p.edits)
    const names = new Map(p.speakers.map((s) => [s.id, s.name || `说话人${s.id.slice(-3)}`]))
    const lines: string[] = []
    lines.push(`工程「${p.name}」(${p.id}) 节目：${view.show?.name ?? '无'} 状态：${p.status}`)
    lines.push(`原始 ${formatClock(view.durationSec)} → 成片 ${formatClock(view.outputSec)}`)
    lines.push(`素材：${p.sources.map((s) => `${basename(s.path)}[${s.role}${s.id === p.referenceId ? ',参考' : ''}${s.offsetSec ? `,偏移${s.offsetSec.toFixed(2)}s` : ''}]`).join('；') || '无'}`)
    lines.push(`说话人：${p.speakers.map((s) => `${s.id}=${s.name || '未命名'}(${formatClock(s.speechSec)}${s.matchScore ? `,声纹${Math.round(s.matchScore * 100)}%` : ''})`).join('；') || '无'}`)
    const pending = p.groups.filter((g) => p.edits.some((e) => e.group === g.id && e.state === 'proposed'))
    if (pending.length) lines.push(`待决提议：${pending.map((g) => `${g.id}「${g.title}」`).join('；')}`)
    const jobs = view.jobs.filter((j) => j.state !== 'done').map((j) => `${j.label} ${j.state}${j.state === 'running' ? ` ${Math.round(j.progress * 100)}%` : ''}${j.error ? `：${j.error}` : ''}`)
    if (jobs.length) lines.push(`任务：${jobs.join('；')}`)
    const fresh = p.events.filter((e) => e.seq > p.modelSeenSeq)
    if (fresh.length) {
      lines.push('用户在面板上的改动（自你上次读取）：')
      for (const e of fresh) lines.push(`- ${e.text}`)
    }
    const from = window?.from ?? 0
    const to = window?.to ?? from + 600
    const segs = p.transcript.filter((s) => s.end > from && s.start < to)
    if (segs.length) {
      lines.push(`文稿（参考时间 ${formatClock(from)}–${formatClock(to)}；[剪]=已剪，{提}=待决提议）：`)
      const proposed = p.edits.filter((e) => e.state === 'proposed')
      for (const s of segs) {
        let text = ''
        for (const t of s.tokens) {
          const cut = removed.some((r) => r.start <= t.start && r.end >= t.end)
          const prop = proposed.some((e) => e.start <= t.start + 1e-3 && e.end >= t.end - 1e-3)
          text += cut ? `[${t.text}]` : prop ? `{${t.text}}` : t.text
        }
        lines.push(`${s.id} ${formatClock(s.start)}–${formatClock(s.end)} ${names.get(s.speakerId) ?? '?'}：${text.replace(/\]\[/g, '').replace(/\}\{/g, '')}`)
      }
      if (p.transcript.some((s) => s.start >= to)) lines.push(`（后面还有，读下一段用 from=${Math.round(to)}）`)
    } else if (!p.transcript.length) lines.push('还没有文稿。')
    await this.mutate(projectId, 'agent', (q) => {
      q.modelSeenSeq = q.events[q.events.length - 1]?.seq ?? 0
    })
    return lines.join('\n')
  }

  // ───────────────────────── preview ─────────────────────────

  /** MP3 data URL of a reference window, cuts applied unless `raw`. Max 30 s. */
  async clip(projectId: string, start: number, end: number, raw: boolean = false): Promise<string> {
    const { ffmpeg } = await this.requireTools()
    const p = await this.mustProject(projectId)
    const ref = p.sources.find((s) => s.id === p.referenceId)
    if (!ref) throw new Error('还没有录音')
    const to = Math.min(end, start + 30)
    const kept = raw ? [{ start, end: to }] : windowOf(keptRanges(ref.durationSec, p.edits), start, to)
    await mkdir(this.store.cacheDir(p.id), { recursive: true })
    const buf = await renderClip(ffmpeg, ref.path, kept, join(this.store.cacheDir(p.id), 'clip.filter'))
    return `data:audio/mpeg;base64,${buf.toString('base64')}`
  }

  // ───────────────────────── jobs ─────────────────────────

  private async loadJobs(): Promise<void> {
    if (!this.jobsLoaded) {
      this.jobsLoaded = (async () => {
        this.jobs = (await this.store.jobs()).map((j) => (j.state === 'running' ? { ...j, state: 'queued' as const, progress: 0 } : j))
        if (this.jobs.some((j) => j.state === 'queued')) void this.pump()
      })()
    }
    return this.jobsLoaded
  }

  async listJobs(projectId?: string): Promise<Job[]> {
    await this.loadJobs()
    return this.jobs.filter((j) => !projectId || j.projectId === projectId)
  }

  private persistJobs(): Promise<void> {
    return this.store.locked('jobs', () => this.writeJobs())
  }

  private async writeJobs(): Promise<void> {
    // keep the last 50 finished jobs
    const live = this.jobs.filter((j) => j.state === 'queued' || j.state === 'running')
    const done = this.jobs.filter((j) => j.state === 'done' || j.state === 'failed').slice(-50)
    this.jobs = [...done, ...live].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    await this.store.saveJobs(this.jobs)
  }

  async enqueue(projectId: string, kind: JobKind, label: string, payload?: JobPayload): Promise<Job> {
    await this.loadJobs()
    const dup = this.jobs.find((j) => j.projectId === projectId && j.kind === kind && j.state === 'queued' && JSON.stringify(j.payload ?? null) === JSON.stringify(payload ?? null))
    if (dup) return dup
    const now = new Date().toISOString()
    const job: Job = { id: newId('job'), projectId, kind, state: 'queued', progress: 0, label, createdAt: now, updatedAt: now, payload }
    this.jobs.push(job)
    await this.persistJobs()
    void this.pump()
    return job
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.loadJobs()
    const j = this.jobs.find((x) => x.id === jobId)
    if (!j) return
    if (j.state === 'running') this.aborts.get(j.id)?.abort()
    if (j.state === 'queued' || j.state === 'running') {
      j.state = 'failed'
      j.error = '已取消'
      await this.persistJobs()
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.disposed) return
    this.pumping = true
    try {
      for (;;) {
        const job = this.jobs.find((j) => j.state === 'queued')
        if (!job || this.disposed) break
        job.state = 'running'
        job.updatedAt = new Date().toISOString()
        await this.persistJobs()
        const ctrl = new AbortController()
        this.aborts.set(job.id, ctrl)
        let lastSave = 0
        const progress = (v: number) => {
          job.progress = Math.max(0, Math.min(1, v))
          const now = Date.now()
          if (now - lastSave > 2000) {
            lastSave = now
            void this.persistJobs()
          }
        }
        try {
          await this.runJob(job, progress, ctrl.signal)
          if (job.state === 'running') {
            job.state = 'done'
            job.progress = 1
          }
        } catch (error) {
          if (job.state === 'running') {
            job.state = 'failed'
            job.error = error instanceof Error ? error.message : String(error)
            this.logger.warn(`video-studio: job ${job.kind} failed`, job.error)
          }
        } finally {
          this.aborts.delete(job.id)
          job.updatedAt = new Date().toISOString()
          await this.persistJobs()
        }
      }
    } finally {
      this.pumping = false
    }
  }

  private async runJob(job: Job, progress: (v: number) => void, signal: AbortSignal): Promise<void> {
    switch (job.kind) {
      case 'align':
        return this.runAlign(job.projectId, progress, signal)
      case 'transcribe':
        return this.runTranscribe(job.projectId, progress, signal)
      case 'export':
        job.outputs = await this.runExport(job.projectId, job.payload?.kinds ?? ['audio'], progress, signal)
        return
      default:
        throw new Error(`未知任务：${job.kind}`)
    }
  }

  private async runAlign(projectId: string, progress: (v: number) => void, signal: AbortSignal): Promise<void> {
    const { ffmpeg } = await this.requireTools()
    const p = await this.mustProject(projectId)
    const ref = p.sources.find((s) => s.id === p.referenceId)
    if (!ref) return
    const rate = 8000
    const span = Math.min(180, ref.durationSec)
    const a = envelope(await decodeMono(ffmpeg, ref.path, rate, 0, span, signal), rate)
    progress(0.3)
    const others = p.sources.filter((s) => s.id !== ref.id && s.hasAudio && s.role === 'video')
    const offsets = new Map<string, number>()
    for (const [i, s] of others.entries()) {
      const b = envelope(await decodeMono(ffmpeg, s.path, rate, 0, Math.min(180 + 30, s.durationSec), signal), rate)
      const res = alignEnvelopes(a, b, 100, 30)
      offsets.set(s.id, res.offsetSec)
      progress(0.3 + (0.7 * (i + 1)) / others.length)
    }
    await this.mutate(projectId, 'agent', (q) => {
      for (const s of q.sources) if (offsets.has(s.id)) s.offsetSec = Math.round(offsets.get(s.id)! * 1000) / 1000
    })
  }

  private async runTranscribe(projectId: string, progress: (v: number) => void, signal: AbortSignal): Promise<void> {
    const { ffmpeg } = await this.requireTools()
    if (!(await this.models.ready())) {
      progress(0.01)
      await this.models.ensure()
      if (!(await this.models.ready())) {
        const failed = this.models.list().find((m) => m.state === 'failed')
        throw new Error(`语音模型下载失败${failed?.error ? `：${failed.error}` : ''}，可在设置 → 全局里重试`)
      }
    }
    const p = await this.mustProject(projectId)
    const ref = p.sources.find((s) => s.id === p.referenceId)
    if (!ref) throw new Error('还没有录音')
    const cache = this.store.cacheDir(projectId)
    await mkdir(cache, { recursive: true })
    const wav = join(cache, 'asr.wav')
    await writeAsrWav(ffmpeg, ref.path, wav, (sec) => progress(0.05 * Math.min(1, sec / Math.max(1, ref.durationSec))), signal)
    const g = await this.store.global()
    const show = p.showId ? await this.store.getShow(p.showId) : null
    const voices = []
    for (const v of show?.voiceprints ?? []) {
      const emb = await this.store.voiceprint(show!.id, v.id)
      if (emb) voices.push({ id: v.id, name: v.name, embedding: emb })
    }
    const weights = { load: [0.05, 0.08], diarize: [0.08, 0.35], transcribe: [0.35, 0.95], embed: [0.95, 1] } as const
    const result = await runSpeech(
      { wavPath: wav, models: speechModelPaths(this.store.modelsDir), voices, numSpeakers: -1, matchThreshold: g.voiceMatchThreshold, numThreads: 4 },
      (stage, v) => {
        const [a, b] = weights[stage]
        progress(a + (b - a) * v)
      },
      signal,
    )
    // map clusters → speakers
    const embeddings: Record<string, string> = {}
    const speakers: Speaker[] = result.speakers
      .sort((x, y) => y.speechSec - x.speechSec)
      .map((s, i) => {
        const vp = s.match ? show?.voiceprints.find((v) => v.id === s.match!.id) : undefined
        const sp: Speaker = {
          id: newId('spk'),
          name: vp?.name ?? '',
          color: vp?.color || (SPEAKER_COLORS[i % SPEAKER_COLORS.length] ?? 's1'),
          origin: { kind: 'diarization', cluster: s.cluster },
          voiceprintId: vp?.id,
          matchScore: s.match?.score,
          speechSec: s.speechSec,
        }
        embeddings[sp.id] = s.embedding
        return sp
      })
    const byCluster = new Map(speakers.map((s) => [(s.origin as { cluster: number }).cluster, s.id]))
    await writeFile(join(cache, 'embeddings.json'), JSON.stringify(embeddings), 'utf8')
    await this.mutate(projectId, 'agent', (q) => {
      q.speakers = speakers
      q.transcript = result.segments.map((seg) => ({
        id: newId('seg'),
        speakerId: byCluster.get(seg.cluster) ?? speakers[0]?.id ?? '',
        start: seg.start,
        end: seg.end,
        tokens: seg.tokens.map((t) => ({ text: t.text, start: t.start, end: t.end, kind: 'word' as const })),
      }))
      q.status = 'editing'
    })
    // matched voices: bump episode counts
    if (show) {
      await this.store.locked(`show:${show.id}`, async () => {
        const s = await this.mustShow(show.id)
        for (const sp of speakers) {
          const vp = s.voiceprints.find((v) => v.id === sp.voiceprintId)
          if (vp) {
            vp.episodes += 1
            vp.updatedAt = new Date().toISOString()
          }
        }
        await this.store.saveShow(s)
      })
    }
    await rm(wav, { force: true })
  }

  async exportDirFor(p: Project): Promise<string> {
    const g = await this.store.global()
    const show = p.showId ? await this.store.getShow(p.showId) : null
    const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || '_'
    return expandHome(g.exportDir.replace('{show}', safe(show?.name ?? '未归类')).replace('{episode}', safe(p.name)))
  }

  private async runExport(projectId: string, kinds: ExportKind[], progress: (v: number) => void, signal: AbortSignal): Promise<string[]> {
    const { ffmpeg, burnSubtitles } = await this.requireTools()
    const p = await this.mustProject(projectId)
    const ref = p.sources.find((s) => s.id === p.referenceId)
    if (!ref) throw new Error('还没有录音')
    const dir = await this.exportDirFor(p)
    await mkdir(dir, { recursive: true })
    const cache = this.store.cacheDir(projectId)
    await mkdir(cache, { recursive: true })
    const kept = keptRanges(ref.durationSec, p.edits)
    const removed = removedRanges(ref.durationSec, p.edits)
    const outSec = outputDuration(ref.durationSec, p.edits)
    const base = p.name.replace(/[\\/:*?"<>|]/g, '_')
    const cues = buildCues(p.transcript, p.speakers, removed)
    const outputs: string[] = []
    const steps = kinds.length
    let step = 0
    const stepProgress = (v: number) => progress((step + v) / steps)
    const g = await this.store.global()
    const lib = (name: string) => (name ? join(expandHome(g.libraryDir), name) : '')

    for (const kind of kinds) {
      if (signal.aborted) throw new Error('已取消')
      if (kind === 'subtitles') {
        const path = join(dir, `${base}.srt`)
        await writeFile(path, toSrt(cues), 'utf8')
        outputs.push(path)
      } else if (kind === 'text') {
        const path = join(dir, `${base}.txt`)
        await writeFile(path, toPlainText(p.transcript, p.speakers, removed), 'utf8')
        outputs.push(path)
      } else if (kind === 'audio') {
        const inputs = [ref.path]
        const intro = lib(p.settings.introMusic)
        const outro = lib(p.settings.outroMusic)
        const opts: { intro?: number; outro?: number } = {}
        if (intro) {
          inputs.push(intro)
          opts.intro = inputs.length - 1
        }
        if (outro) {
          inputs.push(outro)
          opts.outro = inputs.length - 1
        }
        const path = join(dir, `${base}.mp3`)
        await exportAudio(
          { ffmpeg, inputs, scriptPath: join(cache, 'audio.filter'), graph: audioGraph(kept, opts), maps: [], codecArgs: ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3', '-metadata', `title=${p.name}`], output: path, expectedSec: outSec, onProgress: stepProgress, signal },
          p.settings.audioLoudness,
        )
        outputs.push(path)
      } else if (kind === 'video') {
        const video = p.sources.find((s) => s.role === 'video' && s.hasVideo)
        if (!video) throw new Error('这个工程没有视频素材')
        let assPath: string | undefined
        if (burnSubtitles && cues.length) {
          assPath = join(cache, 'subs.ass')
          await writeFile(assPath, toAss(cues, p.settings.subtitleStyle), 'utf8')
        }
        const path = join(dir, `${base}.mp4`)
        const inputs = [ref.path, video.path]
        const maps: string[] = []
        const codec = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']
        if (!assPath && cues.length) {
          const srt = join(cache, 'soft.srt')
          await writeFile(srt, toSrt(cues), 'utf8')
          inputs.push(srt)
          maps.push('-map', `${inputs.length - 1}:s`)
          codec.push('-c:s', 'mov_text', '-metadata:s:s:0', 'language=chi')
        }
        await exportVideo(
          { ffmpeg, inputs, scriptPath: join(cache, 'video.filter'), graph: videoGraph(kept, video.offsetSec, video.durationSec, { w: 1920, h: 1080 }, assPath), maps, codecArgs: codec, output: path, expectedSec: outSec, onProgress: stepProgress, signal },
          p.settings.videoLoudness,
        )
        outputs.push(path)
      }
      step += 1
      stepProgress(0)
    }
    await this.mutate(projectId, 'agent', (q) => {
      q.status = 'exported'
    })
    return outputs
  }

  async startExport(projectId: string, kinds: ExportKind[]): Promise<Job> {
    await this.requireTools()
    const p = await this.mustProject(projectId)
    if (!p.referenceId) throw new Error('还没有录音，先导入素材')
    if (kinds.includes('video') && !p.sources.some((s) => s.role === 'video' && s.hasVideo)) throw new Error('这个工程没有视频素材')
    const order: ExportKind[] = ['subtitles', 'text', 'audio', 'video']
    const sorted = order.filter((k) => kinds.includes(k))
    return this.enqueue(projectId, 'export', `导出 ${sorted.map((k) => ({ audio: '音频', video: '视频', subtitles: '字幕', text: '文稿' })[k]).join(' + ')}`, { kinds: sorted })
  }

  /** Output time of a reference time, for timestamps shown to the model. */
  async outputTimeOf(projectId: string, t: number): Promise<number> {
    const p = await this.mustProject(projectId)
    return toOutputTime(t, removedRanges(referenceDuration(p), p.edits))
  }
}

export function referenceDuration(p: Project): number {
  return p.sources.find((s) => s.id === p.referenceId)?.durationSec ?? 0
}

function summarize(p: Project): ProjectSummary {
  const d = referenceDuration(p)
  return { id: p.id, name: p.name, showId: p.showId, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt, sourceCount: p.sources.length, durationSec: d, outputSec: outputDuration(d, p.edits) }
}

export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}
