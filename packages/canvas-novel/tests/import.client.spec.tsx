// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ImportNovel } from '../src/client/ImportNovel.tsx'
import type { NovelRemote, NovelSurfaceProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { NOVEL_GENRE_ID } from '../src/types.ts'
import TYPERT_REMOTE from '@khorsheed/dsh-canvas-novel/remote'

const SESSION = 's-import' as SessionId
const CANVAS = 'canvas_import'
const t = ((key: keyof typeof zh, params?: Record<string, string | number>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))) as NovelSurfaceProps['t']
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const directoryDescriptor = TYPERT_REMOTE.descriptors.find(descriptor => descriptor.namespace === 'novel' && descriptor.method === 'importDirectory')!

function fixture(remote: NovelRemote, sendToConversation?: NovelSurfaceProps['sendToConversation'], directoryFlow?: NovelSurfaceProps['directoryFlow']) {
  const navigate = { openCard: vi.fn(), openPage: vi.fn(), openManuscripts: vi.fn(), refresh: vi.fn() }
  const props: NovelSurfaceProps = {
    canvasId: CANVAS,
    board: { id: CANVAS, title: '导入作品', genre: { id: NOVEL_GENRE_ID } },
    rev: 0,
    sessionId: SESSION,
    navigate,
    remote: () => remote,
    t,
    ...(sendToConversation === undefined ? {} : { sendToConversation }),
    ...(directoryFlow === undefined ? {} : { directoryFlow }),
  }
  return { props, navigate }
}

function novelFile(title = 'book.txt', chapters = 3): File {
  const text = Array.from({ length: chapters }, (_, index) => `第${index + 1}章 标题${index + 1}\n正文${index + 1}。`).join('\n')
  return new File([text], title)
}

async function openPreview(file: File): Promise<HTMLElement> {
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!
  fireEvent.change(input, { target: { files: [file] } })
  await screen.findByText('第1章 标题1')
  return input
}

