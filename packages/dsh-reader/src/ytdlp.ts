/**
 * yt-dlp on the host: video metadata and platform captions, never the video.
 *
 * Measured 2026-10-20: a 2023 yt-dlp (and the 2025 one pip can still install
 * on a Python 3.9 environment) can no longer read YouTube — captions now need
 * the current extractor and a JavaScript runtime. So the reader keeps its own
 * copy of the official STANDALONE release (bundled Python) under its state
 * root, fetched on first use and self-updated (`-U`) when it is two weeks old;
 * a path configured by the deployment wins over it. Node — the host's own
 * runtime — is handed to yt-dlp as its JavaScript runtime.
 *
 * Only metadata (`--dump-single-json`) and captions (`--write-subs`) are ever
 * requested, with `--skip-download`.
 *
 * @module @khorsheed/dsh-reader/ytdlp
 */
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseCaptions, type Cue } from './captions.ts'

/** The release asset for this platform, or `undefined` where none is published. */
export function releaseAsset(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined {
  if (platform === 'darwin') return 'yt-dlp_macos'
  if (platform === 'linux') return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
  if (platform === 'win32') return 'yt-dlp.exe'
  return undefined
}

/** How old the managed binary may get before a self-update (ms). */
const UPDATE_AFTER_MS = 14 * 24 * 60 * 60 * 1000

/** The subset of yt-dlp's info JSON the reader reads. */
export interface YtDlpInfo {
  readonly id?: string
  readonly title?: string
  readonly description?: string
  readonly duration?: number
  readonly thumbnail?: string
  readonly uploader?: string
  readonly channel?: string
  readonly channel_id?: string
  readonly upload_date?: string
  readonly timestamp?: number
  readonly language?: string
  readonly webpage_url?: string
  readonly subtitles?: Record<string, readonly { ext: string }[]>
  readonly automatic_captions?: Record<string, readonly { ext: string }[]>
}

/** The caption track chosen for a video. */
export interface CaptionTrack {
  readonly lang: string
  readonly auto: boolean
  readonly ext: string
}

/** Tracks that are not speech captions. */
const NOT_CAPTIONS = new Set(['live_chat', 'danmaku', 'rechat'])

/** Caption formats, best first (json3 is YouTube's cleanest; json is Bilibili's). */
const FORMATS = ['json3', 'vtt', 'srt', 'json'] as const

/** The best format a track offers, among the ones the parser reads. */
function bestFormat(formats: readonly { ext: string }[] | undefined): string | undefined {
  const offered = new Set((formats ?? []).map(format => format.ext))
  return FORMATS.find(format => offered.has(format))
}

/**
 * Choose the caption track: the uploader's own captions in the video's
 * language first, then any uploaded track, then the platform's automatic
 * captions in the ORIGINAL language (YouTube marks it `<lang>-orig`; the other
 * auto tracks are machine translations, which are also what trips its rate
 * limit). Manual and automatic tracks are equally "captions" to the reader
 * (2026-10-20); the choice only prefers the better one.
 *
 * @param info - the video's info JSON.
 */
export function chooseCaptionTrack(info: YtDlpInfo): CaptionTrack | undefined {
  const language = (info.language ?? '').toLowerCase()
  const manual = Object.entries(info.subtitles ?? {}).filter(([lang]) => !NOT_CAPTIONS.has(lang))
  const pick = (entries: [string, readonly { ext: string }[]][], auto: boolean, preferred: readonly string[]): CaptionTrack | undefined => {
    for (const want of preferred) {
      const hit = entries.find(([lang]) => lang.toLowerCase() === want) ?? entries.find(([lang]) => want !== '' && lang.toLowerCase().startsWith(want))
      const ext = hit === undefined ? undefined : bestFormat(hit[1])
      if (hit !== undefined && ext !== undefined) return { lang: hit[0], auto, ext }
    }
    for (const [lang, formats] of entries) {
      const ext = bestFormat(formats)
      if (ext !== undefined) return { lang, auto, ext }
    }
    return undefined
  }
  const fromManual = pick(manual, false, [language, 'zh', 'en', 'ai-zh'].filter(item => item !== ''))
  if (fromManual !== undefined) return fromManual
  const auto = Object.entries(info.automatic_captions ?? {}).filter(([lang]) => !NOT_CAPTIONS.has(lang))
  const originals = auto.filter(([lang]) => lang.endsWith('-orig'))
  const fromOriginal = pick(originals, true, language === '' ? [] : [`${language}-orig`])
  if (fromOriginal !== undefined) return fromOriginal
  return language === '' ? undefined : pick(auto.filter(([lang]) => lang.toLowerCase() === language), true, [language])
}

/** Run a process, resolving its stdout. */
function run(file: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      if (error !== null) {
        const tail = String(stderr).trim().split('\n').filter(line => /ERROR|error:/i.test(line)).slice(-1)[0]
        reject(new Error(tail ?? error.message))
        return
      }
      resolve(String(stdout))
    })
  })
}

