/**
 * The managed Chrome: one headless process, a fresh temporary BrowserContext
 * per render, an idle-timeout shutdown.
 *
 * Process model (the closed browser-pane proposal's reviewed model, reused):
 *
 * - **One managed process**, not one per render — a process per render is the
 *   memory bomb the browser-pane review caught. Renders serialize through the
 *   queue, so one process is never contended.
 * - **A fresh `BrowserContext` per render** — the zero-persistence guarantee:
 *   no cookies, credentials, or storage survive a render. The profile on disk
 *   is a fresh temporary directory per PROCESS launch (Chrome 136+ refuses
 *   remote debugging on a default data dir, and a real profile is exactly the
 *   login state this plugin never carries).
 * - **`pipe: true`**, never a debug port: the CDP channel rides stdio, so no
 *   TCP listener exists for any local process to attach to.
 * - **Lazy binary**: the Chrome for Testing build lives under
 *   `<stateRoot>/chrome/` (deployment state, never the package directory) and
 *   downloads on the FIRST render, not at boot. A failed install or launch is
 *   a domain error on that call (`capture/unavailable`), never a boot crash.
 * - **Idle shutdown**: the process exits `idleTimeoutMs` after the last
 *   render; the next render relaunches.
 *
 * The puppeteer surface is consumed through the structural interfaces below —
 * never through `puppeteer-core` types. The generator that produces this
 * package's Remote face analyzes sources against the harness checkout, which
 * does not carry puppeteer; a static import of it would fail that analysis
 * (and a value import at module scope would load the driver at boot). Both
 * edges are instead variable-specifier dynamic imports inside the defaults,
 * typed at the adapter boundary.
 *
 * @module @khorsheed/dsh-capture/browser
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  CAPTURE_VIEWPORT,
  DEFAULT_CHROME_BUILD,
  DEFAULT_IDLE_TIMEOUT_MS,
} from './types.ts'

/** The page surface the render pipeline drives (a structural subset of puppeteer's `Page`). */
export interface CapturePage {
  setViewport(viewport: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>
  setRequestInterception(enabled: boolean): Promise<void>
  on(event: 'request', listener: (request: CaptureHttpRequest) => void): void
  on(event: 'requestfinished' | 'requestfailed', listener: (request: CaptureHttpRequest) => void): void
  /** The main frame's identity, compared against a request's frame. */
  mainFrame(): unknown
  goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<CaptureHttpResponse | null>
  /** Run a self-contained function in the page and return its (serializable) result. */
  evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>
  /** Where the page actually is (after every redirect). */
  url(): string
}

/** The request surface the interception gate reads (a structural subset of puppeteer's `HTTPRequest`). */
export interface CaptureHttpRequest {
  isNavigationRequest(): boolean
  /** The frame the request belongs to; identity-compared with `page.mainFrame()`. */
  frame(): unknown
  url(): string
  continue(): Promise<void>
  abort(errorCode?: string): Promise<void>
}

/** The response surface the pipeline reads (a structural subset of puppeteer's `HTTPResponse`). */
export interface CaptureHttpResponse {
  status(): number
  url(): string
}

/** A temporary BrowserContext (the per-render isolation unit). */
export interface CaptureBrowserContextHandle {
  newPage(): Promise<CapturePage>
  close(): Promise<void>
}

/** The browser-process surface this manager drives. */
export interface CaptureManagedBrowser {
  createBrowserContext(): Promise<CaptureBrowserContextHandle>
  close(): Promise<void>
  /** Register a disconnect listener (crash/kill); the next render relaunches. */
  onDisconnected(listener: () => void): void
}

/** How to reach a Chrome binary: an explicit path, a system channel, or the managed download. */
export interface CaptureBrowserConfig {
  /** State root; the managed binary and the throwaway profiles live under it. */
  readonly stateRoot: string
  /** Explicit Chrome/Chromium executable path (skips the managed download). */
  readonly executablePath?: string
  /** A system channel puppeteer resolves itself (e.g. `chrome`); skips the managed download. */
  readonly channel?: string
  /** Chrome for Testing build tag to install when neither override is set (default `stable`). */
  readonly chromeBuildId?: string
  /** Idle shutdown delay (default {@link DEFAULT_IDLE_TIMEOUT_MS}). */
  readonly idleTimeoutMs?: number
  /** Extra Chrome command-line arguments (deployment escape hatch). */
  readonly extraArgs?: readonly string[]
}

/** Test seams: every process/network edge is injectable. */
export interface CaptureBrowserDeps {
  /** The launcher (defaults to puppeteer-core's `launch`, adapted). */
  readonly launch?: (options: {
    executablePath?: string
    channel?: string
    userDataDir: string
    args: readonly string[]
  }) => Promise<CaptureManagedBrowser>
  /** The installer (defaults to `@puppeteer/browsers`); resolves to the executable path. */
  readonly install?: (cacheDir: string, buildId: string) => Promise<string>
  /** Whether the configured executable exists (default: trust the config). */
  readonly executableExists?: (path: string) => boolean
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- see module note */
type Untyped = any

/** The browser-process owner. Renders enter through {@link withPage}. */
export class CaptureBrowserManager {
  private browser: Promise<CaptureManagedBrowser> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(
    private readonly config: CaptureBrowserConfig,
    private readonly deps: CaptureBrowserDeps = {},
  ) {}