describe('ImportNovel', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('previews split chapters, imports them in order and reconciles the allocated numbers', async () => {
    const importOwnChapter = vi.fn()
      .mockResolvedValueOnce(ok({ ok: true, n: 4 }))
      .mockResolvedValueOnce(ok({ ok: true, n: 5 }))
    const remote = { importOwnChapter } as unknown as NovelRemote
    const send = vi.fn(() => 'sent' as const)
    const { props, navigate } = fixture(remote, send)
    render(<ImportNovel {...props} />)
    await openPreview(novelFile('book.txt', 2))
    fireEvent.click(screen.getByRole('button', { name: '导入 2 章并对账' }))
    await screen.findByText('已导入 2 章，Agent 已开始逐章对账；结果会陆续写入画布。')
    expect(importOwnChapter.mock.calls.map(call => call[1])).toEqual([
      { canvasId: CANVAS, title: '第1章 标题1', text: '正文1。' },
      { canvasId: CANVAS, title: '第2章 标题2', text: '正文2。' },
    ])
    expect(send).toHaveBeenCalledWith(SESSION, '请按章节顺序逐章对账第 4、5 章，直到全部完成；每章按 novel_extract(prepare) → subagent → novel_extract(import) 流程，不改正文。')
    expect(navigate.refresh).toHaveBeenCalled()
  })

  it('does not import a chapter the person unchecks, and reports a drafted reconciliation request', async () => {
    const importOwnChapter = vi.fn(() => ok({ ok: true, n: 1 }))
    const remote = { importOwnChapter } as unknown as NovelRemote
    const send = vi.fn(() => 'drafted' as const)
    const { props } = fixture(remote, send)
    render(<ImportNovel {...props} />)
    await openPreview(novelFile('book.txt', 2))
    fireEvent.click(screen.getByRole('checkbox', { name: '导入「第2章 标题2」' }))
    fireEvent.click(screen.getByRole('button', { name: '导入 1 章并对账' }))
    await screen.findByText('已导入 1 章。对账请求已放进对话输入框，发送后开始整理。')
    expect(importOwnChapter).toHaveBeenCalledTimes(1)
    expect(importOwnChapter).toHaveBeenCalledWith(SESSION, { canvasId: CANVAS, title: '第1章 标题1', text: '正文1。' })
  })

  it('stops after a failed write, then resumes the remainder and reconciles every imported chapter', async () => {
    const importOwnChapter = vi.fn()
      .mockResolvedValueOnce(ok({ ok: true, n: 5 }))
      .mockResolvedValueOnce(ok({ ok: false, error: 'denied' }))
      .mockResolvedValueOnce(ok({ ok: true, n: 6 }))
      .mockResolvedValueOnce(ok({ ok: true, n: 7 }))
    const remote = { importOwnChapter } as unknown as NovelRemote
    const send = vi.fn(() => 'sent' as const)
    const { props, navigate } = fixture(remote, send)
    render(<ImportNovel {...props} />)
    await openPreview(novelFile())
    fireEvent.click(screen.getByRole('button', { name: '导入 3 章并对账' }))
    await screen.findByRole('alert')
    expect(importOwnChapter).toHaveBeenCalledTimes(2)
    expect(send).not.toHaveBeenCalled()
    expect(navigate.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText('已导入第 5 章')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '继续导入剩余 2 章' }))
    await screen.findByText('已导入 3 章，Agent 已开始逐章对账；结果会陆续写入画布。')
    expect(importOwnChapter).toHaveBeenCalledTimes(4)
    expect(send).toHaveBeenCalledWith(SESSION, expect.stringContaining('第 5、6、7 章'))
  })

  it('asks for Word documents as text without offering an empty import', async () => {
    const importOwnChapter = vi.fn()
    const remote = { importOwnChapter } as unknown as NovelRemote
    const { props } = fixture(remote)
    render(<ImportNovel {...props} />)
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    expect(input.accept).toBe('.txt,.md,.markdown')
    fireEvent.change(input, { target: { files: [new File(['Word prose'], 'chapter.docx')] } })
    await screen.findByText('chapter.docx：Word（.doc/.docx）请先另存为 UTF-8 TXT 或 Markdown')
    expect(screen.getByText('没有可导入的章节。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /导入 \d+ 章并对账/ })).toBeNull()
    expect(importOwnChapter).not.toHaveBeenCalled()
  })

  it('loads a host-picked folder into the same preview and imports it', async () => {
    expect(directoryDescriptor.parameters).toHaveLength(2)
    const importDirectory = vi.fn((...args: unknown[]) => {
      if (args.length !== directoryDescriptor.parameters.length) {
        return Promise.reject(new Error(`client api: novel/importDirectory expected ${directoryDescriptor.parameters.length} argument(s), got ${args.length}`))
      }
      return ok({
        ok: true,
        rootName: 'source',
        files: [{ file: '01/第一章.txt', titleBase: '第一章.txt', data: new TextEncoder().encode('第一章 门\n他推开门。') }],
        issues: [],
        skipped: 2,
        truncated: true,
      })
    })
    const importOwnChapter = vi.fn(() => ok({ ok: true, n: 1 }))
    const send = vi.fn(() => 'sent' as const)
    const remote = { importDirectory, importOwnChapter } as unknown as NovelRemote
    const { props } = fixture(remote, send)
    render(<ImportNovel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '导入文件夹' }))
    await screen.findByText('第一章 门')
    expect(screen.getByText('文件夹：source')).toBeTruthy()
    expect(screen.getByText('已跳过 2 个隐藏、系统或不支持的文件')).toBeTruthy()
    expect(screen.getByText('目录内容超过导入上限，这里只显示前一部分；请分批选择子文件夹。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导入 1 章并对账' }))
    await screen.findByText('已导入 1 章，Agent 已开始逐章对账；结果会陆续写入画布。')
    expect(importDirectory).toHaveBeenCalledWith(SESSION, undefined)
    expect(importOwnChapter).toHaveBeenCalledWith(SESSION, { canvasId: CANVAS, title: '第一章 门', text: '他推开门。' })
    await expect(importDirectory(SESSION)).rejects.toThrow('client api: novel/importDirectory expected 2 argument(s), got 1')
  })

  it('uses the host directory flow when the native picker is unavailable', async () => {
    const importDirectory = vi.fn()
      .mockResolvedValueOnce(ok({ ok: false, error: 'browse', files: [], issues: [], skipped: 0, truncated: false }))
      .mockResolvedValueOnce(ok({
        ok: true,
        rootName: 'source',
        files: [{ file: '第一章.txt', titleBase: '第一章.txt', data: new TextEncoder().encode('第一章 门\n他推开门。') }],
        issues: [],
        skipped: 0,
        truncated: false,
      }))
    const remote = { importDirectory } as unknown as NovelRemote
    const directoryFlow: NovelSurfaceProps['directoryFlow'] = () => ({ open, onPicked }) => open
      ? <button type="button" onClick={() => onPicked('/home/user/source')}>宿主目录选择器</button>
      : null
    const { props } = fixture(remote, undefined, directoryFlow)
    render(<ImportNovel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '导入文件夹' }))
    fireEvent.click(await screen.findByRole('button', { name: '宿主目录选择器' }))
    await screen.findByText('第一章 门')
    expect(importDirectory).toHaveBeenNthCalledWith(1, SESSION, undefined)
    expect(importDirectory).toHaveBeenNthCalledWith(2, SESSION, { path: '/home/user/source' })
  })

  it('closes without an error when the native folder picker is cancelled', async () => {
    const importDirectory = vi.fn(() => ok({ ok: false, error: 'cancelled', files: [], issues: [], skipped: 0, truncated: false }))
    const remote = { importDirectory } as unknown as NovelRemote
    const { props } = fixture(remote)
    render(<ImportNovel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '导入文件夹' }))
    await waitFor(() => expect(screen.queryByText('导入已有小说')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers multi-file upload when the host has no picker, and hides folder import off-host', async () => {
    const importDirectory = vi.fn(() => ok({ ok: false, error: 'unsupported', files: [], issues: [], skipped: 0, truncated: false }))
    const remote = { importDirectory } as unknown as NovelRemote
    const { props } = fixture(remote)
    const first = render(<ImportNovel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '导入文件夹' }))
    await screen.findByText('当前宿主没有目录选择能力，请改用「选择文档」多选文件。')
    first.unmount()
    vi.stubGlobal('location', { hostname: 'remote.example' })
    render(<ImportNovel {...props} />)
    expect(screen.queryByRole('button', { name: '导入文件夹' })).toBeNull()
    expect(screen.getByRole('button', { name: '导入小说' })).toBeTruthy()
  })
})
