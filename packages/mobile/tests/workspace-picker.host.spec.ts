import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const harness = process.env.DSH_HARNESS
const resources: { scaffold?: { close(): Promise<void> }; browser?: { close(): Promise<void> } } = {}
afterEach(async () => {
  await resources.browser?.close()
  await resources.scaffold?.close()
  resources.browser = undefined
  resources.scaffold = undefined
})

describe.skipIf(harness === undefined)('the reusable Workspace picker on a mobile client', () => {
  it('uses the mobile directory flow for the official Session importer and creates the chosen Workspace', async () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url))
    const { launchWebScaffold } = await import(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')).href) as {
      launchWebScaffold(options: object): Promise<{
        authenticatedUrl: string
        workspaceCwd: string
        ctx: { workspaceRegistry: { list(): Array<{ path: string }> } }
        close(): Promise<void>
      }>
    }
    const { chromium } = createRequire(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')))('playwright') as typeof import('playwright')
    const { connectFreshWorkspace } = await import(pathToFileURL(join(harness!, 'apps/web/tests/support.ts')).href) as {
      connectFreshWorkspace(page: import('playwright').Page, root: string): Promise<void>
    }
    const scaffold = await launchWebScaffold({
      profile: { packages: [
        { dir: packageRoot, enabled: true },
        { dir: join(harness!, 'packages/experimental/deepseek-chat-import'), enabled: true },
      ] },
    })
    resources.scaffold = scaffold
    const browser = await chromium.launch()
    resources.browser = browser
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US', hasTouch: true })
    const errors: string[] = []
    page.on('pageerror', error => { errors.push(error.message) })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)

    await page.getByRole('button', { name: 'Import DeepSeek chats', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Import DeepSeek chat history' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'workspace', exact: false }).click()
    await page.getByRole('menuitem', { name: 'Add workspace…', exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('html[data-dsh-mobile]').waitFor()
    await page.getByRole('menuitem', { name: 'Add workspace…', exact: true }).click()

    const directory = page.getByRole('dialog', { name: 'Choose working directory' })
    await directory.waitFor()
    await directory.getByText('Enter a path', { exact: true }).click()
    const target = join(scaffold.workspaceCwd, 'import-target')
    mkdirSync(target, { recursive: true })
    await directory.getByRole('textbox').fill(target)
    await directory.getByRole('button', { name: 'Go', exact: true }).click()
    const confirm = directory.getByRole('button', { name: 'Use this directory', exact: true })
    await confirm.waitFor()
    await expect.poll(() => confirm.evaluate(button => (button as HTMLButtonElement).disabled)).toBe(false)
    await confirm.click()

    await directory.waitFor({ state: 'hidden' })
    await dialog.locator('button[title]').filter({ hasText: 'import-target' }).waitFor()
    expect(scaffold.ctx.workspaceRegistry.list().some(workspace => workspace.path === target)).toBe(true)
    expect(errors).toEqual([])
  }, 120_000)
})
