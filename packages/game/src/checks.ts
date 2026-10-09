/**
 * The end-of-turn checks (proposal §6): data validation in plain node, then
 * a smoke run and the project's own test scripts in headless Chrome, all on
 * the same sandbox loader the panel uses.
 *
 * The browser is the machine's installed Chrome (or `chromePath`), driven by
 * `puppeteer-core` loaded on first use — a host without Chrome still runs
 * the data checks and reports the browser part as skipped instead of
 * failing. One browser stays up between turns and shuts down after a minute
 * idle.
 *
 * Test scripts are `tests/*.test.js` the agent writes beside the code. Each
 * file runs on a fresh load of the build, as the body of an async function
 * receiving `test`, `assert`, `game` (= `window.dshGame`), `step` and
 * `press`; `test(name, fn)` registers a case and every case runs in order.
 * @module @khorsheed/dsh-game
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BundleFile, CheckFailure } from './types.ts'
import { shellHtml } from './vfs.ts'

/** What the browser part reports. */
export interface BrowserCheckResult {
  readonly failures: readonly CheckFailure[]
  readonly passed: number
  /** Set when the browser part did not run at all. */
  readonly skipped?: string
  /** A webp screenshot of the first frames, base64, when the smoke run got that far. */
  readonly screenshot?: string
}

/** The browser-check seam (specs stand in a fake). */
export interface BrowserChecker {
  run(files: Readonly<Record<string, BundleFile>>, tests: Readonly<Record<string, string>>): Promise<BrowserCheckResult>
  dispose(): Promise<void>
}

/** Narrow structural view of the puppeteer page this file uses. */
interface Page {
  setBypassCSP(on: boolean): Promise<void>
  setViewport(v: { width: number; height: number }): Promise<void>
  evaluateOnNewDocument(fn: string): Promise<unknown>
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>
  evaluate(fn: string): Promise<unknown>
  screenshot(options: Record<string, unknown>): Promise<string>
  close(): Promise<void>
}

/** Narrow structural view of the puppeteer browser. */
interface Browser {
  newPage(): Promise<Page>
  close(): Promise<void>
  on(event: 'disconnected', listener: () => void): void
}

/** Common Chrome install locations, tried when no path is configured. */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]

/**
 * The Chrome executable to drive: the configured path, `CHROME_PATH`, or the
 * first common install location that exists.
 * @param configured - the plugin config's `chromePath`.
 * @returns the path, or undefined when none is found.
 */
export function findChrome(configured?: string): string | undefined {
  for (const candidate of [configured, process.env.CHROME_PATH, ...CHROME_CANDIDATES]) {
    if (candidate !== undefined && candidate !== '' && existsSync(candidate)) return candidate
  }
  return undefined
}

/** How long the game gets to set `dshGame.ready`. */
const READY_TIMEOUT_MS = 4000
/** How long one test file may run. */
const TEST_TIMEOUT_MS = 8000
/** The viewport checks render at. */
const VIEWPORT = { width: 640, height: 400 }

/** The in-page wait for `window.dshGame.ready`; resolves true/false. */
const WAIT_READY = `(async () => {
  const until = Date.now() + ${READY_TIMEOUT_MS};
  while (Date.now() < until) { const g = window.dshGame; if (g && g.ready) return true; await new Promise(r => setTimeout(r, 40)); }
  return false;
})()`

/** The in-page smoke run: 2 s of game time, then a blank-canvas probe. */
const SMOKE = `(async () => {
  const g = window.dshGame;
  const out = { stepped: false, blank: null };
  if (g && typeof g.step === 'function') { for (let i = 0; i < 120; i++) g.step(1 / 60); out.stepped = true; }
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const c = document.querySelector('canvas');
  if (c && c.width > 0 && c.height > 0) {
    const probe = document.createElement('canvas'); probe.width = 32; probe.height = 32;
    const p = probe.getContext('2d'); p.drawImage(c, 0, 0, 32, 32);
    const d = p.getImageData(0, 0, 32, 32).data; let distinct = new Set();
    for (let i = 0; i < d.length; i += 4) { distinct.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); if (distinct.size > 1) break; }
    out.blank = distinct.size <= 1;
  }
  return out;
})()`

