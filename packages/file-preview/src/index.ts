/** Read-only file-preview Remote service over live sessions and the filesystem.
 * @module @khorsheed/dsh-file-preview
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { BashWriteCollector } from './bash-writes.ts'
import { foldFilePreview } from './fold.ts'
import { revealNativePath } from './reveal.ts'
import type { FilePreviewConfig, FilePreviewEntry, FilePreviewList, FilePreviewRead, FilePreviewReveal } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    filePreview: FilePreviewService
  }
}

/** The webServer surface this service needs (route registration only). The
 * service stays structurally typed so it never imports the web host package —
 * the web face is an optional additive host, absent in headless compositions. */
interface ImageRouteHost {
  register(route: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
}

/** Extensions treated as binary without reading (their text decode is meaningless). */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.zstd', '.br',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.wasm', '.node', '.dylib', '.so', '.dll', '.exe', '.kext',
  '.class', '.jar', '.pyc', '.sqlite', '.db',
  '.DS_Store', '.a', '.o',
])

/** Image extensions served to the browser through the image route. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico', '.svg',
])

/** MIME type per image extension for the image route's Content-Type header. */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}

/** NUL bytes in decoded text mark a file as binary despite a successful decode. */
function hasNulByte(content: string): boolean {
  return content.slice(0, 4096).includes('\u0000')
}

/** Detect a binary file from its display path extension. */
function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** Detect an image from its display path extension. */
function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && IMAGE_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** Stable error text for a failed read, without leaking backend internals. */
function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The `filePreview` Remote service: session-scoped read-only file inspection
 * for web surfaces. `list` is a pure fold over the session log (no filesystem
 * access); `read` resolves the path against the session cwd and serves current
 * text content through `ctx.fs` (or a browser URL for images), capped by
 * config. Image bytes ride a dedicated host route so the browser loads them
 * natively without bloating the RPC channel.
 */
export class FilePreviewService extends TypertRemoteService {
  static inject = ['fs']

  static Config: z<FilePreviewConfig> = z.object({
    maxReadBytes: z.natural().min(1).default(512 * 1024),
    maxFiles: z.natural().min(1).default(500),
    captureBashWrites: z.boolean().default(true),
  })

  /** URL prefix the image route answers under. */
  static readonly IMAGE_ROUTE = '/file-preview-image'

  private readonly resolved: Required<FilePreviewConfig>
  /** Whether a web server is present to host the image route; image reads
   * answer `binary` without it (the headless face has no browser to serve). */
  private readonly imageRoute: boolean
  /** The agents service when present (image route only; null headless). */
  private readonly agents: AgentRegistry | undefined
  /** Native reveal runner; a constructor seam for deterministic tests. */
  private readonly revealNative: (path: string, signal: AbortSignal) => Promise<void>
  /** Bash-write collector (S2 seam), or undefined when disabled in config. */
  private readonly collector: BashWriteCollector | undefined

  /**
   * @param ctx - owning Cordis Context carrying `fs`; `webServer` and `agents`
   *   are optional (the image route needs them, headless faces lack both).
   * @param config - optional deployment tuning; defaults cap reads and lists,
   *   and enable the bash-write collector.
   * @param deps - test seam for the native reveal dispatch.
   */
  constructor(
    ctx: Context,
    config: FilePreviewConfig = {},
    deps: { revealNative?: (path: string, signal: AbortSignal) => Promise<void> } = {},
  ) {
    super(ctx, 'filePreview')
    this.resolved = {
      maxReadBytes: config.maxReadBytes ?? 512 * 1024,
      maxFiles: config.maxFiles ?? 500,
      captureBashWrites: config.captureBashWrites ?? true,
    }
    this.revealNative = deps.revealNative ?? revealNativePath
    if (config.captureBashWrites !== false) {
      this.collector = new BashWriteCollector({ fs: this.fs, maxFiles: this.resolved.maxFiles })
      ctx.effect(
        () => this.collector!.attach(ctx),
        'file-preview: bash-write capture',
      )
    } else {
      this.collector = undefined
    }
    const webServer = ctx.get('webServer') as ImageRouteHost | undefined
    this.agents = ctx.get('agents')
    this.imageRoute = webServer !== undefined && this.agents !== undefined
    if (this.imageRoute && webServer !== undefined) {
      ctx.effect(
        () => webServer.register({
          kind: 'prefix',
          path: FilePreviewService.IMAGE_ROUTE,
          /* v8 ignore next 2 -- the handler body is the request path; the
             unit tests drive serveImage directly, the real server reaches it
             through this registration */
          handler: (req: IncomingMessage, res: ServerResponse) => { void this.serveImage(req, res) },
        }),
        'file-preview: image route',
      )
    }
  }

