import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'

const harness = process.env.DSH_HARNESS
const TITLE = 'Manual continuation browser test'
const resources: { scaffold?: { close(): Promise<void> }; browser?: Browser } = {}
afterEach(async () => {
  await resources.browser?.close()
  await resources.scaffold?.close()
  resources.browser = undefined
  resources.scaffold = undefined
})

interface FixtureEvent {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: Record<string, unknown>
  readonly surfaceOp?: 'append'
}

function fixture(): { events: FixtureEvent[]; dispatchSeq: number } {
  const events: FixtureEvent[] = []
  const add = (type: string, data: Record<string, unknown>, surfaceOp?: 'append'): void => {
    events.push({ seq: events.length, time: events.length * 10, type, data, ...surfaceOp === undefined ? {} : { surfaceOp } })
  }
  for (let turn = 1; turn <= 139; turn += 1) {
    add('turn/start', { turn })
    if (turn === 1) add('user/message', { id: 'u-first', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: TITLE }] }, 'append')
    add('turn/end', { turn, reason: { kind: 'completed' } })
  }
  const dispatchSeq = events.length
  add('room/dispatch', {
    id: 'manual-restart', targets: ['人物建模大师'], text: '继续之前请先核对已经做完的部分',
    origin: 'human', continues: ['interrupted:member'], task: 'original-task-message',
  })
  add('turn/start', { turn: 140 })
  add('turn/end', { turn: 140, reason: { kind: 'completed' } })
  return { events, dispatchSeq }
}

async function expectAtTop(page: Page, dispatchSeq: number): Promise<void> {
  const row = page.locator(`[data-room-dispatch="${dispatchSeq}"]`)
  await row.waitFor({ timeout: 20_000 })
  expect(await row.textContent()).toContain('Room · manual')
  await expect.poll(() => row.evaluate(element => {
    const port = element.closest('[data-conversation-scroll]')
    if (port === null) return false
    const offset = element.getBoundingClientRect().top - port.getBoundingClientRect().top
    const rect = element.getBoundingClientRect()
    const viewport = port.getBoundingClientRect()
    const visible = rect.bottom > viewport.top && rect.top < viewport.bottom
    const atFloor = port.scrollTop >= port.scrollHeight - port.clientHeight - 1
    return visible && (Math.abs(offset) <= 36 || (offset > 0 && atFloor))
  }), { timeout: 10_000 }).toBe(true)
}

describe.skipIf(harness === undefined)('restart continuation navigation in the real Web composition', () => {
  it('renders a manual dispatch and lands on it on first and repeated round selection', async () => {
    const { launchWebScaffold } = await import(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')).href) as {
      launchWebScaffold(options: object): Promise<{
        authenticatedUrl: string
        workspaceCwd: string
        ctx: {
          workspaceRegistry: { create(path: string): Promise<unknown> }
          sessionPersistence: { create(meta: object): Promise<{ append(events: readonly object[]): Promise<void>; close(): Promise<void> }> }
          agents: { resume(options: { resumeSessionId: string }): Promise<unknown> }
        }
        close(): Promise<void>
      }>
    }
    const packageDir = fileURLToPath(new URL('..', import.meta.url))
    const scaffold = await launchWebScaffold({ profile: { hmr: false, packages: [
      { dir: join(packageDir, '..', 'room'), enabled: true },
      { dir: packageDir, enabled: true },
    ] } })
    resources.scaffold = scaffold
    const seed = fixture()
    const handle = await scaffold.ctx.sessionPersistence.create({
      version: 4, id: 'room-manual-continuation', createdAt: Date.now(), isSeeded: false,
      cwd: scaffold.workspaceCwd, delegationDepth: 0,
    })
    await handle.append(seed.events)
    await handle.close()
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    await scaffold.ctx.agents.resume({ resumeSessionId: 'room-manual-continuation' })
    const { chromium } = createRequire(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')))('playwright') as typeof import('playwright')
    const { newEnglishPage, connectFreshWorkspace } = await import(pathToFileURL(join(harness!, 'apps/web/tests/support.ts')).href) as {
      newEnglishPage(browser: Browser): Promise<Page>
      connectFreshWorkspace(page: Page, root: string, name?: string): Promise<void>
    }
    resources.browser = await chromium.launch()
    const page = await newEnglishPage(resources.browser)
    const errors: string[] = []
    page.on('pageerror', error => { errors.push(error.message) })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, '.')
    await page.getByRole('treeitem', { name: 'Ungrouped', exact: true }).click({ timeout: 10_000 })
    await page.getByRole('treeitem').filter({ hasText: /Manual continuation browser test|room-manual-continuation|Untitled/ }).first().click({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Request inspector', exact: true }).first().click({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Switch turn', exact: true }).click({ timeout: 20_000 })
    await page.getByRole('menuitem', { name: /turn 140/ }).click({ timeout: 20_000 })
    await expectAtTop(page, seed.dispatchSeq)
    await page.locator('[data-conversation-scroll]').evaluate(element => { element.scrollTop = 0 })
    await page.getByRole('button', { name: 'Switch turn', exact: true }).click()
    await page.getByRole('menuitem', { name: /turn 140/ }).click()
    await expectAtTop(page, seed.dispatchSeq)
    expect(errors).toEqual([])
  }, 120_000)
})
