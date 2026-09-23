/**
 * The host half's boot, against a real Cordis context, plus the render
 * pipeline's refusal matrix driven through a fake managed browser.
 *
 * The policy refusals (bad scheme, private target) and the availability
 * refusals (no binary, failed install, failed launch) never touch a real
 * Chrome — the browser edges are injected seams. The one path that needs a
 * real browser is the integration spec, which skips when no binary exists.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { apply, CaptureService, name } from '../src/index.ts'
import { CaptureRemoteService } from '../src/remote.ts'
import { inlineStylesAndSerialize, markInteractiveWidgets, replaceWidgetsWithSnapshots, scrollSweepPage, widgetPageRect } from '../src/page-tasks.ts'
import type {
  CaptureBrowserContextHandle,
  CaptureHttpRequest,
  CaptureManagedBrowser,
  CapturePage,
  CaptureScreenshotRequest,
} from '../src/browser.ts'

const roots: string[] = []
const contexts: Context[] = []

/** A throwaway state root; the plugin never touches the real deployment's. */
function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-capture-boot-'))
  roots.push(root)
  return root
}

/** Boot the host half on a fresh context and settle its injection. */
async function boot(config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  apply(ctx, { stateRoot: stateRoot(), ...config })
  // The Remote mount is a fiber waiting on `inject: ['capture']`; settle the
  // lifecycle before reading what it registered.
  await ctx.fiber.await()
  return ctx
}

/** The RemoteError code one rejected render carried. */
async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteError)
    return (error as RemoteError).code
  }
  throw new Error('the render resolved — a refusal was expected')
}

/* -------------------------------------------------- the fake managed browser */

interface FakePageScript {
  /** What goto answers: a status code, or an Error to throw. */
  readonly goto: number | Error
  /** Where the page ended up. */
  readonly finalUrl?: string
  /** Extra behavior inside goto (e.g. emitting a redirect request). */
  readonly duringGoto?: (page: CapturePage, emit: (request: CaptureHttpRequest) => void) => Promise<void> | void
  /** The classify pass's answer when widgets exist (default: none). */
  readonly widgets?: { candidates: number; qualified: number; marked: Array<{ id: number; alt: string }>; skippedOversize: number; skippedHidden: number }
  /** The rect pass's answer (default: a 640×480 box). */
  readonly widgetRect?: { x: number; y: number; width: number; height: number } | undefined
}

class FakePage implements CapturePage {
  readonly listeners = new Map<string, Array<(request: CaptureHttpRequest) => void>>()
  interception = false
  viewport: { width: number; height: number } | undefined

  constructor(private readonly script: FakePageScript) {}

  setViewport(viewport: { width: number; height: number }): Promise<void> {
    this.viewport = viewport
    return Promise.resolve()
  }

  setRequestInterception(enabled: boolean): Promise<void> {
    this.interception = enabled
    return Promise.resolve()
  }

  on(event: string, listener: (request: CaptureHttpRequest) => void): void {
    this.listeners.set(event, [...this.listeners.get(event) ?? [], listener])
  }

  mainFrame(): unknown {
    return this
  }

  async goto(url: string, _options: { waitUntil: 'load'; timeout: number }): Promise<{ status(): number; url(): string } | null> {
    const emit = (request: CaptureHttpRequest): void => {
      for (const listener of this.listeners.get('request') ?? []) listener(request)
    }
    await this.script.duringGoto?.(this, emit)
    if (this.script.goto instanceof Error) throw this.script.goto
    return { status: () => this.script.goto as number, url: () => url }
  }

  evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> {
    if (fn === (scrollSweepPage as unknown)) {
      return Promise.resolve({ steps: 1, elapsedMs: 500, docHeight: 800 } as R)
    }
    if (fn === (markInteractiveWidgets as unknown)) {
      return Promise.resolve((this.script.widgets ?? {
        candidates: 0, qualified: 0, marked: [], skippedOversize: 0, skippedHidden: 0,
      }) as R)
    }
    if (fn === (widgetPageRect as unknown)) {
      return Promise.resolve(('widgetRect' in this.script
        ? this.script.widgetRect
        : { x: 10, y: 20, width: 640, height: 480 }) as R)
    }
    if (fn === (replaceWidgetsWithSnapshots as unknown)) {
      this.replacements = arg
      return Promise.resolve((arg as unknown as readonly unknown[]).length as R)
    }
    if (fn === (inlineStylesAndSerialize as unknown)) {
      void arg
      return Promise.resolve({
        html: '<!DOCTYPE html>\n<html><head><title>Rendered</title></head><body><p>done</p></body></html>',
        truncated: false,
        title: 'Rendered',
        finalUrl: this.script.finalUrl ?? 'https://example.com/',
        inlinedElements: 0,
        inlinedDeclarations: 0,
        skippedSheets: 0,
        removedScripts: 0,
        removedStyles: 0,
      } as R)
    }
    throw new Error('unexpected evaluate')
  }

  initScripts: unknown[] = []
  shots: CaptureScreenshotRequest[] = []
  replacements: unknown

  evaluateOnNewDocument(fn: () => void): Promise<void> {
    this.initScripts.push(fn)
    return Promise.resolve()
  }

  screenshot(request: CaptureScreenshotRequest): Promise<string> {
    this.shots.push(request)
    return Promise.resolve('QUJD')
  }

  url(): string {
    return this.script.finalUrl ?? 'https://example.com/'
  }
}

/** A fake browser-process handle recording its lifecycle. */
function fakeBrowser(page: FakePage, flags: { contextClosed: { value: boolean }; browserClosed: { value: boolean } }): CaptureManagedBrowser {
  return {
    createBrowserContext: (): Promise<CaptureBrowserContextHandle> =>
      Promise.resolve({
        newPage: () => Promise.resolve(page),
        close: () => {
          flags.contextClosed.value = true
          return Promise.resolve()
        },
      }),
    close: () => {
      flags.browserClosed.value = true
      return Promise.resolve()
    },
    onDisconnected: () => undefined,
  }
}

