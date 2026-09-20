/**
 * The capture service core: the `render` pipeline from URL to serialized page.
 *
 * One call's path:
 *
 * 1. **URL policy** — parse/scheme/credentials refuse synchronously; the host
 *    is then resolved and every answer must be a public address. The same gate
 *    re-runs on EVERY redirect hop through request interception, so a public
 *    URL cannot redirect into the private network.
 * 2. **The queue** — one render at a time; a full wait line refuses `busy`.
 * 3. **The render** — a fresh temporary BrowserContext on the managed
 *    browser: intercept → navigate (`load`, bounded by `timeoutMs`) → refuse
 *    HTTP error statuses → re-check the landed URL → wait for network
 *    quiescence → full-page scroll sweep (IntersectionObserver dwell) → inline
 *    CSSOM styles (var() resolved) and serialize, scripts removed, output
 *    capped.
 * 4. **The record** — a successful render persists/refreshes the site's allow
 *    record in `state.json` (the v1 gesture-gate bookkeeping; a failed render
 *    approves nothing).
 *
 * Every refusal is a thrown `RemoteError` with a `capture/*` code — the wire
 * folds it into the caller's `RemoteResult` error branch. Nothing here throws
 * at boot or on construction: the browser installs/launches lazily, and its
 * failure is one call's `capture/unavailable`.
 *
 * @module @khorsheed/dsh-capture/service
 */
import type { Context } from '@deepseek-ai/cordis'
import { CaptureBrowserManager, type CaptureBrowserDeps, type CaptureHttpRequest, type CaptureHttpResponse, type CapturePage } from './browser.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { QueueBusyError, SerialRenderQueue } from './queue.ts'
import { CaptureStore, resolveCaptureStateRoot } from './store.ts'
import {
  CAPTURE_MAX_TIMEOUT_MS,
  CAPTURE_MIN_TIMEOUT_MS,
  DEFAULT_DWELL_MS,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_QUEUE,
  DEFAULT_MAX_SWEEP_MS,
  DEFAULT_TIMEOUT_MS,
  QUIESCENCE_MAX_MS,
  QUIESCENCE_QUIET_MS,
  SCROLL_STEP_RATIO,
  type CaptureRenderRequest,
  type CaptureRenderedPage,
} from './types.ts'
import { checkResolvedTarget, checkUrlSyntax, type CaptureHostLookup, type CaptureUrlVerdict } from './url-policy.ts'
import { inlineStylesAndSerialize, scrollSweepPage } from './page-tasks.ts'

/** Plugin configuration (the cordis.yml row's `config`). */
export interface CaptureConfig {
  /** State root override; defaults to `$DSH_HOME/state/dsh-capture`. */
  readonly stateRoot?: string
  /** Explicit Chrome/Chromium executable path (skips the managed download). */
  readonly executablePath?: string
  /** System channel (e.g. `chrome`) puppeteer resolves itself. */
  readonly channel?: string
  /** Chrome for Testing build tag for the managed download (default `stable`). */
  readonly chromeBuildId?: string
  /** Default navigation timeout (default {@link DEFAULT_TIMEOUT_MS}). */
  readonly defaultTimeoutMs?: number
  /** Serialized-output cap in characters (default {@link DEFAULT_MAX_CHARS}). */
  readonly maxChars?: number
  /** Idle shutdown delay for the managed browser. */
  readonly idleTimeoutMs?: number
  /** How many renders may wait behind the one in flight. */
  readonly maxQueue?: number
  /** Scroll-sweep dwell per viewport step (IntersectionObserver needs ≥ ~400 ms). */
  readonly dwellMs?: number
  /** Total scroll-sweep budget. */
  readonly maxSweepMs?: number
  /** Extra Chrome command-line arguments. */
  readonly extraArgs?: readonly string[]
}

/** Test seams: the resolver and every process edge are injectable. */
export interface CaptureDeps extends CaptureBrowserDeps {
  /** The hostname resolver (defaults to the system resolver). */
  readonly lookup?: CaptureHostLookup
}