  private get fs(): FileSystem {
    return this.ctx.fs
  }

  /**
   * Serve one image file's bytes for a browser `<img>` request. The URL is
   * `IMAGE_ROUTE/<sessionId>/<encodeURIComponent(path)>`; the session must be
   * live (the same scope `read` serves) and the path resolves against its cwd.
   * @param req - the incoming image request.
   * @param res - the response to fill with bytes or an error status.
   */
  private async serveImage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    /* v8 ignore next -- split('?')[0] is always a string when url is defined; the fallback guards a future parse change */
    const pathname = req.url === undefined ? '' : req.url.split('?')[0] ?? ''
    const rest = pathname.slice(FilePreviewService.IMAGE_ROUTE.length + 1)
    const slash = rest.indexOf('/')
    if (slash <= 0) {
      res.writeHead(400).end('file preview: expected /<sessionId>/<path>')
      return
    }
    const sessionId = rest.slice(0, slash) as SessionId
    const encoded = rest.slice(slash + 1)
    let display: string
    try {
      display = decodeURIComponent(encoded)
    } catch {
      res.writeHead(400).end('file preview: malformed path')
      return
    }
    const agent = this.agents?.get(sessionId)
    if (agent === undefined) {
      res.writeHead(404).end('file preview: session not found')
      return
    }
    if (!isImagePath(display)) {
      res.writeHead(400).end('file preview: not an image path')
      return
    }
    const cwd = agent.session.header.cwd
    let target
    try {
      target = await this.fs.resolve(display, cwd === undefined ? {} : { cwd })
    } catch (error) {
      res.writeHead(404).end(readErrorMessage(error))
      return
    }
    let info
    try {
      info = await this.fs.stat(target)
    } catch (error) {
      res.writeHead(404).end(readErrorMessage(error))
      return
    }
    if (info === undefined || info.type !== 'file') {
      res.writeHead(404).end('file preview: not a file')
      return
    }
    if (info.size !== undefined && info.size > this.resolved.maxReadBytes) {
      res.writeHead(413).end('file preview: image exceeds the read cap')
      return
    }
    let bytes
    try {
      bytes = await this.fs.readBytes(target, undefined, this.resolved.maxReadBytes)
    } catch (error) {
      res.writeHead(404).end(readErrorMessage(error))
      return
    }
    const dot = display.lastIndexOf('.')
    /* v8 ignore next -- every IMAGE_EXTENSIONS entry has a MIME mapping; the fallback guards a future extension */
    const mime = IMAGE_MIME[display.slice(dot).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    })
    res.end(Buffer.from(bytes))
  }

  /**
   * List the files one session wrote or edited: the log fold plus any
   * bash-written files the collector verified (the S2 seam), merged so a
   * captured path the fold already knows keeps its log-derived entry.
   * @param agent - owning live agent; its session log is the data source.
   * @returns first-seen files capped by `maxFiles`, with the log watermark.
   */
  @Remote('list')
  list(agent: Agent): FilePreviewList {
    const folded = foldFilePreview(agent.session.events, this.resolved.maxFiles)
    const captured = this.collector?.captured(agent.session.id)
    if (captured === undefined || captured.size === 0) return folded
    const seen = new Set(folded.entries.map(entry => entry.path))
    const extra: FilePreviewEntry[] = []
    for (const [path, write] of captured) {
      if (seen.has(path) || folded.entries.length + extra.length >= this.resolved.maxFiles) continue
      extra.push({ path, op: 'write', seq: write.seq, turn: write.turn, step: write.step, diffs: [] })
    }
    if (extra.length === 0) return folded
    return {
      entries: [...folded.entries, ...extra],
      asOfSeq: folded.asOfSeq,
      truncated: folded.truncated || folded.entries.length + extra.length >= this.resolved.maxFiles,
    }
  }

  /**
   * Read the current content of one recorded file, resolved against the
   * session cwd and capped by `maxReadBytes`.
   * @param agent - owning live agent; its session cwd anchors relative paths.
   * @param path - the display path recorded by the write/edit tool call.
   * @param signal - cooperative cancellation from the calling UI request.
   * @returns the classified read; `text` carries content, `image` carries a
   *   browser URL, other kinds carry the size or a human-readable reason.
   */
  @Remote('read')
  async read(agent: Agent, path: string, signal: AbortSignal): Promise<FilePreviewRead> {
    if (typeof path !== 'string' || path.length === 0) {
      return { path, kind: 'error', message: 'file preview requires a non-empty path' }
    }
    const cwd = agent.session.header.cwd
    let target
    try {
      target = await this.fs.resolve(path, cwd === undefined ? { signal } : { cwd, signal })
    } catch (error) {
      return { path, kind: 'error', message: readErrorMessage(error) }
    }
    let info
    try {
      info = await this.fs.stat(target, signal)
    } catch (error) {
      return { path, kind: 'error', message: readErrorMessage(error) }
    }
    if (info === undefined || info.type !== 'file') {
      return { path, kind: 'missing' }
    }
    if (info.size !== undefined && info.size > this.resolved.maxReadBytes) {
      return { path, kind: 'too-large', size: info.size }
    }
    if (isImagePath(path)) {
      if (this.imageRoute) {
        const encoded = encodeURIComponent(path)
        return {
          path,
          kind: 'image',
          url: `${FilePreviewService.IMAGE_ROUTE}/${agent.session.id}/${encoded}`,
          ...(info.size === undefined ? {} : { size: info.size }),
        }
      }
      // No web face to serve bytes: an image is binary, never decoded as text.
      return { path, kind: 'binary', ...(info.size === undefined ? {} : { size: info.size }) }
    }
    if (isBinaryPath(path)) {
      return { path, kind: 'binary', ...(info.size === undefined ? {} : { size: info.size }) }
    }
    try {
      const content = await this.fs.readText(target, signal)
      if (hasNulByte(content)) {
        return { path, kind: 'binary', ...(info.size === undefined ? {} : { size: info.size }) }
      }
      const truncated = content.length > this.resolved.maxReadBytes
      return {
        path,
        kind: 'text',
        content: truncated ? content.slice(0, this.resolved.maxReadBytes) : content,
        truncated,
        ...(info.size === undefined ? {} : { size: info.size }),
      }
    } catch (error) {
      return { path, kind: 'error', message: readErrorMessage(error) }
    }
  }

  /**
   * Reveal one recorded file in the host file manager — open its folder and
   * select the file (macOS Finder, Windows Explorer, or a select-capable
   * desktop file manager). The display path resolves against the session cwd;
   * the native reveal runs on the host. A path that does not resolve to an
   * existing target, or a platform that cannot select, answers `revealed:
   * false` and the caller opens the parent folder instead (the pre-reveal
   * "show in folder" behavior), so the gesture always lands somewhere visible.
   * @param agent - owning live agent; its session cwd anchors relative paths.
   * @param path - the display path recorded by the read/write/edit tool call.
   * @param signal - cooperative cancellation from the calling UI request.
   * @returns whether the file manager selected the file, or why not.
   */
  @Remote('reveal')
  async reveal(agent: Agent, path: string, signal: AbortSignal): Promise<FilePreviewReveal> {
    if (typeof path !== 'string' || path.length === 0) {
      return { revealed: false, reason: 'missing' }
    }
    const cwd = agent.session.header.cwd
    let target
    try {
      target = await this.fs.resolve(path, cwd === undefined ? { signal } : { cwd, signal })
    } catch (error) {
      // Unresolvable recorded path: the file is gone; the caller opens the parent.
      return { revealed: false, reason: 'missing' }
    }
    let info
    try {
      info = await this.fs.stat(target, signal)
    } catch {
      // A stat failure is treated as missing; the caller still opens the parent.
      info = undefined
    }
    if (info === undefined) {
      return { revealed: false, reason: 'missing' }
    }
    try {
      // processPath hands the canonical path a host subprocess can open; the
      // recorded display path may be relative or backend-normalized.
      await this.revealNative(this.fs.processPath(target), signal)
      return { revealed: true }
    } catch {
      // No select-capable file manager (or a failed launch): fall back to the
      // parent-folder open rather than failing the whole gesture.
      return { revealed: false, reason: 'select-failed' }
    }
  }
}

export default FilePreviewService
