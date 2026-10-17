import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings.ts'
import { SCHEMA_VERSION, type Job, type Project, type Settings, type Show } from './core/types.ts'

export const STATE_DIR_NAME = 'video-studio'

/** $DSH_HOME/state/video-studio, falling back to ~/.dsh like the host does. */
export function resolveStateRoot(configured?: string): string {
  if (configured) return configured
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'state', STATE_DIR_NAME)
}

export interface GlobalConfig {
  settings: Settings
  /** Music and sound-effect library shared by every show. */
  libraryDir: string
  /** Export directory template: {show} and {episode} are replaced. */
  exportDir: string
  /** Explicit binary paths; '' = search PATH. */
  ffmpegPath: string
  ffprobePath: string
  /** Delete project caches (proxies, ASR wav) this many days after export; 0 = never. */
  cleanupDays: number
  /** Cosine similarity at or above which a voice is the stored one. */
  voiceMatchThreshold: number
  /** Speech-model download source: auto-probe, or pin github / huggingface / hf-mirror. */
  modelSource: string
}

export function defaultGlobal(): GlobalConfig {
  return {
    settings: { ...DEFAULT_SETTINGS },
    libraryDir: join(homedir(), 'Podcast', '素材库'),
    exportDir: join(homedir(), 'Podcast', '{show}', '{episode}'),
    ffmpegPath: '',
    ffprobePath: '',
    cleanupDays: 30,
    voiceMatchThreshold: 0.6,
    modelSource: 'auto',
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/** One JSON file per entity, written atomically (tmp + rename). */
export class Store {
  readonly showsDir: string
  readonly projectsDir: string
  readonly voiceprintsDir: string
  readonly modelsDir: string
  private readonly globalPath: string
  private readonly bindingsPath: string
  private readonly jobsPath: string
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(readonly root: string) {
    this.showsDir = join(root, 'shows')
    this.projectsDir = join(root, 'projects')
    this.voiceprintsDir = join(root, 'voiceprints')
    this.modelsDir = join(root, 'models')
    this.globalPath = join(root, 'settings.json')
    this.bindingsPath = join(root, 'bindings.json')
    this.jobsPath = join(root, 'jobs.json')
  }

  projectDir(id: string): string {
    return join(this.projectsDir, id)
  }

  cacheDir(id: string): string {
    return join(this.projectsDir, id, 'cache')
  }

  /** Serialise read-modify-write cycles per key. */
  async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(fn)
    this.locks.set(key, next)
    try {
      return await next
    } finally {
      if (this.locks.get(key) === next) this.locks.delete(key)
    }
  }

  async readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T
    } catch {
      return null
    }
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
    await rename(tmp, path)
  }

  async global(): Promise<GlobalConfig> {
    const raw = await this.readJson<Partial<GlobalConfig>>(this.globalPath)
    const base = defaultGlobal()
    if (!raw) return base
    return {
      ...base,
      ...Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== 'settings' && typeof v === typeof (base as unknown as Record<string, unknown>)[k])),
      settings: normalizeSettings(raw.settings),
    } as GlobalConfig
  }

  saveGlobal(config: GlobalConfig): Promise<void> {
    return this.writeJson(this.globalPath, config)
  }

  async listShows(): Promise<Show[]> {
    const out: Show[] = []
    for (const f of await safeReaddir(this.showsDir)) {
      if (!f.endsWith('.json')) continue
      const s = await this.getShow(f.slice(0, -5))
      if (s) out.push(s)
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async getShow(id: string): Promise<Show | null> {
    const raw = await this.readJson<Show>(join(this.showsDir, `${id}.json`))
    if (!raw) return null
    return { ...raw, settings: normalizeSettings(raw.settings), voiceprints: raw.voiceprints ?? [] }
  }

  saveShow(show: Show): Promise<void> {
    return this.writeJson(join(this.showsDir, `${show.id}.json`), { ...show, schema: SCHEMA_VERSION })
  }

  async deleteShowFiles(id: string): Promise<void> {
    await rm(join(this.showsDir, `${id}.json`), { force: true })
    await rm(join(this.voiceprintsDir, id), { recursive: true, force: true })
  }

  async listProjects(): Promise<Project[]> {
    const out: Project[] = []
    for (const d of await safeReaddir(this.projectsDir)) {
      const p = await this.getProject(d)
      if (p) out.push(p)
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getProject(id: string): Promise<Project | null> {
    if (!/^[\w-]+$/.test(id)) return null
    const raw = await this.readJson<Project>(join(this.projectDir(id), 'project.json'))
    if (!raw) return null
    return {
      ...raw,
      settings: normalizeSettings(raw.settings),
      overrides: raw.overrides ?? [],
      sources: raw.sources ?? [],
      speakers: raw.speakers ?? [],
      transcript: raw.transcript ?? [],
      edits: raw.edits ?? [],
      groups: raw.groups ?? [],
      chapters: raw.chapters ?? [],
      events: raw.events ?? [],
      modelSeenSeq: raw.modelSeenSeq ?? 0,
    }
  }

  saveProject(p: Project): Promise<void> {
    return this.writeJson(join(this.projectDir(p.id), 'project.json'), { ...p, schema: SCHEMA_VERSION })
  }

  async deleteProject(id: string): Promise<void> {
    if (!/^[\w-]+$/.test(id)) return
    await rm(this.projectDir(id), { recursive: true, force: true })
  }

  async voiceprint(showId: string, id: string): Promise<string | null> {
    try {
      return (await readFile(join(this.voiceprintsDir, showId, `${id}.f32`))).toString('base64')
    } catch {
      return null
    }
  }

  async saveVoiceprint(showId: string, id: string, base64: string): Promise<void> {
    await mkdir(join(this.voiceprintsDir, showId), { recursive: true })
    await writeFile(join(this.voiceprintsDir, showId, `${id}.f32`), Buffer.from(base64, 'base64'))
  }

  async deleteVoiceprint(showId: string, id: string): Promise<void> {
    await rm(join(this.voiceprintsDir, showId, `${id}.f32`), { force: true })
  }

  async bindings(): Promise<Record<string, string>> {
    return (await this.readJson<Record<string, string>>(this.bindingsPath)) ?? {}
  }

  saveBindings(b: Record<string, string>): Promise<void> {
    return this.writeJson(this.bindingsPath, b)
  }

  async jobs(): Promise<Job[]> {
    return (await this.readJson<Job[]>(this.jobsPath)) ?? []
  }

  saveJobs(jobs: Job[]): Promise<void> {
    return this.writeJson(this.jobsPath, jobs)
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}