/** A service wired to a fake browser through the launch seam. */
function serviceWithFake(page: FakePage, config: Record<string, unknown> = {}) {
  const flags = { contextClosed: { value: false }, browserClosed: { value: false } }
  const ctx = new Context()
  contexts.push(ctx)
  const service = new CaptureService(ctx, { stateRoot: stateRoot(), ...config }, {
    // The fixture host "resolves" to a public address; Chrome-side resolution
    // is out of scope for the fake.
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    launch: () => Promise.resolve(fakeBrowser(page, flags)),
    install: async () => '/fake/chrome',
  })
  return { service, flags }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/* ------------------------------------------------------------ the boot itself */

describe('the host half boots and provides its service', () => {
  it('declares the loader-facing plugin name it is mounted under', () => {
    // The identity triangle's third leg: cordis.patch.yml's row id, the tsdown
    // clientBundle id, and this name all move together on a rename.
    expect(name).toBe('capture')
  })

  it('provides `capture` — the service the Remote method delegates to', async () => {
    const ctx = await boot()
    expect(ctx.get('capture')).toBeDefined()
  })

  it('mounts the Remote face under its own service key and namespace', async () => {
    const ctx = await boot()
    const remote = ctx.get('captureRemote') as CaptureRemoteService | undefined
    expect(remote).toBeDefined()
    // A refusal delegates through the wire face unchanged (never a boot-only service).
    await expect(rejectionCode((remote as CaptureRemoteService).render({ url: 'file:///etc/passwd' })))
      .resolves.toBe('capture/invalid-url')
  })

  it('boots with no Chrome binary and no config — availability is a per-call question', async () => {
    const ctx = await boot()
    expect(ctx.get('capture')).toBeDefined()
  })
})

/* -------------------------------------------------------- the refusal matrix */

describe('render refusals (no browser involved)', () => {
  it('refuses non-http(s) schemes and credential-carrying URLs', async () => {
    const ctx = await boot()
    const service = ctx.get('capture') as CaptureService
    for (const url of ['file:///etc/passwd', 'data:text/html,<p>x</p>', 'https://user:pass@example.com/']) {
      await expect(rejectionCode(service.render({ url }))).resolves.toBe('capture/invalid-url')
    }
  })

  it('refuses loopback/private/metadata literals before any network', async () => {
    const ctx = await boot()
    const service = ctx.get('capture') as CaptureService
    for (const url of [
      'http://127.0.0.1/',
      'http://10.0.0.4/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]:8080/',
      'http://2130706433/', // 127.0.0.1 as an integer, normalized by the URL parser
    ]) {
      await expect(rejectionCode(service.render({ url }))).resolves.toBe('capture/private-target')
    }
  })

  it('refuses localhost by name without resolving it', async () => {
    const ctx = await boot()
    const service = ctx.get('capture') as CaptureService
    await expect(rejectionCode(service.render({ url: 'http://localhost:3000/' }))).resolves.toBe('capture/private-target')
  })
})

describe('render refusals (browser edges)', () => {
  it('a missing configured executable is capture/unavailable, never a crash', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new CaptureService(ctx, {
      stateRoot: stateRoot(),
      executablePath: '/nonexistent/chrome',
    }, {
      executableExists: () => false,
      install: async () => {
        throw new Error('the managed download must not run when a path is configured')
      },
    })
    await expect(rejectionCode(service.render({ url: 'https://example.com/' }))).resolves.toBe('capture/unavailable')
  })

  it('a failed managed download is capture/unavailable', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const service = new CaptureService(ctx, { stateRoot: stateRoot() }, {
      install: async () => {
        throw new Error('network offline')
      },
    })
    await expect(rejectionCode(service.render({ url: 'https://example.com/' }))).resolves.toBe('capture/unavailable')
  })

  it('a failed launch is capture/unavailable and the next call retries', async () => {
    let launches = 0
    const ctx = new Context()
    contexts.push(ctx)
    const page = new FakePage({ goto: 200 })
    const service = new CaptureService(ctx, { stateRoot: stateRoot() }, {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      install: async () => '/fake/chrome',
      launch: async () => {
        launches += 1
        if (launches === 1) throw new Error('chrome exploded')
        return fakeBrowser(page, { contextClosed: { value: false }, browserClosed: { value: false } })
      },
    })
    await expect(rejectionCode(service.render({ url: 'https://example.com/' }))).resolves.toBe('capture/unavailable')
    const retry = await service.render({ url: 'https://example.com/' })
    expect(retry.html).toContain('done')
    expect(launches).toBe(2)
  })

  it('a full queue refuses capture/busy', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ctx = new Context()
    contexts.push(ctx)
    const hanging = new FakePage({ goto: 200 })
    const slowBrowser: CaptureManagedBrowser = {
      createBrowserContext: () => Promise.resolve({
        newPage: async () => {
          await gate
          return hanging
        },
        close: () => Promise.resolve(),
      }),
      close: () => Promise.resolve(),
      onDisconnected: () => undefined,
    }
    const service = new CaptureService(ctx, { stateRoot: stateRoot(), maxQueue: 0 }, {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      install: async () => '/fake/chrome',
      launch: () => Promise.resolve(slowBrowser),
    })
    const first = service.render({ url: 'https://example.com/' })
    void first.catch(() => undefined)
    await Promise.resolve()
    await Promise.resolve()
    await expect(rejectionCode(service.render({ url: 'https://example.com/' }))).resolves.toBe('capture/busy')
    release()
    await first
  })
})

/* ------------------------------------------------- the pipeline, end to end */

