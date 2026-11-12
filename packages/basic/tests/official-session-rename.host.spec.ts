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

describe.skipIf(harness === undefined)('official session rename', () => {
  it('opens from the row title, rejects blank drafts, and refreshes the renamed title', async () => {
    const { launchWebScaffold } = await import(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')).href) as {
      launchWebScaffold(options: object): Promise<{ authenticatedUrl: string; workspaceCwd: string; close(): Promise<void> }>
    }
    const { chromium } = createRequire(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')))('playwright') as typeof import('playwright')
    const { newEnglishPage, connectFreshWorkspace } = await import(pathToFileURL(join(harness!, 'apps/web/tests/support.ts')).href) as {
      newEnglishPage(browser: Browser): Promise<Page>
      connectFreshWorkspace(page: Page, root: string): Promise<void>
    }
    const packageDir = fileURLToPath(new URL('..', import.meta.url))
    const scaffold = await launchWebScaffold({
      profile: { packages: [{ dir: packageDir, enabled: true }] },
    })
    resources.scaffold = scaffold
    resources.browser = await chromium.launch()
    const page = await newEnglishPage(resources.browser)
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.locator('[data-composer-input]').fill('Official rename source')
    await page.keyboard.press('Enter')
    await page.getByText('Official rename source', { exact: true }).last().waitFor()
    const row = page.getByRole('treeitem').last()
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Rename session', exact: true })
    await dialog.waitFor()
    const input = dialog.getByRole('textbox')
    expect(await input.inputValue()).not.toBe('')
    await input.fill('   ')
    expect(await dialog.getByRole('button', { name: 'Rename', exact: true }).isDisabled()).toBe(true)
    await input.fill('Official rename target')
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByText('Official rename target', { exact: true }).first().waitFor()

    const errors: string[] = []
    page.on('pageerror', error => { errors.push(error.message) })
    expect(await page.locator('[data-ste-inplace]').count()).toBe(0)
    expect(await page.getByRole('textbox', { name: 'Session title', exact: true }).count()).toBe(0)
    expect(errors).toEqual([])
  }, 90_000)
})
