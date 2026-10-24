/** Read-only file-preview Remote service over live sessions and the filesystem.
 * @module @khorsheed/dsh-file-preview
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { BashWriteCollector } from './bash-writes.ts'
import { panelSession } from './panel-session.ts'
import { foldFilePreviewByTurn, type TurnFilesByTurn } from './fold.ts'
import { openExternalNative, macAppName } from './open-external.ts'
import {
  IMAGE_MIME, eventsWatermark, isImagePath, listFilePreview, readErrorMessage, readFilePreview, turnFilesFilePreview,
} from './read-surface.ts'
import { revealNativePath } from './reveal.ts'
import type { FilePreviewConfig, FilePreviewList, FilePreviewOpenExternal, FilePreviewRead, FilePreviewReveal, FilePreviewTurnMap } from './types.ts'

export { createFilePreviewReadSurface } from './read-surface.ts'
export type { FilePreviewImageBytes, FilePreviewReadFs, FilePreviewReadSource, FilePreviewReadSurface } from './read-surface.ts'

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

/**
 * The `filePreview` Remote service: session-scoped read-only file inspection
 * for web surfaces. `list` is a fold over the session log, then filtered to the
 * paths that still exist on disk (resolved against the session cwd and stat-ed
 * per call); `read` resolves the path against the session cwd and serves current
 * text content through `ctx.fs` (or a browser URL for images), capped by
 * config. Image bytes ride a dedicated host route so the browser loads them
 * natively without bloating the RPC channel.
 */
export class FilePreviewService extends TypertRemoteService {
  static inject = ['fs']

  static Config: z<FilePreviewConfig> = z.object({
    maxReadBytes: z.natural().min(1).default(512 * 1024),
    htmlMaxReadBytes: z.natural().min(1).default(4 * 1024 * 1024),
    maxFiles: z.natural().min(1).default(500),
    captureBashWrites: z.boolean().default(true),
  })

  /** URL prefix the image route answers under. */
  static readonly IMAGE_ROUTE = '/file-preview-image'

  private readonly resolved: Required<FilePreviewConfig>
  /** The agents service while the image route is registered; undefined
   * otherwise (headless faces, or before `webServer`/`agents` arrive), and
   * image reads then answer `binary` (no browser to serve). */
  private agents: AgentRegistry | undefined
  /** Native reveal runner; a constructor seam for deterministic tests. */
  private readonly revealNative: (path: string, signal: AbortSignal) => Promise<void>
  /** Native open-in-app runner; a constructor seam for deterministic tests. */
  private readonly openExternalNative: (path: string, app: string, signal: AbortSignal) => Promise<void>
  /** Bash-write collector (S2 seam), or undefined when disabled in config. */
  private readonly collector: BashWriteCollector | undefined
  /** Per-session by-turn fold cache, invalidated by the log watermark. */
  private readonly turnCache = new Map<string, { asOfSeq: number; byTurn: TurnFilesByTurn }>()

  /**
   * @param ctx - owning Cordis Context carrying `fs`; `webServer` and `agents`
   *   are optional (the image route registers whenever both are up, headless
   *   faces lack both).
   * @param config - optional deployment tuning; defaults cap reads and lists,
   *   and enable the bash-write collector.
   * @param deps - test seam for the native reveal dispatch.
   */
  constructor(
    ctx: Context,
    config: FilePreviewConfig = {},
    deps: {
      revealNative?: (path: string, signal: AbortSignal) => Promise<void>
      openExternalNative?: (path: string, app: string, signal: AbortSignal) => Promise<void>
    } = {},
  ) {
    super(ctx, 'filePreview')
    this.resolved = {
      maxReadBytes: config.maxReadBytes ?? 512 * 1024,
      htmlMaxReadBytes: config.htmlMaxReadBytes ?? 4 * 1024 * 1024,
      maxFiles: config.maxFiles ?? 500,
      captureBashWrites: config.captureBashWrites ?? true,
    }
    this.revealNative = deps.revealNative ?? revealNativePath
    this.openExternalNative = deps.openExternalNative ?? openExternalNative
    if (config.captureBashWrites !== false) {
      this.collector = new BashWriteCollector({ fs: this.fs, maxFiles: this.resolved.maxFiles })
      ctx.effect(
        () => this.collector!.attach(ctx),
        'file-preview: bash-write capture',
      )
    } else {
      this.collector = undefined
    }
    // Optional services through a sub-fiber, never an apply-time `ctx.get`:
    // a one-shot probe loses the route for good whenever this service applies
    // before `webServer`/`agents` (load order is not guaranteed), and every
    // image then reads as `binary`. The sub-fiber registers the route once
    // both are up and withdraws it when either leaves.
    ctx.inject(['webServer', 'agents'], (routeCtx) => {
      const webServer = routeCtx.get('webServer') as ImageRouteHost
      const agents = routeCtx.get('agents')
      routeCtx.effect(() => {
        const unregister = webServer.register({
          kind: 'prefix',
          path: FilePreviewService.IMAGE_ROUTE,
          /* v8 ignore next 2 -- the handler body is the request path; the
             unit tests drive serveImage directly, the real server reaches it
             through this registration */
          handler: (req: IncomingMessage, res: ServerResponse) => { void this.serveImage(req, res) },
        })
        this.agents = agents
        return () => {
          this.agents = undefined
          unregister()
        }
      }, 'file-preview: image route')
    })
  }