/** The yt-dlp manager. */
export class YtDlp {
  private readonly binDir: string
  private readonly tmpRoot: string
  private ensuring: Promise<string> | undefined

  /**
   * @param stateRoot - the reader's state root (the managed binary lives under `bin/`).
   * @param configured - a deployment-configured binary path, which wins.
   */
  constructor(stateRoot: string, private readonly configured?: string) {
    this.binDir = join(stateRoot, 'bin')
    this.tmpRoot = join(stateRoot, 'tmp')
  }

  /** The binary to run: the configured one, else the managed one (fetched / updated as needed). */
  binary(): Promise<string> {
    if (this.configured !== undefined && this.configured !== '') return Promise.resolve(this.configured)
    this.ensuring ??= this.ensureManaged().finally(() => { this.ensuring = undefined })
    return this.ensuring
  }

  /** Fetch the standalone release on first use; self-update it when stale. */
  private async ensureManaged(): Promise<string> {
    const asset = releaseAsset()
    if (asset === undefined) throw new Error(`yt-dlp: no standalone release for ${process.platform}/${process.arch}`)
    const target = join(this.binDir, asset)
    if (!existsSync(target)) {
      mkdirSync(this.binDir, { recursive: true })
      const partial = `${target}.download`
      // curl honors the deployment's proxy environment the way Node's fetch
      // does not, and is present on every platform that has a release asset.
      await run('curl', ['-fsSL', '--retry', '2', '-o', partial, `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`], 300_000)
      chmodSync(partial, 0o755)
      renameSync(partial, target)
      return target
    }
    if (Date.now() - statSync(target).mtimeMs > UPDATE_AFTER_MS) {
      // Best effort: a failed update leaves the working binary in place.
      await run(target, ['-U'], 120_000).catch(() => undefined)
    }
    return target
  }

  /** The version of the binary in use. */
  async version(): Promise<string> {
    return (await run(await this.binary(), ['--version'], 30_000)).trim()
  }

  /** The common flags: no download, no formats needed, Node as the JS runtime. */
  private base(): string[] {
    return ['--skip-download', '--ignore-no-formats-error', '--no-playlist', '--no-warnings', '--js-runtimes', `node:${process.execPath}`]
  }

  /**
   * A video's metadata.
   *
   * @param url - the video page URL.
   */
  async info(url: string): Promise<YtDlpInfo> {
    const out = await run(await this.binary(), [...this.base(), '--dump-single-json', url], 120_000)
    const line = out.trim().split('\n').filter(item => item.startsWith('{')).pop()
    if (line === undefined) throw new Error('yt-dlp: no metadata')
    return JSON.parse(line) as YtDlpInfo
  }

  /**
   * One caption track's cues.
   *
   * @param url - the video page URL.
   * @param track - the chosen track.
   */
  async captions(url: string, track: CaptionTrack): Promise<Cue[]> {
    mkdirSync(this.tmpRoot, { recursive: true })
    const dir = mkdtempSync(join(this.tmpRoot, 'subs-'))
    try {
      await run(await this.binary(), [
        ...this.base(),
        track.auto ? '--write-auto-subs' : '--write-subs',
        '--sub-langs', track.lang,
        '--sub-format', track.ext,
        '-o', join(dir, 'captions.%(ext)s'),
        url,
      ], 180_000)
      const file = readdirSync(dir).find(name => name.startsWith('captions.') && !name.endsWith('.part'))
      if (file === undefined) return []
      return parseCaptions(readFileSync(join(dir, file), 'utf8'), file.split('.').pop() ?? '')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
