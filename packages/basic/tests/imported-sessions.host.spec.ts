import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import type { Browser, Locator, Page } from 'playwright'

const harness = process.env.DSH_HARNESS
const TITLE = 'Bus to the city museum'
const QUESTION = 'Which bus goes from Central Station to the City Museum?'
const ANSWER = 'Take bus 12 from Central Station; it stops at the City Museum.'
const NOTICE = '(以下是先前被撤回、现随恢复放回的助手回复)'
const resources: { scaffold?: { close(): Promise<void> }; browser?: Browser } = {}
afterEach(async () => {
  await resources.browser?.close()
  await resources.scaffold?.close()
  resources.browser = undefined
  resources.scaffold = undefined
})

interface HostEvent {
  readonly type: string
  readonly seq: number
  readonly data?: {
    readonly source?: { readonly kind?: string; readonly op?: string }
    readonly content?: readonly { readonly type: string; readonly text?: string; readonly attachment?: { readonly name?: string } }[]
  }
}
interface HostSession { readonly snapshotEvents: () => HostEvent[] }
interface HostContext {
  readonly workspaceRegistry: { create(path: string): Promise<{ id: string }> }
  readonly sessions: { get(id: string): HostSession | undefined }
  readonly agents: { get(id: string): { session: HostSession } | undefined }
  readonly filePreview: { list(id: string): Promise<{ entries: unknown[] }> }
  readonly jobs: { list(): readonly unknown[] }
  readonly requestInspector: {
    getSessionTrend(id: string): Promise<{
      official?: { session?: { turns: number; steps: number } }
    }>
  }
  readonly messageTools: {
    withdraw(request: { sessionId: string; targetSeq: number }): Promise<{ ok: boolean }>
    restore(request: { sessionId: string; targetSeq: number }): Promise<{ ok: boolean }>
  }
}
interface ImportScaffold {
  readonly authenticatedUrl: string
  readonly workspaceCwd: string
  readonly ctx: HostContext
  readonly hostFetch(path: string, init?: RequestInit): Promise<Response>
  readonly close(): Promise<void>
}

function exportArchive(scaffoldUrl: string): Uint8Array<ArrayBuffer> {
  const { zipSync, strToU8 } = createRequire(scaffoldUrl)('fflate') as typeof import('fflate')
  const at = (seconds: number): string => new Date(Date.UTC(2026, 10, 11, 2, 0, seconds)).toISOString()
  const file = {
    id: 'museum-route', title: TITLE, current_message_id: 2, inserted_at: at(0),
    messages: [
      { id: 1, parent_id: null, role: 'USER', status: 'FINISHED', inserted_at: at(10), fragments: [
        { type: 'REQUEST', content: QUESTION },
        { type: 'FILE', files: [{ id: 'file-1', file_name: 'notes.pdf', file_size: 128, is_image: false, export_path: 'chat_sessions/museum-route_files/notes.pdf' }] },
      ] },
      { id: 2, parent_id: 1, role: 'ASSISTANT', status: 'FINISHED', inserted_at: at(12), fragments: [
        { type: 'THINK', content: 'Check the route first.', elapsed_secs: 2 },
        { type: 'TOOL_SEARCH', queries: ['Central Station City Museum bus'], status: 'FINISHED', stage_id: 1, results: [{
          url: 'https://transit.example/routes/12', title: 'Route 12 timetable', snippet: 'Bus 12 stops at the museum.', published_at: null,
        }] },
        { type: 'TOOL_OPEN', status: 'FINISHED', url: 'https://transit.example/routes/12', title: 'Route 12 timetable', stage_id: 2 },
        { type: 'THINK', content: 'The route stops at the museum.', elapsed_secs: 1 },
        { type: 'RESPONSE', content: `${ANSWER}\n\n\`\`\`dsh-card\n<button id="route-card">Route 12</button>\n\`\`\`` },
      ] },
    ],
  }
  return new Uint8Array(zipSync({
    'manifest.json': strToU8(JSON.stringify({ export_format_version: 3 })),
    'chat_session_index.json': strToU8(JSON.stringify([{
      id: file.id, title: file.title, pinned: false, inserted_at: file.inserted_at,
      updated_at: file.messages[1]!.inserted_at, message_count: file.messages.length, files: [],
    }])),
    [`chat_sessions/${file.id}.json`]: strToU8(JSON.stringify(file)),
  }))
}