/** The `capture` service: what `ctx.provide('capture', …)` publishes. */
export class CaptureService {
  private readonly store: CaptureStore
  private readonly queue: SerialRenderQueue
  private readonly browsers: CaptureBrowserManager
  private readonly lookup: CaptureHostLookup | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: CaptureConfig = {},
    deps: CaptureDeps = {},
  ) {
    const stateRoot = resolveCaptureStateRoot(config.stateRoot)
    this.store = new CaptureStore(stateRoot, {
      warn: (message) => this.ctx.logger.warn(message),
    })
    this.queue = new SerialRenderQueue(config.maxQueue ?? DEFAULT_MAX_QUEUE)
    this.browsers = new CaptureBrowserManager(
      {
        stateRoot,
        ...(config.executablePath !== undefined ? { executablePath: config.executablePath } : {}),
        ...(config.channel !== undefined ? { channel: config.channel } : {}),
        ...(config.chromeBuildId !== undefined ? { chromeBuildId: config.chromeBuildId } : {}),
        ...(config.idleTimeoutMs !== undefined ? { idleTimeoutMs: config.idleTimeoutMs } : {}),
        ...(config.extraArgs !== undefined ? { extraArgs: config.extraArgs } : {}),
      },
      deps,
    )
    this.lookup = deps.lookup
  }

  /** The state root in use (diagnostics and tests). */
  get stateRoot(): string {
    return this.store.stateRoot
  }

  /** One host's allow record, when a render of it has succeeded before. */
  siteRecord(host: string): ReturnType<CaptureStore['site']> {
    return this.store.site(host)
  }

  /**
   * Render one URL and hand back the serialized page.
   *
   * @param request - the URL and optional timeout.
   * @returns the rendered page (never an error union — refusals throw).
   */
  async render(request: CaptureRenderRequest): Promise<CaptureRenderedPage> {
    const syntax = checkUrlSyntax(request.url)
    if (!syntax.ok) throw refusalError(syntax)
    const timeoutMs = clampTimeout(request.timeoutMs ?? this.config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS)
    let queued: Promise<CaptureRenderedPage>
    try {
      queued = this.queue.run(() => this.renderOne(syntax.url, timeoutMs))
    } catch (error) {
      if (error instanceof QueueBusyError) {
        throw new RemoteError('capture/busy', error.message, {})
      }
      throw error
    }
    return queued
  }

  /** The pipeline behind the queue slot. */
  private async renderOne(url: URL, timeoutMs: number): Promise<CaptureRenderedPage> {
    const verdict = await checkResolvedTarget(url, this.lookup)
    if (!verdict.ok) throw refusalError(verdict)
    const page = await this.browsers.withPage((p) => this.renderInPage(p, url, timeoutMs))
    const host = safeHost(page.finalUrl ?? url.href)
    if (host !== undefined) this.store.recordRender(host, new Date().toISOString())
    return page
  }

  /** Everything that happens on the fresh page, start to serialized finish. */
  private async renderInPage(page: CapturePage, url: URL, timeoutMs: number): Promise<CaptureRenderedPage> {
    // Every request passes this handler (interception): navigations through
    // the full policy (this is the per-redirect re-check), subresources pass
    // on web schemes, and anything else (file:, chrome:, …) is aborted.
    let inFlight = 0
    let refused: CaptureUrlVerdict | undefined
    const pendingGates = new Set<Promise<void>>()
    await page.setRequestInterception(true)
    page.on('request', (request: CaptureHttpRequest) => {
      inFlight += 1
      const gate = this.gateRequest(page, request).then(
        (verdict) => {
          if (verdict !== undefined && refused === undefined) refused = verdict
        },
        () => undefined, // a settled page races its handlers; the goto outcome reports
      )
      pendingGates.add(gate)
      void gate.finally(() => {
        pendingGates.delete(gate)
      })
    })
    page.on('requestfinished', () => {
      inFlight = Math.max(0, inFlight - 1)
    })
    page.on('requestfailed', () => {
      inFlight = Math.max(0, inFlight - 1)
    })
    /** A gate's verdict lands asynchronously; read it only after draining. */
    const drainedRefusal = async (): Promise<CaptureUrlVerdict | undefined> => {
      await Promise.allSettled([...pendingGates])
      return refused
    }

    let response: CaptureHttpResponse | null
    try {
      response = await page.goto(url.href, { waitUntil: 'load', timeout: timeoutMs })
    } catch (error) {
      const refusal = await drainedRefusal()
      if (refusal !== undefined && !refusal.ok) throw refusalError(refusal)
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new RemoteError('capture/timeout', `navigation did not finish within ${timeoutMs}ms`, { timeoutMs })
      }
      throw new RemoteError(
        'capture/navigation-failed',
        `navigation failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`,
        {},
      )
    }
    const refusal = await drainedRefusal()
    if (refusal !== undefined && !refusal.ok) throw refusalError(refusal)
    const status = response?.status()
    if (status !== undefined && status >= 400) {
      throw new RemoteError('capture/navigation-failed', `the server answered HTTP ${status}`, { status })
    }

    // Belt: the landed URL passes the gate again even though every hop was
    // already checked — a client-side navigation is still a navigation.
    const landed = await checkResolvedTarget(new URL(page.url()), this.lookup).catch((): CaptureUrlVerdict => ({
      ok: false,
      code: 'capture/invalid-url',
      message: 'the landed URL does not parse',
    }))
    if (!landed.ok) throw refusalError(landed)

    await waitForQuiescence(() => inFlight, QUIESCENCE_QUIET_MS, QUIESCENCE_MAX_MS)
    await page.evaluate(scrollSweepPage, {
      dwellMs: this.config.dwellMs ?? DEFAULT_DWELL_MS,
      maxMs: this.config.maxSweepMs ?? DEFAULT_MAX_SWEEP_MS,
      stepRatio: SCROLL_STEP_RATIO,
    })
    const serialized = await page.evaluate(inlineStylesAndSerialize, {
      maxChars: this.config.maxChars ?? DEFAULT_MAX_CHARS,
    })
    this.ctx.logger.debug(
      `dsh-capture: rendered ${serialized.finalUrl} — ${serialized.inlinedElements} elements inlined, `
      + `${serialized.removedScripts} scripts removed, ${serialized.skippedSheets} sheets skipped`
      + `${serialized.truncated ? ', TRUNCATED' : ''}`,
    )
    return {
      html: serialized.html,
      ...(serialized.finalUrl !== '' ? { finalUrl: serialized.finalUrl } : {}),
      ...(serialized.title !== '' ? { title: serialized.title } : {}),
      ...(serialized.truncated ? { truncated: true } : {}),
    }
  }

  /**
   * The request gate behind interception. Navigations on the main frame run
   * the full URL policy (per-redirect re-check); subresources pass on
   * http(s)/data/blob and abort otherwise.
   *
   * @returns the refusal verdict when the request was a refused navigation.
   */
  private async gateRequest(page: CapturePage, request: CaptureHttpRequest): Promise<CaptureUrlVerdict | undefined> {
    const isMainNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame()
    if (isMainNavigation) {
      const raw = request.url()
      const syntax = checkUrlSyntax(raw)
      const verdict = syntax.ok ? await checkResolvedTarget(syntax.url, this.lookup) : syntax
      if (!verdict.ok) {
        await request.abort('blockedbyclient').catch(() => undefined)
        return verdict
      }
      await request.continue().catch(() => undefined)
      return undefined
    }
    const scheme = safeScheme(request.url())
    if (scheme === 'http:' || scheme === 'https:' || scheme === 'data:' || scheme === 'blob:' || scheme === 'about:') {
      await request.continue().catch(() => undefined)
    } else {
      await request.abort('blockedbyclient').catch(() => undefined)
    }
    return undefined
  }

  /** Stop the managed browser (plugin disposal). */
  async dispose(): Promise<void> {
    await this.browsers.dispose()
  }
}