/**
 * The in-page test harness for one file. The body is spliced in as the
 * function body — CSP is bypassed for the check page, never for the panel.
 * @param body - the test file's text.
 * @returns the expression to evaluate.
 */
function testExpression(body: string): string {
  return `(async () => {
  const cases = [];
  const test = (name, fn) => { cases.push({ name: String(name), fn }); };
  const fail = (msg) => { throw new Error(msg); };
  const assert = (cond, msg) => { if (!cond) fail(msg || 'assert 失败'); };
  assert.equal = (a, b, msg) => { if (a !== b) fail((msg ? msg + '：' : '') + '期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)); };
  assert.near = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= (eps ?? 1e-6))) fail((msg ? msg + '：' : '') + '期望约 ' + b + '，实际 ' + a); };
  const game = window.dshGame;
  const step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) game.step(dt); };
  const press = (key, frames = 1) => { game.input(key, true); step(frames); game.input(key, false); };
  try {
    await (async (test, assert, game, step, press) => {\n${body}\n})(test, assert, game, step, press);
  } catch (e) { return { load: String(e && e.message || e), results: [] }; }
  const results = [];
  for (const c of cases) {
    try { await c.fn(); results.push({ name: c.name, ok: true }); }
    catch (e) { results.push({ name: c.name, ok: false, msg: String(e && e.message || e).slice(0, 300) }); }
  }
  return { results };
})()`
}

/** The errors the bridge collected, worded for the model. */
const READ_ERRORS = '(window.__gamedevErrors || []).slice(0, 5)'

