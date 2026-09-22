/**
 * The render pipeline against a REAL Chrome, over a local fixture server.
 *
 * The fixture reproduces the measured target behavior (transformer-circuits.
 * pub, 2026-09-20): a figure that renders only through IntersectionObserver
 * (a fast scroll-by does not trigger it — the sweep dwells), SVG colors that
 * live in stylesheet rules via CSS custom properties, scripts that must
 * not survive serialization, and a JS-driven widget figure (canvas + listener)
 * that must arrive as one pixel snapshot with its caption kept as text.
 *
 * The URL policy refuses loopback targets by design, so the fixture is served
 * under the hostname `capture.test`, which Chrome maps to 127.0.0.1 through
 * `--host-resolver-rules`; the policy's resolver seam answers a public
 * address for it. The redirect-escape case targets the raw 127.0.0.1 literal
 * and is refused per hop exactly as in production.
 *
 * **Skips gracefully when no Chrome binary exists** (CI has none): the
 * executable is resolved from `DSH_CAPTURE_CHROME_PATH`, then the managed
 * install under the default state root, then the system `chrome` channel.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { CaptureService } from '../src/index.ts'

const FIXTURE_PAGE = `<!DOCTYPE html>
<html><head>
<title>Capture Fixture</title>
<style>
  :root { --brand-clay: #bada55; --ink: #112233 }
  .eager-figure rect { fill: var(--ink) }
  .io-figure circle { fill: var(--brand-clay) }
  /* CSS nesting: the measured failure (transformer-circuits figure grids are
     laid out by nested rules like .intro-functional > & .if-row). The nested
     rule must flatten against the parent and inline. */
  .nest-host {
    & .nest-row { display: flex; flex-direction: row }
    & .nest-row > .nest-cell { color: #135713 }
  }
</style>
</head><body>
  <h1>fixture</h1>
  <div class="nest-host"><div class="nest-row"><span class="nest-cell">nested</span></div></div>
  <figure class="eager-figure"><svg viewBox="0 0 10 10"><rect width="8" height="8"/></svg></figure>
  <div class="spacer"></div>
  <figure class="io-figure" id="lazy"></figure>
  <figure class="widget-figure" id="widget"></figure>
  <script>
    document.querySelector('.spacer').style.height = '2400px'
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('viewBox', '0 0 10 10')
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        circle.setAttribute('r', '4')
        circle.setAttribute('cx', '5')
        circle.setAttribute('cy', '5')
        svg.appendChild(circle)
        entry.target.appendChild(svg)
        io.unobserve(entry.target)
      }
    })
    io.observe(document.getElementById('lazy'))
    // A JS-driven widget: canvas pixels plus a listener-bearing label. The
    // snapshot pass must replace the whole subtree with one img of its pixels.
    const widget = document.getElementById('widget')
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 30
    const pen = canvas.getContext('2d')
    pen.fillStyle = '#bada55'
    pen.fillRect(0, 0, 40, 30)
    widget.appendChild(canvas)
    const hot = document.createElement('div')
    hot.textContent = 'widget remnant'
    hot.addEventListener('click', () => undefined)
    widget.appendChild(hot)
    const cap = document.createElement('figcaption')
    cap.textContent = 'Figure W: kept caption'
    widget.appendChild(cap)
  </script>
