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

describe.skipIf(harness === undefined)('MCP server detail toggle', () => {
  it('enables and disables a real server from its detail modal', async () => {
    const { launchWebScaffold } = await import(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')).href) as {
      launchWebScaffold(options: object): Promise<{ authenticatedUrl: string; workspaceCwd: string; close(): Promise<void>; ctx: { get(name: string): unknown } }>
    }
    const { chromium } = createRequire(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')))('playwright') as typeof import('playwright')
    const { newEnglishPage, connectFreshWorkspace, openSettings } = await import(pathToFileURL(join(harness!, 'apps/web/tests/support.ts')).href) as {
      newEnglishPage(browser: Browser): Promise<Page>
      connectFreshWorkspace(page: Page, root: string): Promise<void>
      openSettings(page: Page, locale: 'en' | 'zh' | 'ja'): Promise<void>
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
    await openSettings(page, 'en')
    await page.getByRole('button', { name: 'Tools & Skills', exact: true }).click()
    await page.getByRole('tab', { name: /^Tools/ }).click()
    await page.getByRole('button', { name: /Add MCP/ }).click()
    const addDialog = page.getByRole('dialog').filter({ hasText: 'Add MCP server' }).last()
    await addDialog.locator('textarea').fill(JSON.stringify({
      'detail-fixture': {
        command: process.execPath,
        args: [fileURLToPath(new URL('fixture-mcp-server.ts', import.meta.url))],
      },
    }))
    await addDialog.locator('input').first().fill('detail-fixture')
    await addDialog.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByText('detail-fixture', { exact: true }).first().click()

    const toggle = page.getByRole('checkbox', { name: 'Enabled: detail-fixture', exact: true })
    await toggle.waitFor({ state: 'attached' })
    expect(await toggle.isChecked()).toBe(false)
    await toggle.locator('..').click()
    const manager = scaffold.ctx.get('mcpManager') as { list(): { name: string; status: { state: string } }[] } | undefined
    await expect.poll(() => manager?.list().find(row => row.name === 'detail-fixture')?.status.state, { timeout: 45_000 }).toBe('connected')
    await page.getByRole('button', { name: 'Connect & discover tools', exact: true }).click()
    await page.getByText('3 tools', { exact: true }).waitFor()
    expect(await toggle.isChecked()).toBe(true)

    await toggle.locator('..').click()
    await page.getByText('Server not enabled; enable it to connect.', { exact: true }).waitFor()
    expect(await toggle.isChecked()).toBe(false)
    expect(errors).toEqual([])
  }, 120_000)
})