  /** Where the managed Chrome for Testing build is installed. */
  get cacheDir(): string {
    return join(this.config.stateRoot, 'chrome')
  }

  /**
   * Run `fn` with a fresh page in a fresh temporary BrowserContext. The
   * context closes in `finally` (zero cookie/credential persistence), and the
   * idle shutdown is (re)armed when the render settles.
   */
  async withPage<T>(fn: (page: CapturePage) => Promise<T>): Promise<T> {
    const browser = await this.ensureBrowser()
    let context: CaptureBrowserContextHandle | undefined
    try {
      context = await browser.createBrowserContext()
      const page = await context.newPage()
      await page.setViewport({ ...CAPTURE_VIEWPORT, deviceScaleFactor: 1 })
      return await fn(page)
    } finally {
      if (context !== undefined) {
        await context.close().catch(() => {
          // A crashed browser closes contexts itself; the render already failed upstream.
        })
      }
      this.armIdleShutdown()
    }
  }

  /** The live browser, launching (and if needed installing) on first use. */
  private ensureBrowser(): Promise<CaptureManagedBrowser> {
    if (this.disposed) {
      return Promise.reject(new RemoteError('capture/unavailable', 'the capture service is disposed', {}))
    }
    this.disarmIdleShutdown()
    if (this.browser === undefined) {
      this.browser = this.launch().catch((error: unknown) => {
        // A failed launch must not wedge every later render: the next call retries.
        this.browser = undefined
        throw error
      })
    }
    return this.browser
  }

  /** Resolve which Chrome to run: explicit path → system channel → managed download. */
  private async resolveExecutable(): Promise<{ executablePath?: string; channel?: string }> {
    if (this.config.executablePath !== undefined && this.config.executablePath !== '') {
      const exists = this.deps.executableExists?.(this.config.executablePath) ?? true
      if (!exists) {
        throw new RemoteError(
          'capture/unavailable',
          `configured Chrome executable does not exist: ${this.config.executablePath}`,
          {},
        )
      }
      return { executablePath: this.config.executablePath }
    }
    if (this.config.channel !== undefined && this.config.channel !== '') {
      return { channel: this.config.channel }
    }
    const buildId = this.config.chromeBuildId ?? DEFAULT_CHROME_BUILD
    const install = this.deps.install ?? defaultInstall
    try {
      const executablePath = await install(this.cacheDir, buildId)
      return { executablePath }
    } catch (error) {
      throw new RemoteError(
        'capture/unavailable',
        `no managed Chrome and the download failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`,
        {},
      )
    }
  }

  /** Launch the managed process on a fresh throwaway profile directory. */
  private async launch(): Promise<CaptureManagedBrowser> {
    const target = await this.resolveExecutable()
    this.cleanStaleProfiles()
    const userDataDir = mkdtempSync(join(this.profileRoot(), `p${process.pid}-`))
    const args = [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-dev-shm-usage',
      '--mute-audio',
      ...this.config.extraArgs ?? [],
    ]
    const launch = this.deps.launch ?? defaultLaunch
    let browser: CaptureManagedBrowser
    try {
      browser = await launch({
        ...(target.executablePath !== undefined ? { executablePath: target.executablePath } : {}),
        ...(target.channel !== undefined ? { channel: target.channel } : {}),
        userDataDir,
        args,
      })
    } catch (error) {
      rmSync(userDataDir, { recursive: true, force: true })
      if (error instanceof RemoteError) throw error
      throw new RemoteError(
        'capture/unavailable',
        `Chrome did not launch: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`,
        {},
      )
    }
    browser.onDisconnected(() => {
      this.browser = undefined // a crashed browser relaunches on the next render
      // The just-closed process still has files in flight; retry briefly and
      // never let a profile cleanup failure escape the listener.
      try {
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        // Best-effort: the next launch's stale-profile sweep takes the rest.
      }
    })
    return browser
  }

