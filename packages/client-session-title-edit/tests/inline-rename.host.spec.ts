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

describe.skipIf(harness === undefined)('in-place session title editing', () => {
  it('edits over the current title and commits through the official rename', async () => {
    const { launchWebScaffold } = await import(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')).href) as {
      launchWebScaffold(options: object): Promise<{ authenticatedUrl: string; workspaceCwd: string; close(): Promise<void> }>
    }
    const { chromium } = createRequire(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')))('playwright') as typeof import('playwright')
    const { newEnglishPage, connectFreshWorkspace } = await import(pathToFileURL(join(harness!, 'apps/web/tests/support.ts')).href) as {
      newEnglishPage(browser: Browser): Promise<Page>
      connectFreshWorkspace(page: Page, root: string): Promise<void>
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
    await page.locator('[data-composer-input]').fill('Inline title source')
    await page.keyboard.press('Enter')
    await page.getByText('Inline title source', { exact: true }).last().waitFor()

    await page.getByRole('button', { name: 'Rename session', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Session title', exact: true })
    await editor.waitFor()
    expect(await page.locator('[data-ste-inplace]').count()).toBe(1)
    await editor.fill('Inline title target')
    await editor.press('Enter')
    await editor.waitFor({ state: 'hidden' })
    await page.getByText('Inline title target', { exact: true }).first().waitFor()
    expect(await page.locator('[data-ste-inplace]').count()).toBe(0)
    expect(errors).toEqual([])
  }, 90_000)
})
