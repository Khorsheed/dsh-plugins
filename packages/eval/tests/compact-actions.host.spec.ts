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

describe.skipIf(harness === undefined)('dataset and experiment action sizing', () => {
  it("matches the host's primary action sizing", async () => {
    const { launchWebScaffold } = await import(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')).href) as {
      launchWebScaffold(options: object): Promise<{ authenticatedUrl: string; workspaceCwd: string; close(): Promise<void> }>
    }
    const { chromium } = createRequire(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')))('playwright') as typeof import('playwright')
    const { newEnglishPage, connectFreshWorkspace } = await import(pathToFileURL(join(harness!, 'apps/web/tests/support.ts')).href) as {
      newEnglishPage(browser: Browser): Promise<Page>
      connectFreshWorkspace(page: Page, root: string): Promise<void>
    }
    const packageDir = (name: string) => fileURLToPath(new URL(`../../${name}`, import.meta.url))
    const scaffold = await launchWebScaffold({ profile: { packages: [
      { dir: packageDir('datasets'), enabled: true },
      { dir: packageDir('eval'), enabled: true },
    ] } })
    resources.scaffold = scaffold
    resources.browser = await chromium.launch()
    const page = await newEnglishPage(resources.browser)
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)

    const sizes: Record<string, number> = {}
    for (const [tab, action] of [['Datasets', 'Add a dataset'], ['Experiments', 'Create the first experiment']] as const) {
      await page.getByRole('button', { name: tab, exact: true }).click()
      const button = page.getByRole('button', { name: action, exact: true })
      await button.waitFor()
      sizes[action] = await button.evaluate(element => element.getBoundingClientRect().height)
      expect(sizes[action], `${action} should use the host's standard 36px control`).toBe(36)
      if (tab === 'Experiments') {
        expect(await page.getByRole('button', { name: 'New experiment', exact: true }).evaluate(element => element.getBoundingClientRect().height)).toBe(36)
        expect(await page.getByRole('button', { name: 'Refresh', exact: true }).evaluate(element => element.getBoundingClientRect().height)).toBe(28)
      }
    }
  }, 90_000)
})