  /** The directory per-process throwaway profiles live under (created on demand). */
  private profileRoot(): string {
    const root = join(this.config.stateRoot, 'chrome-profile')
    mkdirSync(root, { recursive: true })
    return root
  }

  /** Remove profile directories a dead process left behind (idle/crash residue). */
  private cleanStaleProfiles(): void {
    try {
      rmSync(this.profileRoot(), { recursive: true, force: true })
    } catch {
      // Best-effort: a locked leftover costs disk, not correctness.
    }
  }

  /** Schedule the idle shutdown; a new render disarms it. */
  private armIdleShutdown(): void {
    this.disarmIdleShutdown()
    const delay = this.config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.idleTimer = setTimeout(() => {
      void this.shutdownBrowser()
    }, delay)
    this.idleTimer.unref?.()
  }

  private disarmIdleShutdown(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
  }

  /** Close the live browser (idle timeout or dispose). */
  private async shutdownBrowser(): Promise<void> {
    const current = this.browser
    this.browser = undefined
    if (current === undefined) return
    try {
      await (await current).close()
    } catch {
      // A browser that already died rejects close; the process is gone either way.
    }
  }

  /** Stop the idle timer and close the browser (plugin disposal). */
  async dispose(): Promise<void> {
    this.disposed = true
    this.disarmIdleShutdown()
    await this.shutdownBrowser()
  }
}

/**
 * The default launcher: puppeteer-core, pipe transport, new headless.
 *
 * The specifier rides a variable so static analysis never resolves it: the
 * typert overlay (a harness clone) does not carry puppeteer, and a literal
 * `import('puppeteer-core')` would fail that analysis — the driver is loaded
 * on the first render, never at boot.
 */
async function defaultLaunch(options: {
  executablePath?: string
  channel?: string
  userDataDir: string
  args: readonly string[]
}): Promise<CaptureManagedBrowser> {
  const specifier = 'puppeteer-core'
  const { launch } = (await import(specifier)) as {
    launch: (options: Record<string, unknown>) => Promise<Untyped>
  }
  const browser = await launch({
    ...(options.executablePath !== undefined ? { executablePath: options.executablePath } : {}),
    ...(options.channel !== undefined ? { channel: options.channel } : {}),
    headless: true,
    pipe: true,
    userDataDir: options.userDataDir,
    args: [...options.args],
    timeout: 30_000,
  }) as {
    createBrowserContext(): Promise<{ newPage(): Promise<CapturePage>; close(): Promise<void> }>
    close(): Promise<void>
    on(event: 'disconnected', listener: () => void): void
  }
  return {
    createBrowserContext: () => browser.createBrowserContext(),
    close: () => browser.close(),
    onDisconnected: (listener) => browser.on('disconnected', listener),
  }
}

/**
 * The default installer: Chrome for Testing into `<stateRoot>/chrome/`,
 * idempotent across renders (`install` on an existing build resolves its
 * executable without re-downloading). Same variable-specifier rationale as
 * the launcher.
 */
async function defaultInstall(cacheDir: string, buildId: string): Promise<string> {
  const specifier = '@puppeteer/browsers'
  const browsers = (await import(specifier)) as {
    Browser: { CHROME: string }
    detectBrowserPlatform(): string | undefined
    resolveBuildId(browser: string, platform: string, tag: string): Promise<string>
    install(options: { cacheDir: string; browser: string; buildId: string }): Promise<{ executablePath: string }>
  }
  const platform = browsers.detectBrowserPlatform()
  if (platform === undefined) throw new Error('this platform cannot run Chrome for Testing')
  const pinned = await browsers.resolveBuildId(browsers.Browser.CHROME, platform, buildId)
  const installed = await browsers.install({
    cacheDir,
    browser: browsers.Browser.CHROME,
    buildId: pinned,
  })
  return installed.executablePath
}
