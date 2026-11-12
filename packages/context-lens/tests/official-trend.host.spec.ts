import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import type { Browser } from 'playwright'

const harness = process.env.DSH_HARNESS
const resources: { scaffold?: { close(): Promise<void> }; browser?: Browser } = {}
afterEach(async () => {
  await resources.browser?.close()
  await resources.scaffold?.close()
  resources.browser = undefined
  resources.scaffold = undefined
})

describe.skipIf(harness === undefined)('session trend in the real composition', () => {
  it('keeps the request bars visible and adds whole-log totals', async () => {
    const { launchWebScaffold } = await import(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')).href) as {
      launchWebScaffold(options: object): Promise<{
        authenticatedUrl: string
        workspaceCwd: string
        ctx: {
          requestInspector: {
            getSessionTrend(sessionId: string): Promise<{
              requests: unknown[]
              official?: { session?: { turns: number } }
            }>
          }
        }
        whenTurnSettled(): Promise<string>
        close(): Promise<void>
      }>
    }
    const { chromium } = createRequire(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')))('playwright') as typeof import('playwright')
    const { newEnglishPage, connectFreshWorkspace } = await import(pathToFileURL(join(harness!, 'apps/web/tests/support.ts')).href) as {
      newEnglishPage(browser: Browser): Promise<import('playwright').Page>
      connectFreshWorkspace(page: import('playwright').Page, root: string): Promise<void>
    }
    const packageDir = fileURLToPath(new URL('..', import.meta.url))
    const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: packageDir, enabled: true }] } })
    resources.scaffold = scaffold
    resources.browser = await chromium.launch()
    const page = await newEnglishPage(resources.browser)
    const errors: string[] = []
    page.on('pageerror', error => { errors.push(error.message) })
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const settled = scaffold.whenTurnSettled()
    await page.locator('[data-composer-input]').fill('Trend fixture')
    await page.keyboard.press('Enter')
    const sessionId = await settled
    const trend = await scaffold.ctx.requestInspector.getSessionTrend(sessionId)
    expect(trend.requests.length).toBeGreaterThan(0)
    expect(trend.official?.session?.turns).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Request inspector', exact: true }).click()
    await page.getByRole('region', { name: 'Main conversation · Input trend', exact: true }).waitFor()
    expect(await page.locator('button[class*="trendTarget"]').count()).toBeGreaterThan(0)
    await page.getByRole('note').filter({ hasText: 'Whole log' }).waitFor()
    expect(errors).toEqual([])
  }, 90_000)
})