/** Race a promise against a timeout. */
async function within<T>(ms: number, work: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}超时（${ms / 1000} 秒）`)), ms) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** The headless-Chrome checker. */
export class ChromeChecker implements BrowserChecker {
  private browser: Promise<Browser> | undefined
  private idle: NodeJS.Timeout | undefined
  private profile: string | undefined

  /** @param chromePath - configured executable (optional). */
  constructor(private readonly chromePath?: string) {}

  private async launch(executablePath: string): Promise<Browser> {
    // A variable specifier keeps the typert overlay (a harness clone without
    // puppeteer) from resolving it, and the driver loads on first use only.
    const specifier = 'puppeteer-core'
    const { launch } = (await import(specifier)) as { launch: (o: Record<string, unknown>) => Promise<Browser> }
    this.profile = await mkdtemp(join(tmpdir(), 'dsh-game-chrome-'))
    const browser = await launch({
      executablePath,
      headless: true,
      pipe: true,
      userDataDir: this.profile,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--mute-audio'],
      timeout: 30_000,
    })
    browser.on('disconnected', () => { this.browser = undefined })
    return browser
  }

  private async page(executablePath: string): Promise<Page> {
    if (this.idle !== undefined) clearTimeout(this.idle)
    this.browser ??= this.launch(executablePath).catch((error: unknown) => {
      this.browser = undefined
      throw error
    })
    return (await this.browser).newPage()
  }

  private armIdle(): void {
    if (this.idle !== undefined) clearTimeout(this.idle)
    this.idle = setTimeout(() => { void this.dispose() }, 60_000)
    this.idle.unref?.()
  }

  /** Load the build into a fresh page with CSP bypassed and wait for ready. */
  private async load(executablePath: string, files: Readonly<Record<string, BundleFile>>): Promise<{ page: Page; ready: boolean }> {
    const page = await this.page(executablePath)
    await page.setBypassCSP(true)
    await page.setViewport(VIEWPORT)
    await page.evaluateOnNewDocument(`window.__VFS_FILES__ = ${JSON.stringify(files)};`)
    const shell = shellHtml('<script>window.__GAMEDEV_TEST__=true</script>')
    await page.goto(`data:text/html;base64,${Buffer.from(shell).toString('base64')}`, { waitUntil: 'load', timeout: 10_000 })
    const ready = await page.evaluate(WAIT_READY) as boolean
    return { page, ready }
  }

  async run(files: Readonly<Record<string, BundleFile>>, tests: Readonly<Record<string, string>>): Promise<BrowserCheckResult> {
    const executablePath = findChrome(this.chromePath)
    if (executablePath === undefined) return { failures: [], passed: 0, skipped: '没找到 Chrome，只跑了数据校验' }
    const failures: CheckFailure[] = []
    let passed = 0
    let screenshot: string | undefined
    try {
      const { page, ready } = await this.load(executablePath, files)
      try {
        if (!ready) {
          failures.push({ where: 'smoke', message: `游戏没在 ${READY_TIMEOUT_MS / 1000} 秒内就绪：window.dshGame.ready 一直不是 true` })
        } else {
          const smoke = await within(5000, page.evaluate(SMOKE) as Promise<{ stepped: boolean; blank: boolean | null }>, '冒烟运行')
          if (!smoke.stepped) failures.push({ where: 'smoke', message: 'window.dshGame.step 不是函数，测试没法推进游戏时间' })
          if (smoke.blank === true) failures.push({ where: 'smoke', message: '跑了 2 秒后画布仍是同一种颜色（什么都没画出来）' })
        }
        const errors = await page.evaluate(READ_ERRORS) as { kind: string; msg: string }[]
        for (const e of errors) failures.push({ where: 'smoke', message: `运行报错（${e.kind}）：${e.msg.slice(0, 300)}` })
        screenshot = await page.screenshot({ type: 'webp', quality: 70, encoding: 'base64', captureBeyondViewport: false })
      } finally {
        await page.close().catch(() => {})
      }
      // Tests only make sense on a build that loads.
      if (failures.length === 0) {
        for (const [file, body] of Object.entries(tests).sort(([a], [b]) => a.localeCompare(b))) {
          const { page, ready } = await this.load(executablePath, files)
          try {
            if (!ready) {
              failures.push({ where: file, message: '这次加载游戏没有就绪，测试没跑' })
              continue
            }
            const outcome = await within(TEST_TIMEOUT_MS, page.evaluate(testExpression(body)) as Promise<{
              load?: string
              results: { name: string; ok: boolean; msg?: string }[]
            }>, '测试')
            if (outcome.load !== undefined) failures.push({ where: file, message: `测试文件本身出错：${outcome.load}` })
            if (outcome.load === undefined && outcome.results.length === 0) failures.push({ where: file, message: '没有用 test(名称, 函数) 登记任何用例' })
            for (const r of outcome.results) {
              if (r.ok) passed++
              else failures.push({ where: `${file} › ${r.name}`, message: r.msg ?? '失败' })
            }
          } catch (error) {
            failures.push({ where: file, message: (error as Error).message.split('\n')[0] ?? '出错' })
          } finally {
            await page.close().catch(() => {})
          }
        }
      }
    } catch (error) {
      return { failures, passed, skipped: `浏览器检查没跑起来：${(error as Error).message.split('\n')[0]?.slice(0, 200)}` }
    } finally {
      this.armIdle()
    }
    return { failures, passed, ...(screenshot === undefined ? {} : { screenshot }) }
  }

  async dispose(): Promise<void> {
    if (this.idle !== undefined) clearTimeout(this.idle)
    const pending = this.browser
    this.browser = undefined
    if (pending !== undefined) await pending.then(b => b.close()).catch(() => {})
    if (this.profile !== undefined) await rm(this.profile, { recursive: true, force: true }).catch(() => {})
    this.profile = undefined
  }
}