describe('the render pipeline (fake browser)', () => {
  it('renders, maps the result fields, and persists the site allow record', async () => {
    const page = new FakePage({ goto: 200, finalUrl: 'https://example.com/post' })
    const { service, flags } = serviceWithFake(page)
    const result = await service.render({ url: 'https://example.com/' })
    expect(page.interception).toBe(true)
    expect(page.viewport).toEqual({ width: 1280, height: 800, deviceScaleFactor: 1 })
    expect(result.html).toContain('done')
    expect(result.title).toBe('Rendered')
    expect(result.finalUrl).toBe('https://example.com/post')
    expect(result.truncated).toBeUndefined()
    expect(flags.contextClosed.value).toBe(true) // zero-persistence context, closed
    expect(service.siteRecord('example.com')).toMatchObject({ renders: 1 })
    const onDisk = JSON.parse(readFileSync(join(service.stateRoot, 'state.json'), 'utf8')) as {
      sites: Record<string, { renders: number }>
    }
    expect(onDisk.sites['example.com']?.renders).toBe(1)
  })

  it('maps a navigation timeout to capture/timeout', async () => {
    const timeout = new Error('nav timeout')
    timeout.name = 'TimeoutError'
    const page = new FakePage({ goto: timeout })
    const { service } = serviceWithFake(page)
    await expect(rejectionCode(service.render({ url: 'https://example.com/', timeoutMs: 5_000 })))
      .resolves.toBe('capture/timeout')
  })

  it('maps an HTTP error status to capture/navigation-failed with the status', async () => {
    const page = new FakePage({ goto: 404 })
    const { service } = serviceWithFake(page)
    try {
      await service.render({ url: 'https://example.com/' })
      expect.unreachable()
    } catch (error) {
      expect((error as RemoteError).code).toBe('capture/navigation-failed')
      expect((error as RemoteError<'capture/navigation-failed'>).details.status).toBe(404)
    }
  })

  it('a redirect INTO the private network is refused mid-flight (the per-hop re-check)', async () => {
    const mainFrame = {}
    const page = new FakePage({
      goto: new Error('net::ERR_ABORTED'),
      duringGoto: (_page, emit) => {
        emit({
          isNavigationRequest: () => true,
          frame: () => mainFrame,
          url: () => 'http://127.0.0.1/secret',
          continue: () => Promise.resolve(),
          abort: () => Promise.resolve(),
        })
      },
    })
    page.mainFrame = () => mainFrame
    const { service } = serviceWithFake(page)
    await expect(rejectionCode(service.render({ url: 'https://example.com/' })))
      .resolves.toBe('capture/private-target')
  })

  it('disposal closes the managed browser', async () => {
    const page = new FakePage({ goto: 200 })
    const { service, flags } = serviceWithFake(page)
    await service.render({ url: 'https://example.com/' })
    await service.dispose()
    expect(flags.browserClosed.value).toBe(true)
  })

  it('snapshots marked widgets between the sweep and serialize', async () => {
    const page = new FakePage({
      goto: 200,
      widgets: { candidates: 3, qualified: 1, marked: [{ id: 0, alt: 'widget text' }], skippedOversize: 0, skippedHidden: 0 },
    })
    const { service } = serviceWithFake(page)
    await service.render({ url: 'https://example.com/' })
    expect(page.initScripts).toHaveLength(1)
    expect(page.shots).toHaveLength(1)
    expect(page.shots[0]!.clip).toEqual({ x: 10, y: 20, width: 640, height: 480, scale: 2 })
    expect(page.shots[0]!.type).toBe('webp')
    expect(page.replacements).toEqual([
      { id: 0, dataUri: 'data:image/webp;base64,QUJD', width: 640, height: 480, alt: 'widget text' },
    ])
  })

  it('leaves widgets as DOM when the screenshot pass yields nothing, and skips the phase entirely when configured off', async () => {
    const unshot = new FakePage({
      goto: 200,
      widgets: { candidates: 1, qualified: 1, marked: [{ id: 0, alt: '' }], skippedOversize: 0, skippedHidden: 0 },
      widgetRect: undefined,
    })
    const { service: offService } = serviceWithFake(unshot, { snapshotWidgets: false })
    await offService.render({ url: 'https://example.com/' })
    expect(unshot.initScripts).toHaveLength(0)
    expect(unshot.shots).toHaveLength(0)

    const empty = new FakePage({
      goto: 200,
      widgets: { candidates: 1, qualified: 1, marked: [{ id: 0, alt: '' }], skippedOversize: 0, skippedHidden: 0 },
      widgetRect: undefined,
    })
    const { service } = serviceWithFake(empty)
    await service.render({ url: 'https://example.com/' })
    // The rect pass answered "gone": no shot, no replacement, still a clean render.
    expect(empty.shots).toHaveLength(0)
    expect(empty.replacements).toBeUndefined()
  })
})
