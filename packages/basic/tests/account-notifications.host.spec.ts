import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'

const harness = process.env.DSH_HARNESS
const resources: { scaffold?: { close(): Promise<void> }; browser?: Browser } = {}
afterEach(async () => {
  await resources.browser?.close()
  await resources.scaffold?.close()
  resources.browser = undefined
  resources.scaffold = undefined
})

describe.skipIf(harness === undefined)('account notifications on the plain Web client', () => {
  it('activates account notifications with account settings providing accountUi', async () => {
    const { launchWebScaffold } = await import(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')).href) as {
      launchWebScaffold(options: object): Promise<{ authenticatedUrl: string; workspaceCwd: string; close(): Promise<void> }>
    }
    const { chromium } = createRequire(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')))('playwright') as typeof import('playwright')
    const { newEnglishPage, connectFreshWorkspace, openSettings } = await import(pathToFileURL(join(harness!, 'apps/web/tests/support.ts')).href) as {
      newEnglishPage(browser: Browser): Promise<Page>
      connectFreshWorkspace(page: Page, root: string): Promise<void>
      openSettings(page: Page, locale: 'en' | 'zh' | 'ja'): Promise<void>
    }
    const scaffold = await launchWebScaffold({ profile: { packages: [] } })
    resources.scaffold = scaffold
    resources.browser = await chromium.launch()
    const page = await newEnglishPage(resources.browser)
    const errors: string[] = []
    page.on('pageerror', error => { errors.push(error.message) })
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await openSettings(page, 'en')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button').filter({ hasText: 'Built-in plugins' }).click()
    const globalToggle = dialog.getByRole('button').filter({ hasText: /^Global/ })
    if (await globalToggle.getAttribute('aria-expanded') === 'false') await globalToggle.click()
    await dialog.locator('[data-plugin-scope="global"] [data-plugin-entry]').first().waitFor()
    await dialog.getByText('Account notifications', { exact: true }).first().waitFor()
    expect(await page.getByText(/waiting for activation/).count()).toBe(0)
    expect(errors).toEqual([])
  }, 90_000)
})