async function boot(): Promise<{ scaffold: ImportScaffold; page: Page; sessionId: string; errors: string[]; expandOwningTurnProcess(page: Page, target: Locator): Promise<void> }> {
  const basic = fileURLToPath(new URL('..', import.meta.url))
  const { launchWebScaffold } = await import(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')).href) as {
    launchWebScaffold(options: object): Promise<ImportScaffold>
  }
  const scaffold = await launchWebScaffold({
    profile: { packages: [
      ...['client-message-tools', 'message-timeline', 'context-lens', 'file-preview', 'taskpilot', 'quote', 'inline-html-render']
        .map(name => ({ dir: join(basic, '..', name), enabled: true })),
      { dir: join(harness!, 'packages/experimental/deepseek-chat-import'), enabled: true },
    ] },
  })
  resources.scaffold = scaffold
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  const response = await scaffold.hostFetch(`/api/deepseek-chat-import/archive?workspaceId=${encodeURIComponent(workspace.id)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: exportArchive(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')).href),
  })
  expect(response.status).toBe(200)
  const lines = (await response.text()).split('\n').filter(line => line.trim() !== '')
  const outcome = JSON.parse(lines.at(-1)!) as {
    type: string
    outcome: { ok: true; value: { sessionIds: string[] } } | { ok: false; error: { reason: string; message: string } }
  }
  expect(outcome.type).toBe('outcome')
  expect(outcome.outcome).toMatchObject({ ok: true, value: { conversationCount: 1, skipped: [] } })
  const sessionId = outcome.outcome.ok ? outcome.outcome.value.sessionIds[0]! : ''
  expect(sessionId).not.toBe('')

  const { chromium } = createRequire(pathToFileURL(join(harness!, 'apps/web/tests/scaffold.ts')))('playwright') as typeof import('playwright')
  const { newEnglishPage, expandOwningTurnProcess } = await import(pathToFileURL(join(harness!, 'apps/web/tests/support.ts')).href) as {
    newEnglishPage(browser: Browser): Promise<Page>
    expandOwningTurnProcess(page: Page, target: Locator): Promise<void>
  }
  resources.browser = await chromium.launch()
  const page = await newEnglishPage(resources.browser)
  const errors: string[] = []
  page.on('pageerror', error => { errors.push(error.message) })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('treeitem').filter({ has: page.getByText(TITLE, { exact: true }) }).click({ timeout: 20_000 })
  await page.getByText(QUESTION, { exact: true }).first().waitFor({ timeout: 20_000 })
  return { scaffold, page, sessionId, errors, expandOwningTurnProcess }
}

describe.skipIf(harness === undefined || !existsSync(join(harness, 'packages/experimental/deepseek-chat-import/package.json')))('DeepSeek website Sessions consumed by community plugins', () => {
  it('renders history without inventing files, jobs or measured request metadata', async () => {
    const { scaffold, page, sessionId, errors, expandOwningTurnProcess } = await boot()
    const searchRow = page.locator('[data-tool="web_search"] [data-expandable]').first()
    await expandOwningTurnProcess(page, searchRow)
    await searchRow.click()
    await page.getByText('Central Station City Museum bus').first().waitFor()
    const searchCard = page.locator('[data-web="search"]')
    await searchCard.waitFor()
    expect(await searchCard.textContent()).toContain('Route 12 timetable')
    await searchCard.locator('a[href="https://transit.example/routes/12"]').first().waitFor()
    await page.locator('iframe[title="inline card"][sandbox="allow-scripts"]').waitFor()

    const user = page.getByText(QUESTION, { exact: true }).first()
    await user.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    const quote = page.getByRole('toolbar', { name: 'Quote', exact: true })
    await quote.waitFor()
    await quote.getByRole('button', { name: 'Quote to current chat', exact: true }).click()
    await page.locator('[data-composer-input]').getByText(`@Quote “${TITLE}”`, { exact: true }).click()
    const draft = page.locator('#quote-preview-card')
    await draft.waitFor()
    expect(await draft.textContent()).toContain(QUESTION)
    expect(await draft.getAttribute('aria-label')).toBe(`Quote “${TITLE}”`)
    await draft.getByRole('button', { name: 'Close', exact: true }).click()

    const timeline = page.getByRole('navigation', { name: 'Message timeline', exact: true })
    await timeline.waitFor()
    expect(await timeline.textContent()).toContain(QUESTION)

    const session = scaffold.ctx.agents.get(sessionId)?.session ?? scaffold.ctx.sessions.get(sessionId)
    expect(session).toBeDefined()
    const events = session!.snapshotEvents()
    expect(events.some(event => event.type === 'user/message'
      && event.data?.content?.some(block => block.type === 'file' && block.attachment?.name === 'notes.pdf'))).toBe(true)
    expect(events.some(event => event.type === 'request/header')).toBe(false)
    expect((await scaffold.ctx.filePreview.list(sessionId)).entries).toEqual([])
    expect(scaffold.ctx.jobs.list()).toEqual([])
    const trend = await scaffold.ctx.requestInspector.getSessionTrend(sessionId)
    expect(trend.official?.session).toMatchObject({ turns: 1, steps: 3 })
    expect(errors).toEqual([])
  }, 120_000)

  it('keeps the existing user-role fallback when withdrawing and restoring an imported reply', async () => {
    const { scaffold, sessionId, errors } = await boot()
    const session = scaffold.ctx.agents.get(sessionId)?.session ?? scaffold.ctx.sessions.get(sessionId)
    expect(session).toBeDefined()
    const target = session!.snapshotEvents().find(event => event.type === 'user/message')
    expect(target).toBeDefined()
    const beforeAssistants = session!.snapshotEvents().filter(event => event.type === 'assistant/message').length

    expect(await scaffold.ctx.messageTools.withdraw({ sessionId, targetSeq: target!.seq })).toMatchObject({ ok: true })
    expect(await scaffold.ctx.messageTools.restore({ sessionId, targetSeq: target!.seq })).toMatchObject({ ok: true })

    const events = session!.snapshotEvents()
    expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(beforeAssistants)
    const restored = events.at(-1)!
    expect(restored.type).toBe('user/message')
    expect(restored.data?.source).toMatchObject({ kind: 'message-tools', op: 'restore-assistant' })
    expect(restored.data?.content?.[0]?.text).toContain(ANSWER)
    expect(restored.data?.content?.[0]?.text).toContain(NOTICE)
    expect(errors).toEqual([])
  }, 120_000)
})