/** Map a policy refusal onto the wire failure. */
function refusalError(verdict: Extract<CaptureUrlVerdict, { ok: false }>): RemoteError<'capture/invalid-url' | 'capture/private-target'> {
  return verdict.code === 'capture/private-target'
    ? new RemoteError('capture/private-target', verdict.message, { hostname: verdict.hostname ?? '' })
    : new RemoteError('capture/invalid-url', verdict.message, { url: verdict.url ?? '' })
}

/** Clamp a caller timeout into the supported range. */
export function clampTimeout(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS
  return Math.min(CAPTURE_MAX_TIMEOUT_MS, Math.max(CAPTURE_MIN_TIMEOUT_MS, Math.floor(ms)))
}

/** Post-load network quiescence: no request in flight for `quietMs`, capped at `maxMs`. */
export async function waitForQuiescence(inFlight: () => number, quietMs: number, maxMs: number): Promise<void> {
  const started = Date.now()
  let quietSince: number | undefined
  for (;;) {
    const now = Date.now()
    if (inFlight() === 0) {
      quietSince ??= now
      if (now - quietSince >= quietMs) return
    } else {
      quietSince = undefined
    }
    if (now - started >= maxMs) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** The scheme of a request URL, or undefined when it does not parse. */
function safeScheme(url: string): string | undefined {
  try {
    return new URL(url).protocol
  } catch {
    return undefined
  }
}

/** The host of a URL, or undefined when it does not parse. */
function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/\.$/, '')
  } catch {
    return undefined
  }
}