</body></html>`

const REDIRECT_TARGET = '<!DOCTYPE html><html><head><title>Landed</title></head><body><p>redirect landed</p></body></html>'

/** Resolve a usable Chrome executable, or undefined when there is none (CI). */
async function findChrome(): Promise<string | undefined> {
  const fromEnv = process.env.DSH_CAPTURE_CHROME_PATH
  if (fromEnv !== undefined && fromEnv !== '') {
    return existsSync(fromEnv) ? fromEnv : undefined
  }
  const browsers = await import('@puppeteer/browsers')
  const home = process.env.DSH_HOME ?? join(tmpdir(), 'dsh')
  try {
    const installed = await browsers.getInstalledBrowsers({
      cacheDir: join(home, 'state', 'dsh-capture', 'chrome'),
      browser: browsers.Browser.CHROME,
    })
    if (installed.length > 0 && installed[0] !== undefined) return installed[0].executablePath
  } catch {
    // No managed install yet; fall through to the system channel probe.
  }
  try {
    return browsers.computeSystemExecutablePath({
      browser: browsers.Browser.CHROME,
      channel: browsers.ChromeReleaseChannel.STABLE,
    })
  } catch {
    return undefined
  }
}

const chrome = await findChrome()
const describeWithChrome = chrome === undefined ? describe.skip : describe

describeWithChrome('render integration (real Chrome)', () => {
  let server: Server
  let port: number
  let stateRoot: string
  let service: CaptureService
  let ctx: Context

  beforeAll(async () => {
    stateRoot = mkdtempSync(join(tmpdir(), 'dsh-capture-integration-'))
    server = createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(FIXTURE_PAGE)
      } else if (req.url === '/redirect') {
        res.writeHead(302, { location: '/landed' }).end()
      } else if (req.url === '/landed') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(REDIRECT_TARGET)
      } else if (req.url === '/evil-redirect') {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/secret` }).end()
      } else if (req.url === '/secret') {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('loopback-only')
      } else {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('nope')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as { port: number }).port
    ctx = new Context()
    service = new CaptureService(ctx, {
      stateRoot,
      // `chrome` is defined here: the whole describe skipped when it was not.
      executablePath: chrome as string,
      // Chrome resolves capture.test to the fixture; the policy seam answers a
      // public address for it (loopback targets are refused by design). The
      // proxy bypass keeps the fixture deterministic on machines whose system
      // proxy would otherwise answer capture.test itself (HTTP 503).
      extraArgs: ['--host-resolver-rules=MAP capture.test 127.0.0.1', '--no-proxy-server'],
      idleTimeoutMs: 30_000,
    }, {
      lookup: async (hostname) =>
        hostname === 'capture.test'
          ? [{ address: '93.184.216.34', family: 4 }]
          : [{ address: '198.51.100.99', family: 4 }],
    })
  })

  afterAll(async () => {
    await service.dispose()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(stateRoot, { recursive: true, force: true })
    await ctx.fiber.dispose()
  })

  it('renders the IntersectionObserver-gated figure with its CSS-variable color resolved', { timeout: 90_000 }, async () => {
    const result = await service.render({ url: `http://capture.test:${port}/page` })
    // The lazy figure exists ONLY because the sweep dwelled in its viewport.
    expect(result.html).toContain('<circle')
    // The variable resolved, both as an inlined style and as the SVG
    // presentation attribute; the raw var() reference is gone.
    expect(result.html).toContain('fill: rgb(186, 218, 85)')
    expect(result.html).toContain('fill="#bada55"')
    expect(result.html).not.toContain('var(--brand-clay)')
    // The eagerly rendered figure arrived too.
    expect(result.html).toContain('fill="#112233"')
    // CSS-nested rules flatten and inline (the figure-grid layout class).
    expect(result.html).toContain('display: flex')
    expect(result.html).toContain('color: rgb(19, 87, 19)')
    // Scripts never ship.
    expect(result.html).not.toContain('<script')
    // The JS-driven widget became one snapshot img: its pixels replace the
    // canvas/remnant subtree, its caption survives as text, its text rides alt.
    expect(result.html).toContain('data:image/webp;base64,')
    expect(result.html).toContain('data-capture-snapshot="widget"')
    expect(result.html).not.toContain('<canvas')
    expect(result.html).not.toContain('<div>widget remnant</div>')
    expect(result.html).toContain('Figure W: kept caption')
    expect(result.html).toContain('alt="widget remnant"')
    expect(result.title).toBe('Capture Fixture')
    expect(result.finalUrl).toBe(`http://capture.test:${port}/page`)
    expect(result.truncated).toBeUndefined()
    // The first successful render persisted the site's allow record.
    expect(service.siteRecord('capture.test')?.renders).toBe(1)
  })

  it('follows a same-site redirect and reports the landed URL', { timeout: 90_000 }, async () => {
    const result = await service.render({ url: `http://capture.test:${port}/redirect` })
    expect(result.html).toContain('redirect landed')
    expect(result.finalUrl).toBe(`http://capture.test:${port}/landed`)
  })

  it('refuses a redirect that escapes to a loopback literal, mid-flight', { timeout: 90_000 }, async () => {
    try {
      await service.render({ url: `http://capture.test:${port}/evil-redirect` })
      expect.unreachable()
    } catch (error) {
      expect((error as RemoteError).code).toBe('capture/private-target')
    }
  })

  it('maps an HTTP 404 to capture/navigation-failed carrying the status', { timeout: 90_000 }, async () => {
    try {
      await service.render({ url: `http://capture.test:${port}/missing` })
      expect.unreachable()
    } catch (error) {
      expect((error as RemoteError).code).toBe('capture/navigation-failed')
      expect((error as RemoteError<'capture/navigation-failed'>).details.status).toBe(404)
    }
  })
})

if (chrome === undefined) {
  it('skips the render integration suite (no Chrome binary found)', () => {
    expect(chrome).toBeUndefined()
  })
}