  /** Zero-session availability handshake for browser companions. */
  @Remote('capabilities')
  capabilities(): { protocolVersion: 1 } {
    return { protocolVersion: 1 }
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
    // An attached session answers too: a subagent's (a room CLI member's)
    // session has no Agent of its own in the registry.
    const session = this.ctx.get('sessions')?.get(sessionId) ?? this.agents?.get(sessionId)?.session
    if (session === undefined) {
      res.writeHead(404).end('file preview: session not found')
      return
    }
    if (!isImagePath(display)) {
      res.writeHead(400).end('file preview: not an image path')
      return
    }
    const cwd = session.header.cwd
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
   * captured path the fold already knows keeps its log-derived entry. Only
   * paths that currently exist on disk are returned — a file the session
   * wrote and later deleted is history, not a product.
   * @param sessionId - the owning session (see panel-session.ts); its log is the data source.
   * @returns existing first-seen files capped by `maxFiles`, with the log watermark.
   */
  @Remote('list')
  async list(sessionId: SessionId): Promise<FilePreviewList> {
    const session = await panelSession(this.ctx, sessionId)
    return listFilePreview(
      // The header read stays lazy-tolerant: the pre-core code only touched
      // the cwd inside the existence probe, which an empty fold never reached.
      { fs: this.fs, cwd: session.header?.cwd, maxFiles: this.resolved.maxFiles },
      session.snapshotEvents(),
      this.collector?.captured(sessionId),
    )
  }

  /**
   * Every turn's file mutations for the turn-tail card — the single source of
   * truth the card renders (the client's old write/edit-only fold retired).
   * Built by folding the session log per turn (write/edit calls, PTC
   * dispatches borrowing the root call's turn, and render-intent paths from
   * result diff meta) and merging the collector's bash-written captures by
   * their own turn. The fold is cached per session and invalidated by the log
   * watermark, so repeated card fetches do not refold. A path touched in two
   * turns appears in BOTH turn groups — per-turn attribution is exact. Only
   * paths that currently exist on disk are returned (a deleted temp script is
   * history, not a product); existence is probed fresh on every call, so the
   * cached fold is filtered per request rather than cached.
   * @param sessionId - the owning session (see panel-session.ts); its log is the data source.
   * @returns existing per-turn file groups plus the scanned watermark.
   */
  @Remote('turnFiles')
  async turnFiles(sessionId: SessionId): Promise<FilePreviewTurnMap> {
    const session = await panelSession(this.ctx, sessionId)
    const events = session.snapshotEvents()
    const asOfSeq = eventsWatermark(events)
    const cached = this.turnCache.get(session.id)
    let byTurn: TurnFilesByTurn
    if (cached === undefined || cached.asOfSeq !== asOfSeq) {
      byTurn = foldFilePreviewByTurn(events)
      this.turnCache.set(session.id, { asOfSeq, byTurn })
    } else {
      byTurn = cached.byTurn
    }
    return turnFilesFilePreview(
      { fs: this.fs, cwd: session.header?.cwd, maxFiles: this.resolved.maxFiles },
      asOfSeq,
      byTurn,
      this.collector?.captured(session.id),
    )
  }

  /**
   * Read the current content of one recorded file, resolved against the
   * session cwd and capped by `maxReadBytes`. The text read is a bounded byte
   * window (`readByteRange` of cap + 1 bytes), so an oversized file costs the
   * cap, never its full size; a known oversized stat still short-circuits to
   * `too-large` before any bytes move.
   * @param sessionId - the owning session (see panel-session.ts); its cwd anchors relative paths.
   * @param path - the display path recorded by the write/edit tool call.
   * @param signal - cooperative cancellation from the calling UI request.
   * @returns the classified read; `text` carries content, `image` carries a
   *   browser URL, other kinds carry the size or a human-readable reason.
   */
  @Remote('read')
  async read(sessionId: SessionId, path: string, signal: AbortSignal): Promise<FilePreviewRead> {
    const session = await panelSession(this.ctx, sessionId)
    return readFilePreview(
      {
        fs: this.fs,
        cwd: session.header.cwd,
        maxReadBytes: this.resolved.maxReadBytes,
        htmlMaxReadBytes: this.resolved.htmlMaxReadBytes,
        // The web face's image route is the local deployment's issuer; a
        // headless composition has none and image reads answer `binary`.
        imageUrl: this.agents !== undefined
          ? (display: string) => `${FilePreviewService.IMAGE_ROUTE}/${session.id}/${encodeURIComponent(display)}`
          : undefined,
      },
      path,
      signal,
    )
  }

  /**
   * Reveal one recorded file in the host file manager — open its folder and
   * select the file (macOS Finder, Windows Explorer, or a select-capable
   * desktop file manager). The display path resolves against the session cwd;
   * the native reveal runs on the host. A path that does not resolve to an
   * existing target, or a platform that cannot select, answers `revealed:
   * false` and the caller opens the parent folder instead (the pre-reveal
   * "show in folder" behavior), so the gesture always lands somewhere visible.
   * @param sessionId - the owning session (see panel-session.ts); its cwd anchors relative paths.
   * @param path - the display path recorded by the read/write/edit tool call.
   * @param signal - cooperative cancellation from the calling UI request.
   * @returns whether the file manager selected the file, or why not.
   */
  @Remote('reveal')
  async reveal(sessionId: SessionId, path: string, signal: AbortSignal): Promise<FilePreviewReveal> {
    if (typeof path !== 'string' || path.length === 0) {
      return { revealed: false, reason: 'missing' }
    }
    const cwd = (await panelSession(this.ctx, sessionId)).header.cwd
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

  /**
   * Open one recorded file in a specific host application (the "open in IDE"
   * gesture). The official open-in-app route only accepts directories — a
   * file path 404s — so file-exact opens go through this method: macOS
   * `open -a <App> <path>` via the same native-command runner reveal uses.
   * The browser names the application by official open-in-app catalog id
   * (probed from `/open-in-app/apps`); the id → app-name map lives in
   * open-external.ts. Non-macOS hosts and unknown ids answer without
   * launching, and the client hides the gesture.
   * @param sessionId - the owning session (see panel-session.ts); its cwd anchors relative paths.
   * @param path - the display path recorded by the read/write/edit tool call.
   * @param app - official open-in-app catalog id (e.g. `cursor`).
   * @param signal - cooperative cancellation from the calling UI request.
   * @returns whether the application launched, or why not.
   */
  @Remote('openExternal')
  async openExternal(sessionId: SessionId, path: string, app: string, signal: AbortSignal): Promise<FilePreviewOpenExternal> {
    if (typeof path !== 'string' || path.length === 0 || typeof app !== 'string' || app.length === 0) {
      return { opened: false, reason: 'missing' }
    }
    if (macAppName(app) === undefined) return { opened: false, reason: 'unknown-app' }
    const cwd = (await panelSession(this.ctx, sessionId)).header.cwd
    let target
    try {
      target = await this.fs.resolve(path, cwd === undefined ? { signal } : { cwd, signal })
    } catch {
      return { opened: false, reason: 'missing' }
    }
    let info
    try {
      info = await this.fs.stat(target, signal)
    } catch {
      info = undefined
    }
    if (info === undefined) return { opened: false, reason: 'missing' }
    try {
      await this.openExternalNative(this.fs.processPath(target), app, signal)
      return { opened: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { opened: false, reason: message.startsWith('open-in-app is unsupported on ') ? 'unsupported-platform' : 'launch-failed' }
    }
  }
}

export default FilePreviewService
